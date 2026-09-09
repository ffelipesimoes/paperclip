import type { BillingType, CostStatus } from "../constants.js";

export interface CostEvent {
  id: string;
  companyId: string;
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  goalId: string | null;
  heartbeatRunId: string | null;
  billingCode: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  costStatus: CostStatus;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  occurredAt: Date;
  createdAt: Date;
}

export interface CostSummary {
  companyId: string;
  spendCents: number;
  budgetCents: number;
  utilizationPercent: number;
  simulatedCostCents?: number;
  subscriptionTokens?: number;
}

export interface IssueCostSummary {
  issueId: string;
  issueCount: number;
  includeDescendants: boolean;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** number of distinct heartbeat runs aggregated across the issue tree */
  runCount: number;
  /** sum of wall-clock duration of each run in the tree (ms);
   * still-running runs contribute (now - startedAt) so this ticks up live */
  runtimeMs: number;
}

export interface CostByAgent {
  agentId: string;
  agentName: string | null;
  agentStatus: string | null;
  costCents: number;
  simulatedCostCents?: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface CostByProviderModel {
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  costCents: number;
  simulatedCostCents?: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface CostByBiller {
  biller: string;
  costCents: number;
  simulatedCostCents?: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
  providerCount: number;
  modelCount: number;
}

/** per-agent breakdown by provider + model, for identifying token-hungry agents */
export interface CostByAgentModel {
  agentId: string;
  agentName: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  costCents: number;
  simulatedCostCents?: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** spend per provider for a fixed rolling time window */
export interface CostWindowSpendRow {
  provider: string;
  biller: string;
  /** duration label, e.g. "5h", "24h", "7d" */
  window: string;
  /** rolling window duration in hours */
  windowHours: number;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** cost attributed to a project via heartbeat run → activity log → issue → project chain */
export interface CostByProject {
  projectId: string | null;
  projectName: string | null;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface CompanyComputeUsage {
  companyId: string;
  companyName: string;
  companyPrefix: string;
  companyStatus: "active" | "paused" | "archived";
  createdAt: string;
  agentCount: number;
  activeAgentCount: number;
  issueCount: number;
  runCount: number;
  activeRunCount: number;
  runtimeMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  simulatedCostCents: number;
  subscriptionTokens: number;
  subscriptionRunCount: number;
}

export interface HostComputeResources {
  cpuCount: number;
  cpuModel?: string;
  loadAvg: [number, number, number];
  totalMemBytes: number;
  freeMemBytes: number;
  usedMemBytes: number;
  processRssBytes: number;
  processHeapUsedBytes: number;
  processHeapTotalBytes: number;
  uptimeSeconds: number;
  hostUptimeSeconds: number;
  activeWorkers: number;
  diskTotalBytes?: number;
  diskFreeBytes?: number;
  diskUsedBytes?: number;
}

export interface ModelComputeUsage {
  model: string;
  provider: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  simulatedCostCents: number;
  percentage: number;
}

export interface ComputeTimelinePoint {
  bucket: string;
  label: string;
  runCount: number;
  runtimeMs: number;
  tokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  simulatedCostCents: number;
}

export interface CostlyTask {
  issueId: string;
  issueTitle: string;
  companyName: string;
  companyPrefix: string;
  agentName: string;
  totalTokens: number;
  simulatedCostCents: number;
  latestRunId?: string | null;
}

export interface AgentTraceNode {
  id: string;
  seq: number;
  parentId?: string | null;
  kind: "thought" | "tool_call" | "subagent" | "message" | "lifecycle" | "error";
  title: string;
  name?: string;
  status: "success" | "running" | "error";
  durationMs?: number;
  tokens?: { input: number; cached: number; output: number };
  input?: unknown;
  output?: unknown;
  startedAt: string;
  finishedAt?: string;
  children?: AgentTraceNode[];
}

export interface AgentRunTrace {
  runId: string;
  agentId: string;
  agentName: string;
  issueId?: string | null;
  issueTitle?: string | null;
  companyPrefix?: string | null;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  durationMs: number;
  totalTokens: number;
  simulatedCostCents: number;
  nodes: AgentTraceNode[];
}

export interface TaskCostDetail {
  issueId: string;
  issueTitle: string;
  issueNumber?: number | null;
  identifier?: string | null;
  companyId: string;
  companyName: string;
  companyPrefix: string;
  status: string;
  priority: string;
  originKind: string;
  createdByUserId?: string | null;
  agentName?: string | null;
  runCount: number;
  runtimeMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  costCents: number;
  simulatedCostCents: number;
  latestRunId?: string | null;
}

export interface AgentComputeUsage {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentStatus: string;
  companyId: string;
  companyName: string;
  companyPrefix: string;
  runCount: number;
  activeRunCount: number;
  runtimeMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  simulatedCostCents: number;
  avgDurationMs: number;
  tokensPerSecond: number;
}

export interface InstanceObservabilitySummary {
  window: string;
  totalCompanies: number;
  activeCompanies: number;
  totalAgents: number;
  activeAgents: number;
  totalIssues: number;
  totalRuns: number;
  activeRuns: number;
  totalRuntimeMs: number;
  avgRunDurationMs: number;
  tokensPerSecond: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  simulatedCacheSavingsCents: number;
  billedCostCents: number;
  simulatedCostCents: number;
  subscriptionTokens: number;
  subscriptionRunCount: number;
  host?: HostComputeResources;
  models: ModelComputeUsage[];
  timeline: ComputeTimelinePoint[];
  costlyTasks: CostlyTask[];
  tasks: TaskCostDetail[];
  agents: AgentComputeUsage[];
  companies: CompanyComputeUsage[];
}
