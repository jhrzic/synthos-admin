/**
 * SynthOS Core Types: Governance, Guardian, Aegis, Receipts, Workspaces & Ledger
 */
import { AgentRole, KanbanTask, ObsidianNote } from './index';

export type TaskStatus = 'backlog' | 'in-progress' | 'review' | 'done' | 'failed';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical' | 'P0' | 'P1' | 'P2' | 'P3';

export type SystemExecutionMode = 'LIVE_ONLINE' | 'SIMULATED_TEST_MODE' | 'DEGRADED_OFFLINE';

export interface GuardianPolicyCheck {
  policyId: string;
  policyName: string;
  approved: boolean;
  reason: string;
  evaluatedAt: string;
  role: AgentRole;
  requiredAuthority: 'operator' | 'admin' | 'owner';
  allowedTools: string[];
  maxTokenBudget: number;
}

export interface AegisVerificationScore {
  score: number; // 0.0 to 1.0
  passed: boolean;
  verificationChecks: {
    checkName: string;
    passed: boolean;
    details: string;
  }[];
  evaluatedAt: string;
  verifier: string;
}

export interface ExecutionReceipt {
  id: string;
  taskId: string;
  taskTitle: string;
  workspaceId: string;
  signatureHash: string;
  guardianPolicyPassed: boolean;
  aegisVerificationScore: number;
  assignedRole: AgentRole;
  modelUsed: string;
  latencyMs: number;
  tokensCount: number;
  issuedAt: string;
  isSimulated: boolean;
  vaultArtifactId?: string;
  status: 'VERIFIED' | 'REJECTED' | 'HELD_FOR_APPROVAL';
}

export interface ActivityLedgerEvent {
  id: string;
  workspaceId: string;
  taskId?: string;
  eventType: 
    | 'TASK_CREATED' 
    | 'GUARDIAN_CHECK_PASSED'
    | 'GUARDIAN_CHECK_REJECTED'
    | 'TASK_DISPATCHED' 
    | 'EXECUTION_RUNNING' 
    | 'EXECUTION_SUCCESS' 
    | 'EXECUTION_FAILED' 
    | 'AEGIS_VERIFIED' 
    | 'RECEIPT_ISSUED' 
    | 'VAULT_ARTIFACT_STORED' 
    | 'HUMAN_APPROVAL_REQUESTED'
    | 'TASK_TRIAGED'
    | 'TASK_PROMOTED'
    | 'BUILDER_ARTIFACT_PRODUCED'
    | 'JUDGE_EVALUATED';
  actorRole: AgentRole;
  actorModel?: string;
  summary: string;
  payload: Record<string, any>;
  timestamp: string;
  isSimulated: boolean;
}

export interface VaultArtifact {
  id: string;
  workspaceId: string;
  taskId?: string;
  title: string;
  type: 'markdown' | 'code' | 'json' | 'obsidian_note' | 'receipt';
  content: string;
  wikilinks: string[];
  tags: string[];
  createdAt: string;
  isSimulated: boolean;
}

export interface WorkspaceTenant {
  id: string;
  name: string;
  slug: string;
  tier: 'free' | 'pro' | 'enterprise';
  currentUserRole: 'owner' | 'admin' | 'operator' | 'auditor';
  activeCapabilities: string[];
  guardianActive: boolean;
  aegisReviewRequired: boolean;
  apiHealth: {
    gemini: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    openrouter: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    hermesDb: 'ONLINE' | 'LOCAL_ATTACHED' | 'OFFLINE';
    obsidianSync: 'ONLINE' | 'OFFLINE';
  };
}
