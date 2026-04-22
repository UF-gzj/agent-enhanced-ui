import path from 'path';
import chokidar from 'chokidar';
import { appendTaskEvent, enrichTaskState, readTask, writeCurrentTaskPointer, writeTask } from './task-manager.js';
import { invalidateTaskState } from './invalidation-service.js';

const PROJECT_WATCHERS = new Map();

function buildIgnoredPatterns(projectPath) {
  const normalizedProjectPath = path.resolve(projectPath);
  return [
    (targetPath) => {
      const normalizedTargetPath = path.resolve(targetPath);
      const relativePath = path.relative(normalizedProjectPath, normalizedTargetPath);
      if (!relativePath || relativePath.startsWith('..')) {
        return false;
      }

      const normalizedRelative = relativePath.replace(/\\/g, '/');
      return (
        normalizedRelative.startsWith('.claude/runtime/') ||
        normalizedRelative.startsWith('.git/') ||
        normalizedRelative.startsWith('node_modules/') ||
        normalizedRelative.startsWith('dist/') ||
        normalizedRelative.startsWith('dist-server/')
      );
    },
  ];
}

async function invalidateTaskFromFileChange(projectPath, taskId, changedPath, changeType) {
  try {
    const task = await readTask(projectPath, taskId);
    const nextTask = enrichTaskState(
      invalidateTaskState(task, 'all', `file-changed:${changeType}:${changedPath.replace(/\\/g, '/')}`),
    );
    await writeTask(projectPath, nextTask);
    await writeCurrentTaskPointer(projectPath, nextTask);
    await appendTaskEvent(projectPath, taskId, {
      type: 'task_auto_invalidated',
      reason: 'file-changed',
      changeType,
      changedPath,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    console.error('[HARNESS] Failed to auto-invalidate task after file change:', error);
  }
}

export function ensureTaskProjectWatcher(projectPath, taskId) {
  const normalizedProjectPath = path.resolve(projectPath);
  const existing = PROJECT_WATCHERS.get(normalizedProjectPath);

  if (existing) {
    existing.activeTaskId = taskId;
    return existing.watcher;
  }

  const watcher = chokidar.watch(normalizedProjectPath, {
    ignored: buildIgnoredPatterns(normalizedProjectPath),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 50,
    },
  });

  const state = {
    watcher,
    activeTaskId: taskId,
  };

  const handleChange = async (changeType, changedPath) => {
    const relativePath = path.relative(normalizedProjectPath, changedPath);
    if (!relativePath || relativePath.startsWith('..')) {
      return;
    }

    const activeTaskId = PROJECT_WATCHERS.get(normalizedProjectPath)?.activeTaskId;
    if (!activeTaskId) {
      return;
    }

    await invalidateTaskFromFileChange(normalizedProjectPath, activeTaskId, relativePath, changeType);
  };

  watcher
    .on('change', (changedPath) => {
      void handleChange('change', changedPath);
    })
    .on('add', (changedPath) => {
      void handleChange('add', changedPath);
    })
    .on('unlink', (changedPath) => {
      void handleChange('unlink', changedPath);
    })
    .on('error', (error) => {
      console.error('[HARNESS] Task watcher error:', error);
    });

  PROJECT_WATCHERS.set(normalizedProjectPath, state);
  return watcher;
}

export async function closeAllTaskProjectWatchers() {
  await Promise.all(
    Array.from(PROJECT_WATCHERS.values()).map(async ({ watcher }) => {
      try {
        await watcher.close();
      } catch (error) {
        console.error('[HARNESS] Failed to close task watcher:', error);
      }
    }),
  );
  PROJECT_WATCHERS.clear();
}
