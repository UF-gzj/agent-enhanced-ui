import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type ClaudeStatusProps = {
  status: {
    text?: string;
    tokens?: number;
    can_interrupt?: boolean;
  } | null;
  onAbort?: () => void;
  isLoading: boolean;
  provider?: string;
};

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  claude: 'messageTypes.claude',
  codex: 'messageTypes.codex',
  cursor: 'messageTypes.cursor',
  gemini: 'messageTypes.gemini',
};

function ClaudeStatus({
  status,
  onAbort,
  isLoading,
  provider = 'claude',
}: ClaudeStatusProps) {
  const { t } = useTranslation('chat');

  if (!isLoading && !status) return null;

  const statusText = isLoading
    ? t('claudeStatus.actions.processing', { defaultValue: 'Processing' })
    : (status?.text || t('claudeStatus.actions.processing', { defaultValue: 'Processing' })).replace(/[.]+$/, '');

  const providerLabel = t(PROVIDER_LABEL_KEYS[provider] || 'claudeStatus.providers.assistant', { defaultValue: 'Assistant' });

  return (
    <div className="mb-3 w-full">
      <div className="mx-auto flex min-h-[38px] max-w-4xl items-center justify-between gap-3 overflow-hidden rounded-full border border-border/60 bg-slate-50 px-3 py-1.5 shadow-sm dark:bg-slate-950">

        {/* Left Side: Identity & Status */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 ring-1 ring-primary/10">
            <SessionProviderLogo provider={provider} className="h-3.5 w-3.5" />
          </div>

          <div className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              {providerLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", isLoading ? "bg-emerald-500 status-indicator-soft" : "bg-amber-500")} />
              <p className="truncate text-xs font-medium text-foreground">
                {statusText}
                {isLoading && (
                  <span className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-start text-primary">
                    <span className="status-ellipsis-dot">.</span>
                    <span className="status-ellipsis-dot" style={{ animationDelay: '0.16s' }}>.</span>
                    <span className="status-ellipsis-dot" style={{ animationDelay: '0.32s' }}>.</span>
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Right Side: Metrics & Actions */}
        <div className="flex items-center gap-2">
          {isLoading && status?.can_interrupt !== false && onAbort && (
            <>
              <button
                type="button"
                onClick={onAbort}
                className="group flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-bold text-destructive transition-all hover:bg-destructive hover:text-destructive-foreground"
              >
                <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span className="hidden sm:inline">STOP</span>
                <kbd className="hidden rounded bg-black/10 px-1 text-[9px] group-hover:bg-white/20 sm:block">
                  ESC
                </kbd>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ClaudeStatus);
