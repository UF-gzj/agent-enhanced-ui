import express from 'express';
import {
  getHarnessProjectCapability,
  isHarnessProvider,
  listProviderCapabilities,
} from '../harness/provider-capability-service.js';
import {
  buildSubagentModelSettingsResponse,
  getProviderSubagentConfig,
  getSubagentModelSettings,
  resolveSubagentExecution,
  saveProviderSubagentConfig,
  saveSubagentModelSettings,
} from '../harness/subagent-model-config-service.js';
import { appendAppMetricEvent, listAppMetricEvents } from '../harness/metrics-service.js';
import {
  applyGateDecision,
  appendTaskEvent,
  createInitialTask,
  createTaskId,
  enrichTaskState,
  getNextRunSequence,
  listRunRecords,
  listTaskEvents,
  readCurrentTask,
  readTask,
  writeCurrentTaskPointer,
  updateTaskForStage,
  writeRunRecord,
  writeTask,
} from '../harness/task-manager.js';
import { createOrUpdatePack, listPackRecordsForTask } from '../harness/pack-service.js';
import { invalidateDownstreamGate, invalidateTaskState } from '../harness/invalidation-service.js';
import { ensureTaskProjectWatcher } from '../harness/task-watch-service.js';
import { getWorkspacePrimeStatus } from '../harness/workspace-prime-service.js';
import { listHarnessCommands } from '../harness/command-registry-service.js';
import { decorateArtifactsWithBindings, refreshTaskArtifactBindings } from '../harness/artifact-service.js';
import {
  getStageDefinition,
  inferStageFromCommandName,
  validateStageTransition,
} from '../harness/stage-state-machine.js';
import { listTaskTimeline } from '../harness/run-timeline-service.js';
import { getEvalSummary, listEvalDatasets, listEvalResults, runEvalBenchmark, saveEvalDataset } from '../harness/eval-service.js';
import { createTaskCheckpoint, listTaskCheckpoints, resumeTaskFromCheckpoint } from '../harness/checkpoint-service.js';
import { listKnowledgeFeedback, writeKnowledgeFeedback } from '../harness/knowledge-feedback-service.js';
import { initializeHarnessBootstrap } from '../harness/bootstrap-service.js';
const router = express.Router();

async function ensureHarnessAvailable(projectPath, res) {
  const capability = await getHarnessProjectCapability(projectPath);
  if (capability.harnessAvailability !== 'available') {
    res.status(400).json({
      error: 'Harness unavailable for project',
      ...capability,
    });
    return null;
  }
  return capability;
}

