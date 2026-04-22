import path from 'path';
import { promises as fs } from 'fs';
import { ensureTaskRuntime, stageToPackType } from './task-manager.js';

function nowIso() {
  return new Date().toISOString();
}

function getPackSections(packType, message, stage, commandName, commandContent) {
  if (packType === 'prime') {
    return [
      '## 目标',
      message || '待补充',
      '',
      '## 边界',
      `当前阶段：${stage}`,
      `当前命令：${commandName || '未提供'}`,
      '',
      '## 已确认事实',
      '- 项目已启用 .claude 团队共享系统',
      '- 当前通过 Harness 团队流程命令进入工作流',
      '',
      '## 假设',
      '- 后续细化由主线程继续补充',
      '',
      '## 禁止事项',
      '- 不要跳过验证和工件落盘',
      '',
      '## 下一步',
      '- 根据当前阶段继续推进',
    ].join('\n');
  }

  if (packType === 'review') {
    return [
      '## 变更范围',
      message || '待补充',
      '',
      '## 高风险点',
      '- 待主线程补充',
      '',
      '## 必查项',
      '- 回归风险',
      '- 超范围修改',
      '',
      '## 输出格式',
      '- findings only',
    ].join('\n');
  }

  if (packType === 'validation') {
    return [
      '## 必跑验证',
      '- 待主线程补充',
      '',
      '## 推荐命令',
      '- 待补充',
      '',
      '## 证据路径',
      '- 待补充',
      '',
      '## 跳过条件',
      '- 无',
    ].join('\n');
  }

  return [
    '## 方案',
    message || '待补充',
    '',
    '## 步骤',
    `- 当前阶段：${stage}`,
    `- 当前命令：${commandName || '未提供'}`,
    '',
    '## 目标文件',
    '- 待补充',
    '',
    '## 风险',
    '- 待主线程补充',
    '',
    '## 验收标准',
    '- 待补充',
    '',
    '## 原始命令内容',
    '```md',
    commandContent || '',
    '```',
  ].join('\n');
}

async function writeAtomicText(targetPath, content) {
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, targetPath);
}

function parsePackFileName(fileName) {
  const match = /^(prime|plan|review|validation)-pack\.v(\d+)\.md$/i.exec(fileName);
  if (!match) {
    return null;
  }

  return {
    packType: match[1].toLowerCase(),
    version: Number(match[2]),
  };
}

export async function listPackRecords(projectPath, taskId) {
  const { packsDir } = await ensureTaskRuntime(projectPath, taskId);
  const fileNames = await fs.readdir(packsDir);
  const packFiles = fileNames
    .map((fileName) => ({ fileName, parsed: parsePackFileName(fileName) }))
    .filter((entry) => Boolean(entry.parsed));

  return packFiles
    .map(({ fileName, parsed }) => ({
      packType: parsed.packType,
      version: parsed.version,
      path: path.join(packsDir, fileName),
      basedOnArtifacts: [],
      basedOnHashes: {},
      status: 'fresh',
    }))
    .sort((packA, packB) => packA.version - packB.version);
}

function resolvePackStatus(task, packType, version) {
  const activeVersion = Number(task?.activePackVersions?.[packType] || 0);
  if (activeVersion && version < activeVersion) {
    return 'superseded';
  }

  if (!task) {
    return 'fresh';
  }

  if (packType === 'prime' && task.primeState === 'stale') {
    return 'stale';
  }

  if (packType === 'review') {
    if (task.activeGate?.reviewStatus === 'invalidated') {
      return 'invalidated';
    }
    if (task.activeGate?.reviewStatus === 'pending' && activeVersion && version === activeVersion) {
      return 'stale';
    }
  }

  if (packType === 'validation') {
    if (task.activeGate?.validationStatus === 'invalidated') {
      return 'invalidated';
    }
    if (task.activeGate?.validationStatus === 'pending' && activeVersion && version === activeVersion) {
      return 'stale';
    }
  }

  if (packType === 'plan' && ['stale', 'invalidated'].includes(task.taskSummaryState)) {
    return task.taskSummaryState === 'invalidated' ? 'invalidated' : 'stale';
  }

  return 'fresh';
}

export async function listPackRecordsForTask(projectPath, task) {
  const baseRecords = await listPackRecords(projectPath, task.taskId);
  return baseRecords.map((pack) => ({
    ...pack,
    status: resolvePackStatus(task, pack.packType, pack.version),
    basedOnArtifacts: Array.isArray(task.artifactBindings)
      ? task.artifactBindings
          .filter((binding) => binding.status !== 'superseded')
          .map((binding) => binding.path)
      : [],
    basedOnHashes: Array.isArray(task.artifactBindings)
      ? Object.fromEntries(task.artifactBindings.map((binding) => [binding.path, binding.hash]))
      : pack.basedOnHashes,
  }));
}

export async function createOrUpdatePack({
  projectPath,
  task,
  stage,
  message,
  commandName,
  commandContent,
}) {
  const packType = stageToPackType(stage);
  const currentVersion = task.activePackVersions?.[packType] || 0;
  const nextVersion = currentVersion + 1;
  const { packsDir } = await ensureTaskRuntime(projectPath, task.taskId);
  const packFileName = `${packType}-pack.v${nextVersion}.md`;
  const packPath = path.join(packsDir, packFileName);
  const createdAt = nowIso();

  const frontmatter = [
    '---',
    `task_id: ${task.taskId}`,
    `pack_type: ${packType}`,
    `pack_version: ${nextVersion}`,
    `generated_at: ${createdAt}`,
    'generated_by: main-agent',
    `current_stage: ${stage}`,
    `command_name: ${commandName || ''}`,
    'status: fresh',
    '---',
    '',
  ].join('\n');

  const body = getPackSections(packType, message, stage, commandName, commandContent);
  await writeAtomicText(packPath, `${frontmatter}${body}\n`);

  return {
    packType,
    version: nextVersion,
    path: packPath,
    basedOnArtifacts: Array.isArray(task.artifactBindings)
      ? task.artifactBindings.map((binding) => binding.path)
      : [],
    basedOnHashes: Array.isArray(task.artifactBindings)
      ? Object.fromEntries(task.artifactBindings.map((binding) => [binding.path, binding.hash]))
      : {
          projectPath: task.sourceHashes?.projectPath || '',
        },
    status: 'fresh',
    generatedAt: createdAt,
  };
}
