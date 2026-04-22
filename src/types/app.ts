export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'gemini';
export type ConversationMode = 'chat' | 'harness';
export type SendMode = 'use_default' | 'force_chat' | 'force_harness';
export type HarnessAvailability =
  | 'available'
  | 'unavailable_no_claude'
  | 'unavailable_project_unknown';
export type HarnessTaskSummaryState = 'idle' | 'fresh' | 'stale' | 'blocked' | 'invalidated';
export type SubagentMode = 'inherit' | 'override' | 'unsupported';
export interface HarnessGateState {
  reviewStatus: 'pending' | 'passed' | 'failed' | 'invalidated';
  validationStatus: 'pending' | 'passed' | 'failed' | 'invalidated';
  humanDecision: 'pending' | 'approved' | 'rejected' | 'not_required';
  blockers: string[];
}

export type AppTab = 'chat' | 'harness' | 'files' | 'shell' | 'git' | 'tasks' | 'preview' | `plugin:${string}`;

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  __provider?: LLMProvider;
  __projectName?: string;
  defaultConversationMode?: ConversationMode;
  activeHarnessTaskId?: string | null;
  activeHarnessStage?: string | null;
  taskSummaryState?: HarnessTaskSummaryState;
  harnessAvailability?: HarnessAvailability;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  harnessAvailability?: HarnessAvailability;
  harnessReason?: string | null;
  [key: string]: unknown;
}

export interface SubagentModelConfig {
  provider: LLMProvider;
  reviewerMode: SubagentMode;
  reviewerModel?: string;
  validatorMode: SubagentMode;
  validatorModel?: string;
}

export interface HarnessProviderCapability {
  provider: LLMProvider;
  displayName: string;
  supportsSubagentModelOverride: boolean;
  supportsNativeCommand: boolean;
  supportsNativeConfig: boolean;
  supportsNativeApi: boolean;
  defaultMode: SubagentMode;
  availableModels: string[];
  modelSourceType: string;
  modelSourceRef: string;
}

export interface HarnessProviderSettings extends HarnessProviderCapability, SubagentModelConfig {}

export interface HarnessSubagentSettingsResponse {
  selectedProvider: LLMProvider;
  providers: HarnessProviderSettings[];
}

