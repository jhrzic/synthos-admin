// ---------------------------------------------------------------------------
// SYNTHOS — TON telemetry persistence, adapted from the real, shipped
// implementation at ~/synthos/mission-control/src/lib/ton-analytics.ts.
//
// The aggregation logic is unchanged: every metric is a real SQL aggregate
// over ton_telemetry_events, gated by hasTelemetry so an empty workspace
// returns null/"unavailable" metrics rather than fabricated zeroes. Adapted
// only for this repo's conventions: TEXT workspace_id/event ids (not
// INTEGER), and TEXT ISO-8601 occurred_at (not INTEGER unixepoch) — SQLite's
// date() works directly on ISO-8601 strings, so the trend query needs no
// 'unixepoch' modifier.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { getDatabase } from './persistence';

export const TON_EVENT_TYPES = [
  'campaign',
  'acquisition',
  'install',
  'attribution',
  'fraud_block',
  'wallet_link',
  'escrow_deposit',
  'verification',
  'settlement',
  'payout',
] as const;

export type TonEventType = (typeof TON_EVENT_TYPES)[number];

export interface TonTelemetryInput {
  eventType: TonEventType;
  channel?: string | null;
  walletHint?: string | null;
  amountUsdt?: number | null;
  spendUsd?: number | null;
  revenueUsd?: number | null;
  verified?: boolean;
  blockedReason?: string | null;
  latencyMs?: number | null;
  txHash?: string | null;
  detail?: Record<string, unknown> | null;
  /** ISO-8601 timestamp of when the event occurred. Defaults to now. */
  occurredAt?: string;
}

export interface TonAnalyticsSnapshot {
  rangeDays: number;
  hasTelemetry: boolean;
  metrics: {
    managedSpendUsd: number | null;
    verifiedInstalls: number | null;
    fraudBlockRate: number | null;
    d7Roas: number | null;
    settledUsdt: number | null;
    acquisitions: number | null;
    verifiedEvents: number | null;
    payoutCount: number | null;
    uniqueChannels: number | null;
    linkedWallets: number | null;
    averageLatencyMs: number | null;
  };
  trend: Array<{ day: string; acquisitions: number; verified: number; blocked: number; spendUsd: number; revenueUsd: number; settledUsdt: number }>;
  activity: Array<{
    id: string;
    eventType: TonEventType;
    channel: string | null;
    walletHint: string | null;
    amountUsdt: number | null;
    verified: boolean;
    blockedReason: string | null;
    latencyMs: number | null;
    txHash: string | null;
    occurredAt: string;
  }>;
  topology: {
    channels: Array<{ name: string; events: number }>;
    wallets: Array<{ hint: string; events: number }>;
  };
}

const cleanText = (value: string | null | undefined, max = 160): string | null => {
  const cleaned = String(value || '').trim();
  return cleaned ? cleaned.slice(0, max) : null;
};

const finiteOrNull = (value: number | null | undefined, min = 0): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= min ? value : null;

