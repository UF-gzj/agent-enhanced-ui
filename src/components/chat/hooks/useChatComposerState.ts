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
  Project,
  ProjectSession,
  LLMProvider,
} from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';
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

type ConversationMode = 'chat' | 'harness';

const getConversationModeStorageKey = (projectName: string) => `conversation_mode_${projectName}`;

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
  const handleSubmitRef = useRef<
    ((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);
  const allowHarnessCommandSubmitRef = useRef(false);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'clear':
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
    [onFileOpen, onShowSettings, addMessage, clearMessages, rewindMessages],
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
        setActiveHarnessTaskId(null);
        setActiveHarnessStage(null);
        setTaskSummaryState('idle');
        setActivePrimeState('unprimed');
        setActiveHarnessGate(null);
        return null;
      }

      const projectPath = project.fullPath || project.path || '';
      if (!projectPath) {
        setActiveHarnessTaskId(null);
        setActiveHarnessStage(null);
        setTaskSummaryState('idle');
        setActivePrimeState('unprimed');
        setActiveHarnessGate(null);
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
      setActiveHarnessTaskId(nextTask?.taskId || result?.taskId || null);
      setActiveHarnessStage(nextTask?.currentStage || null);
      setTaskSummaryState(nextTask?.taskSummaryState || 'idle');
      setActivePrimeState(nextTask?.primeState || 'unprimed');
      setActiveHarnessGate(nextTask?.activeGate || null);
      return nextTask;
    },
    [selectedProject],
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
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error || 'Failed to prepare harness task');
      }

      const payload = await response.json();
      const nextTaskId = payload?.task?.taskId || null;
      const nextStage = payload?.task?.currentStage || null;
      const nextTaskSummaryState = payload?.task?.taskSummaryState || 'idle';
      const nextPrimeState = payload?.task?.primeState || 'unprimed';
      const nextActiveGate = payload?.task?.activeGate || null;

      if (nextTaskId) {
        setActiveHarnessTaskId(nextTaskId);
        setActiveHarnessStage(nextStage);
        setTaskSummaryState(nextTaskSummaryState);
        setActivePrimeState(nextPrimeState);
        setActiveHarnessGate(nextActiveGate);
      }

      return payload;
    },
    [activeHarnessTaskId, currentSessionId, selectedProject, selectedSession?.id],
  );

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult, options?: { allowHarnessSubmit?: boolean }) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        addMessage({
          type: 'assistant',
          content: 'Command execution cancelled',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const commandContent = content || '';
    allowHarnessCommandSubmitRef.current = Boolean(options?.allowHarnessSubmit);
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [addMessage]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string) => {
      if (!command || !selectedProject) {
        return;
      }

      const requiresHarness = Boolean(command.metadata?.requiresHarness);
      const effectiveConversationMode = conversationMode;
      if (requiresHarness && harnessAvailability !== 'available') {
        showHarnessUnavailableMessage();
        void recordAppMetricEvent({
          metricKey: 'M12A',
          name: 'force_harness_blocked_no_claude',
          reason: harnessAvailabilityReason || harnessAvailability,
        });
        return;
      }

      if (requiresHarness && effectiveConversationMode !== 'harness') {
        addMessage({
          type: 'assistant',
          content: t('conversationMode.commandRequiresHarness'),
          timestamp: Date.now(),
        });
        void recordAppMetricEvent({
          metricKey: 'M3',
          name: 'harness_command_guided_from_chat',
          reason: 'requires-harness-mode',
        });
        return;
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
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

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
          handleBuiltInCommand(result);
          setInput('');
          inputValueRef.current = '';
        } else if (result.type === 'custom') {
          if (requiresHarness) {
            await prepareHarnessTask(command, result.content || '');
          }
          await handleCustomCommand(result, { allowHarnessSubmit: requiresHarness });
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
      conversationMode,
      codexModel,
      currentSessionId,
      cursorModel,
      geminiModel,
      harnessAvailability,
      harnessAvailabilityReason,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      prepareHarnessTask,
      recordAppMetricEvent,
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
    onExecuteCommand: executeCommand,
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
      const effectiveConversationMode = conversationMode;
      if (!currentInput.trim() || isLoading || !selectedProject) {
        allowHarnessCommandSubmitRef.current = false;
        return;
      }

      if (effectiveConversationMode === 'harness' && harnessAvailability !== 'available') {
        allowHarnessCommandSubmitRef.current = false;
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
      if (trimmedInput.startsWith('/')) {
        const firstSpace = trimmedInput.indexOf(' ');
        const commandName = firstSpace > 0 ? trimmedInput.slice(0, firstSpace) : trimmedInput;
        let matchedCommand = slashCommands.find((cmd: SlashCommand) => cmd.name === commandName);

        if (!matchedCommand) {
          try {
            const commands = await loadSlashCommandsForProject();
            matchedCommand = commands.find((cmd: SlashCommand) => cmd.name === commandName);
          } catch (error) {
            console.warn('Failed to lazily load slash commands:', error);
          }
        }

        if (matchedCommand) {
          await executeCommand(matchedCommand, trimmedInput);
          setInput('');
          inputValueRef.current = '';
          setAttachedImages([]);
          setUploadingImages(new Map());
          setImageErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      if (effectiveConversationMode === 'harness' && !allowHarnessCommandSubmitRef.current) {
        allowHarnessCommandSubmitRef.current = false;
          addMessage({
            type: 'assistant',
            content: t('conversationMode.freeformBlocked'),
            timestamp: Date.now(),
          });
        void recordAppMetricEvent({
          metricKey: 'M3',
          name: 'message_routed_to_chat_from_harness_freeform_blocked',
          reason: 'phase-1-slash-command-only',
        });
        return;
      }

      let messageContent = currentInput;
      const selectedThinkingMode = thinkingModes.find((mode: { id: string; prefix?: string }) => mode.id === thinkingMode);
      if (selectedThinkingMode && selectedThinkingMode.prefix) {
        messageContent = `${selectedThinkingMode.prefix}: ${currentInput}`;
      }

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
          allowHarnessCommandSubmitRef.current = false;
          return;
        }
      }

      const effectiveSessionId =
        currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId');
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

      if (!effectiveSessionId && !selectedSession?.id) {
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

      const getToolsSettings = () => {
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
      };

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
            model: claudeModel,
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
      void recordAppMetricEvent({
        metricKey: 'M3',
        name: effectiveConversationMode === 'harness' ? 'message_routed_to_harness' : 'message_routed_to_chat',
        reason: effectiveConversationMode === 'harness' ? 'harness-command-submit' : 'default-chat-path',
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
      thinkingMode,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

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
      setHarnessAvailability('unavailable_project_unknown');
      setHarnessAvailabilityReason(null);
      setActiveHarnessTaskId(null);
      setActiveHarnessStage(null);
      setTaskSummaryState('idle');
      setActivePrimeState('unprimed');
      setActiveHarnessGate(null);
      return;
    }

    const savedMode = safeLocalStorage.getItem(getConversationModeStorageKey(selectedProject.name));
    setConversationMode(savedMode === 'harness' ? 'harness' : 'chat');
    setActiveHarnessTaskId(null);
    setActiveHarnessStage(null);
    setTaskSummaryState('idle');
    setActivePrimeState('unprimed');
    setActiveHarnessGate(null);

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
          setActiveHarnessTaskId(null);
          setActiveHarnessStage(null);
          setTaskSummaryState('idle');
          setActivePrimeState('unprimed');
          setActiveHarnessGate(null);
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
        setActiveHarnessTaskId(null);
        setActiveHarnessStage(null);
        setTaskSummaryState('idle');
        setActivePrimeState('unprimed');
        setActiveHarnessGate(null);
      }
    };

    void loadHarnessCapability();

    return () => {
      isCancelled = true;
    };
  }, [refreshCurrentHarnessTask, selectedProject]);

  useEffect(() => {
    if (!selectedProject || harnessAvailability !== 'available') {
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
    }, 2000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [harnessAvailability, refreshCurrentHarnessTask, selectedProject]);

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

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    // Re-run when input changes so restored drafts get the same autosize behavior as typed text.
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
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
      target.style.height = `${target.scrollHeight}px`;
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

    sendMessage({
      type: 'abort-session',
      sessionId: targetSessionId,
      provider,
    });
  }, [canAbortSession, currentSessionId, pendingViewSessionRef, provider, selectedSession?.id, sendMessage]);

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
    harnessAvailability,
    harnessAvailabilityReason,
    activeHarnessTaskId,
    activeHarnessStage,
    taskSummaryState,
    activePrimeState,
    activeHarnessGate,
    handleConversationModeToggle,
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
