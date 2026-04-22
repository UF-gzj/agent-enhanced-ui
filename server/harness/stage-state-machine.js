const COMMAND_STAGE_MAP = new Map([
  ['/prim', 'prim'],
  ['/core/prime', 'prim'],
  ['/pinit', 'pinit'],
  ['/core/init-project', 'pinit'],
  ['/refr', 'refr'],
  ['/core/refresh-project-context', 'refr'],
  ['/bref', 'bref'],
  ['/core/backend-review-plan', 'bref'],
  ['/pln', 'pln'],
  ['/core/plan', 'pln'],
  ['/exec', 'exec'],
  ['/core/execute', 'exec'],
  ['/iter', 'iter'],
  ['/core/iterate', 'iter'],
  ['/rca', 'rca'],
  ['/bugfix/rca', 'rca'],
  ['/fix', 'fix'],
  ['/bugfix/implement-fix', 'fix'],
  ['/revu', 'revu'],
  ['/validation/review', 'revu'],
  ['/vald', 'vald'],
  ['/validation/validate', 'vald'],
  ['/xrep', 'xrep'],
  ['/validation/execution-report', 'xrep'],
  ['/srev', 'srev'],
  ['/validation/system-review', 'srev'],
  ['/cmit', 'cmit'],
  ['/commit', 'cmit'],
]);

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

export function normalizeCommandName(commandName = '') {
  const trimmed = String(commandName || '').trim();
  if (!trimmed) {
    return '';
  }

  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.replace(/:/g, '/').replace(/\/+/g, '/').toLowerCase();
}

export function inferStageFromCommandName(commandName = '') {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) {
    return 'prim';
  }

  if (COMMAND_STAGE_MAP.has(normalized)) {
    return COMMAND_STAGE_MAP.get(normalized);
  }

  const leaf = normalized.split('/').pop() || '';
  return COMMAND_STAGE_MAP.get(`/${leaf}`) || 'prim';
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

