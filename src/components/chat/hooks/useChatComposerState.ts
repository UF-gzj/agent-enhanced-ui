import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../../../utils/api';
import { thinkingModes } from '../constants/thinkingModes';
import { grantClaudeToolPermission } from '../utils/chatPermissions';
import { safeLocalStorage } from '../utils/chatStorage';
import type {
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
} from '../types/types';
import type {
  HarnessGateState,
  HarnessTaskSummaryState,
  HarnessWorkflowScenario,
  Project,
  ProjectSession,
  LLMProvider,
} from '../../../types/app';
import { useFileMentions } from './useFileMentions';
import { normalizeSlashCommandsResponse, type SlashCommand, useSlashCommands } from './useSlashCommands';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  clearedSessionId: string | null;
  provider: LLMProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  cursorModel: string;
  claudeModel: string;
  codexModel: string;
  geminiModel: string;
  isLoading: boolean;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  pendingViewSessionRef: { current: PendingViewSession | null };
  scrollToBottom: () => void;
  addMessage: (msg: ChatMessage) => void;
  clearMessages: () => void;
  resetSessionView: () => void;
  rewindMessages: (count: number) => void;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

type HarnessProjectCapabilityResponse = {
  projectPath?: string | null;
  harnessAvailability?: 'available' | 'unavailable_no_claude' | 'unavailable_project_unknown';
  reason?: string | null;
};

type ClaudeSubagentConfigResponse = {
  provider: 'claude';
  supportsSubagentModelOverride: boolean;
  reviewerMode: 'inherit' | 'override' | 'unsupported';
  reviewerModel?: string;
  validatorMode: 'inherit' | 'override' | 'unsupported';
  validatorModel?: string;
};

type HarnessLaneRunResponse = {
  success: true;
  task: {
    taskId?: string | null;
    currentStage?: string | null;
    taskSummaryState?: HarnessTaskSummaryState | null;
    primeState?: 'unprimed' | 'primed' | 'stale' | null;
    activeGate?: HarnessGateState | null;
  };
  lane: 'review' | 'validation';
  result: {
    status: 'passed' | 'failed';
    summary: string;
    blockers: string[];
  };
};

type ConversationMode = 'chat' | 'harness';

const getConversationModeStorageKey = (projectName: string) => `conversation_mode_${projectName}`;
const getHarnessScenarioStorageKey = (projectName: string) => `harness_scenario_${projectName}`;
const DEFAULT_HARNESS_SCENARIO: HarnessWorkflowScenario = 'feature';
const HARNESS_CURRENT_TASK_RESET_EVENT = 'harness-current-task-reset';

const getHarnessAvailabilityMessage = (
  t: (key: string, options?: Record<string, unknown>) => string,
  availability: HarnessProjectCapabilityResponse['harnessAvailability'],
  reason?: string | null,
) => {
  if (availability === 'unavailable_no_claude') {
    return t('conversationMode.disabledNoClaude');
  }

  if (reason) {
    return t('conversationMode.disabledWithReason', { reason });
  }

  return t('conversationMode.disabledGeneric');
};

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const FALLBACK_HARNESS_COMMANDS = new Set([
  '/prim',
  '/pln',
  '/exec',
  '/iter',
  '/rca',
  '/fix',
  '/revu',
  '/vald',
  '/cmit',
  '/commit',
  '/core:prime',
  '/core:init-project',
  '/core:refresh-project-context',
  '/core:backend-review-plan',
  '/core:plan',
  '/core:execute',
  '/core:iterate',
  '/bugfix:rca',
  '/bugfix:implement-fix',
  '/validation:validate',
  '/validation:review',
  '/validation:execution-report',
  '/validation:system-review',
  '/core/prime',
  '/core/init-project',
  '/core/refresh-project-context',
  '/core/backend-review-plan',
  '/core/plan',
  '/core/execute',
  '/core/iterate',
  '/bugfix/rca',
  '/bugfix/implement-fix',
  '/validation/validate',
  '/validation/review',
  '/validation/execution-report',
  '/validation/system-review',
]);

const normalizeHarnessCommandName = (commandName: string) =>
  (commandName.startsWith('/') ? commandName : `/${commandName}`).replace(/:/g, '/').toLowerCase();

const isFallbackHarnessCommand = (commandName: string) =>
  FALLBACK_HARNESS_COMMANDS.has(normalizeHarnessCommandName(commandName));

const HARNESS_COMMAND_STAGE_MAP = new Map([
  ['/core:prime', 'prim'],
  ['/prim', 'prim'],
  ['/core/prime', 'prim'],
  ['/core:init-project', 'pinit'],
  ['/pinit', 'pinit'],
  ['/core/init-project', 'pinit'],
  ['/core:refresh-project-context', 'refr'],
  ['/refr', 'refr'],
  ['/core/refresh-project-context', 'refr'],
  ['/core:backend-review-plan', 'bref'],
  ['/bref', 'bref'],
  ['/core/backend-review-plan', 'bref'],
  ['/core:plan', 'pln'],
  ['/pln', 'pln'],
  ['/core/plan', 'pln'],
  ['/core:execute', 'exec'],
  ['/exec', 'exec'],
  ['/core/execute', 'exec'],
  ['/core:iterate', 'iter'],
  ['/iter', 'iter'],
  ['/core/iterate', 'iter'],
  ['/bugfix:rca', 'rca'],
  ['/rca', 'rca'],
  ['/bugfix/rca', 'rca'],
  ['/bugfix:implement-fix', 'fix'],
  ['/fix', 'fix'],
  ['/bugfix/implement-fix', 'fix'],
  ['/validation:review', 'revu'],
  ['/revu', 'revu'],
  ['/validation/review', 'revu'],
  ['/validation:validate', 'vald'],
  ['/vald', 'vald'],
  ['/validation/validate', 'vald'],
  ['/validation:execution-report', 'xrep'],
  ['/xrep', 'xrep'],
  ['/validation/execution-report', 'xrep'],
  ['/validation:system-review', 'srev'],
  ['/srev', 'srev'],
  ['/validation/system-review', 'srev'],
  ['/cmit', 'cmit'],
  ['/commit', 'cmit'],
]);

