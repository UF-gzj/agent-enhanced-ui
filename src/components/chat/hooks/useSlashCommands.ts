import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import Fuse from 'fuse.js';
import { authenticatedFetch } from '../../../utils/api';
import { safeLocalStorage } from '../utils/chatStorage';
import type { Project } from '../../../types/app';

const COMMAND_QUERY_DEBOUNCE_MS = 150;

export interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

const HARNESS_COMMAND_PREFIXES = ['/core:', '/validation:', '/bugfix:', '/core/', '/validation/', '/bugfix/'];
const HARNESS_COMMAND_NAMES = new Set([
  '/prim',
  '/pinit',
  '/refr',
  '/bref',
  '/pln',
  '/exec',
  '/iter',
  '/rca',
  '/fix',
  '/vald',
  '/revu',
  '/xrep',
  '/srev',
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
]);

const normalizeCommandLookupKey = (value: string) => {
  if (!value) {
    return value;
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.replace(/:/g, '/').replace(/\/+/g, '/');
};

export const isHarnessCommand = (command: SlashCommand): boolean => {
  if (command.type === 'built-in') {
    return false;
  }

  const normalizedName = normalizeCommandLookupKey(command.name).toLowerCase();

  if (
    Array.from(HARNESS_COMMAND_NAMES).some(
      (commandName) => normalizeCommandLookupKey(commandName).toLowerCase() === normalizedName,
    )
  ) {
    return true;
  }

  return HARNESS_COMMAND_PREFIXES.some((prefix) => normalizedName.startsWith(normalizeCommandLookupKey(prefix).toLowerCase()));
};

export const normalizeSlashCommandsResponse = (data: { builtIn?: SlashCommand[]; custom?: SlashCommand[] }) => {
  const normalizedCustomCommands = ((data.custom || []) as SlashCommand[]).map((command) => {
    const canonicalName =
      typeof command.metadata?.alias_for === 'string'
        ? command.metadata.alias_for
        : typeof command.metadata?.canonicalName === 'string'
          ? command.metadata.canonicalName
          : command.name;
    return {
      ...command,
      type: 'custom',
      metadata: {
        ...(command.metadata || {}),
        canonicalName,
        requiresHarness: isHarnessCommand(command),
      },
    };
  });

  const dedupedCustomCommands = normalizedCustomCommands.reduce<SlashCommand[]>((bucket, command) => {
    const canonicalName =
      typeof command.metadata?.canonicalName === 'string'
        ? normalizeCommandLookupKey(command.metadata.canonicalName)
        : normalizeCommandLookupKey(command.name);
    const existingIndex = bucket.findIndex((existingCommand) => {
      const existingCanonicalName =
        typeof existingCommand.metadata?.canonicalName === 'string'
          ? normalizeCommandLookupKey(existingCommand.metadata.canonicalName)
          : normalizeCommandLookupKey(existingCommand.name);
      return existingCanonicalName === canonicalName;
    });

    if (existingIndex === -1) {
      bucket.push(command);
      return bucket;
    }

    const existingCommand = bucket[existingIndex];
    const existingMetadata = (existingCommand.metadata || {}) as Record<string, unknown>;
    const nextMetadata = (command.metadata || {}) as Record<string, unknown>;
    const existingIsAlias = typeof existingMetadata.alias_for === 'string';
    const nextIsAlias = typeof nextMetadata.alias_for === 'string';

    if (existingIsAlias && !nextIsAlias) {
      bucket[existingIndex] = command;
    }

    return bucket;
  }, []);

  return [
    ...((data.builtIn || []) as SlashCommand[]).map((command) => ({
      ...command,
      type: 'built-in',
      metadata: {
        ...(command.metadata || {}),
        requiresHarness: false,
      },
    })),
    ...dedupedCustomCommands,
  ];
};

interface UseSlashCommandsOptions {
  selectedProject: Project | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  commandVisibilityFilter?: (command: SlashCommand) => boolean;
}

const getCommandHistoryKey = (projectName: string) => `command_history_${projectName}`;

const readCommandHistory = (projectName: string): Record<string, number> => {
  const history = safeLocalStorage.getItem(getCommandHistoryKey(projectName));
  if (!history) {
    return {};
  }

  try {
    return JSON.parse(history);
  } catch (error) {
    console.error('Error parsing command history:', error);
    return {};
  }
};

const saveCommandHistory = (projectName: string, history: Record<string, number>) => {
  safeLocalStorage.setItem(getCommandHistoryKey(projectName), JSON.stringify(history));
};

export function useSlashCommands({
  selectedProject,
  input,
  setInput,
  textareaRef,
  commandVisibilityFilter,
}: UseSlashCommandsOptions) {
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);

  const commandQueryTimerRef = useRef<number | null>(null);

  const clearCommandQueryTimer = useCallback(() => {
    if (commandQueryTimerRef.current !== null) {
      window.clearTimeout(commandQueryTimerRef.current);
      commandQueryTimerRef.current = null;
    }
  }, []);

  const resetCommandMenuState = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    clearCommandQueryTimer();
  }, [clearCommandQueryTimer]);

  useEffect(() => {
    const fetchCommands = async () => {
      if (!selectedProject) {
        setSlashCommands([]);
        setFilteredCommands([]);
        return;
      }

      try {
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
          throw new Error('Failed to fetch commands');
        }

        const data = await response.json();
        const allCommands = normalizeSlashCommandsResponse(data);

        const parsedHistory = readCommandHistory(selectedProject.name);
        const sortedCommands = [...allCommands].sort((commandA, commandB) => {
          const commandAUsage = parsedHistory[commandA.name] || 0;
          const commandBUsage = parsedHistory[commandB.name] || 0;
          return commandBUsage - commandAUsage;
        });

        setSlashCommands(sortedCommands);
      } catch (error) {
        console.error('Error fetching slash commands:', error);
        setSlashCommands([]);
      }
    };

    fetchCommands();
  }, [selectedProject]);

  useEffect(() => {
    if (!showCommandMenu) {
      setSelectedCommandIndex(-1);
    }
  }, [showCommandMenu]);

  const fuse = useMemo(() => {
    if (!slashCommands.length) {
      return null;
    }

    return new Fuse(slashCommands, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'description', weight: 1 },
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 1,
    });
  }, [slashCommands]);

  useEffect(() => {
    if (!commandQuery) {
      setFilteredCommands(
        commandVisibilityFilter ? slashCommands.filter((command) => commandVisibilityFilter(command)) : slashCommands,
      );
      return;
    }

    if (!fuse) {
      setFilteredCommands([]);
      return;
    }

    const results = fuse.search(commandQuery);
    const nextCommands = results.map((result) => result.item);
    setFilteredCommands(
      commandVisibilityFilter
        ? nextCommands.filter((command) => commandVisibilityFilter(command))
        : nextCommands,
    );
  }, [commandQuery, slashCommands, fuse, commandVisibilityFilter]);

  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) {
      return [];
    }

    const parsedHistory = readCommandHistory(selectedProject.name);

    return slashCommands
      .map((command) => ({
        ...command,
        usageCount: parsedHistory[command.name] || 0,
      }))
      .filter((command) => (commandVisibilityFilter ? commandVisibilityFilter(command) : true))
      .filter((command) => command.usageCount > 0)
      .sort((commandA, commandB) => commandB.usageCount - commandA.usageCount)
      .slice(0, 5);
  }, [selectedProject, slashCommands, commandVisibilityFilter]);

  const trackCommandUsage = useCallback(
    (command: SlashCommand) => {
      if (!selectedProject) {
        return;
      }

      const parsedHistory = readCommandHistory(selectedProject.name);
      parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
      saveCommandHistory(selectedProject.name, parsedHistory);
    },
    [selectedProject],
  );

  const selectCommandFromKeyboard = useCallback(
    (command: SlashCommand) => {
      const cursorFromTextarea = textareaRef.current?.selectionStart ?? input.length;

      let newInput = '';
      let cursorPosition = 0;

      if (slashPosition >= 0) {
        const textBeforeSlash = input.slice(0, slashPosition);
        const textAfterSlash = input.slice(slashPosition);
        const spaceIndex = textAfterSlash.indexOf(' ');
        const trailingText = spaceIndex !== -1 ? textAfterSlash.slice(spaceIndex + 1).trimStart() : '';

        newInput = trailingText
          ? `${textBeforeSlash}${command.name} ${trailingText}`
          : `${textBeforeSlash}${command.name} `;
        cursorPosition = trailingText
          ? textBeforeSlash.length + command.name.length + 1 + trailingText.length
          : textBeforeSlash.length + command.name.length + 1;
      } else {
        const textBeforeCursor = input.slice(0, cursorFromTextarea);
        const textAfterCursor = input.slice(cursorFromTextarea);
        const separator = textBeforeCursor && !/\s$/.test(textBeforeCursor) ? ' ' : '';
        const inserted = `${separator}${command.name} `;
        newInput = `${textBeforeCursor}${inserted}${textAfterCursor}`;
        cursorPosition = textBeforeCursor.length + inserted.length;
      }

      setInput(newInput);
      resetCommandMenuState();
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
        }
      });
    },
    [input, slashPosition, setInput, resetCommandMenuState, textareaRef],
  );

  const handleCommandSelect = useCallback(
    (command: SlashCommand | null, index: number, isHover: boolean) => {
      if (!command || !selectedProject) {
        return;
      }

      if (isHover) {
        setSelectedCommandIndex(index);
        return;
      }

      trackCommandUsage(command);
      selectCommandFromKeyboard(command);
    },
    [selectedProject, trackCommandUsage, selectCommandFromKeyboard],
  );

  const handleToggleCommandMenu = useCallback(() => {
    const isOpening = !showCommandMenu;
    setShowCommandMenu(isOpening);
    setCommandQuery('');
    setSelectedCommandIndex(-1);

    if (isOpening) {
      setFilteredCommands(
        commandVisibilityFilter ? slashCommands.filter((command) => commandVisibilityFilter(command)) : slashCommands,
      );
    }

    textareaRef.current?.focus();
  }, [showCommandMenu, slashCommands, textareaRef, commandVisibilityFilter]);

  const handleCommandInputChange = useCallback(
    (newValue: string, cursorPos: number) => {
      if (!newValue.trim()) {
        resetCommandMenuState();
        return;
      }

      const textBeforeCursor = newValue.slice(0, cursorPos);
      const backticksBefore = (textBeforeCursor.match(/```/g) || []).length;
      const inCodeBlock = backticksBefore % 2 === 1;

      if (inCodeBlock) {
        resetCommandMenuState();
        return;
      }

      const slashPattern = /(^|\s)\/(\S*)$/;
      const match = textBeforeCursor.match(slashPattern);

      if (!match) {
        resetCommandMenuState();
        return;
      }

      const slashPos = (match.index || 0) + match[1].length;
      const query = match[2];

      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      clearCommandQueryTimer();
      commandQueryTimerRef.current = window.setTimeout(() => {
        setCommandQuery(query);
      }, COMMAND_QUERY_DEBOUNCE_MS);
    },
    [resetCommandMenuState, clearCommandQueryTimer],
  );

  const handleCommandMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showCommandMenu) {
        return false;
      }

      if (!filteredCommands.length) {
        if (event.key === 'Escape') {
          event.preventDefault();
          resetCommandMenuState();
          return true;
        }
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex < filteredCommands.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : filteredCommands.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        const cursorPos = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
        const textBeforeCursor = event.currentTarget.value.slice(0, cursorPos);
        const exactMatch = textBeforeCursor.match(/(^|\s)\/(\S*)$/);
        const exactTypedCommand =
          exactMatch && exactMatch[2]
            ? slashCommands.find((command) => command.name === `/${exactMatch[2]}`)
            : null;

        if (selectedCommandIndex >= 0) {
          selectCommandFromKeyboard(filteredCommands[selectedCommandIndex]);
        } else if (exactTypedCommand) {
          selectCommandFromKeyboard(exactTypedCommand);
        } else if (filteredCommands.length > 0) {
          selectCommandFromKeyboard(filteredCommands[0]);
        }
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        resetCommandMenuState();
        return true;
      }

      return false;
    },
    [showCommandMenu, filteredCommands, resetCommandMenuState, selectCommandFromKeyboard, selectedCommandIndex, slashCommands],
  );

  useEffect(
    () => () => {
      clearCommandQueryTimer();
    },
    [clearCommandQueryTimer],
  );

  return {
    slashCommands,
    slashCommandsCount: slashCommands.length,
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
  };
}
