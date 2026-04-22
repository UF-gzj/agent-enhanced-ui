import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

const FEEDBACK_ROOT_RELATIVE = path.join('.claude', 'reference', 'feedback');
const FEEDBACK_INDEX_FILE = 'index.json';

function nowIso() {
  return new Date().toISOString();
}

function createFeedbackId() {
  return `feedback_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function buildFeedbackPaths(projectPath) {
  const feedbackRoot = path.join(projectPath, FEEDBACK_ROOT_RELATIVE);
  return {
    feedbackRoot,
    indexPath: path.join(feedbackRoot, FEEDBACK_INDEX_FILE),
  };
}

async function readIndex(indexPath) {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeIndex(indexPath, value) {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const tmpPath = `${indexPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmpPath, indexPath);
}

function buildFeedbackMarkdown(record) {
  const evidenceLines = (record.evidencePaths || []).map((item) => `- ${item}`).join('\n') || '- none';
  return `---
feedback_id: ${record.feedbackId}
target_layer: ${record.targetLayer}
source_task_id: ${record.sourceTaskId || ''}
created_at: ${record.createdAt}
status: ${record.status}
---

# ${record.title}

${record.summary}

## Evidence

${evidenceLines}
`;
}

export async function listKnowledgeFeedback(projectPath, { limit = 100 } = {}) {
  const { indexPath } = buildFeedbackPaths(projectPath);
  const records = await readIndex(indexPath);
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 500)) : 100;
  return records.slice(-normalizedLimit).reverse();
}

export async function writeKnowledgeFeedback(projectPath, input) {
  const { feedbackRoot, indexPath } = buildFeedbackPaths(projectPath);
  const feedbackId = createFeedbackId();
  const createdAt = nowIso();
  const record = {
    feedbackId,
    projectPath,
    sourceTaskId: input?.sourceTaskId || null,
    targetLayer: String(input?.targetLayer || 'reference').trim(),
    title: String(input?.title || feedbackId).trim(),
    summary: String(input?.summary || '').trim(),
    evidencePaths: Array.isArray(input?.evidencePaths) ? input.evidencePaths.filter(Boolean) : [],
    status: 'recorded',
    createdAt,
    relativePath: path.join('.claude', 'reference', 'feedback', `${feedbackId}.md`).replace(/\\/g, '/'),
  };

  await fs.mkdir(feedbackRoot, { recursive: true });
  await fs.writeFile(path.join(feedbackRoot, `${feedbackId}.md`), buildFeedbackMarkdown(record), 'utf8');

  const index = await readIndex(indexPath);
  await writeIndex(indexPath, [...index, record]);
  return record;
}