async function executeTaskStage({
  projectPath,
  taskId,
  message,
  sendMode,
  commandName,
  commandContent,
}) {
  const stage = inferStageFromCommandName(commandName);
  const subagentSettings = getSubagentModelSettings();
  const selectedProviderConfig =
    subagentSettings.configs?.[subagentSettings.selectedProvider] || null;

  if (!taskId) {
    const transitionDecision = validateStageTransition(null, stage);
    if (!transitionDecision.valid) {
      return {
        ok: false,
        statusCode: 400,
        body: {
          error: 'Initial stage is not allowed',
          stage,
          reason: transitionDecision.reason,
          allowedNextStages: transitionDecision.allowedNextStages,
        },
      };
    }

    const nextTaskId = createTaskId();
    let task = createInitialTask({
      taskId: nextTaskId,
      sessionId: null,
      projectPath,
      title: message,
      stage,
      subagentModelConfig: selectedProviderConfig,
    });

    const artifactResult = await refreshTaskArtifactBindings(
      projectPath,
      task,
      getStageDefinition(stage)?.artifacts || [],
    );
    task = {
      ...task,
      artifactBindings: artifactResult.artifactBindings,
    };

    const pack = await createOrUpdatePack({
      projectPath,
      task,
      stage,
      message,
      commandName,
      commandContent,
    });

    task = enrichTaskState({
      ...task,
      activePackVersions: {
        ...task.activePackVersions,
        [pack.packType]: pack.version,
      },
    });

    await writeTask(projectPath, task);
    await writeCurrentTaskPointer(projectPath, task);
    ensureTaskProjectWatcher(projectPath, task.taskId);
    const runPath = await writeRunRecord(projectPath, task.taskId, {
      runId: `${task.taskId}-main-001`,
      sequence: 1,
      role: 'main',
      stage,
      status: 'completed',
      inputPackVersion: pack.version,
      findingsCount: 0,
      summary: `stage ${stage} started`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await appendTaskEvent(projectPath, task.taskId, {
      type: 'task_started',
      stage,
      sendMode,
      commandName,
      packType: pack.packType,
      packVersion: pack.version,
      artifactBindings: task.artifactBindings,
      runPath,
    });

    return {
      ok: true,
      body: {
        success: true,
        task,
        pack,
        sendMode,
      },
    };
  }

  let task = await readTask(projectPath, taskId);
  const transitionDecision = validateStageTransition(task, stage);
  if (!transitionDecision.valid) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        error: 'Stage transition is not allowed',
        stage,
        reason: transitionDecision.reason,
        allowedNextStages: transitionDecision.allowedNextStages,
      },
    };
  }

  task = updateTaskForStage(invalidateDownstreamGate(task), stage);
  const artifactResult = await refreshTaskArtifactBindings(
    projectPath,
    task,
    getStageDefinition(stage)?.artifacts || [],
  );
  const taskWithArtifacts = {
    ...task,
    artifactBindings: artifactResult.artifactBindings,
  };

  const pack = await createOrUpdatePack({
    projectPath,
    task: taskWithArtifacts,
    stage,
    message,
    commandName,
    commandContent,
  });

  task = enrichTaskState({
    ...taskWithArtifacts,
    activePackVersions: {
      ...taskWithArtifacts.activePackVersions,
      [pack.packType]: pack.version,
    },
  });

  await writeTask(projectPath, task);
  await writeCurrentTaskPointer(projectPath, task);
  ensureTaskProjectWatcher(projectPath, task.taskId);
  const sequence = await getNextRunSequence(projectPath, task.taskId);
  const runPath = await writeRunRecord(projectPath, task.taskId, {
    runId: `${task.taskId}-main-${sequence.toString().padStart(3, '0')}`,
    sequence,
    role: 'main',
    stage,
    status: 'completed',
    inputPackVersion: pack.version,
    findingsCount: 0,
    summary: `stage ${stage} continued`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await appendTaskEvent(projectPath, task.taskId, {
    type: 'task_continued',
    stage,
    sendMode,
    commandName,
    packType: pack.packType,
    packVersion: pack.version,
    artifactBindings: task.artifactBindings,
    runPath,
  });

  return {
    ok: true,
    body: {
      success: true,
      task,
      pack,
      sendMode,
    },
  };
}

router.get('/projects/capability', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';
    const capability = await getHarnessProjectCapability(projectPath);
    res.json(capability);
  } catch (error) {
    console.error('[HARNESS] Failed to read project capability:', error);
    res.status(500).json({
      projectPath: req.query.projectPath || null,
      harnessAvailability: 'unavailable_project_unknown',
      reason: 'project-capability-read-failed',
    });
  }
});

router.get('/projects/current-task', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const capability = await getHarnessProjectCapability(projectPath);
    if (capability.harnessAvailability !== 'available') {
      return res.json({
        success: true,
        ...capability,
        taskId: null,
        task: null,
      });
    }

    const task = await readCurrentTask(projectPath);
    return res.json({
      success: true,
      ...capability,
      taskId: task?.taskId || null,
      task: task || null,
    });
  } catch (error) {
    console.error('[HARNESS] Failed to read current task:', error);
    res.status(500).json({ error: 'Failed to read current harness task' });
  }
});

router.get('/workspaces/status', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const workspaceStatus = await getWorkspacePrimeStatus(projectPath);
    return res.json({
      success: true,
      workspace: workspaceStatus,
    });
  } catch (error) {
    console.error('[HARNESS] Failed to read workspace status:', error);
    res.status(500).json({ error: 'Failed to read workspace status' });
  }
});

router.get('/commands', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const commands = await listHarnessCommands(projectPath);
    return res.json({
      success: true,
      commands,
    });
  } catch (error) {
    console.error('[HARNESS] Failed to read command registry:', error);
    res.status(500).json({ error: 'Failed to read command registry' });
  }
});

