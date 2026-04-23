import path from 'path';
import { expect, test } from '@playwright/test';

const NO_CLAUDE_PROJECT_PATH = path.resolve(
  process.env.CLOUDCLI_E2E_NO_CLAUDE_PROJECT_PATH || 'tests/e2e/fixtures/no-claude-workspace',
);
const HARNESS_PROJECT_PATH = path.resolve(
  process.env.CLOUDCLI_E2E_HARNESS_PROJECT_PATH || 'tests/e2e/fixtures/harness-workspace',
);
const AUTH_CREDENTIALS = {
  username: process.env.CLOUDCLI_E2E_USERNAME || 'smoketest',
  password: process.env.CLOUDCLI_E2E_PASSWORD || 'smoke12345',
};
const FIXTURE_IMAGE_PATH = path.resolve('tests/e2e/fixtures/sample-upload.svg');
const TEXT_MATCHERS = {
  noClaudeBanner: /当前项目未启用团队共享系统|has not enabled the shared \.claude workspace system/i,
  noClaudeCommandBlocked:
    /当前项目未启用团队共享系统|共享 \.claude 工作台系统|Only regular chat is available|shared \.claude workspace system/i,
  normalChatMode: /当前为普通对话模式|You are in chat mode|regular chat mode/i,
  switchToHarnessFirst:
    /这是团队流程命令。请先切换到 Harness 流程后再执行|team workflow command|switch to Harness (flow|mode) before (using .*workflow commands|running it)/i,
  harnessEnabled: /Harness 流程已启用|Harness (workflow )?(mode|flow) is enabled/i,
  harnessFreeformBlocked:
    /一期当前只开放团队流程命令的 Harness 入口。自然语言任务流会在后续步骤接入|Only (team|shared) workflow commands are available in Harness mode right now|shared team workflow commands|supported workflow command to continue/i,
};