export interface HarnessTask {
  taskId: string;
  sessionId: string | null;
  projectPath: string;
  title: string;
  status: 'active' | 'blocked' | 'done' | 'cancelled';
  taskSummaryState: HarnessTaskSummaryState;
  primeState: 'unprimed' | 'primed' | 'stale';
  currentStage: string;
  activePackVersions: Record<string, number>;
  artifactBindings: Array<{
    kind: 'plan' | 'decision' | 'rca' | 'review' | 'report';
    path: string;
    hash: string;
    status: 'fresh' | 'stale' | 'invalidated' | 'superseded';
  }>;
  sourceHashes: Record<string, string>;
  subagentModelConfig: SubagentModelConfig | null;
  activeGate: HarnessGateState | null;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessPackRecord {
  packType: 'prime' | 'plan' | 'review' | 'validation' | string;
  version: number;
  path: string;
  basedOnArtifacts: string[];
  basedOnHashes: Record<string, string>;
  status: 'fresh' | 'stale' | 'invalidated' | 'superseded';
}

export interface HarnessWorkspaceStatus {
  projectPath: string | null;
  harnessAvailability: HarnessAvailability;
  reason: string | null;
  workspacePrimeState: 'unprimed' | 'primed' | 'stale';
  currentTaskId: string | null;
  currentStage: string | null;
  lastPrimedAt: string | null;
  commandCount: number;
  artifactCount: number;
  staleReasons: string[];
}

export interface HarnessCommandRegistryEntry {
  name: string;
  canonicalName: string;
  type: 'canonical' | 'alias' | string;
  stage: string;
  requiresHarness: boolean;
  path: string;
  relativePath: string;
  description: string;
  preconditions: string[];
  nextStages: string[];
  artifacts: string[];
  metadata?: Record<string, unknown>;
}

export interface HarnessArtifactRecord {
  artifactId: string;
  kind: 'plan' | 'decision' | 'rca' | 'review' | 'report' | string;
  path: string;
  relativePath: string;
  hash: string;
  status: 'fresh' | 'stale' | 'invalidated' | 'superseded';
  boundTaskId: string | null;
  updatedAt: string;
  size?: number;
}

export interface HarnessTimelineEntry {
  entryType: 'run' | 'event';
  timestamp: string;
  stage: string | null;
  lane: string;
  status: string;
  summary: string | null;
  inputPackVersion: number | null;
  blockers: string[];
  modelResolution?: HarnessRunRecord['modelResolution'];
  source: Record<string, unknown>;
}

export interface HarnessRunRecord {
  runId: string;
  taskId?: string;
  sequence: number;
  role: 'main' | 'reviewer' | 'validator' | string;
  stage: string;
  status: string;
  inputPackVersion?: number | null;
  findingsCount?: number;
  blockers?: string[];
  summary?: string;
  modelResolution?: {
    provider: LLMProvider;
    lane: 'review' | 'validation' | string;
    configuredMode: SubagentMode;
    configuredModel: string | null;
    resolvedMode: 'inherit' | 'override' | 'unsupported';
    resolvedModel: string | null;
    resolutionReason: string;
  } | null;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessEvalDatasetTask {
  taskKey: string;
  repositoryClass: string;
  taskType: string;
  difficulty: string;
  title: string;
}

export interface HarnessEvalDataset {
  datasetId: string;
  name: string;
  provider: LLMProvider | string;
  description: string;
  tasks: HarnessEvalDatasetTask[];
  frozenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessEvalResult {
  resultId: string;
  benchmarkName: string;
  datasetId: string;
  provider: LLMProvider | string;
  roundLabel: string;
  taskCount: number;
  runCount: number;
  metrics: {
    baselineSuccessRate: number;
    harnessSuccessRate: number;
    baselineFirstPassRate: number;
    harnessFirstPassRate: number;
    m19: number;
    m20: number;
    m21: number;
    m22: number;
    m24: number;
  };
  validity: {
    providerGrouped: boolean;
    minimumTaskCountMet: boolean;
    minimumAttemptsMet: boolean;
    reproducibilityMet: boolean;
    hallucinationGuardMet: boolean;
    roundCountForProvider: number;
  };
  runs: Array<{
    taskKey: string;
    mode: 'baseline' | 'harness';
    attempt: number;
    success: boolean;
    firstPassValidation: boolean;
    hallucinationEvents: number;
    outOfScopeEdits: boolean;
    signature: string;
  }>;
  createdAt: string;
}

export interface HarnessEvalSummary {
  provider: LLMProvider | string | null;
  datasetId: string | null;
  totalResults: number;
  latestMetrics: HarnessEvalResult['metrics'] | null;
  rounds: Array<{
    resultId: string;
    roundLabel: string;
    datasetId: string;
    provider: string;
    metrics: HarnessEvalResult['metrics'];
    validity: HarnessEvalResult['validity'];
    createdAt: string;
  }>;
  thresholds: {
    m19Met: boolean;
    m20Met: boolean;
    m21Met: boolean;
    m22Met: boolean;
    m24Met: boolean;
    minimumRoundsMet: boolean;
  };
  directionConsistencyMet: boolean;
  claimEligible: boolean;
}

export interface HarnessCheckpointRecord {
  checkpointId: string;
  taskId: string;
  projectPath: string;
  reason: string;
  createdAt: string;
  snapshot: {
    task: HarnessTask;
    packs: HarnessPackRecord[];
    runs: HarnessRunRecord[];
    gate: HarnessGateState | null;
  };
}

export interface HarnessKnowledgeFeedbackRecord {
  feedbackId: string;
  projectPath: string;
  sourceTaskId: string | null;
  targetLayer: string;
  title: string;
  summary: string;
  evidencePaths: string[];
  status: string;
  createdAt: string;
  relativePath: string;
}

export interface HarnessBootstrapResult {
  projectPath: string;
  created: boolean;
  alreadyInitialized: boolean;
  createdFiles: string[];
  harnessAvailability: HarnessAvailability;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  [key: string]: unknown;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | { type?: string;[key: string]: unknown };
