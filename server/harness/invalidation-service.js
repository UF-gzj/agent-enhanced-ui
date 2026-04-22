function nowIso() {
  return new Date().toISOString();
}

export function invalidateDownstreamGate(task) {
  if (!task.activeGate) {
    return {
      ...task,
      updatedAt: nowIso(),
    };
  }

  return {
    ...task,
    activeGate: {
      ...task.activeGate,
      reviewStatus: 'invalidated',
      validationStatus: 'invalidated',
      blockers: Array.from(new Set([...(task.activeGate.blockers || []), 'upstream-changed'])),
    },
    updatedAt: nowIso(),
  };
}

export function invalidateTaskState(task, scope = 'all', reason = 'upstream-changed') {
  const invalidateReview = scope === 'all' || scope === 'review';
  const invalidateValidation = scope === 'all' || scope === 'validation';

  const nextGate = task.activeGate
    ? {
        ...task.activeGate,
        reviewStatus: invalidateReview ? 'invalidated' : task.activeGate.reviewStatus,
        validationStatus: invalidateValidation ? 'invalidated' : task.activeGate.validationStatus,
        blockers: Array.from(new Set([...(task.activeGate.blockers || []), reason])),
      }
    : null;

  return {
    ...task,
    activeGate: nextGate,
    artifactBindings: Array.isArray(task.artifactBindings)
      ? task.artifactBindings.map((binding) => ({
          ...binding,
          status: binding.status === 'superseded' ? binding.status : 'invalidated',
        }))
      : [],
    updatedAt: nowIso(),
  };
}
