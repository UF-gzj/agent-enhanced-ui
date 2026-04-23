import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeAtomicJson(targetPath, value) {
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmpPath, targetPath);
}

export function createTaskId() {
  return `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function stageToPackType(stage) {
  if (['prim', 'pinit', 'refr'].includes(stage)) {
    return 'prime';
  }

  if (stage === 'revu') {
    return 'review';
  }

  if (stage === 'vald') {
    return 'validation';
  }

  return 'plan';
}

export function buildRuntimePaths(projectPath, taskId) {
  const taskRoot = path.join(projectPath, '.claude', 'runtime', 'tasks', taskId);
  return {
    taskRoot,
    taskFile: path.join(taskRoot, 'task.json'),
    packsDir: path.join(taskRoot, 'packs'),
    runsDir: path.join(taskRoot, 'runs'),
    checkpointsDir: path.join(taskRoot, 'checkpoints'),
    eventsFile: path.join(taskRoot, 'events.ndjson'),
    locksDir: path.join(taskRoot, 'locks'),
  };
}

export function buildProjectRuntimePaths(projectPath) {
  const runtimeRoot = path.join(projectPath, '.claude', 'runtime');
  return {
    runtimeRoot,
    currentTaskFile: path.join(runtimeRoot, 'current-task.json'),
  };
}

export async function ensureProjectRuntime(projectPath) {
  const paths = buildProjectRuntimePaths(projectPath);
  await ensureDir(paths.runtimeRoot);
  return paths;
}

export async function ensureTaskRuntime(projectPath, taskId) {
  const paths = buildRuntimePaths(projectPath, taskId);
  await Promise.all([
    ensureDir(paths.taskRoot),
    ensureDir(paths.packsDir),
    ensureDir(paths.runsDir),
    ensureDir(paths.checkpointsDir),
    ensureDir(paths.locksDir),
  ]);
  return paths;
}

export async function readTask(projectPath, taskId) {
  const { taskFile } = buildRuntimePaths(projectPath, taskId);
  const raw = await fs.readFile(taskFile, 'utf8');
  return JSON.parse(raw);
}

export async function writeTask(projectPath, task) {
  const { taskFile } = await ensureTaskRuntime(projectPath, task.taskId);
  await writeAtomicJson(taskFile, task);
}

export async function writeCurrentTaskPointer(projectPath, task) {
  const { currentTaskFile } = await ensureProjectRuntime(projectPath);
  const pointer = {
    taskId: task.taskId,
    currentStage: task.currentStage,
    updatedAt: task.updatedAt || nowIso(),
  };
  await writeAtomicJson(currentTaskFile, pointer);
  return pointer;
}

export async function clearCurrentTaskPointer(projectPath) {
  const { currentTaskFile } = await ensureProjectRuntime(projectPath);
  await fs.rm(currentTaskFile, { force: true });
}

export async function readCurrentTaskPointer(projectPath) {
  try {
    const { currentTaskFile } = buildProjectRuntimePaths(projectPath);
    const raw = await fs.readFile(currentTaskFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readCurrentTask(projectPath) {
  const pointer = await readCurrentTaskPointer(projectPath);
  if (!pointer?.taskId) {
    return null;
  }

  try {
    return enrichTaskState(await readTask(projectPath, pointer.taskId));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const { currentTaskFile } = await ensureProjectRuntime(projectPath);
      await fs.rm(currentTaskFile, { force: true });
      return null;
    }
    throw error;
  }
}

export async function appendTaskEvent(projectPath, taskId, event) {
  const { eventsFile } = await ensureTaskRuntime(projectPath, taskId);
  const enrichedEvent = {
    eventId: `task_evt_${crypto.randomBytes(6).toString('hex')}`,
    createdAt: nowIso(),
    ...event,
  };
  await fs.appendFile(eventsFile, `${JSON.stringify(enrichedEvent)}\n`, 'utf8');
  return enrichedEvent;
}

export async function listTaskEvents(projectPath, taskId, limit = 100) {
  try {
    const { eventsFile } = buildRuntimePaths(projectPath, taskId);
    const raw = await fs.readFile(eventsFile, 'utf8');
    const events = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 500)) : 100;
    return events.slice(-normalizedLimit);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function writeRunRecord(projectPath, taskId, runRecord) {
  const { runsDir } = await ensureTaskRuntime(projectPath, taskId);
  const runPath = path.join(runsDir, `${runRecord.role}-${runRecord.sequence.toString().padStart(3, '0')}.json`);
  await writeAtomicJson(runPath, runRecord);
  return runPath;
}

export async function listRunRecords(projectPath, taskId) {
  const { runsDir } = await ensureTaskRuntime(projectPath, taskId);
  const fileNames = await fs.readdir(runsDir);
  const runFiles = fileNames.filter((fileName) => fileName.endsWith('.json')).sort();
  const runs = await Promise.all(
    runFiles.map(async (fileName) => {
      const runPath = path.join(runsDir, fileName);
      const raw = await fs.readFile(runPath, 'utf8');
      return JSON.parse(raw);
    }),
  );

  return runs.sort((runA, runB) => (runA.sequence || 0) - (runB.sequence || 0));
}

export async function getNextRunSequence(projectPath, taskId) {
  const runs = await listRunRecords(projectPath, taskId);
  return runs.reduce((maxSequence, run) => Math.max(maxSequence, Number(run.sequence) || 0), 0) + 1;
}

export function createInitialTask({
  taskId,
  sessionId,
  projectPath,
  title,
  stage,
  subagentModelConfig,
  mainClaudeModel,
}) {
  const createdAt = nowIso();
  return {
    taskId,
    sessionId: sessionId || null,
    projectPath,
    title,
    status: 'active',
    taskSummaryState: 'idle',
    primeState: 'unprimed',
    currentStage: stage,
    activePackVersions: {},
    artifactBindings: [],
    sourceHashes: {
      projectPath: sha256(projectPath),
    },
    mainClaudeModel: mainClaudeModel || null,
    subagentModelConfig: subagentModelConfig || null,
    laneSessions: {},
    activeGate: deriveActiveGate(null, stage),
    createdAt,
    updatedAt: createdAt,
  };
}

export function updateTaskForStage(task, stage) {
  return {
    ...task,
    currentStage: stage,
    activeGate: deriveActiveGate(task.activeGate, stage),
    updatedAt: nowIso(),
  };
}

export function deriveActiveGate(activeGate, stage) {
  const currentGate = activeGate || {
    reviewStatus: 'pending',
    validationStatus: 'pending',
    humanDecision: 'pending',
    blockers: [],
  };

  if (['exec', 'fix'].includes(stage)) {
    return {
      ...currentGate,
      reviewStatus: 'pending',
      validationStatus: 'pending',
      humanDecision: 'pending',
      blockers: Array.from(new Set([...(currentGate.blockers || []), 'awaiting-gate'])),
    };
  }

  if (stage === 'revu') {
    return {
      ...currentGate,
      reviewStatus: 'pending',
      humanDecision: 'pending',
      blockers: Array.from(new Set([...(currentGate.blockers || []), 'review-pending'])),
    };
  }

  if (stage === 'vald') {
    return {
      ...currentGate,
      validationStatus: 'pending',
      humanDecision: 'pending',
      blockers: Array.from(new Set([...(currentGate.blockers || []), 'validation-pending'])),
    };
  }

  return activeGate;
}

export function applyGateDecision(task, { lane, status, blockers, humanDecision }) {
  const currentGate =
    task.activeGate || {
      reviewStatus: 'pending',
      validationStatus: 'pending',
      humanDecision: 'pending',
      blockers: [],
    };

  const nextBlockers = Array.from(
    new Set(
      Array.isArray(blockers)
        ? blockers.filter(Boolean)
        : typeof blockers === 'string' && blockers.trim()
          ? [blockers.trim()]
          : currentGate.blockers || [],
    ),
  );

  let nextGate = {
    ...currentGate,
    blockers: nextBlockers,
  };

  if (lane === 'review') {
    nextGate = {
      ...nextGate,
      reviewStatus: status || currentGate.reviewStatus,
    };
  }

  if (lane === 'validation') {
    nextGate = {
      ...nextGate,
      validationStatus: status || currentGate.validationStatus,
    };
  }

  if (lane === 'human') {
    nextGate = {
      ...nextGate,
      humanDecision: humanDecision || currentGate.humanDecision,
    };
  }

  const isBlocked =
    nextGate.reviewStatus === 'failed' ||
    nextGate.validationStatus === 'failed' ||
    nextGate.humanDecision === 'rejected';

  return {
    ...task,
    status: isBlocked ? 'blocked' : 'active',
    activeGate: nextGate,
    updatedAt: nowIso(),
  };
}

export function deriveTaskSummaryState(task) {
  if (!task) {
    return 'idle';
  }

  if (task.status === 'blocked') {
    return 'blocked';
  }

  const hasInvalidatedGate = Boolean(
    task.activeGate &&
      (task.activeGate.reviewStatus === 'invalidated' || task.activeGate.validationStatus === 'invalidated'),
  );
  if (hasInvalidatedGate) {
    return 'invalidated';
  }

  const hasInvalidatedArtifacts =
    Array.isArray(task.artifactBindings) && task.artifactBindings.some((binding) => binding.status === 'invalidated');
  if (hasInvalidatedArtifacts) {
    return 'invalidated';
  }

  const hasStaleArtifacts = Array.isArray(task.artifactBindings) && task.artifactBindings.some((binding) => binding.status === 'stale');
  if (hasStaleArtifacts || task.primeState === 'stale') {
    return 'stale';
  }

  const hasPackVersions = Object.keys(task.activePackVersions || {}).length > 0;
  if (hasPackVersions) {
    return 'fresh';
  }

  return 'idle';
}

export function derivePrimeState(task) {
  const primeVersion = task?.activePackVersions?.prime || 0;
  if (primeVersion > 0) {
    return 'primed';
  }
  return 'unprimed';
}

export function enrichTaskState(task) {
  const primeState = derivePrimeState(task);
  return {
    ...task,
    primeState,
    taskSummaryState: deriveTaskSummaryState({
      ...task,
      primeState,
    }),
    updatedAt: task.updatedAt || nowIso(),
  };
}
