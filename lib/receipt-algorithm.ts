// The one algorithm this build signs receipts with (crypto.sign with an
// Ed25519 key — lib/persistence.ts signReceiptPayload). Pure: safe to import
// from UI tests and anywhere else that must label a receipt.

export const RECEIPT_SIGNING_ALGORITHM = 'Ed25519';

/** Display label for a recorded algorithm: the stored value, or UNKNOWN — never a guess. */
export function receiptAlgorithmLabel(recorded: string | null | undefined): string {
  const v = typeof recorded === 'string' ? recorded.trim() : '';
  return v ? v : 'UNKNOWN';
}