const HARNESS_PRIMARY_COMMANDS = new Map<string, string>([
  ['prim', '/core:prime'],
  ['pinit', '/core:init-project'],
  ['refr', '/core:refresh-project-context'],
  ['bref', '/core:backend-review-plan'],
  ['pln', '/core:plan'],
  ['exec', '/core:execute'],
  ['iter', '/core:iterate'],
  ['rca', '/bugfix:rca'],
  ['fix', '/bugfix:implement-fix'],
  ['revu', '/validation:review'],
  ['vald', '/validation:validate'],
  ['xrep', '/validation:execution-report'],
  ['srev', '/validation:system-review'],
  ['cmit', '/commit'],
]);

const HARNESS_SCENARIO_BRANCH_BLOCKS: Record<HarnessWorkflowScenario, string[]> = {
  feature: ['rca', 'fix'],
  upgrade: ['rca', 'fix'],
  bugfix: ['pln', 'exec'],
};

const HARNESS_SCENARIO_RECOMMENDED_FLOW: Record<HarnessWorkflowScenario, string[]> = {
  feature: [
    '/core:prime',
    '/core:backend-review-plan',
    '/core:plan',
    '/core:execute',
    '/validation:validate',
    '/validation:review',
    '/validation:execution-report',
    '/validation:system-review',
    '/commit',
  ],
  upgrade: [
    '/core:prime',
    '/core:backend-review-plan',
    '/core:plan',
    '/core:execute',
    '/validation:validate',
    '/validation:review',
    '/validation:execution-report',
    '/validation:system-review',
    '/commit',
  ],
  bugfix: [
    '/core:prime',
    '/bugfix:rca',
    '/core:backend-review-plan',
    '/bugfix:implement-fix',
    '/validation:validate',
    '/validation:review',
    '/validation:execution-report',
    '/validation:system-review',
    '/commit',
  ],
};

const HARNESS_ALLOWED_NEXT_STAGES = new Map<string | null, string[]>([
  [null, ['prim', 'pinit', 'refr']],
  ['prim', ['bref', 'pln', 'rca', 'refr']],
  ['pinit', ['prim', 'refr']],
  ['refr', ['prim', 'bref', 'pln', 'rca']],
  ['bref', ['pln', 'exec']],
  ['pln', ['exec', 'iter']],
  ['exec', ['revu', 'vald', 'iter']],
  ['rca', ['fix', 'iter']],
  ['fix', ['revu', 'vald', 'iter']],
  ['revu', ['gate', 'iter', 'xrep']],
  ['vald', ['gate', 'iter', 'xrep']],
  ['gate', ['iter', 'xrep']],
  ['iter', ['pln', 'exec', 'fix', 'revu', 'vald']],
  ['xrep', ['srev', 'cmit']],
  ['srev', ['cmit']],
  ['cmit', []],
]);

const inferHarnessStageFromCommand = (commandName: string) => {
  const normalized = normalizeHarnessCommandName(commandName.startsWith('/') ? commandName : `/${commandName}`);
  if (HARNESS_COMMAND_STAGE_MAP.has(normalized)) {
    return HARNESS_COMMAND_STAGE_MAP.get(normalized) || null;
  }

  const leaf = normalized.split('/').pop() || '';
  return HARNESS_COMMAND_STAGE_MAP.get(`/${leaf}`) || null;
};

const getAllowedHarnessStages = (currentStage: string | null) =>
  HARNESS_ALLOWED_NEXT_STAGES.get(currentStage || null) || HARNESS_ALLOWED_NEXT_STAGES.get(null) || [];

const getScenarioBlockedHarnessStages = (
  _currentStage: string | null,
  scenario: HarnessWorkflowScenario,
) => {
  return new Set(HARNESS_SCENARIO_BRANCH_BLOCKS[scenario] || []);
};

const getAllowedHarnessCommandNames = (
  currentStage: string | null,
  scenario: HarnessWorkflowScenario = DEFAULT_HARNESS_SCENARIO,
) => {
  const blockedStages = getScenarioBlockedHarnessStages(currentStage, scenario);
  const allowedCommands = getAllowedHarnessStages(currentStage)
    .filter((stage) => !blockedStages.has(stage))
    .map((stage) => HARNESS_PRIMARY_COMMANDS.get(stage))
    .filter((commandName): commandName is string => Boolean(commandName));

  if (allowedCommands.length > 0) {
    return Array.from(new Set(allowedCommands));
  }

  return Array.from(
    new Set(
      getAllowedHarnessStages(currentStage)
        .map((stage) => HARNESS_PRIMARY_COMMANDS.get(stage))
        .filter((commandName): commandName is string => Boolean(commandName)),
    ),
  );
};

const getHarnessStageDisplayCommand = (stage: string | null) => {
  if (!stage) {
    return null;
  }

  return HARNESS_PRIMARY_COMMANDS.get(stage) || stage;
};

const areStringArraysEqual = (left: string[] = [], right: string[] = []) => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
};

const areHarnessGatesEqual = (
  left: HarnessGateState | null,
  right: HarnessGateState | null,
) => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return (
    left.reviewStatus === right.reviewStatus &&
    left.validationStatus === right.validationStatus &&
    left.humanDecision === right.humanDecision &&
    areStringArraysEqual(left.blockers, right.blockers)
  );
};

const isTemporarySessionId = (sessionId: string | null | undefined) =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