function requireHarnessProject() {
  test.skip(
    !HARNESS_PROJECT_PATH,
    'Set CLOUDCLI_E2E_HARNESS_PROJECT_PATH to a project path that contains .claude before running Harness phase-1 E2E tests.',
  );
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getProjectButtonLocator(page, projectName) {
  const baseName = path.basename(projectName);
  return page
    .locator('button')
    .filter({ hasText: new RegExp(`${escapeRegex(projectName)}|${escapeRegex(baseName)}`, 'i') })
    .first();
}

async function login(request) {
  const response = await request.post('/api/auth/login', {
    data: AUTH_CREDENTIALS,
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.token;
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

async function getProjectSessions(request, token, projectName) {
  const response = await request.get(`/api/projects/${encodeURIComponent(projectName)}/sessions?limit=5&offset=0`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
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
  await expect(page.getByText('Loading projects...')).toBeHidden({ timeout: 30000 });
  const noClaudeProjectLocator = page
    .getByTestId(`project-item-${noClaudeProject.name}`)
    .or(getProjectButtonLocator(page, noClaudeProject.name));
  await expect(noClaudeProjectLocator.first()).toBeVisible({ timeout: 30000 });

  return { token, noClaudeProject, harnessProject };
}

async function selectProject(page, projectName) {
  const projectLocator = page
    .getByTestId(`project-item-${projectName}`)
    .or(getProjectButtonLocator(page, projectName));
  await projectLocator.first().click();
}

test.describe.serial('phase-1 harness browser automation', () => {
  test('无 .claude 项目降级、普通聊天发送、slash 菜单和图片上传', async ({ page, request }) => {
    const { noClaudeProject } = await bootstrapPage(page, request);

    await selectProject(page, noClaudeProject.name);

    const modeToggle = page.getByTestId('conversation-mode-toggle');
    await expect(modeToggle).toBeDisabled();
    await expect(modeToggle).toHaveAttribute('data-harness-availability', 'unavailable_no_claude');
    await expect(page.getByTestId('conversation-mode-banner')).toContainText(TEXT_MATCHERS.noClaudeBanner);

    await page.getByTestId('slash-command-menu-toggle').click();
    await expect(page.getByTestId('command-menu')).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_IMAGE_PATH);
    await expect(page.getByAltText('sample-upload.svg')).toBeVisible();

    const input = page.getByTestId('chat-input-textarea');
    await input.fill('ordinary smoke message');
    await page.getByTestId('chat-send-button').click();
    await expect(page.getByTestId('chat-message-user-content').last()).toHaveText('ordinary smoke message');

    await input.fill('/prim');
    await page.getByTestId('chat-send-button').click();
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText(TEXT_MATCHERS.noClaudeCommandBlocked);
  });

  test('模式切换、Harness 命令路由和当前任务状态', async ({ page, request }) => {
    requireHarnessProject();
    const { harnessProject } = await bootstrapPage(page, request);

    await selectProject(page, harnessProject.name);

    const input = page.getByTestId('chat-input-textarea');
    const modeToggle = page.getByTestId('conversation-mode-toggle');

    await expect(modeToggle).toBeEnabled();
    await expect(page.getByTestId('conversation-mode-banner')).toContainText(TEXT_MATCHERS.normalChatMode);

    await input.fill('/prim');
    await page.getByTestId('chat-send-button').click();
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText(TEXT_MATCHERS.switchToHarnessFirst);

    await modeToggle.click();
    await input.fill('/prim');
    await page.getByTestId('chat-send-button').click();
    await expect(page.getByTestId('active-harness-task-banner')).toBeVisible();
  });

  test('Harness 默认模式下会拦截普通自然语言消息', async ({ page, request }) => {
    requireHarnessProject();
    const { harnessProject } = await bootstrapPage(page, request);

    await selectProject(page, harnessProject.name);

    const input = page.getByTestId('chat-input-textarea');
    const modeToggle = page.getByTestId('conversation-mode-toggle');

    await modeToggle.click();
    await expect(page.getByTestId('conversation-mode-banner')).toContainText(TEXT_MATCHERS.harnessEnabled);

    await input.fill('harness mode should block freeform');
    await page.getByTestId('chat-send-button').click();
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText(TEXT_MATCHERS.harnessFreeformBlocked);
  });

  test('Harness 默认模式会拦截自然语言任务流', async ({ page, request }) => {
    requireHarnessProject();
    const { harnessProject } = await bootstrapPage(page, request);

    await selectProject(page, harnessProject.name);

    const input = page.getByTestId('chat-input-textarea');
    const modeToggle = page.getByTestId('conversation-mode-toggle');

    await modeToggle.click();
    await expect(page.getByTestId('conversation-mode-banner')).toContainText(TEXT_MATCHERS.harnessEnabled);

    await input.fill('default harness should block');
    await page.getByTestId('chat-send-button').click();
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText(TEXT_MATCHERS.harnessFreeformBlocked);
  });

  test('子 agent 模型设置展示', async ({ page, request }) => {
    requireHarnessProject();
    const { harnessProject } = await bootstrapPage(page, request);

    await selectProject(page, harnessProject.name);

    await page.getByTestId('open-settings-button').click();
    const providerSelect = page.getByTestId('harness-agent-provider-select');
    const reviewerSelect = page.getByTestId('harness-reviewer-model-select');
    const validatorSelect = page.getByTestId('harness-validator-model-select');

    await expect(providerSelect).toBeVisible();

    await providerSelect.selectOption('codex');
    await expect(reviewerSelect).toBeDisabled();
    await expect(validatorSelect).toBeDisabled();
    await expect(reviewerSelect).toHaveValue('unsupported');
    await expect(validatorSelect).toHaveValue('unsupported');

    await providerSelect.selectOption('claude');
    await expect(reviewerSelect).toBeEnabled();
    await expect(validatorSelect).toBeEnabled();
    await expect(reviewerSelect).toHaveValue(/inherit|sonnet|opus/);
  });
});
