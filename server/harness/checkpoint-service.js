import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import {
  appendTaskEvent,
  buildRuntimePaths,
  listRunRecords,
  readTask,
  writeCurrentTaskPointer,
  writeTask,
} from './task-manager.js';
import { listPackRecordsForTask } from './pack-service.js';

function nowIso() {
  return new Date().toISOString();
}

function createCheckpointId() {
  return `checkpoint_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function writeAtomicJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmpPath, targetPath);
}

function checkpointFileName(checkpointId) {
  return `${checkpointId}.json`;
}

export async function listTaskCheckpoints(projectPath, taskId) {
  const { checkpointsDir } = buildRuntimePaths(projectPath, taskId);
  try {
    const fileNames = (await fs.readdir(checkpointsDir))
      .filter((fileName) => fileName.endsWith('.json'))
      .sort();
    const checkpoints = await Promise.all(
      fileNames.map(async (fileName) => {
        const raw = await fs.readFile(path.join(checkpointsDir, fileName), 'utf8');
        return JSON.parse(raw);
      }),
    );
    return checkpoints.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function createTaskCheckpoint(projectPath, taskId, { reason = 'manual-checkpoint' } = {}) {
  const task = await readTask(projectPath, taskId);
  const packRecords = await listPackRecordsForTask(projectPath, task);
  const recentRuns = await listRunRecords(projectPath, taskId);
  const checkpointId = createCheckpointId();
  const createdAt = nowIso();
  const checkpoint = {
    checkpointId,
    taskId,
    projectPath,
    reason,
    createdAt,
    snapshot: {
      task,
      packs: packRecords,
      runs: recentRuns.slice(-10),
      gate: task.activeGate || null,
    },
  };

  const { checkpointsDir } = buildRuntimePaths(projectPath, taskId);
  await writeAtomicJson(path.join(checkpointsDir, checkpointFileName(checkpointId)), checkpoint);
  await appendTaskEvent(projectPath, taskId, {
    type: 'checkpoint_created',
    checkpointId,
    reason,
  });

  return checkpoint;
}

export async function resumeTaskFromCheckpoint(projectPath, taskId, checkpointId) {
  const { checkpointsDir } = buildRuntimePaths(projectPath, taskId);
  const checkpointPath = path.join(checkpointsDir, checkpointFileName(checkpointId));
  const raw = await fs.readFile(checkpointPath, 'utf8');
  const checkpoint = JSON.parse(raw);

  const restoredTask = {
    ...checkpoint.snapshot.task,
    updatedAt: nowIso(),
  };

  await writeTask(projectPath, restoredTask);
  await writeCurrentTaskPointer(projectPath, restoredTask);
  await appendTaskEvent(projectPath, taskId, {
    type: 'checkpoint_restored',
    checkpointId,
    restoredStage: restoredTask.currentStage,
  });

  return {
    checkpoint,
    task: restoredTask,
  };
}
