import { useTranslation } from 'react-i18next';
import type { AgentProvider, HarnessProviderSettingsMap } from '../../../../../types/types';

type HarnessSubagentModelsSectionProps = {
  providers: HarnessProviderSettingsMap;
  selectedProvider: AgentProvider;
  loading: boolean;
  error: string | null;
  onSelectedProviderChange: (provider: AgentProvider) => void;
  onSubagentConfigChange: (
    provider: AgentProvider,
    role: 'reviewer' | 'validator',
    model: string,
  ) => void;
};

const providerOptions: Array<{ value: AgentProvider; label: string }> = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

function getSelectedModelValue(
  providerSettings: HarnessProviderSettingsMap[AgentProvider] | undefined,
  role: 'reviewer' | 'validator',
) {
  if (!providerSettings) {
    return 'inherit';
  }

  if (!providerSettings.supportsSubagentModelOverride) {
    return 'unsupported';
  }

  if (role === 'reviewer') {
    return providerSettings.reviewerMode === 'override'
      ? (providerSettings.reviewerModel || 'inherit')
      : 'inherit';
  }

  return providerSettings.validatorMode === 'override'
    ? (providerSettings.validatorModel || 'inherit')
    : 'inherit';
}

export default function HarnessSubagentModelsSection({
  providers,
  selectedProvider,
  loading,
  error,
  onSelectedProviderChange,
  onSubagentConfigChange,
}: HarnessSubagentModelsSectionProps) {
  const { t } = useTranslation('settings');
  const selectedSettings = providers[selectedProvider];
  const isSupported = Boolean(selectedSettings?.supportsSubagentModelOverride);
  const modelOptions = isSupported ? selectedSettings.availableModels : ['unsupported'];

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-foreground">{t('agents.harness.title')}</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('agents.harness.description')}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">{t('agents.harness.providerLabel')}</span>
          <select
            data-testid="harness-agent-provider-select"
            value={selectedProvider}
            onChange={(event) => onSelectedProviderChange(event.target.value as AgentProvider)}
            disabled={loading}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">{t('agents.harness.reviewerLabel')}</span>
          <select
            data-testid="harness-reviewer-model-select"
            value={getSelectedModelValue(selectedSettings, 'reviewer')}
            onChange={(event) => onSubagentConfigChange(selectedProvider, 'reviewer', event.target.value)}
            disabled={loading || !isSupported}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model === 'inherit'
                  ? t('agents.harness.inherit')
                  : model === 'unsupported'
                    ? t('agents.harness.unsupported')
                    : model}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">{t('agents.harness.validatorLabel')}</span>
          <select
            data-testid="harness-validator-model-select"
            value={getSelectedModelValue(selectedSettings, 'validator')}
            onChange={(event) => onSubagentConfigChange(selectedProvider, 'validator', event.target.value)}
            disabled={loading || !isSupported}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model === 'inherit'
                  ? t('agents.harness.inherit')
                  : model === 'unsupported'
                    ? t('agents.harness.unsupported')
                    : model}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedSettings && (
        <div className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <div>{t('agents.harness.modelSource', { value: selectedSettings.modelSourceType })}</div>
          <div>{t('agents.harness.reference', { value: selectedSettings.modelSourceRef })}</div>
        </div>
      )}
    </div>
  );
}
