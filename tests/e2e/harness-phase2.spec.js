import path from 'path';
import { expect, test } from '@playwright/test';

const NO_CLAUDE_PROJECT_PATH = path.resolve(
  process.env.CLOUDCLI_E2E_NO_CLAUDE_PROJECT_PATH || process.cwd(),
);
const HARNESS_PROJECT_PATH = path.resolve(
  process.env.CLOUDCLI_E2E_HARNESS_PROJECT_PATH || 'tests/e2e/fixtures/harness-workspace',
);
const AUTH_CREDENTIALS = {
  username: process.env.CLOUDCLI_E2E_USERNAME || 'smoketest',
  password: process.env.CLOUDCLI_E2E_PASSWORD || 'smoke12345',
};

function getProjectButtonLocator(page, projectName) {
  const baseName = path.basename(projectName);
  return page
    .locator('button')
    .filter({ hasText: new RegExp(`${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') })
    .first();
}

async function login(request) {
  const loginResponse = await request.post('/api/auth/login', {
    data: AUTH_CREDENTIALS,
  });

  if (loginResponse.ok()) {
    return (await loginResponse.json()).token;
  }

  const registerResponse = await request.post('/api/auth/register', {
    data: AUTH_CREDENTIALS,
  });
  expect(registerResponse.ok()).toBeTruthy();
  return (await registerResponse.json()).token;
}

async function ensureProject(request, token, projectPath) {
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  let response = await request.get('/api/projects', { headers });
  expect(response.ok()).toBeTruthy();
  let projects = await response.json();
  let project = projects.find((entry) => entry.fullPath === projectPath || entry.path === projectPath);

  if (!project) {
    const createResponse = await request.post('/api/projects/create', {
      headers,
      data: { path: projectPath },
    });
    expect(createResponse.ok()).toBeTruthy();

    response = await request.get('/api/projects', { headers });
    expect(response.ok()).toBeTruthy();
    projects = await response.json();
    project = projects.find((entry) => entry.fullPath === projectPath || entry.path === projectPath);
  }

  expect(project).toBeTruthy();
  return project;
}

async function completeOnboarding(request, token) {
  const response = await request.post('/api/user/complete-onboarding', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function bootstrapPage(page, request) {
  const token = await login(request);
  await completeOnboarding(request, token);
  const noClaudeProject = await ensureProject(request, token, NO_CLAUDE_PROJECT_PATH);
  const harnessProject = HARNESS_PROJECT_PATH
    ? await ensureProject(request, token, HARNESS_PROJECT_PATH)
    : null;

  await page.addInitScript((authToken) => {
    window.localStorage.setItem('auth-token', authToken);
  }, token);

  await page.goto('/');
  await expect(page.getByText('Loading projects...')).toBeHidden({ timeout: 30_000 });
  const noClaudeProjectLocator = page
    .getByTestId(`project-item-${noClaudeProject.name}`)
    .or(getProjectButtonLocator(page, noClaudeProject.name));
  await expect(noClaudeProjectLocator.first()).toBeVisible({ timeout: 30_000 });

  return { token, noClaudeProject, harnessProject };
}

async function selectProject(page, projectName) {
  const projectLocator = page
    .getByTestId(`project-item-${projectName}`)
    .or(getProjectButtonLocator(page, projectName));
  await projectLocator.first().click();
}

test.describe.serial('phase-2 harness browser automation', () => {
  test('Workspace、命令注册、工件、timeline 在 Harness 工作台可见', async ({ page, request }) => {
    const { token, harnessProject } = await bootstrapPage(page, request);
    const headers = { Authorization: `Bearer ${token}` };

    const startResponse = await request.post('/api/harness/tasks/start', {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 panel prim',
        commandName: '/prim',
        commandContent: '/prim',
      },
    });
    expect(startResponse.ok()).toBeTruthy();

    await selectProject(page, harnessProject.name);
    await page.getByTestId('main-tab-harness').click();

    await expect(page.getByText('Workspace 状态条')).toBeVisible();
    await expect(page.getByText('Command Registry')).toBeVisible();
    await expect(page.getByText('Artifact Workbench')).toBeVisible();
    await expect(page.getByText('Timeline', { exact: true })).toBeVisible();
    await expect(page.getByText('Workspace 状态条')).toBeVisible();
    await expect(page.getByText('Task ID', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('canonical').first()).toBeVisible();
  });

  test('M14: 合法与非法阶段跳转被正确执行或拦截', async ({ request }) => {
    const token = await login(request);
    await completeOnboarding(request, token);
    await ensureProject(request, token, HARNESS_PROJECT_PATH);
    const headers = { Authorization: `Bearer ${token}` };

    const startResponse = await request.post('/api/harness/tasks/start', {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 m14 prim',
        commandName: '/prim',
        commandContent: '/prim',
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const startPayload = await startResponse.json();
    const taskId = startPayload.task.taskId;

    const invalidResponse = await request.post(`/api/harness/tasks/${taskId}/stages/cmit/execute`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 invalid cmit',
        commandName: '/cmit',
        commandContent: '/cmit',
      },
    });
    expect(invalidResponse.status()).toBe(400);

    const planResponse = await request.post(`/api/harness/tasks/${taskId}/stages/pln/execute`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 plan',
        commandName: '/pln',
        commandContent: '/pln',
      },
    });
    expect(planResponse.ok()).toBeTruthy();
    const planPayload = await planResponse.json();
    expect(planPayload.task.currentStage).toBe('pln');
  });

  test('M15/M17: 工件绑定正确，工件刷新后状态与 Pack 会变化', async ({ request }) => {
    const token = await login(request);
    await completeOnboarding(request, token);
    await ensureProject(request, token, HARNESS_PROJECT_PATH);
    const headers = { Authorization: `Bearer ${token}` };

    const startResponse = await request.post('/api/harness/tasks/start', {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 artifact binding',
        commandName: '/prim',
        commandContent: '/prim',
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const startPayload = await startResponse.json();
    const taskId = startPayload.task.taskId;

    const planResponse = await request.post(`/api/harness/tasks/${taskId}/stages/pln/execute`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 artifact plan',
        commandName: '/pln',
        commandContent: '/pln',
      },
    });
    expect(planResponse.ok()).toBeTruthy();

    const artifactsResponse = await request.get(
      `/api/harness/tasks/${taskId}/artifacts?projectPath=${encodeURIComponent(HARNESS_PROJECT_PATH)}`,
      { headers },
    );
    expect(artifactsResponse.ok()).toBeTruthy();
    const artifactsPayload = await artifactsResponse.json();
    expect(Array.isArray(artifactsPayload.artifacts)).toBeTruthy();
    expect(Array.isArray(artifactsPayload.bindings)).toBeTruthy();
    expect(artifactsPayload.bindings.length).toBeGreaterThan(0);
    expect(artifactsPayload.bindings.every((binding) => binding.taskId === taskId)).toBeTruthy();

    const invalidateResponse = await request.post(`/api/harness/tasks/${taskId}/invalidate`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        scope: 'all',
        reason: 'phase2-test-manual-invalidate',
      },
    });
    expect(invalidateResponse.ok()).toBeTruthy();

    const packsResponse = await request.get(
      `/api/harness/tasks/${taskId}/packs?projectPath=${encodeURIComponent(HARNESS_PROJECT_PATH)}`,
      { headers },
    );
    expect(packsResponse.ok()).toBeTruthy();
    const packsPayload = await packsResponse.json();
    expect(packsPayload.packs.some((pack) => ['stale', 'invalidated'].includes(pack.status))).toBeTruthy();
  });

  test('M18: /iter 后两轮内可回到受影响验证链', async ({ request }) => {
    const token = await login(request);
    await completeOnboarding(request, token);
    await ensureProject(request, token, HARNESS_PROJECT_PATH);
    const headers = { Authorization: `Bearer ${token}` };

    const startResponse = await request.post('/api/harness/tasks/start', {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 recovery prim',
        commandName: '/prim',
        commandContent: '/prim',
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const startPayload = await startResponse.json();
    const taskId = startPayload.task.taskId;

    const planResponse = await request.post(`/api/harness/tasks/${taskId}/stages/pln/execute`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 recovery plan',
        commandName: '/pln',
        commandContent: '/pln',
      },
    });
    expect(planResponse.ok()).toBeTruthy();

    const execResponse = await request.post(`/api/harness/tasks/${taskId}/stages/exec/execute`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 recovery exec',
        commandName: '/exec',
        commandContent: '/exec',
      },
    });
    expect(execResponse.ok()).toBeTruthy();

    const gateFailResponse = await request.post(`/api/harness/tasks/${taskId}/gate`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        lane: 'review',
        status: 'failed',
        blockers: ['phase2-review-failed'],
        summary: 'phase2 review failed',
      },
    });
    expect(gateFailResponse.ok()).toBeTruthy();

    const iterResponse = await request.post(`/api/harness/tasks/${taskId}/stages/iter/execute`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 recovery iter',
        commandName: '/iter',
        commandContent: '/iter',
      },
    });
    expect(iterResponse.ok()).toBeTruthy();
    const iterPayload = await iterResponse.json();
    expect(iterPayload.task.currentStage).toBe('iter');

    const revalidateResponse = await request.post(`/api/harness/tasks/${taskId}/stages/revu/execute`, {
      headers,
      data: {
        projectPath: HARNESS_PROJECT_PATH,
        message: 'phase2 recovery revu',
        commandName: '/revu',
        commandContent: '/revu',
      },
    });
    expect(revalidateResponse.ok()).toBeTruthy();
    const revalidatePayload = await revalidateResponse.json();
    expect(['revu', 'vald', 'iter'].includes(revalidatePayload.task.currentStage)).toBeTruthy();
  });
});
