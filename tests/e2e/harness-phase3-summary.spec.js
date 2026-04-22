import { expect, test } from '@playwright/test';

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

function buildTasks() {
  return Array.from({ length: 60 }).map((_, index) => ({
    taskKey: `summary-task-${index + 1}`,
    repositoryClass: 'service',
    taskType: index % 2 === 0 ? 'bugfix' : 'feature',
    difficulty: 'medium',
    title: `Summary Task ${index + 1}`,
  }));
}

function buildRuns(tasks, baselineSuccessRate, baselineFirstPassRate) {
  const successCutoff = Math.floor(tasks.length * baselineSuccessRate);
  const firstPassCutoff = Math.floor(tasks.length * baselineFirstPassRate);

  return tasks.flatMap((task, index) => {
    const baselineSuccess = index < successCutoff;
    const baselineFirstPass = index < firstPassCutoff;
    return [
      { taskKey: task.taskKey, mode: 'baseline', attempt: 1, success: baselineSuccess, firstPassValidation: baselineFirstPass, hallucinationEvents: 0, outOfScopeEdits: false },
      { taskKey: task.taskKey, mode: 'baseline', attempt: 2, success: baselineSuccess, firstPassValidation: baselineFirstPass, hallucinationEvents: 0, outOfScopeEdits: false },
      { taskKey: task.taskKey, mode: 'baseline', attempt: 3, success: baselineSuccess, firstPassValidation: baselineFirstPass, hallucinationEvents: 0, outOfScopeEdits: false },
      { taskKey: task.taskKey, mode: 'harness', attempt: 1, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
      { taskKey: task.taskKey, mode: 'harness', attempt: 2, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
      { taskKey: task.taskKey, mode: 'harness', attempt: 3, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
    ];
  });
}

test('phase-3 eval summary aggregates two rounds and eligibility gates', async ({ request }) => {
  const token = await login(request);
  const headers = { Authorization: `Bearer ${token}` };

  const datasetResponse = await request.post('/api/harness/evals/datasets', {
    headers,
    data: {
      name: 'phase3-summary-dataset',
      provider: 'claude',
      description: 'phase3 summary dataset',
      tasks: buildTasks(),
    },
  });
  expect(datasetResponse.ok()).toBeTruthy();
  const datasetPayload = await datasetResponse.json();
  const dataset = datasetPayload.dataset;

  const round1Response = await request.post('/api/harness/evals/run', {
    headers,
    data: {
      benchmarkName: 'phase3-summary-benchmark',
      datasetId: dataset.datasetId,
      provider: 'claude',
      roundLabel: 'round-1',
      runs: buildRuns(dataset.tasks, 0.7, 0.5),
    },
  });
  expect(round1Response.ok()).toBeTruthy();

  const round2Response = await request.post('/api/harness/evals/run', {
    headers,
    data: {
      benchmarkName: 'phase3-summary-benchmark',
      datasetId: dataset.datasetId,
      provider: 'claude',
      roundLabel: 'round-2',
      runs: buildRuns(dataset.tasks, 0.72, 0.55),
    },
  });
  expect(round2Response.ok()).toBeTruthy();

  const summaryResponse = await request.get(
    `/api/harness/evals/summary?provider=claude&datasetId=${encodeURIComponent(dataset.datasetId)}`,
    { headers },
  );
  expect(summaryResponse.ok()).toBeTruthy();
  const summaryPayload = await summaryResponse.json();

  expect(summaryPayload.summary.totalResults).toBeGreaterThanOrEqual(2);
  expect(summaryPayload.summary.thresholds.minimumRoundsMet).toBeTruthy();
  expect(summaryPayload.summary.thresholds.m19Met).toBeTruthy();
  expect(summaryPayload.summary.thresholds.m20Met).toBeTruthy();
  expect(summaryPayload.summary.thresholds.m21Met).toBeTruthy();
  expect(summaryPayload.summary.thresholds.m22Met).toBeTruthy();
  expect(summaryPayload.summary.directionConsistencyMet).toBeTruthy();
  expect(summaryPayload.summary.claimEligible).toBeTruthy();
});
