import path from 'path';
import { promises as fs } from 'fs';
import { expect, test } from '@playwright/test';

const FIXTURE_PROJECT_PATH = path.resolve('tests/e2e/fixtures/harness-workspace');
const BOOTSTRAP_PROJECT_PATH = path.resolve('tests/e2e/fixtures/bootstrap-target');
const AUTH_CREDENTIALS = {
  username: process.env.CLOUDCLI_E2E_USERNAME || 'smoketest',
  password: process.env.CLOUDCLI_E2E_PASSWORD || 'smoke12345',
};

async function login(request) {
  const response = await request.post('/api/auth/login', {
    data: AUTH_CREDENTIALS,
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).token;
}

async function completeOnboarding(request, token) {
  const response = await request.post('/api/user/complete-onboarding', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
}

async function ensureProject(request, token, projectPath) {
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request.get('/api/projects', { headers });
  expect(response.ok()).toBeTruthy();
  const projects = await response.json();
  const project = projects.find((entry) => entry.fullPath === projectPath || entry.path === projectPath);
  if (!project) {
    const createResponse = await request.post('/api/projects/create', {
      headers,
      data: { path: projectPath },
    });
    expect(createResponse.ok()).toBeTruthy();
  }
}

function buildSeedTasks() {
  return Array.from({ length: 60 }).map((_, index) => ({
    taskKey: `phase3-task-${index + 1}`,
    repositoryClass: index % 2 === 0 ? 'backend' : 'frontend',
    taskType: index % 3 === 0 ? 'bugfix' : 'feature',
    difficulty: index % 2 === 0 ? 'medium' : 'hard',
    title: `Phase 3 Task ${index + 1}`,
  }));
}

function buildSeedRuns(tasks) {
  return tasks.flatMap((task) => [
    { taskKey: task.taskKey, mode: 'baseline', attempt: 1, success: true, firstPassValidation: false, hallucinationEvents: 0, outOfScopeEdits: false },
    { taskKey: task.taskKey, mode: 'baseline', attempt: 2, success: true, firstPassValidation: false, hallucinationEvents: 0, outOfScopeEdits: false },
    { taskKey: task.taskKey, mode: 'baseline', attempt: 3, success: true, firstPassValidation: false, hallucinationEvents: 0, outOfScopeEdits: false },
    { taskKey: task.taskKey, mode: 'harness', attempt: 1, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
    { taskKey: task.taskKey, mode: 'harness', attempt: 2, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
    { taskKey: task.taskKey, mode: 'harness', attempt: 3, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
  ]);
}

test.describe.serial('phase-3 harness automation', () => {
  test('M24: benchmark dataset、结果与可复现率链路可读', async ({ request }) => {
    const token = await login(request);
    await completeOnboarding(request, token);
    await ensureProject(request, token, FIXTURE_PROJECT_PATH);
    const headers = { Authorization: `Bearer ${token}` };

    const datasetResponse = await request.post('/api/harness/evals/datasets', {
      headers,
      data: {
        name: 'phase3-e2e-dataset',
        provider: 'claude',
        description: 'phase3 e2e benchmark dataset',
        tasks: buildSeedTasks(),
      },
    });
    expect(datasetResponse.ok()).toBeTruthy();
    const datasetPayload = await datasetResponse.json();
    const dataset = datasetPayload.dataset;

    const runResponse = await request.post('/api/harness/evals/run', {
      headers,
      data: {
        benchmarkName: 'phase3-e2e-benchmark',
        datasetId: dataset.datasetId,
        provider: 'claude',
        roundLabel: 'round-1',
        runs: buildSeedRuns(dataset.tasks),
      },
    });
    expect(runResponse.ok()).toBeTruthy();
    const runPayload = await runResponse.json();

    expect(runPayload.result.metrics.m24).toBeGreaterThanOrEqual(0.9);
    expect(runPayload.result.validity.minimumTaskCountMet).toBeTruthy();
    expect(runPayload.result.validity.minimumAttemptsMet).toBeTruthy();

    const resultsResponse = await request.get('/api/harness/evals/results?provider=claude', { headers });
    expect(resultsResponse.ok()).toBeTruthy();
    const resultsPayload = await resultsResponse.json();
    expect(resultsPayload.results.length).toBeGreaterThan(0);
  });

  test('M25: checkpoint 创建与恢复可用', async ({ request }) => {
    const token = await login(request);
    await completeOnboarding(request, token);
    await ensureProject(request, token, FIXTURE_PROJECT_PATH);
    const headers = { Authorization: `Bearer ${token}` };

    const startResponse = await request.post('/api/harness/tasks/start', {
      headers,
      data: {
        projectPath: FIXTURE_PROJECT_PATH,
        message: 'phase3 checkpoint prim',
        commandName: '/prim',
        commandContent: '/prim',
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const startPayload = await startResponse.json();
    const taskId = startPayload.task.taskId;

    const checkpointResponse = await request.post(`/api/harness/tasks/${taskId}/checkpoint`, {
      headers,
      data: {
        projectPath: FIXTURE_PROJECT_PATH,
        reason: 'phase3-e2e-checkpoint',
      },
    });
    expect(checkpointResponse.ok()).toBeTruthy();
    const checkpointPayload = await checkpointResponse.json();

    const resumeResponse = await request.post(`/api/harness/tasks/${taskId}/resume`, {
      headers,
      data: {
        projectPath: FIXTURE_PROJECT_PATH,
        checkpointId: checkpointPayload.checkpoint.checkpointId,
      },
    });
    expect(resumeResponse.ok()).toBeTruthy();
    const resumePayload = await resumeResponse.json();
    expect(resumePayload.task.currentStage).toBe('prim');
  });

  test('M26: knowledge feedback 写入后可读取', async ({ request }) => {
    const token = await login(request);
    await completeOnboarding(request, token);
    await ensureProject(request, token, FIXTURE_PROJECT_PATH);
    const headers = { Authorization: `Bearer ${token}` };

    const feedbackResponse = await request.post('/api/harness/knowledge/feedback', {
      headers,
      data: {
        projectPath: FIXTURE_PROJECT_PATH,
        sourceTaskId: null,
        targetLayer: 'reference',
        title: 'phase3 knowledge feedback',
        summary: 'phase3 knowledge feedback summary',
        evidencePaths: [],
      },
    });
    expect(feedbackResponse.ok()).toBeTruthy();
    const feedbackPayload = await feedbackResponse.json();

    const listResponse = await request.get(
      `/api/harness/knowledge/feedback?projectPath=${encodeURIComponent(FIXTURE_PROJECT_PATH)}`,
      { headers },
    );
    expect(listResponse.ok()).toBeTruthy();
    const listPayload = await listResponse.json();
    expect(listPayload.feedback.some((record) => record.feedbackId === feedbackPayload.feedback.feedbackId)).toBeTruthy();
  });

  test('M27: bootstrap 可把无 .claude 项目升级为 Harness 项目', async ({ request }) => {
    const token = await login(request);
    await completeOnboarding(request, token);
    await fs.mkdir(BOOTSTRAP_PROJECT_PATH, { recursive: true });
    await fs.rm(path.join(BOOTSTRAP_PROJECT_PATH, '.claude'), { recursive: true, force: true });
    await ensureProject(request, token, BOOTSTRAP_PROJECT_PATH);
    const headers = { Authorization: `Bearer ${token}` };

    const bootstrapResponse = await request.post('/api/harness/bootstrap/init', {
      headers,
      data: {
        projectPath: BOOTSTRAP_PROJECT_PATH,
      },
    });
    expect(bootstrapResponse.ok()).toBeTruthy();
    const bootstrapPayload = await bootstrapResponse.json();
    expect(bootstrapPayload.result.harnessAvailability).toBe('available');
    expect(bootstrapPayload.result.createdFiles.length).toBeGreaterThan(0);

    const capabilityResponse = await request.get(
      `/api/harness/projects/capability?projectPath=${encodeURIComponent(BOOTSTRAP_PROJECT_PATH)}`,
      { headers },
    );
    expect(capabilityResponse.ok()).toBeTruthy();
    const capabilityPayload = await capabilityResponse.json();
    expect(capabilityPayload.harnessAvailability).toBe('available');
  });
});