export function recordTonTelemetry(workspaceId: string, input: TonTelemetryInput): string {
  if (!TON_EVENT_TYPES.includes(input.eventType)) throw new Error('Unsupported TON telemetry event type');
  const db = getDatabase();
  const occurredAt = input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt))
    ? input.occurredAt
    : new Date().toISOString();
  const detailJson = input.detail ? JSON.stringify(input.detail) : null;
  if (detailJson && detailJson.length > 16_384) throw new Error('TON telemetry detail is too large');

  const eventId = `tt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ton_telemetry_events (
      event_id, workspace_id, event_type, channel, wallet_hint, amount_usdt,
      spend_usd, revenue_usd, verified, blocked_reason, latency_ms,
      tx_hash, detail_json, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    workspaceId,
    input.eventType,
    cleanText(input.channel, 120),
    cleanText(input.walletHint, 96),
    finiteOrNull(input.amountUsdt),
    finiteOrNull(input.spendUsd),
    finiteOrNull(input.revenueUsd),
    input.verified ? 1 : 0,
    cleanText(input.blockedReason, 240),
    finiteOrNull(input.latencyMs),
    cleanText(input.txHash, 160),
    detailJson,
    occurredAt,
    now,
  );
  return eventId;
}

function n(value: unknown): number {
  return Number(value || 0);
}

function nullableMetric(value: number, hasTelemetry: boolean): number | null {
  return hasTelemetry ? value : null;
}

export function tonAnalyticsSnapshot(workspaceId: string, rangeDays = 30): TonAnalyticsSnapshot {
  const db = getDatabase();
  const days = Math.min(90, Math.max(7, Math.floor(rangeDays)));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const d7Cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const aggregate = db.prepare(`
    SELECT
      COUNT(*) AS event_count,
      COALESCE(SUM(spend_usd), 0) AS spend,
      COALESCE(SUM(revenue_usd), 0) AS revenue,
      COALESCE(SUM(CASE WHEN event_type = 'install' AND verified = 1 THEN 1 ELSE 0 END), 0) AS verified_installs,
      COALESCE(SUM(CASE WHEN event_type IN ('install','attribution','fraud_block') THEN 1 ELSE 0 END), 0) AS fraud_denominator,
      COALESCE(SUM(CASE WHEN event_type = 'fraud_block' OR blocked_reason IS NOT NULL THEN 1 ELSE 0 END), 0) AS blocked,
      COALESCE(SUM(CASE WHEN event_type IN ('settlement','payout') THEN amount_usdt ELSE 0 END), 0) AS settled,
      COALESCE(SUM(CASE WHEN event_type = 'acquisition' THEN 1 ELSE 0 END), 0) AS acquisitions,
      COALESCE(SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END), 0) AS verified_events,
      COALESCE(SUM(CASE WHEN event_type = 'payout' THEN 1 ELSE 0 END), 0) AS payouts,
      COUNT(DISTINCT CASE WHEN channel IS NOT NULL THEN channel END) AS channels,
      COUNT(DISTINCT CASE WHEN wallet_hint IS NOT NULL THEN wallet_hint END) AS wallets,
      AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) AS average_latency
    FROM ton_telemetry_events
    WHERE workspace_id = ? AND occurred_at >= ?
  `).get(workspaceId, cutoff) as Record<string, unknown>;

  const d7 = db.prepare(`
    SELECT COALESCE(SUM(spend_usd), 0) AS spend, COALESCE(SUM(revenue_usd), 0) AS revenue
      FROM ton_telemetry_events
     WHERE workspace_id = ? AND occurred_at >= ?
  `).get(workspaceId, d7Cutoff) as Record<string, unknown>;

  const hasTelemetry = n(aggregate.event_count) > 0;
  const fraudDenominator = n(aggregate.fraud_denominator);
  const spend7 = n(d7.spend);

  const trend = (db.prepare(`
    SELECT date(occurred_at) AS day,
      SUM(CASE WHEN event_type = 'acquisition' THEN 1 ELSE 0 END) AS acquisitions,
      SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN event_type = 'fraud_block' OR blocked_reason IS NOT NULL THEN 1 ELSE 0 END) AS blocked,
      COALESCE(SUM(spend_usd), 0) AS spend_usd,
      COALESCE(SUM(revenue_usd), 0) AS revenue_usd,
      COALESCE(SUM(CASE WHEN event_type IN ('settlement','payout') THEN amount_usdt ELSE 0 END), 0) AS settled_usdt
    FROM ton_telemetry_events
    WHERE workspace_id = ? AND occurred_at >= ?
    GROUP BY day ORDER BY day
  `).all(workspaceId, cutoff) as any[]).map((row) => ({
    day: String(row.day),
    acquisitions: n(row.acquisitions),
    verified: n(row.verified),
    blocked: n(row.blocked),
    spendUsd: n(row.spend_usd),
    revenueUsd: n(row.revenue_usd),
    settledUsdt: n(row.settled_usdt),
  }));

  const activity = (db.prepare(`
    SELECT event_id, event_type, channel, wallet_hint, amount_usdt, verified,
           blocked_reason, latency_ms, tx_hash, occurred_at
      FROM ton_telemetry_events
     WHERE workspace_id = ? AND occurred_at >= ?
     ORDER BY occurred_at DESC, event_id DESC LIMIT 40
  `).all(workspaceId, cutoff) as any[]).map((row) => ({
    id: String(row.event_id),
    eventType: String(row.event_type) as TonEventType,
    channel: row.channel == null ? null : String(row.channel),
    walletHint: row.wallet_hint == null ? null : String(row.wallet_hint),
    amountUsdt: row.amount_usdt == null ? null : Number(row.amount_usdt),
    verified: Number(row.verified) === 1,
    blockedReason: row.blocked_reason == null ? null : String(row.blocked_reason),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    txHash: row.tx_hash == null ? null : String(row.tx_hash),
    occurredAt: String(row.occurred_at),
  }));

  const top = (column: 'channel' | 'wallet_hint') => db.prepare(`
    SELECT ${column} AS value, COUNT(*) AS events
      FROM ton_telemetry_events
     WHERE workspace_id = ? AND occurred_at >= ? AND ${column} IS NOT NULL
     GROUP BY ${column} ORDER BY events DESC LIMIT 8
  `).all(workspaceId, cutoff) as Array<{ value: string; events: number }>;

  return {
    rangeDays: days,
    hasTelemetry,
    metrics: {
      managedSpendUsd: nullableMetric(n(aggregate.spend), hasTelemetry),
      verifiedInstalls: nullableMetric(n(aggregate.verified_installs), hasTelemetry),
      fraudBlockRate: fraudDenominator > 0 ? n(aggregate.blocked) / fraudDenominator : null,
      d7Roas: spend7 > 0 ? n(d7.revenue) / spend7 : null,
      settledUsdt: nullableMetric(n(aggregate.settled), hasTelemetry),
      acquisitions: nullableMetric(n(aggregate.acquisitions), hasTelemetry),
      verifiedEvents: nullableMetric(n(aggregate.verified_events), hasTelemetry),
      payoutCount: nullableMetric(n(aggregate.payouts), hasTelemetry),
      uniqueChannels: nullableMetric(n(aggregate.channels), hasTelemetry),
      linkedWallets: nullableMetric(n(aggregate.wallets), hasTelemetry),
      averageLatencyMs: aggregate.average_latency == null ? null : Number(aggregate.average_latency),
    },
    trend,
    activity,
    topology: {
      channels: top('channel').map((row) => ({ name: String(row.value), events: n(row.events) })),
      wallets: top('wallet_hint').map((row) => ({ hint: String(row.value), events: n(row.events) })),
    },
  };
}
