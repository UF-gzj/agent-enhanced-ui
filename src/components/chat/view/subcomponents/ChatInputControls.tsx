import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PermissionMode, Provider } from '../../types/types';
import type { HarnessAvailability, HarnessWorkflowScenario } from '../../../../types/app';
import ThinkingModeSelector from './ThinkingModeSelector';
import TokenUsagePie from './TokenUsagePie';

interface ChatInputControlsProps {
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  provider: Provider | string;
  thinkingMode: string;
  setThinkingMode: React.Dispatch<React.SetStateAction<string>>;
  conversationMode: 'chat' | 'harness';
  harnessScenario: HarnessWorkflowScenario;
  harnessAvailability: HarnessAvailability;
  harnessAvailabilityReason: string | null;
  onConversationModeToggle: () => void;
  onHarnessScenarioChange: (scenario: HarnessWorkflowScenario) => void;
  tokenBudget: { used?: number; total?: number } | null;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
}

export default function ChatInputControls({
  permissionMode,
  onModeSwitch,
  provider,
  thinkingMode,
  setThinkingMode,
  conversationMode,
  harnessScenario,
  harnessAvailability,
  harnessAvailabilityReason,
  onConversationModeToggle,
  onHarnessScenarioChange,
  tokenBudget,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');
  const harnessDisabled = harnessAvailability !== 'available';
  const harnessTitle = harnessDisabled
    ? harnessAvailability === 'unavailable_no_claude'
      ? t('conversationMode.disabledNoClaude')
      : harnessAvailabilityReason || t('conversationMode.disabledGeneric')
    : t('conversationMode.toggleTitle');

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={onModeSwitch}
        className={`rounded-lg border px-2.5 py-1 text-sm font-medium transition-all duration-200 sm:px-3 sm:py-1.5 ${
          permissionMode === 'default'
            ? 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted'
            : permissionMode === 'acceptEdits'
              ? 'border-green-300/60 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-600/40 dark:bg-green-900/15 dark:text-green-300 dark:hover:bg-green-900/25'
              : permissionMode === 'bypassPermissions'
                ? 'border-orange-300/60 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-600/40 dark:bg-orange-900/15 dark:text-orange-300 dark:hover:bg-orange-900/25'
                : 'border-primary/20 bg-primary/5 text-primary hover:bg-primary/10'
        }`}
        title={t('input.clickToChangeMode')}
      >
        <div className="flex items-center gap-1.5">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              permissionMode === 'default'
                ? 'bg-muted-foreground'
                : permissionMode === 'acceptEdits'
                  ? 'bg-green-500'
                  : permissionMode === 'bypassPermissions'
                    ? 'bg-orange-500'
                    : 'bg-primary'
            }`}
          />
          <span>
            {permissionMode === 'default' && t('codex.modes.default')}
            {permissionMode === 'acceptEdits' && t('codex.modes.acceptEdits')}
            {permissionMode === 'bypassPermissions' && t('codex.modes.bypassPermissions')}
            {permissionMode === 'plan' && t('codex.modes.plan')}
          </span>
        </div>
      </button>

      <button
        type="button"
        onClick={onConversationModeToggle}
        disabled={harnessDisabled}
        data-testid="conversation-mode-toggle"
        data-mode={conversationMode}
        data-harness-availability={harnessAvailability}
        className={`rounded-lg border px-2.5 py-1 text-sm font-medium transition-all duration-200 sm:px-3 sm:py-1.5 ${
          conversationMode === 'harness'
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted'
        } disabled:cursor-not-allowed disabled:border-border/40 disabled:bg-muted/30 disabled:text-muted-foreground/60`}
        title={harnessTitle}
      >
        {conversationMode === 'harness'
          ? t('conversationMode.harness')
          : t('conversationMode.chat')}
      </button>

      {harnessAvailability === 'available' && (
        <label
          className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground sm:px-3 sm:py-1.5 sm:text-sm"
          title={t('conversationMode.scenarioHelp')}
        >
          <span>{t('conversationMode.scenarioLabel')}</span>
          <select
            data-testid="harness-scenario-select"
            value={harnessScenario}
            onChange={(event) => onHarnessScenarioChange(event.target.value as HarnessWorkflowScenario)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary sm:text-sm"
            style={{ fontFamily: 'inherit' }}
          >
            <option value="feature">{t('conversationMode.scenarios.feature')}</option>
            <option value="upgrade">{t('conversationMode.scenarios.upgrade')}</option>
            <option value="bugfix">{t('conversationMode.scenarios.bugfix')}</option>
          </select>
        </label>
      )}

      {provider === 'claude' && (
        <ThinkingModeSelector selectedMode={thinkingMode} onModeChange={setThinkingMode} onClose={() => {}} className="" />
      )}

      {typeof tokenBudget?.used === 'number' && typeof tokenBudget?.total === 'number' ? (
        <TokenUsagePie used={tokenBudget.used} total={tokenBudget.total} />
      ) : null}

      <button
        type="button"
        onClick={onToggleCommandMenu}
        data-testid="slash-command-menu-toggle"
        className="relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground sm:h-8 sm:w-8"
        title={t('input.showAllCommands')}
      >
        <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
          />
        </svg>
        {slashCommandsCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground sm:h-5 sm:w-5"
          >
            {slashCommandsCount}
          </span>
        )}
      </button>

      <div className="flex h-7 w-7 items-center justify-center sm:h-8 sm:w-8">
        <button
          type="button"
          onClick={onClearInput}
          className={`group flex h-7 w-7 items-center justify-center rounded-lg border border-border/50 bg-card shadow-sm transition-all duration-200 hover:bg-accent/60 sm:h-8 sm:w-8 ${
            hasInput ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          title={t('input.clearInput', { defaultValue: 'Clear input' })}
          aria-hidden={!hasInput}
          tabIndex={hasInput ? 0 : -1}
        >
          <svg
            className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground sm:h-4 sm:w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {isUserScrolledUp && hasMessages && (
        <button
          onClick={onScrollToBottom}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-all duration-200 hover:scale-105 hover:bg-primary/90 sm:h-8 sm:w-8"
          title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
        >
          <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
}
