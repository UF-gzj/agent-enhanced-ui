import { appConfigDb } from '../database/db.js';
import {
  DEFAULT_SUBAGENT_PROVIDER,
  HARNESS_PROVIDERS,
  getProviderCapability,
} from './provider-capability-service.js';

const STORAGE_KEY = 'harness_subagent_model_settings_v1';

function createDefaultConfigForProvider(provider) {
  if (provider === 'claude') {
    return {
      provider,
      reviewerMode: 'inherit',
      reviewerModel: 'inherit',
      validatorMode: 'inherit',
      validatorModel: 'inherit',
    };
  }

  return {
    provider,
    reviewerMode: 'unsupported',
    validatorMode: 'unsupported',
  };
}

function createDefaultSettings() {
  return {
    selectedProvider: DEFAULT_SUBAGENT_PROVIDER,
    configs: Object.fromEntries(
      HARNESS_PROVIDERS.map((provider) => [provider, createDefaultConfigForProvider(provider)]),
    ),
  };
}

function readStoredSettings() {
  const raw = appConfigDb.get(STORAGE_KEY);
  if (!raw) {
    return createDefaultSettings();
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...createDefaultSettings(),
      ...parsed,
      configs: {
        ...createDefaultSettings().configs,
        ...(parsed?.configs || {}),
      },
    };
  } catch (error) {
    console.warn('[HARNESS] Failed to parse subagent model settings:', error.message);
    return createDefaultSettings();
  }
}

function normalizeProviderConfig(provider, inputConfig) {
  const capability = getProviderCapability(provider);
  if (!capability) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  if (!capability.supportsSubagentModelOverride) {
    return createDefaultConfigForProvider(provider);
  }

  const reviewerMode = inputConfig?.reviewerMode === 'override' ? 'override' : 'inherit';
  const validatorMode = inputConfig?.validatorMode === 'override' ? 'override' : 'inherit';

  const availableModels = new Set(capability.availableModels || []);
  const reviewerModel =
    reviewerMode === 'override' && availableModels.has(inputConfig?.reviewerModel)
      ? inputConfig.reviewerModel
      : 'inherit';
  const validatorModel =
    validatorMode === 'override' && availableModels.has(inputConfig?.validatorModel)
      ? inputConfig.validatorModel
      : 'inherit';

  return {
    provider,
    reviewerMode,
    reviewerModel,
    validatorMode,
    validatorModel,
  };
}

export function getSubagentModelSettings() {
  const stored = readStoredSettings();
  const selectedProvider = HARNESS_PROVIDERS.includes(stored.selectedProvider)
    ? stored.selectedProvider
    : DEFAULT_SUBAGENT_PROVIDER;

  const configs = Object.fromEntries(
    HARNESS_PROVIDERS.map((provider) => [
      provider,
      normalizeProviderConfig(provider, stored.configs?.[provider]),
    ]),
  );

  return {
    selectedProvider,
    configs,
  };
}

export function saveSubagentModelSettings(input) {
  const current = getSubagentModelSettings();
  const selectedProvider = HARNESS_PROVIDERS.includes(input?.selectedProvider)
    ? input.selectedProvider
    : current.selectedProvider;

  const configs = Object.fromEntries(
    HARNESS_PROVIDERS.map((provider) => [
      provider,
      normalizeProviderConfig(provider, input?.configs?.[provider] || current.configs[provider]),
    ]),
  );

  const nextSettings = {
    selectedProvider,
    configs,
  };

  appConfigDb.set(STORAGE_KEY, JSON.stringify(nextSettings));
  return nextSettings;
}

export function buildSubagentModelSettingsResponse() {
  const settings = getSubagentModelSettings();
  return {
    selectedProvider: settings.selectedProvider,
    providers: HARNESS_PROVIDERS.map((provider) => ({
      ...getProviderCapability(provider),
      ...settings.configs[provider],
    })),
  };
}

export function getProviderSubagentConfig(provider) {
  const settings = getSubagentModelSettings();
  const capability = getProviderCapability(provider);
  if (!capability) {
    return null;
  }

  return {
    ...capability,
    ...settings.configs[provider],
  };
}

export function saveProviderSubagentConfig(provider, inputConfig) {
  if (!HARNESS_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const current = getSubagentModelSettings();
  return saveSubagentModelSettings({
    selectedProvider: provider,
    configs: {
      ...current.configs,
      [provider]: {
        ...current.configs[provider],
        ...(inputConfig || {}),
      },
    },
  });
}

export function resolveSubagentExecution(taskConfig, lane) {
  const provider = taskConfig?.provider || DEFAULT_SUBAGENT_PROVIDER;
  const capability = getProviderCapability(provider);
  const isReviewLane = lane === 'review';
  const configuredMode = isReviewLane ? taskConfig?.reviewerMode : taskConfig?.validatorMode;
  const configuredModel = isReviewLane ? taskConfig?.reviewerModel : taskConfig?.validatorModel;

  if (!capability || !capability.supportsSubagentModelOverride) {
    return {
      provider,
      lane,
      configuredMode: 'unsupported',
      configuredModel: null,
      resolvedMode: 'unsupported',
      resolvedModel: null,
      resolutionReason: 'provider-unsupported-in-phase-1',
    };
  }

  if (configuredMode === 'override' && configuredModel && configuredModel !== 'inherit') {
    return {
      provider,
      lane,
      configuredMode,
      configuredModel,
      resolvedMode: 'override',
      resolvedModel: configuredModel,
      resolutionReason: 'provider-override-applied',
    };
  }

  return {
    provider,
    lane,
    configuredMode: configuredMode || 'inherit',
    configuredModel: configuredModel || 'inherit',
    resolvedMode: 'inherit',
    resolvedModel: null,
    resolutionReason: 'inherits-main-model',
  };
}
