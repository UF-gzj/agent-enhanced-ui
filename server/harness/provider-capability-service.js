import path from 'path';
import { promises as fs } from 'fs';

export const HARNESS_PROVIDERS = ['claude', 'cursor', 'codex', 'gemini'];
export const DEFAULT_SUBAGENT_PROVIDER = 'claude';

const PROVIDER_CAPABILITIES = {
  claude: {
    provider: 'claude',
    displayName: 'Claude Code',
    supportsSubagentModelOverride: true,
    supportsNativeCommand: true,
    supportsNativeConfig: true,
    supportsNativeApi: false,
    defaultMode: 'inherit',
    availableModels: ['inherit', 'sonnet', 'opus', 'haiku'],
    modelSourceType: 'official-docs',
    modelSourceRef: 'Claude Code subagent model docs',
  },
  cursor: {
    provider: 'cursor',
    displayName: 'Cursor',
    supportsSubagentModelOverride: false,
    supportsNativeCommand: false,
    supportsNativeConfig: false,
    supportsNativeApi: false,
    defaultMode: 'unsupported',
    availableModels: [],
    modelSourceType: 'disabled-in-phase-1',
    modelSourceRef: 'phase-1-product-scope',
  },
  codex: {
    provider: 'codex',
    displayName: 'Codex',
    supportsSubagentModelOverride: false,
    supportsNativeCommand: false,
    supportsNativeConfig: false,
    supportsNativeApi: false,
    defaultMode: 'unsupported',
    availableModels: [],
    modelSourceType: 'disabled-in-phase-1',
    modelSourceRef: 'phase-1-product-scope',
  },
  gemini: {
    provider: 'gemini',
    displayName: 'Gemini',
    supportsSubagentModelOverride: false,
    supportsNativeCommand: false,
    supportsNativeConfig: false,
    supportsNativeApi: false,
    defaultMode: 'unsupported',
    availableModels: [],
    modelSourceType: 'disabled-in-phase-1',
    modelSourceRef: 'phase-1-product-scope',
  },
};

export function listProviderCapabilities() {
  return HARNESS_PROVIDERS.map((provider) => ({
    ...PROVIDER_CAPABILITIES[provider],
  }));
}

export function getProviderCapability(provider) {
  if (!provider || !PROVIDER_CAPABILITIES[provider]) {
    return null;
  }

  return {
    ...PROVIDER_CAPABILITIES[provider],
  };
}

export function isHarnessProvider(provider) {
  return HARNESS_PROVIDERS.includes(provider);
}

export async function getHarnessProjectCapability(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return {
      projectPath: projectPath || null,
      harnessAvailability: 'unavailable_project_unknown',
      reason: 'project-path-missing',
    };
  }

  const claudeDir = path.join(projectPath, '.claude');

  try {
    const stats = await fs.stat(claudeDir);
    if (stats.isDirectory()) {
      return {
        projectPath,
        harnessAvailability: 'available',
        reason: null,
      };
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        projectPath,
        harnessAvailability: 'unavailable_no_claude',
        reason: 'missing-.claude-directory',
      };
    }
  }

  return {
    projectPath,
    harnessAvailability: 'unavailable_project_unknown',
    reason: 'project-capability-check-failed',
  };
}
