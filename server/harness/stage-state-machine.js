const PRIMARY_STAGE_COMMAND_MAP = new Map([
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

const COMMAND_STAGE_ENTRIES = [
  ['/core:prime', 'prim'],
  ['/core/prime', 'prim'],
  ['/prim', 'prim'],
  ['/core:init-project', 'pinit'],
  ['/core/init-project', 'pinit'],
  ['/pinit', 'pinit'],
  ['/core:refresh-project-context', 'refr'],
  ['/core/refresh-project-context', 'refr'],
  ['/refr', 'refr'],
  ['/core:backend-review-plan', 'bref'],
  ['/core/backend-review-plan', 'bref'],
  ['/bref', 'bref'],
  ['/core:plan', 'pln'],
  ['/core/plan', 'pln'],
  ['/pln', 'pln'],
  ['/core:execute', 'exec'],
  ['/core/execute', 'exec'],
  ['/exec', 'exec'],
  ['/core:iterate', 'iter'],
  ['/core/iterate', 'iter'],
  ['/iter', 'iter'],
  ['/bugfix:rca', 'rca'],
  ['/bugfix/rca', 'rca'],
  ['/rca', 'rca'],
  ['/bugfix:implement-fix', 'fix'],
  ['/bugfix/implement-fix', 'fix'],
  ['/fix', 'fix'],
  ['/validation:review', 'revu'],
  ['/validation/review', 'revu'],
  ['/revu', 'revu'],
  ['/validation:validate', 'vald'],
  ['/validation/validate', 'vald'],
  ['/vald', 'vald'],
  ['/validation:execution-report', 'xrep'],
  ['/validation/execution-report', 'xrep'],
  ['/xrep', 'xrep'],
  ['/validation:system-review', 'srev'],
  ['/validation/system-review', 'srev'],
  ['/srev', 'srev'],
  ['/commit', 'cmit'],
  ['/cmit', 'cmit'],
];

const COMMAND_STAGE_MAP = new Map(
  COMMAND_STAGE_ENTRIES.map(([commandName, stage]) => [normalizeCommandLookupKey(commandName), stage]),
);

export const STAGE_DEFINITIONS = {
  prim: {
    stage: 'prim',
    label: 'Prime',
    lane: 'main',
    allowedFrom: [],
    artifacts: [],
    preconditions: ['workspace-available'],
    nextStages: ['bref', 'pln', 'rca', 'refr'],
  },
  pinit: {
    stage: 'pinit',
    label: 'Init Project',
    lane: 'main',
    allowedFrom: [],
    artifacts: [],
    preconditions: ['workspace-available'],
    nextStages: ['prim', 'refr'],
  },
  refr: {
    stage: 'refr',
    label: 'Refresh Context',
    lane: 'main',
    allowedFrom: ['prim', 'pln', 'exec', 'iter', 'xrep', 'srev', 'cmit'],
    artifacts: [],
    preconditions: ['workspace-available'],
    nextStages: ['prim', 'bref', 'pln', 'rca'],
  },
  bref: {
    stage: 'bref',
    label: 'Backend Review Plan',
    lane: 'main',
    allowedFrom: ['prim', 'refr'],
    artifacts: ['decision'],
    preconditions: ['workspace-primed'],
    nextStages: ['pln', 'exec'],
  },
  pln: {
    stage: 'pln',
    label: 'Plan',
    lane: 'main',
    allowedFrom: ['prim', 'refr', 'bref', 'iter'],
    artifacts: ['plan'],
    preconditions: ['workspace-primed'],
    nextStages: ['exec', 'iter'],
  },
  exec: {
    stage: 'exec',
    label: 'Execute',
    lane: 'main',
    allowedFrom: ['pln', 'iter', 'bref'],
    artifacts: ['plan'],
    preconditions: ['workspace-primed'],
    nextStages: ['revu', 'vald', 'iter'],
  },
  rca: {
    stage: 'rca',
    label: 'Root Cause Analysis',
    lane: 'main',
    allowedFrom: ['prim', 'refr', 'iter'],
    artifacts: ['rca'],
    preconditions: ['workspace-primed'],
    nextStages: ['fix', 'iter'],
  },
  fix: {
    stage: 'fix',
    label: 'Implement Fix',
    lane: 'main',
    allowedFrom: ['rca', 'iter'],
    artifacts: ['rca'],
    preconditions: ['workspace-primed'],
    nextStages: ['revu', 'vald', 'iter'],
  },
  revu: {
    stage: 'revu',
    label: 'Review',
    lane: 'reviewer',
    allowedFrom: ['exec', 'fix', 'iter'],
    artifacts: ['review'],
    preconditions: ['review-pack-ready'],
    nextStages: ['gate', 'iter', 'xrep'],
  },
  vald: {
    stage: 'vald',
    label: 'Validate',
    lane: 'validator',
    allowedFrom: ['exec', 'fix', 'iter'],
    artifacts: ['report'],
    preconditions: ['validation-pack-ready'],
    nextStages: ['gate', 'iter', 'xrep'],
  },
  gate: {
    stage: 'gate',
    label: 'Gate',
    lane: 'main',
    allowedFrom: ['revu', 'vald'],
    artifacts: [],
    preconditions: ['review-validation-finished'],
    nextStages: ['iter', 'xrep'],
  },
  iter: {
    stage: 'iter',
    label: 'Iterate',
    lane: 'main',
    allowedFrom: ['exec', 'fix', 'revu', 'vald', 'gate', 'xrep', 'srev'],
    artifacts: [],
    preconditions: ['failure-or-feedback-available'],
    nextStages: ['pln', 'exec', 'fix', 'revu', 'vald'],
  },
  xrep: {
    stage: 'xrep',
    label: 'Execution Report',
    lane: 'main',
    allowedFrom: ['gate', 'revu', 'vald', 'iter'],
    artifacts: ['report'],
    preconditions: ['review-validation-passed'],
    nextStages: ['srev', 'cmit'],
  },
  srev: {
    stage: 'srev',
    label: 'System Review',
    lane: 'main',
    allowedFrom: ['xrep'],
    artifacts: ['report'],
    preconditions: ['execution-report-ready'],
    nextStages: ['cmit'],
  },
  cmit: {
    stage: 'cmit',
    label: 'Commit',
    lane: 'main',
    allowedFrom: ['srev'],
    artifacts: ['report'],
    preconditions: ['system-review-ready'],
    nextStages: [],
  },
};

export function normalizeCommandLookupKey(commandName = '') {
  const trimmed = String(commandName || '').trim();
  if (!trimmed) {
    return '';
  }

  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.replace(/:/g, '/').replace(/\/+/g, '/').toLowerCase();
}

export function formatClaudeCommandName(commandName = '') {
  const trimmed = String(commandName || '').trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const slashNormalized = normalized.replace(/:/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (!slashNormalized) {
    return '';
  }

  const segments = slashNormalized.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments.length <= 1) {
    return `/${segments[0]}`;
  }

  const [namespace, ...rest] = segments;
  return `/${namespace}:${rest.join('/')}`;
}

export function normalizeCommandName(commandName = '') {
  return normalizeCommandLookupKey(commandName);
}

export function getPreferredCommandNameForStage(stage) {
  return PRIMARY_STAGE_COMMAND_MAP.get(stage) || null;
}

export function inferStageFromCommandName(commandName = '') {
  const normalized = normalizeCommandLookupKey(commandName);
  if (!normalized) {
    return null;
  }

  if (COMMAND_STAGE_MAP.has(normalized)) {
    return COMMAND_STAGE_MAP.get(normalized);
  }

  const leaf = normalized.split('/').pop() || '';
  return COMMAND_STAGE_MAP.get(`/${leaf}`) || null;
}

export function getStageDefinition(stage) {
  return STAGE_DEFINITIONS[stage] || null;
}

export function listStageDefinitions() {
  return Object.values(STAGE_DEFINITIONS);
}

export function getAllowedNextStages(currentStage) {
  if (!currentStage) {
    return ['prim', 'pinit', 'refr'];
  }

  const definition = getStageDefinition(currentStage);
  return definition?.nextStages || [];
}

function hasPassingGate(task) {
  return (
    task?.activeGate?.reviewStatus === 'passed' &&
    task?.activeGate?.validationStatus === 'passed'
  );
}

export function validateStageTransition(task, nextStage) {
  const definition = getStageDefinition(nextStage);
  if (!definition) {
    return {
      valid: false,
      reason: `unknown-stage:${nextStage}`,
      allowedNextStages: task?.currentStage ? getAllowedNextStages(task.currentStage) : ['prim', 'pinit', 'refr'],
    };
  }

  if (!task) {
    const validInitial = ['prim', 'pinit', 'refr'].includes(nextStage);
    return {
      valid: validInitial,
      reason: validInitial ? 'initial-stage-allowed' : 'task-required-before-stage',
      allowedNextStages: ['prim', 'pinit', 'refr'],
    };
  }

  const currentStage = task.currentStage || null;
  if (currentStage === nextStage) {
    return {
      valid: true,
      reason: 'same-stage-rerun',
      allowedNextStages: getAllowedNextStages(currentStage),
    };
  }

  const allowedFrom = definition.allowedFrom || [];
  if (!allowedFrom.includes(currentStage)) {
    return {
      valid: false,
      reason: `stage-transition-not-allowed:${currentStage}->${nextStage}`,
      allowedNextStages: getAllowedNextStages(currentStage),
    };
  }

  if (nextStage === 'xrep' && !hasPassingGate(task)) {
    return {
      valid: false,
      reason: 'gate-not-passed-for-execution-report',
      allowedNextStages: getAllowedNextStages(currentStage),
    };
  }

  if (nextStage === 'gate') {
    const hasAnyGateProgress = ['passed', 'failed', 'invalidated'].includes(task?.activeGate?.reviewStatus) ||
      ['passed', 'failed', 'invalidated'].includes(task?.activeGate?.validationStatus);
    if (!hasAnyGateProgress) {
      return {
        valid: false,
        reason: 'gate-requires-review-or-validation-result',
        allowedNextStages: getAllowedNextStages(currentStage),
      };
    }
  }

  return {
    valid: true,
    reason: 'stage-transition-allowed',
    allowedNextStages: getAllowedNextStages(nextStage),
  };
}