router.get('/tasks/:taskId/packs', async (req, res) => {
  try {
    const { taskId } = req.params;
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const task = enrichTaskState(await readTask(projectPath, taskId));
    const packs = await listPackRecordsForTask(projectPath, task);
    return res.json({
      success: true,
      taskId,
      packs,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to read packs:', error);
    res.status(500).json({ error: 'Failed to read harness packs' });
  }
});

router.get('/tasks/:taskId/runs', async (req, res) => {
  try {
    const { taskId } = req.params;
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const runs = await listRunRecords(projectPath, taskId);
    return res.json({
      success: true,
      taskId,
      runs,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to read runs:', error);
    res.status(500).json({ error: 'Failed to read harness runs' });
  }
});

router.get('/tasks/:taskId/timeline', async (req, res) => {
  try {
    const { taskId } = req.params;
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const timeline = await listTaskTimeline(projectPath, taskId);
    return res.json({
      success: true,
      taskId,
      timeline,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to read timeline:', error);
    res.status(500).json({ error: 'Failed to read harness timeline' });
  }
});

router.get('/tasks/:taskId/artifacts', async (req, res) => {
  try {
    const { taskId } = req.params;
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const task = await readTask(projectPath, taskId);
    const definition = getStageDefinition(task.currentStage);
    const artifactResult = await refreshTaskArtifactBindings(projectPath, task, definition?.artifacts || []);
    return res.json({
      success: true,
      taskId,
      artifacts: decorateArtifactsWithBindings(
        artifactResult.artifacts,
        task.artifactBindings || artifactResult.artifactBindings,
        task.taskId,
      ),
      bindings: artifactResult.artifactBindings,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to read artifacts:', error);
    res.status(500).json({ error: 'Failed to read harness artifacts' });
  }
});

router.get('/tasks/:taskId/gate', async (req, res) => {
  try {
    const { taskId } = req.params;
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const task = enrichTaskState(await readTask(projectPath, taskId));
    return res.json({
      success: true,
      taskId,
      gate: task.activeGate || null,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to read gate:', error);
    res.status(500).json({ error: 'Failed to read harness gate' });
  }
});

router.get('/tasks/:taskId/events', async (req, res) => {
  try {
    const { taskId } = req.params;
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';
    const limit = typeof req.query.limit === 'string' ? req.query.limit : 100;

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const events = await listTaskEvents(projectPath, taskId, limit);
    return res.json({
      success: true,
      taskId,
      events,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to read task events:', error);
    res.status(500).json({ error: 'Failed to read harness task events' });
  }
});

router.get('/providers/capabilities', async (_req, res) => {
  try {
    res.json({
      providers: listProviderCapabilities(),
    });
  } catch (error) {
    console.error('[HARNESS] Failed to read provider capabilities:', error);
    res.status(500).json({ error: 'Failed to read provider capabilities' });
  }
});

router.get('/providers/subagent-capabilities', async (_req, res) => {
  try {
    res.json({
      providers: listProviderCapabilities(),
    });
  } catch (error) {
    console.error('[HARNESS] Failed to read subagent capabilities:', error);
    res.status(500).json({ error: 'Failed to read subagent capabilities' });
  }
});

router.get('/providers/:provider/subagent-config', async (req, res) => {
  try {
    const { provider } = req.params;
    if (!isHarnessProvider(provider)) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }

    const config = getProviderSubagentConfig(provider);
    res.json(config);
  } catch (error) {
    console.error('[HARNESS] Failed to read provider subagent config:', error);
    res.status(500).json({ error: 'Failed to read provider subagent config' });
  }
});

router.put('/providers/:provider/subagent-config', async (req, res) => {
  try {
    const { provider } = req.params;
    if (!isHarnessProvider(provider)) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }

    saveProviderSubagentConfig(provider, req.body || {});
    res.json(getProviderSubagentConfig(provider));
  } catch (error) {
    console.error('[HARNESS] Failed to save provider subagent config:', error);
    res.status(500).json({ error: 'Failed to save provider subagent config' });
  }
});

router.get('/settings/subagent-models', async (_req, res) => {
  try {
    res.json(buildSubagentModelSettingsResponse());
  } catch (error) {
    console.error('[HARNESS] Failed to read subagent model settings:', error);
    res.status(500).json({ error: 'Failed to read subagent model settings' });
  }
});

router.put('/settings/subagent-models', async (req, res) => {
  try {
    const selectedProvider = req.body?.selectedProvider;
    if (selectedProvider && !isHarnessProvider(selectedProvider)) {
      return res.status(400).json({ error: 'Unsupported selectedProvider' });
    }

    saveSubagentModelSettings(req.body || {});
    res.json(buildSubagentModelSettingsResponse());
  } catch (error) {
    console.error('[HARNESS] Failed to save subagent model settings:', error);
    res.status(500).json({ error: 'Failed to save subagent model settings' });
  }
});

router.post('/tasks/start', async (req, res) => {
  try {
    const {
      projectPath,
      message = '为当前需求启动 Harness 流程',
      sendMode = 'force_harness',
      commandName = '',
      commandContent = '',
    } = req.body || {};

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const result = await executeTaskStage({
      projectPath,
      message,
      sendMode,
      commandName,
      commandContent,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.body);
    }
    res.json(result.body);
  } catch (error) {
    console.error('[HARNESS] Failed to start task:', error);
    res.status(500).json({ error: 'Failed to start harness task' });
  }
});

router.post('/tasks/:taskId/continue', async (req, res) => {
  try {
    const { taskId } = req.params;
    const {
      projectPath,
      message = '继续执行 Harness 流程',
      sendMode = 'force_harness',
      commandName = '',
      commandContent = '',
    } = req.body || {};

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const result = await executeTaskStage({
      projectPath,
      taskId,
      message,
      sendMode,
      commandName,
      commandContent,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.body);
    }
    res.json(result.body);
  } catch (error) {
    console.error('[HARNESS] Failed to continue task:', error);
    res.status(500).json({ error: 'Failed to continue harness task' });
  }
});

router.post('/tasks/:taskId/stages/:stage/execute', async (req, res) => {
  try {
    const { taskId, stage } = req.params;
    const {
      projectPath,
      message = `执行 ${stage} 阶段`,
      commandName = `/${stage}`,
      commandContent = '',
      sendMode = 'force_harness',
    } = req.body || {};

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const result = await executeTaskStage({
      projectPath,
      taskId,
      message,
      sendMode,
      commandName,
      commandContent,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.body);
    }
    return res.json(result.body);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to execute stage:', error);
    res.status(500).json({ error: 'Failed to execute harness stage' });
  }
});

router.post('/tasks/:taskId/gate', async (req, res) => {
  try {
    const { taskId } = req.params;
    const {
      projectPath,
      lane,
      status = null,
      humanDecision = null,
      blockers = [],
      summary = '',
    } = req.body || {};

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    if (!['review', 'validation', 'human'].includes(lane)) {
      return res.status(400).json({ error: 'lane must be review, validation, or human' });
    }

    if (lane !== 'human' && !['pending', 'passed', 'failed', 'invalidated'].includes(status)) {
      return res.status(400).json({ error: 'status is invalid for gate lane' });
    }

    if (lane === 'human' && !['pending', 'approved', 'rejected', 'not_required'].includes(humanDecision)) {
      return res.status(400).json({ error: 'humanDecision is invalid for gate lane' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    let task = await readTask(projectPath, taskId);
    task = enrichTaskState(
      applyGateDecision(task, {
        lane,
        status,
        humanDecision,
        blockers,
      }),
    );

    await writeTask(projectPath, task);
    await writeCurrentTaskPointer(projectPath, task);
    const sequence = await getNextRunSequence(projectPath, task.taskId);
    const role = lane === 'human' ? 'main' : lane === 'review' ? 'reviewer' : 'validator';
    const stage = lane === 'human' ? 'gate' : lane === 'review' ? 'revu' : 'vald';
    const decisionStatus = lane === 'human' ? humanDecision : status;
    const modelResolution =
      lane === 'review' || lane === 'validation'
        ? resolveSubagentExecution(task.subagentModelConfig, lane)
        : null;
    const runPath = await writeRunRecord(projectPath, task.taskId, {
      runId: `${task.taskId}-${role}-${sequence.toString().padStart(3, '0')}`,
      taskId: task.taskId,
      sequence,
      role,
      stage,
      status: decisionStatus,
      inputPackVersion:
        lane === 'review'
          ? task.activePackVersions?.review || null
          : lane === 'validation'
            ? task.activePackVersions?.validation || null
            : null,
      findingsCount: Array.isArray(blockers) ? blockers.length : 0,
      blockers: Array.isArray(blockers) ? blockers : [],
      summary,
      modelResolution,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await appendTaskEvent(projectPath, task.taskId, {
      type: 'gate_updated',
      lane,
      status: lane === 'human' ? humanDecision : status,
      blockers: Array.isArray(blockers) ? blockers : [],
      summary,
      runPath,
    });

    res.json({
      success: true,
      task,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to update gate:', error);
    res.status(500).json({ error: 'Failed to update harness gate' });
  }
});

router.post('/tasks/:taskId/invalidate', async (req, res) => {
  try {
    const { taskId } = req.params;
    const {
      projectPath,
      scope = 'all',
      reason = 'upstream-changed',
      summary = '',
    } = req.body || {};

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    if (!['all', 'review', 'validation'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be all, review, or validation' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    let task = await readTask(projectPath, taskId);
    task = enrichTaskState(invalidateTaskState(task, scope, reason));

    await writeTask(projectPath, task);
    await writeCurrentTaskPointer(projectPath, task);
    await appendTaskEvent(projectPath, task.taskId, {
      type: 'task_invalidated',
      scope,
      reason,
      summary,
    });

    res.json({
      success: true,
      task,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to invalidate task:', error);
    res.status(500).json({ error: 'Failed to invalidate harness task' });
  }
});

router.post('/tasks/:taskId/artifacts/refresh', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { projectPath } = req.body || {};

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    let task = await readTask(projectPath, taskId);
    const definition = getStageDefinition(task.currentStage);
    const artifactResult = await refreshTaskArtifactBindings(projectPath, task, definition?.artifacts || []);

    task = {
      ...task,
      artifactBindings: artifactResult.artifactBindings,
    };

    if (artifactResult.changed) {
      task = enrichTaskState(invalidateTaskState(task, 'all', 'artifact-refresh-changed'));
    } else {
      task = enrichTaskState(task);
    }

    await writeTask(projectPath, task);
    await writeCurrentTaskPointer(projectPath, task);
    await appendTaskEvent(projectPath, task.taskId, {
      type: 'artifacts_refreshed',
      changed: artifactResult.changed,
      artifactCount: artifactResult.artifacts.length,
    });

    return res.json({
      success: true,
      task,
      artifacts: decorateArtifactsWithBindings(
        artifactResult.artifacts,
        artifactResult.artifactBindings,
        task.taskId,
      ),
      bindings: artifactResult.artifactBindings,
      changed: artifactResult.changed,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to refresh artifacts:', error);
    res.status(500).json({ error: 'Failed to refresh harness artifacts' });
  }
});

router.get('/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }

    const task = enrichTaskState(await readTask(projectPath, taskId));
    res.json({
      success: true,
      task,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ error: 'Harness task not found' });
    }
    console.error('[HARNESS] Failed to read task:', error);
    res.status(500).json({ error: 'Failed to read harness task' });
  }
});

router.post('/metrics/events/app', async (req, res) => {
  try {
    const event = await appendAppMetricEvent(req.body || {});
    res.json({ success: true, event });
  } catch (error) {
    console.error('[HARNESS] Failed to append app metric event:', error);
    res.status(500).json({ error: 'Failed to append app metric event' });
  }
});

router.get('/metrics/events/app', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : null;
    const limit = typeof req.query.limit === 'string' ? req.query.limit : 100;
    const events = await listAppMetricEvents({ projectPath, limit });
    res.json({
      success: true,
      events,
    });
  } catch (error) {
    console.error('[HARNESS] Failed to read app metric events:', error);
    res.status(500).json({ error: 'Failed to read app metric events' });
  }
});

router.get('/evals/datasets', async (req, res) => {
  try {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : null;
    const datasets = await listEvalDatasets({ provider });
    res.json({ success: true, datasets });
  } catch (error) {
    console.error('[HARNESS] Failed to read eval datasets:', error);
    res.status(500).json({ error: 'Failed to read eval datasets' });
  }
});

router.post('/evals/datasets', async (req, res) => {
  try {
    const dataset = await saveEvalDataset(req.body || {});
    res.json({ success: true, dataset });
  } catch (error) {
    console.error('[HARNESS] Failed to save eval dataset:', error);
    res.status(500).json({ error: 'Failed to save eval dataset' });
  }
});

router.post('/evals/run', async (req, res) => {
  try {
    const result = await runEvalBenchmark(req.body || {});
    res.json({ success: true, result });
  } catch (error) {
    if (error?.code === 'DATASET_NOT_FOUND') {
      return res.status(404).json({ error: 'Eval dataset not found' });
    }
    console.error('[HARNESS] Failed to run eval benchmark:', error);
    res.status(500).json({ error: 'Failed to run eval benchmark' });
  }
});

router.get('/evals/results', async (req, res) => {
  try {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : null;
    const datasetId = typeof req.query.datasetId === 'string' ? req.query.datasetId : null;
    const results = await listEvalResults({ provider, datasetId });
    res.json({ success: true, results });
  } catch (error) {
    console.error('[HARNESS] Failed to read eval results:', error);
    res.status(500).json({ error: 'Failed to read eval results' });
  }
});

router.get('/evals/summary', async (req, res) => {
  try {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : null;
    const datasetId = typeof req.query.datasetId === 'string' ? req.query.datasetId : null;
    const summary = await getEvalSummary({ provider, datasetId });
    res.json({ success: true, summary });
  } catch (error) {
    console.error('[HARNESS] Failed to read eval summary:', error);
    res.status(500).json({ error: 'Failed to read eval summary' });
  }
});

router.get('/tasks/:taskId/checkpoints', async (req, res) => {
  try {
    const { taskId } = req.params;
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }
    const checkpoints = await listTaskCheckpoints(projectPath, taskId);
    res.json({ success: true, taskId, checkpoints });
  } catch (error) {
    console.error('[HARNESS] Failed to read checkpoints:', error);
    res.status(500).json({ error: 'Failed to read checkpoints' });
  }
});

router.post('/tasks/:taskId/checkpoint', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { projectPath, reason = 'manual-checkpoint' } = req.body || {};
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }
    const checkpoint = await createTaskCheckpoint(projectPath, taskId, { reason });
    res.json({ success: true, checkpoint });
  } catch (error) {
    console.error('[HARNESS] Failed to create checkpoint:', error);
    res.status(500).json({ error: 'Failed to create checkpoint' });
  }
});

router.post('/tasks/:taskId/resume', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { projectPath, checkpointId } = req.body || {};
    if (!projectPath || !checkpointId) {
      return res.status(400).json({ error: 'projectPath and checkpointId are required' });
    }
    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }
    const restored = await resumeTaskFromCheckpoint(projectPath, taskId, checkpointId);
    res.json({ success: true, ...restored });
  } catch (error) {
    console.error('[HARNESS] Failed to resume checkpoint:', error);
    res.status(500).json({ error: 'Failed to resume checkpoint' });
  }
});

router.get('/knowledge/feedback', async (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';
    const limit = typeof req.query.limit === 'string' ? req.query.limit : 100;
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }
    const feedback = await listKnowledgeFeedback(projectPath, { limit });
    res.json({ success: true, feedback });
  } catch (error) {
    console.error('[HARNESS] Failed to read knowledge feedback:', error);
    res.status(500).json({ error: 'Failed to read knowledge feedback' });
  }
});

router.post('/knowledge/feedback', async (req, res) => {
  try {
    const { projectPath, ...payload } = req.body || {};
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const availability = await ensureHarnessAvailable(projectPath, res);
    if (!availability) {
      return;
    }
    const record = await writeKnowledgeFeedback(projectPath, payload);
    res.json({ success: true, feedback: record });
  } catch (error) {
    console.error('[HARNESS] Failed to write knowledge feedback:', error);
    res.status(500).json({ error: 'Failed to write knowledge feedback' });
  }
});

router.post('/bootstrap/init', async (req, res) => {
  try {
    const { projectPath } = req.body || {};
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const result = await initializeHarnessBootstrap(projectPath);
    res.json({ success: true, result });
  } catch (error) {
    console.error('[HARNESS] Failed to initialize bootstrap:', error);
    res.status(500).json({ error: 'Failed to initialize bootstrap' });
  }
});

export default router;
