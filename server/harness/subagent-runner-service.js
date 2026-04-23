import path from 'path';
import { promises as fs } from 'fs';
import { queryClaudeSDK } from '../claude-sdk.js';
import { CLAUDE_MODELS } from '../../shared/modelConstants.js';
import { buildRuntimePaths } from './task-manager.js';
import { resolveSubagentExecution } from './subagent-model-config-service.js';

function createCaptureWriter() {
  const messages = [];
  let sessionId = null;

  return {
    userId: null,
    send(message) {
      messages.push(message);
    },
    setSessionId(nextSessionId) {
      sessionId = nextSessionId;
    },
    getMessages() {
      return messages;
    },
    getSessionId() {
      return sessionId;
    },
  };
}

function normalizeBlockers(blockers) {
  if (!Array.isArray(blockers)) {
    return [];
  }

  return blockers
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function extractJsonPayload(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function extractAssistantText(messages) {
  return messages
    .filter((message) => message?.kind === 'text' && message?.role === 'assistant')
    .map((message) => String(message.content || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function buildAllowedToolsForLane(lane) {
  if (lane === 'validation') {
    return ['Read', 'LS', 'Glob', 'Grep', 'Bash'];
  }

  return ['Read', 'LS', 'Glob', 'Grep'];
}

function buildLanePrompt({
  lane,
  packPath,
  artifactPaths,
  evidencePaths,
}) {
  const laneLabel = lane === 'review' ? 'reviewer' : 'validator';
  const laneObjective =
    lane === 'review'
      ? '审查当前实现与计划/工件的一致性，找出真实问题、回归风险、越界修改或明显缺失。'
      : '根据当前验证包与证据路径执行验证，判断当前变更是否通过验证。';

  const artifactSection = artifactPaths.length
    ? artifactPaths.map((artifactPath) => `- ${artifactPath}`).join('\n')
    : '- 无';
  const evidenceSection = evidencePaths.length
    ? evidencePaths.map((evidencePath) => `- ${evidencePath}`).join('\n')
    : '- 无';

  return [
    `你是 Harness 的 ${laneLabel} 子线程。`,
    '你必须只使用下面提供的 Pack、工件和证据路径工作，不要假设你看过主线程的完整聊天历史。',
    laneObjective,
    '',
    '工作规则：',
    '1. 先读取 Pack 文件。',
    '2. 只按需要读取列出的工件与证据路径。',
    '3. 不要修改代码，不要写文件。',
    lane === 'validation'
      ? '4. 如需验证，可使用只读命令和 Bash 执行验证命令。'
      : '4. 只做审查，不做实现。',
    '5. 如果证据不足，返回 failed，并把缺失原因写进 blockers。',
    '',
    `Pack 文件：\n- ${packPath}`,
    '',
    `相关工件：\n${artifactSection}`,
    '',
    `证据路径：\n${evidenceSection}`,
    '',
    '最终只输出一个 JSON 对象，不要加代码块，不要加额外解释，格式必须完全如下：',
    '{"status":"passed|failed","summary":"一句话总结","blockers":["阻塞项1","阻塞项2"],"evidencePaths":["使用过的路径1","使用过的路径2"]}',
  ].join('\n');
}

export async function runHarnessSubagentLane({
  projectPath,
  task,
  lane,
}) {
  const packType = lane === 'review' ? 'review' : 'validation';
  const packVersion = Number(task?.activePackVersions?.[packType] || 0);
  if (!packVersion) {
    throw new Error(`${packType} pack is missing for current task`);
  }

  const runtimePaths = buildRuntimePaths(projectPath, task.taskId);
  const packPath = path.join(runtimePaths.packsDir, `${packType}-pack.v${packVersion}.md`);
  await fs.access(packPath);

  const artifactPaths = Array.isArray(task.artifactBindings)
    ? task.artifactBindings
        .filter((binding) => binding.status !== 'superseded')
        .map((binding) => binding.path)
    : [];
  const evidencePaths = Array.from(new Set([packPath, ...artifactPaths]));

  const modelResolution = resolveSubagentExecution(task.subagentModelConfig, lane);
  if (modelResolution.provider !== 'claude') {
    throw new Error('当前子线程 provider 不是 Claude Code，无法执行真实 Claude 子线程');
  }

  const resolvedModel =
    modelResolution.resolvedMode === 'override' && modelResolution.resolvedModel
      ? modelResolution.resolvedModel
      : task.mainClaudeModel || CLAUDE_MODELS.DEFAULT;

  const captureWriter = createCaptureWriter();
  const prompt = buildLanePrompt({
    lane,
    packPath: path.relative(projectPath, packPath).replace(/\\/g, '/'),
    artifactPaths: artifactPaths.map((artifactPath) => path.relative(projectPath, artifactPath).replace(/\\/g, '/')),
    evidencePaths: evidencePaths.map((evidencePath) => path.relative(projectPath, evidencePath).replace(/\\/g, '/')),
  });

  await queryClaudeSDK(
    prompt,
    {
      cwd: projectPath,
      model: resolvedModel,
      permissionMode: 'bypassPermissions',
      toolsSettings: {
        allowedTools: buildAllowedToolsForLane(lane),
        disallowedTools: [],
        skipPermissions: true,
      },
      sessionSummary: `Harness ${lane} ${task.taskId}`,
    },
    captureWriter,
  );

  const sessionId = captureWriter.getSessionId();
  const assistantText = extractAssistantText(captureWriter.getMessages());
  const payload = extractJsonPayload(assistantText);

  if (!payload || !['passed', 'failed'].includes(payload.status)) {
    throw new Error(`子线程输出无法解析为有效 JSON：${assistantText || 'empty-output'}`);
  }

  return {
    lane,
    sessionId,
    modelResolution: {
      ...modelResolution,
      resolvedModel,
    },
    status: payload.status,
    summary: typeof payload.summary === 'string' ? payload.summary.trim() : '',
    blockers: normalizeBlockers(payload.blockers),
    evidencePaths: Array.isArray(payload.evidencePaths)
      ? payload.evidencePaths.filter((item) => typeof item === 'string' && item.trim())
      : [],
    rawAssistantText: assistantText,
    packPath,
  };
}
