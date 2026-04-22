import path from 'path';
import { promises as fs } from 'fs';
import { getHarnessProjectCapability } from './provider-capability-service.js';
import { readCurrentTask } from './task-manager.js';
import { listHarnessCommands } from './command-registry-service.js';
import { listProjectArtifacts } from './artifact-service.js';

async function statOrNull(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function getPrimeInputsLastUpdated(projectPath) {
  const targets = [
    path.join(projectPath, '.claude', 'CLAUDE.md'),
    path.join(projectPath, '.claude', 'prime-context.md'),
    path.join(projectPath, '.claude', 'reference', 'knowledge-index.md'),
    path.join(projectPath, '.claude', 'commands'),
  ];

  const stats = await Promise.all(targets.map((target) => statOrNull(target)));
  return stats.reduce((latest, entry) => {
    const value = entry?.mtimeMs || 0;
    return Math.max(latest, value);
  }, 0);
}

async function getPrimePackLastUpdated(projectPath, taskId) {
  const packsDir = path.join(projectPath, '.claude', 'runtime', 'tasks', taskId, 'packs');
  try {
    const fileNames = await fs.readdir(packsDir);
    const primePacks = fileNames.filter((fileName) => /^prime-pack\.v\d+\.md$/i.test(fileName)).sort();
    if (!primePacks.length) {
      return 0;
    }

    const latestPrimePack = primePacks[primePacks.length - 1];
    const stats = await fs.stat(path.join(packsDir, latestPrimePack));
    return stats.mtimeMs;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

export async function getWorkspacePrimeStatus(projectPath) {
  const capability = await getHarnessProjectCapability(projectPath);
  const commands = capability.harnessAvailability === 'available' ? await listHarnessCommands(projectPath) : [];
  const artifacts = capability.harnessAvailability === 'available' ? await listProjectArtifacts(projectPath) : [];

  if (capability.harnessAvailability !== 'available') {
    return {
      ...capability,
      workspacePrimeState: 'unprimed',
      reason: capability.reason || 'workspace-unavailable',
      currentTaskId: null,
      currentStage: null,
      lastPrimedAt: null,
      commandCount: commands.length,
      artifactCount: artifacts.length,
      staleReasons: [],
    };
  }

  const task = await readCurrentTask(projectPath);
  if (!task || task.primeState === 'unprimed') {
    return {
      ...capability,
      workspacePrimeState: 'unprimed',
      reason: 'prime-pack-missing',
      currentTaskId: task?.taskId || null,
      currentStage: task?.currentStage || null,
      lastPrimedAt: null,
      commandCount: commands.length,
      artifactCount: artifacts.length,
      staleReasons: [],
    };
  }

  const lastPrimedAtMs = await getPrimePackLastUpdated(projectPath, task.taskId);
  const primeInputsLastUpdated = await getPrimeInputsLastUpdated(projectPath);
  const staleReasons = [];

  if (lastPrimedAtMs > 0 && primeInputsLastUpdated > lastPrimedAtMs) {
    staleReasons.push('prime-inputs-updated-after-last-prime');
  }

  if (['stale', 'invalidated'].includes(task.taskSummaryState)) {
    staleReasons.push(`task-summary-${task.taskSummaryState}`);
  }

  const workspacePrimeState = staleReasons.length > 0 ? 'stale' : 'primed';

  return {
    ...capability,
    workspacePrimeState,
    reason: staleReasons[0] || 'prime-current',
    currentTaskId: task.taskId,
    currentStage: task.currentStage,
    lastPrimedAt: lastPrimedAtMs > 0 ? new Date(lastPrimedAtMs).toISOString() : null,
    commandCount: commands.length,
    artifactCount: artifacts.length,
    staleReasons,
  };
}