const getNotificationSessionSummary = (
  selectedSession: ProjectSession | null,
  fallbackInput: string,
): string | null => {
  const sessionSummary = selectedSession?.summary || selectedSession?.name || selectedSession?.title;
  if (typeof sessionSummary === 'string' && sessionSummary.trim()) {
    const normalized = sessionSummary.replace(/\s+/g, ' ').trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  const normalizedFallback = fallbackInput.replace(/\s+/g, ' ').trim();
  if (!normalizedFallback) {
    return null;
  }

  return normalizedFallback.length > 80 ? `${normalizedFallback.slice(0, 77)}...` : normalizedFallback;
};

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  clearedSessionId,
  provider,
  permissionMode,
  cyclePermissionMode,
  cursorModel,
  claudeModel,
  codexModel,
  geminiModel,
  isLoading,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionActive,
  onSessionProcessing,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  pendingViewSessionRef,
  scrollToBottom,
  addMessage,
  clearMessages,
  resetSessionView,
  rewindMessages,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
}: UseChatComposerStateArgs) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState<Map<string, number>>(new Map());
  const [imageErrors, setImageErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [thinkingMode, setThinkingMode] = useState('none');
  const [conversationMode, setConversationMode] = useState<ConversationMode>(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const savedMode = safeLocalStorage.getItem(getConversationModeStorageKey(selectedProject.name));
      return savedMode === 'harness' ? 'harness' : 'chat';
    }
    return 'chat';
  });
  const [harnessScenario, setHarnessScenario] = useState<HarnessWorkflowScenario>(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const savedScenario = safeLocalStorage.getItem(getHarnessScenarioStorageKey(selectedProject.name));
      return savedScenario === 'upgrade' || savedScenario === 'bugfix' ? savedScenario : DEFAULT_HARNESS_SCENARIO;
    }
    return DEFAULT_HARNESS_SCENARIO;
  });
  const [harnessAvailability, setHarnessAvailability] = useState<
    'available' | 'unavailable_no_claude' | 'unavailable_project_unknown'
  >('unavailable_project_unknown');
  const [harnessAvailabilityReason, setHarnessAvailabilityReason] = useState<string | null>(null);
  const [activeHarnessTaskId, setActiveHarnessTaskId] = useState<string | null>(null);
  const [activeHarnessStage, setActiveHarnessStage] = useState<string | null>(null);
  const [taskSummaryState, setTaskSummaryState] = useState<HarnessTaskSummaryState>('idle');
  const [activePrimeState, setActivePrimeState] = useState<'unprimed' | 'primed' | 'stale'>('unprimed');
  const [activeHarnessGate, setActiveHarnessGate] = useState<HarnessGateState | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const submitInFlightRef = useRef(false);
  const programmaticSubmitContentRef = useRef<string | null>(null);
  const programmaticClaudeModelRef = useRef<string | null>(null);
  const handleSubmitRef = useRef<
    ((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);
  const allowHarnessCommandSubmitRef = useRef(false);
  const recommendedHarnessFlow = HARNESS_SCENARIO_RECOMMENDED_FLOW[harnessScenario];
  const clearActiveHarnessTaskView = useCallback(() => {
    setActiveHarnessTaskId(null);
    setActiveHarnessStage(null);
    setTaskSummaryState('idle');
    setActivePrimeState('unprimed');
    setActiveHarnessGate(null);
  }, []);
  const syncActiveHarnessTaskView = useCallback(
    (nextTask: {
      taskId?: string | null;
      currentStage?: string | null;
      taskSummaryState?: HarnessTaskSummaryState | null;
      primeState?: 'unprimed' | 'primed' | 'stale' | null;
      activeGate?: HarnessGateState | null;
    } | null) => {
      const nextTaskId = nextTask?.taskId || null;
      const nextStage = nextTask?.currentStage || null;
      const nextTaskSummaryState = nextTask?.taskSummaryState || 'idle';
      const nextPrimeState = nextTask?.primeState || 'unprimed';
      const nextActiveGate = nextTask?.activeGate || null;

      setActiveHarnessTaskId((previous) => (previous === nextTaskId ? previous : nextTaskId));
      setActiveHarnessStage((previous) => (previous === nextStage ? previous : nextStage));
      setTaskSummaryState((previous) =>
        previous === nextTaskSummaryState ? previous : nextTaskSummaryState,
      );
      setActivePrimeState((previous) => (previous === nextPrimeState ? previous : nextPrimeState));
      setActiveHarnessGate((previous) =>
        areHarnessGatesEqual(previous, nextActiveGate) ? previous : nextActiveGate,
      );
    },
    [],
  );

  const getToolsSettings = useCallback(() => {
    try {
      const settingsKey =
        provider === 'cursor'
          ? 'cursor-tools-settings'
          : provider === 'codex'
            ? 'codex-settings'
            : provider === 'gemini'
              ? 'gemini-settings'
              : 'claude-settings';
      const savedSettings = safeLocalStorage.getItem(settingsKey);
      if (savedSettings) {
        return JSON.parse(savedSettings);
      }
    } catch (error) {
      console.error('Error loading tools settings:', error);
    }

    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
    };
  }, [provider]);

  const handleBuiltInCommand = useCallback(
    async (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'clear':
          if (provider === 'claude') {
            const resolvedProjectPath = selectedProject?.fullPath || selectedProject?.path || '';
            resetSessionView();
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);

            if (
              resolvedProjectPath &&
              harnessAvailability === 'available' &&
              (conversationMode === 'harness' || Boolean(activeHarnessTaskId))
            ) {
              try {
                const response = await authenticatedFetch('/api/harness/projects/reset-current-task', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    projectPath: resolvedProjectPath,
                  }),
                });

                if (response.ok && typeof window !== 'undefined') {
                  window.dispatchEvent(
                    new CustomEvent(HARNESS_CURRENT_TASK_RESET_EVENT, {
                      detail: { projectPath: resolvedProjectPath },
                    }),
                  );
                }
              } catch (error) {
                console.warn('Failed to reset current harness task after /clear:', error);
              }
            }
            break;
          }

          clearMessages();
          break;

        case 'help':
          addMessage({
            type: 'assistant',
            content: data.content,
            timestamp: Date.now(),
          });
          break;

        case 'model':
          addMessage({
            type: 'assistant',
            content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nClaude: ${data.available.claude.join(', ')}\n\nCursor: ${data.available.cursor.join(', ')}`,
            timestamp: Date.now(),
          });
          break;

        case 'cost': {
          const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
          addMessage({ type: 'assistant', content: costMessage, timestamp: Date.now() });
          break;
        }

        case 'status': {
          const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
          addMessage({ type: 'assistant', content: statusMessage, timestamp: Date.now() });
          break;
        }

        case 'memory':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              type: 'assistant',
              content: `${data.message}\n\nPath: \`${data.path}\``,
              timestamp: Date.now(),
            });
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        case 'rewind':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            rewindMessages(data.steps * 2);
            addMessage({
              type: 'assistant',
              content: `Rewound ${data.steps} step(s). ${data.message}`,
              timestamp: Date.now(),
            });
          }
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [
      addMessage,
      activeHarnessTaskId,
      claudeModel,
      clearMessages,
      conversationMode,
      currentSessionId,
      getToolsSettings,
      harnessAvailability,
      onFileOpen,
      onShowSettings,
      permissionMode,
      provider,
      resetSessionView,
      rewindMessages,
      selectedProject,
      selectedSession?.id,
      sendMessage,
      setCanAbortSession,
      setClaudeStatus,
      setIsLoading,
    ],
  );

  const recordAppMetricEvent = useCallback(
    async (payload: {
      metricKey: string;
      name: string;
      category?: string;
      reason?: string | null;
      value?: number;
    }) => {
      try {
        await authenticatedFetch('/api/harness/metrics/events/app', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            category: payload.category || 'routing',
            metricKey: payload.metricKey,
            name: payload.name,
            value: payload.value ?? 1,
            unit: 'count',
            reason: payload.reason || null,
            provider,
            projectPath: selectedProject?.fullPath || selectedProject?.path || null,
            sessionId: currentSessionId || selectedSession?.id || null,
          }),
        });
      } catch (error) {
        console.warn('Failed to record app metric event:', error);
      }
    },
    [currentSessionId, provider, selectedProject, selectedSession?.id],
  );

  const showHarnessUnavailableMessage = useCallback(() => {
    addMessage({
      type: 'assistant',
      content: getHarnessAvailabilityMessage(t, harnessAvailability, harnessAvailabilityReason),
      timestamp: Date.now(),
    });
  }, [addMessage, harnessAvailability, harnessAvailabilityReason, t]);

  const loadSlashCommandsForProject = useCallback(async () => {
    if (!selectedProject) {
      return [] as SlashCommand[];
    }

    const response = await authenticatedFetch('/api/commands/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectPath: selectedProject.fullPath || selectedProject.path,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch commands (${response.status})`);
    }

    const data = await response.json();
    return normalizeSlashCommandsResponse(data);
  }, [selectedProject]);

  const refreshCurrentHarnessTask = useCallback(
    async (projectOverride?: Project | null) => {
      const project = projectOverride ?? selectedProject;
      if (!project) {
        clearActiveHarnessTaskView();
        return null;
      }

      const projectPath = project.fullPath || project.path || '';
      if (!projectPath) {
        clearActiveHarnessTaskView();
        return null;
      }

      const response = await authenticatedFetch(
        `/api/harness/projects/current-task?projectPath=${encodeURIComponent(projectPath)}`,
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      const nextTask = result?.task || null;
      syncActiveHarnessTaskView(
        nextTask
          ? {
              ...nextTask,
              taskId: nextTask?.taskId || result?.taskId || null,
            }
          : {
              taskId: result?.taskId || null,
            },
      );
      return nextTask;
    },
    [clearActiveHarnessTaskView, selectedProject, syncActiveHarnessTaskView],
  );

  const isHarnessCommandVisible = useCallback(
    (command: SlashCommand) => {
      const requiresHarness = Boolean(command.metadata?.requiresHarness);
      if (!requiresHarness) {
        return true;
      }

      if (harnessAvailability !== 'available') {
        return false;
      }

      return true;
    },
    [harnessAvailability],
  );

  const getHarnessStageBlockReason = useCallback(
    (command: SlashCommand) => {
      const stage = inferHarnessStageFromCommand(command.name);
      if (!stage) {
        return null;
      }

      const currentStage = activeHarnessStage || null;
      if (currentStage === stage) {
        return null;
      }

      const allowedStages = getAllowedHarnessStages(currentStage);
      const recommendedCommands = getAllowedHarnessCommandNames(currentStage, harnessScenario);
      const gateReadyForExecutionReport =
        activeHarnessGate?.reviewStatus === 'passed' && activeHarnessGate?.validationStatus === 'passed';

      if (stage === 'xrep' && !gateReadyForExecutionReport) {
        return {
          stage,
          currentStage,
          allowedStages,
          recommendedCommands,
          reason: 'gate-not-ready',
        };
      }

      const scenarioBlockedStages = getScenarioBlockedHarnessStages(currentStage, harnessScenario);
      if (scenarioBlockedStages.has(stage)) {
        return {
          stage,
          currentStage,
          allowedStages,
          recommendedCommands,
          reason: 'scenario-not-recommended',
        };
      }

      if (allowedStages.includes(stage)) {
        return null;
      }

      return {
        stage,
        currentStage,
        allowedStages,
        recommendedCommands,
        reason: 'stage-not-allowed',
      };
    },
    [activeHarnessGate, activeHarnessStage, harnessScenario],
  );

  const findMatchingSlashCommand = useCallback(
    (commandName: string, availableCommands: SlashCommand[]) => {
      const normalizedTarget = normalizeHarnessCommandName(commandName);
      return (
        availableCommands.find(
          (command) => normalizeHarnessCommandName(command.name) === normalizedTarget,
        ) || null
      );
    },
    [],
  );

  const prepareHarnessTask = useCallback(
    async (command: SlashCommand, commandContent: string) => {
      if (!selectedProject) {
        return null;
      }

      const projectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionId = currentSessionId || selectedSession?.id || null;
      const taskId = activeHarnessTaskId;
      const endpoint = taskId
        ? `/api/harness/tasks/${encodeURIComponent(taskId)}/continue`
        : '/api/harness/tasks/start';

      const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          projectPath,
          message: inputValueRef.current || command.name,
          commandName: command.name,
          commandContent,
          mainClaudeModel: provider === 'claude' ? claudeModel : null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error || 'Failed to prepare harness task');
      }

      const payload = await response.json();
      if (payload?.task?.taskId) {
        syncActiveHarnessTaskView(payload.task);
      }

      return payload;
    },
    [
      activeHarnessTaskId,
      claudeModel,
      currentSessionId,
      provider,
      selectedProject,
      selectedSession?.id,
      syncActiveHarnessTaskView,
    ],
  );

  const handleCustomCommand = useCallback(async (
    result: CommandExecutionResult,
    options?: { allowHarnessSubmit?: boolean; userArguments?: string | null; claudeExecutionModel?: string | null },
  ) => {
    const { content } = result;

    const normalizedUserArguments = options?.userArguments?.trim() || '';
      const commandContentBase = normalizedUserArguments
        ? `${(content || '').trim()}\n\n---\nUser task:\n${normalizedUserArguments}`
        : content || '';
      const commandContent = commandContentBase;
    allowHarnessCommandSubmitRef.current = Boolean(options?.allowHarnessSubmit);
    programmaticSubmitContentRef.current = commandContent;
    programmaticClaudeModelRef.current = options?.claudeExecutionModel || null;

    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
      }, [addMessage]);

  const runHarnessLaneSubagent = useCallback(
    async (taskPayload: { task?: { taskId?: string | null } } | null, stage: 'revu' | 'vald') => {
      if (!selectedProject || !taskPayload?.task?.taskId) {
        throw new Error('Harness 子线程缺少任务上下文');
      }

      const lane = stage === 'revu' ? 'review' : 'validation';
      const projectPath = selectedProject.fullPath || selectedProject.path || '';
      const response = await authenticatedFetch(
        `/api/harness/tasks/${encodeURIComponent(taskPayload.task.taskId)}/lanes/${lane}/run`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectPath,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error || 'Failed to run harness lane subagent');
      }

      const payload = (await response.json()) as HarnessLaneRunResponse;
      if (payload?.task) {
        syncActiveHarnessTaskView(payload.task);
      }

      addMessage({
        type: 'assistant',
        content:
          lane === 'review'
            ? t('conversationMode.reviewLaneCompleted', {
                status: payload.result.status,
                summary: payload.result.summary || t('conversationMode.noSummary'),
                blockers: payload.result.blockers.length
                  ? payload.result.blockers.join(' / ')
                  : t('conversationMode.noBlockers'),
              })
            : t('conversationMode.validationLaneCompleted', {
                status: payload.result.status,
                summary: payload.result.summary || t('conversationMode.noSummary'),
                blockers: payload.result.blockers.length
                  ? payload.result.blockers.join(' / ')
                  : t('conversationMode.noBlockers'),
              }),
        timestamp: Date.now(),
      });

      return payload;
    },
    [addMessage, selectedProject, syncActiveHarnessTaskView, t],
  );

  const resolveClaudeHarnessExecutionModel = useCallback(
    async (commandName: string) => {
      if (provider !== 'claude') {
        return null;
      }

      const stage = inferHarnessStageFromCommand(commandName);
      if (!stage) {
        return claudeModel;
      }

      if (stage !== 'revu' && stage !== 'vald') {
        return claudeModel;
      }

      try {
        const response = await authenticatedFetch('/api/harness/providers/claude/subagent-config');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const config = (await response.json()) as ClaudeSubagentConfigResponse;
        if (!config?.supportsSubagentModelOverride) {
          return claudeModel;
        }

        if (stage === 'revu') {
          return config.reviewerMode === 'override' && config.reviewerModel && config.reviewerModel !== 'inherit'
            ? config.reviewerModel
            : claudeModel;
        }

        return config.validatorMode === 'override' && config.validatorModel && config.validatorModel !== 'inherit'
          ? config.validatorModel
          : claudeModel;
      } catch (error) {
        console.warn('Failed to resolve Claude harness execution model:', error);
        return claudeModel;
      }
    },
    [claudeModel, provider],
  );

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      const requiresHarness = Boolean(command.metadata?.requiresHarness);
      if (requiresHarness && harnessAvailability !== 'available') {
        showHarnessUnavailableMessage();
        void recordAppMetricEvent({
          metricKey: 'M12A',
          name: 'force_harness_blocked_no_claude',
          reason: harnessAvailabilityReason || harnessAvailability,
        });
        return;
      }

      if (requiresHarness) {
        const stageBlock = getHarnessStageBlockReason(command);
        if (stageBlock) {
          const allowedCommands = stageBlock.recommendedCommands || getAllowedHarnessCommandNames(stageBlock.currentStage, harnessScenario);
          const currentStageDisplay = getHarnessStageDisplayCommand(stageBlock.currentStage) || t('conversationMode.stageNotStarted');
          const stageBlockedContent =
            stageBlock.reason === 'scenario-not-recommended'
              ? t('conversationMode.scenarioBlocked', {
                  command: command.name,
                  scene: t(`conversationMode.scenarios.${harnessScenario}`),
                  currentStage: currentStageDisplay,
                  commands: allowedCommands.length ? allowedCommands.join(' / ') : t('conversationMode.noAllowedCommands'),
                })
              : t('conversationMode.stageBlocked', {
                  command: command.name,
                  currentStage: currentStageDisplay,
                  commands: allowedCommands.length ? allowedCommands.join(' / ') : t('conversationMode.noAllowedCommands'),
                });
          addMessage({
            type: 'assistant',
            content: stageBlockedContent,
            timestamp: Date.now(),
          });
          return;
        }
      }

      try {
        if (requiresHarness) {
          void recordAppMetricEvent({
            metricKey: 'M3',
            name: 'message_routed_to_harness',
            reason: 'harness-command-dispatch',
          });
        }

        const effectiveInput = rawInput ?? input;
        const normalizedInput = effectiveInput.trim();
        const firstSpace = normalizedInput.indexOf(' ');
        const userArguments = firstSpace > -1 ? normalizedInput.slice(firstSpace + 1).trim() : '';
        const args = userArguments ? userArguments.split(/\s+/) : [];

        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          provider,
          model: provider === 'cursor' ? cursorModel : provider === 'codex' ? codexModel : provider === 'gemini' ? geminiModel : claudeModel,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          await handleBuiltInCommand(result);
          setInput('');
          inputValueRef.current = '';
        } else if (result.type === 'custom') {
          const stage = inferHarnessStageFromCommand(command.name);
          const claudeExecutionModel =
            requiresHarness && provider === 'claude' && stage !== 'revu' && stage !== 'vald'
              ? await resolveClaudeHarnessExecutionModel(command.name)
              : null;
          let taskPayload: { task?: { taskId?: string | null } } | null = null;
          if (requiresHarness) {
            taskPayload = await prepareHarnessTask(command, result.content || '');
          }
          if (
            requiresHarness &&
            provider === 'claude' &&
            taskPayload &&
            (stage === 'revu' || stage === 'vald')
          ) {
            await runHarnessLaneSubagent(taskPayload, stage);
            setInput('');
            inputValueRef.current = '';
            return;
          }
          await handleCustomCommand(result, {
            allowHarnessSubmit: requiresHarness,
            userArguments,
            claudeExecutionModel,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        addMessage({
          type: 'assistant',
          content: `Error executing command: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      claudeModel,
      codexModel,
      currentSessionId,
      cursorModel,
      geminiModel,
      harnessAvailability,
      harnessAvailabilityReason,
      harnessScenario,
      handleBuiltInCommand,
      handleCustomCommand,
      getHarnessStageBlockReason,
      input,
      provider,
      prepareHarnessTask,
      runHarnessLaneSubagent,
      provider,
      recordAppMetricEvent,
      resolveClaudeHarnessExecutionModel,
      selectedProject,
      addMessage,
      selectedSession?.id,
      showHarnessUnavailableMessage,
      tokenBudget,
    ],
  );

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    input,
    setInput,
    textareaRef,
    commandVisibilityFilter: isHarnessCommandVisible,
  });

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const handleImageFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (!file.type || !file.type.startsWith('image/')) {
          return false;
        }

        if (!file.size || file.size > 5 * 1024 * 1024) {
          const fileName = file.name || 'Unknown file';
          setImageErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 5MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages((previous) => [...previous, ...validFiles].slice(0, 5));
    }
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleImageFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        const imageFiles = files.filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          handleImageFiles(imageFiles);
        }
      }
    },
    [handleImageFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
    },
    maxSize: 5 * 1024 * 1024,
    maxFiles: 5,
    onDrop: handleImageFiles,
    noClick: true,
    noKeyboard: true,
  });

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      ) => {
        event.preventDefault();
        const currentInput = inputValueRef.current;
        const programmaticSubmitContent = programmaticSubmitContentRef.current;
        const effectiveConversationMode = conversationMode;
        const isHarnessWorkflowSubmit = allowHarnessCommandSubmitRef.current;
        if (!currentInput.trim() || isLoading || submitInFlightRef.current || !selectedProject) {
          allowHarnessCommandSubmitRef.current = false;
          programmaticSubmitContentRef.current = null;
          programmaticClaudeModelRef.current = null;
          return;
        }

      if (effectiveConversationMode === 'harness' && harnessAvailability !== 'available') {
        allowHarnessCommandSubmitRef.current = false;
        programmaticSubmitContentRef.current = null;
        programmaticClaudeModelRef.current = null;
        showHarnessUnavailableMessage();
        void recordAppMetricEvent({
          metricKey: 'M12A',
          name: 'force_harness_blocked_no_claude',
          reason: harnessAvailabilityReason || harnessAvailability,
        });
        return;
      }

        // Intercept slash commands: if input starts with /commandName, execute as command with args
        const trimmedInput = currentInput.trim();
        if (!programmaticSubmitContent && trimmedInput.startsWith('/')) {
          const firstSpace = trimmedInput.indexOf(' ');
          const commandName = firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
          let matchedCommand = findMatchingSlashCommand(commandName, slashCommands);

        if (!matchedCommand) {
          try {
            const commands = await loadSlashCommandsForProject();
            matchedCommand = findMatchingSlashCommand(commandName, commands);
          } catch (error) {
            console.warn('Failed to lazily load slash commands:', error);
          }
        }

        if (!matchedCommand && harnessAvailability !== 'available' && isFallbackHarnessCommand(commandName)) {
          allowHarnessCommandSubmitRef.current = false;
          programmaticSubmitContentRef.current = null;
          programmaticClaudeModelRef.current = null;
          showHarnessUnavailableMessage();
          void recordAppMetricEvent({
            metricKey: 'M12A',
            name: 'force_harness_blocked_no_claude',
            reason: harnessAvailabilityReason || harnessAvailability,
          });
          return;
        }

        if (matchedCommand) {
          await executeCommand(matchedCommand, trimmedInput);
          return;
        }
      }

        let messageContent = programmaticSubmitContent || currentInput;
        const claudeExecutionModel = programmaticClaudeModelRef.current || claudeModel;
        const selectedThinkingMode = thinkingModes.find((mode: { id: string; prefix?: string }) => mode.id === thinkingMode);
        if (selectedThinkingMode && selectedThinkingMode.prefix) {
          messageContent = `${selectedThinkingMode.prefix}: ${messageContent}`;
        }

        submitInFlightRef.current = true;

        let uploadedImages: unknown[] = [];
        if (attachedImages.length > 0) {
        const formData = new FormData();
        attachedImages.forEach((file) => {
          formData.append('images', file);
        });

        try {
          const response = await authenticatedFetch(`/api/projects/${selectedProject.name}/upload-images`, {
            method: 'POST',
            headers: {},
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to upload images');
          }

          const result = await response.json();
          uploadedImages = result.images;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Image upload failed:', error);
            addMessage({
              type: 'error',
            content: `Failed to upload images: ${message}`,
              timestamp: new Date(),
            });
            submitInFlightRef.current = false;
            allowHarnessCommandSubmitRef.current = false;
            programmaticSubmitContentRef.current = null;
            programmaticClaudeModelRef.current = null;
            return;
          }
        }

      const shouldStartFreshClaudeSession =
        provider === 'claude' &&
        Boolean(clearedSessionId) &&
        (clearedSessionId === currentSessionId || clearedSessionId === selectedSession?.id);

      const effectiveSessionId = shouldStartFreshClaudeSession
        ? null
        : currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId');
      const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;

      const userMessage: ChatMessage = {
        type: 'user',
        content: currentInput,
        images: uploadedImages as any,
        timestamp: new Date(),
      };

      addMessage(userMessage);
      setIsLoading(true); // Processing banner starts
      setCanAbortSession(true);
      setClaudeStatus({
        text: 'Processing',
        tokens: 0,
        can_interrupt: true,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      if (!effectiveSessionId) {
        if (typeof window !== 'undefined') {
          // Reset stale pending IDs from previous interrupted runs before creating a new one.
          sessionStorage.removeItem('pendingSessionId');
        }
        pendingViewSessionRef.current = { sessionId: null, startedAt: Date.now() };
      }
      onSessionActive?.(sessionToActivate);
      if (effectiveSessionId && !isTemporarySessionId(effectiveSessionId)) {
        onSessionProcessing?.(effectiveSessionId);
      }

      const toolsSettings = getToolsSettings();
      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionSummary = getNotificationSessionSummary(selectedSession, currentInput);

      if (provider === 'cursor') {
        sendMessage({
          type: 'cursor-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: cursorModel,
            skipPermissions: toolsSettings?.skipPermissions || false,
            sessionSummary,
            toolsSettings,
          },
        });
      } else if (provider === 'codex') {
        sendMessage({
          type: 'codex-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: codexModel,
            sessionSummary,
            permissionMode: permissionMode === 'plan' ? 'default' : permissionMode,
          },
        });
      } else if (provider === 'gemini') {
        sendMessage({
          type: 'gemini-command',
          command: messageContent,
          sessionId: effectiveSessionId,
          options: {
            cwd: resolvedProjectPath,
            projectPath: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            model: geminiModel,
            sessionSummary,
            permissionMode,
            toolsSettings,
          },
        });
      } else {
        sendMessage({
          type: 'claude-command',
          command: messageContent,
          options: {
            projectPath: resolvedProjectPath,
            cwd: resolvedProjectPath,
            sessionId: effectiveSessionId,
            resume: Boolean(effectiveSessionId),
            toolsSettings,
            permissionMode,
            model: claudeExecutionModel,
            sessionSummary,
            images: uploadedImages,
          },
        });
      }

      setInput('');
      inputValueRef.current = '';
      resetCommandMenuState();
      setAttachedImages([]);
      setUploadingImages(new Map());
      setImageErrors(new Map());
      setIsTextareaExpanded(false);
      setThinkingMode('none');

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
      allowHarnessCommandSubmitRef.current = false;
      programmaticSubmitContentRef.current = null;
      programmaticClaudeModelRef.current = null;
      void recordAppMetricEvent({
        metricKey: 'M3',
        name: isHarnessWorkflowSubmit ? 'message_routed_to_harness' : 'message_routed_to_chat',
        reason: isHarnessWorkflowSubmit
          ? 'harness-command-submit'
          : effectiveConversationMode === 'harness'
            ? 'harness-freeform-chat'
            : 'default-chat-path',
      });
    },
    [
      selectedSession,
      attachedImages,
      claudeModel,
      conversationMode,
      codexModel,
      currentSessionId,
      cursorModel,
      executeCommand,
      geminiModel,
      harnessAvailability,
      harnessAvailabilityReason,
      isLoading,
      findMatchingSlashCommand,
      onSessionActive,
      onSessionProcessing,
      pendingViewSessionRef,
      permissionMode,
      provider,
      recordAppMetricEvent,
      resetCommandMenuState,
      scrollToBottom,
      selectedProject,
      sendMessage,
      loadSlashCommandsForProject,
      setCanAbortSession,
      addMessage,
      setClaudeStatus,
      setIsLoading,
      setIsUserScrolledUp,
      showHarnessUnavailableMessage,
      slashCommands,
      t,
      thinkingMode,
      clearedSessionId,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useEffect(() => {
    submitInFlightRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProject?.name]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    if (input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setConversationMode('chat');
      setHarnessScenario(DEFAULT_HARNESS_SCENARIO);
      setHarnessAvailability('unavailable_project_unknown');
      setHarnessAvailabilityReason(null);
      clearActiveHarnessTaskView();
      return;
    }

    const savedMode = safeLocalStorage.getItem(getConversationModeStorageKey(selectedProject.name));
    setConversationMode(savedMode === 'harness' ? 'harness' : 'chat');
    const savedScenario = safeLocalStorage.getItem(getHarnessScenarioStorageKey(selectedProject.name));
    setHarnessScenario(
      savedScenario === 'upgrade' || savedScenario === 'bugfix' ? savedScenario : DEFAULT_HARNESS_SCENARIO,
    );
    clearActiveHarnessTaskView();

    let isCancelled = false;

    const loadHarnessCapability = async () => {
      try {
        const projectPath = selectedProject.fullPath || selectedProject.path || '';
        const response = await authenticatedFetch(
          `/api/harness/projects/capability?projectPath=${encodeURIComponent(projectPath)}`,
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = (await response.json()) as HarnessProjectCapabilityResponse;
        if (isCancelled) {
          return;
        }

        const nextAvailability = result.harnessAvailability || 'unavailable_project_unknown';
        setHarnessAvailability(nextAvailability);
        setHarnessAvailabilityReason(result.reason || null);

        if (nextAvailability !== 'available') {
          setConversationMode('chat');
          setHarnessScenario(
            savedScenario === 'upgrade' || savedScenario === 'bugfix' ? savedScenario : DEFAULT_HARNESS_SCENARIO,
          );
          clearActiveHarnessTaskView();
          safeLocalStorage.setItem(getConversationModeStorageKey(selectedProject.name), 'chat');
          return;
        }

        await refreshCurrentHarnessTask(selectedProject);
      } catch (error) {
        if (isCancelled) {
          return;
        }
        setHarnessAvailability('unavailable_project_unknown');
        setHarnessAvailabilityReason(error instanceof Error ? error.message : 'unknown-error');
        clearActiveHarnessTaskView();
      }
    };

    void loadHarnessCapability();

    return () => {
      isCancelled = true;
    };
  }, [clearActiveHarnessTaskView, refreshCurrentHarnessTask, selectedProject]);

  useEffect(() => {
    if (!selectedProject || typeof window === 'undefined') {
      return;
    }

    const projectPath = selectedProject.fullPath || selectedProject.path || '';
    const handleHarnessTaskReset = (event: Event) => {
      const customEvent = event as CustomEvent<{ projectPath?: string | null }>;
      if (customEvent.detail?.projectPath !== projectPath) {
        return;
      }
      clearActiveHarnessTaskView();
    };

    window.addEventListener(HARNESS_CURRENT_TASK_RESET_EVENT, handleHarnessTaskReset as EventListener);
    return () => {
      window.removeEventListener(HARNESS_CURRENT_TASK_RESET_EVENT, handleHarnessTaskReset as EventListener);
    };
  }, [clearActiveHarnessTaskView, selectedProject]);

  useEffect(() => {
    if (!selectedProject || harnessAvailability !== 'available' || isLoading) {
      return;
    }

    if (conversationMode !== 'harness' && !activeHarnessTaskId) {
      return;
    }

    let isCancelled = false;

    const refreshHarnessTaskSummary = async () => {
      try {
        if (isCancelled) {
          return;
        }
        await refreshCurrentHarnessTask(selectedProject);
      } catch (error) {
        if (isCancelled) {
          return;
        }
        console.warn('Failed to refresh harness task summary:', error);
      }
    };

    void refreshHarnessTaskSummary();
    const intervalId = window.setInterval(() => {
      void refreshHarnessTaskSummary();
    }, 5000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeHarnessTaskId,
    conversationMode,
    harnessAvailability,
    isLoading,
    refreshCurrentHarnessTask,
    selectedProject,
  ]);

  const handleConversationModeToggle = useCallback(() => {
    if (!selectedProject) {
      return;
    }

    if (harnessAvailability !== 'available') {
      showHarnessUnavailableMessage();
      void recordAppMetricEvent({
        metricKey: 'M12A',
        name: 'force_harness_blocked_no_claude',
        reason: harnessAvailabilityReason || harnessAvailability,
      });
      return;
    }

    setConversationMode((previous) => {
      const nextMode = previous === 'chat' ? 'harness' : 'chat';
      safeLocalStorage.setItem(getConversationModeStorageKey(selectedProject.name), nextMode);
      void recordAppMetricEvent({
        metricKey: 'M3',
        name: nextMode === 'harness' ? 'conversation_mode_enabled_harness' : 'conversation_mode_enabled_chat',
        reason: 'conversation-mode-toggle',
      });
      return nextMode;
    });
  }, [
    harnessAvailability,
    harnessAvailabilityReason,
    recordAppMetricEvent,
    selectedProject,
    showHarnessUnavailableMessage,
  ]);

  const handleHarnessScenarioChange = useCallback(
    (nextScenario: HarnessWorkflowScenario) => {
      if (!selectedProject) {
        return;
      }

      setHarnessScenario(nextScenario);
      safeLocalStorage.setItem(getHarnessScenarioStorageKey(selectedProject.name), nextScenario);
      void recordAppMetricEvent({
        metricKey: 'M3',
        name: 'harness_scenario_changed',
        reason: nextScenario,
      });
    },
    [recordAppMetricEvent, selectedProject],
  );

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.max(22, textareaRef.current.scrollHeight)}px`;
    const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
    const expanded = textareaRef.current.scrollHeight > lineHeight * 2;
    setIsTextareaExpanded(expanded);
  }, [input]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      target.style.height = 'auto';
      target.style.height = `${Math.max(22, target.scrollHeight)}px`;
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);

      const lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      setIsTextareaExpanded(target.scrollHeight > lineHeight * 2);
    },
    [setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const pendingSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
    const cursorSessionId =
      typeof window !== 'undefined' ? sessionStorage.getItem('cursorSessionId') : null;

    const candidateSessionIds = [
      currentSessionId,
      pendingViewSessionRef.current?.sessionId || null,
      pendingSessionId,
      provider === 'cursor' ? cursorSessionId : null,
      selectedSession?.id || null,
    ];

    const targetSessionId =
      candidateSessionIds.find((sessionId) => Boolean(sessionId) && !isTemporarySessionId(sessionId)) || null;

    if (!targetSessionId) {
      console.warn('Abort requested but no concrete session ID is available yet.');
      return;
    }

    // Stop should feel immediate locally even if the provider's complete event arrives later.
    setIsLoading(false);
    setCanAbortSession(false);
    setClaudeStatus(null);

    sendMessage({
      type: 'abort-session',
      sessionId: targetSessionId,
      provider,
    });
  }, [
    canAbortSession,
    currentSessionId,
    pendingViewSessionRef,
    provider,
    selectedSession?.id,
    sendMessage,
    setCanAbortSession,
    setClaudeStatus,
    setIsLoading,
  ]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || provider !== 'claude') {
        return { success: false };
      }
      return grantClaudeToolPermission(suggestion.entry);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'claude-permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      setPendingPermissionRequests((previous) => {
        const next = previous.filter((request) => !validIds.includes(request.requestId));
        if (next.length === 0) {
          setClaudeStatus(null);
        }
        return next;
      });
    },
    [sendMessage, setClaudeStatus, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    conversationMode,
    harnessScenario,
    recommendedHarnessFlow,
    harnessAvailability,
    harnessAvailabilityReason,
    activeHarnessTaskId,
    activeHarnessStage,
    taskSummaryState,
    activePrimeState,
    activeHarnessGate,
    handleConversationModeToggle,
    handleHarnessScenarioChange,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker: open,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
  };
}
