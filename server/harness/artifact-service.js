import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

const ARTIFACT_KIND_BY_DIR = {
  plans: 'plan',
  decisions: 'decision',
  rca: 'rca',
  reviews: 'review',
  reports: 'report',
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath) {
  const raw = await fs.readFile(filePath);
  return sha256(raw);
}

async function scanDocsFiles(dir, bucket = []) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDocsFiles(fullPath, bucket);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        bucket.push(fullPath);
      }
    }
  } catch (error) {
    if (!['ENOENT', 'EACCES'].includes(error?.code)) {
      throw error;
    }
  }

  return bucket;
}

function inferArtifactKind(projectPath, artifactPath) {
  const relativePath = path.relative(path.join(projectPath, '.claude', 'docs'), artifactPath).replace(/\\/g, '/');
  const topDir = relativePath.split('/')[0] || '';
  return ARTIFACT_KIND_BY_DIR[topDir] || 'report';
}

export async function listProjectArtifacts(projectPath) {
  const docsRoot = path.join(projectPath, '.claude', 'docs');
  const artifactFiles = await scanDocsFiles(docsRoot);

  const records = await Promise.all(
    artifactFiles.map(async (artifactPath) => {
      const stats = await fs.stat(artifactPath);
      return {
        artifactId: `artifact_${sha256(artifactPath).slice(0, 12)}`,
        kind: inferArtifactKind(projectPath, artifactPath),
        path: artifactPath,
        relativePath: path.relative(projectPath, artifactPath).replace(/\\/g, '/'),
        hash: await hashFile(artifactPath),
        status: 'fresh',
        boundTaskId: null,
        updatedAt: stats.mtime.toISOString(),
        size: stats.size,
      };
    }),
  );

  return records.sort((a, b) => a.path.localeCompare(b.path));
}

function buildBindingRecord(artifact, taskId) {
  return {
    kind: artifact.kind,
    path: artifact.path,
    hash: artifact.hash,
    status: 'fresh',
    updatedAt: artifact.updatedAt,
    taskId,
  };
}

export function compareArtifactBindings(previousBindings = [], nextBindings = []) {
  const previousIndex = new Map(previousBindings.map((binding) => [`${binding.kind}:${binding.path}`, binding.hash]));
  const nextIndex = new Map(nextBindings.map((binding) => [`${binding.kind}:${binding.path}`, binding.hash]));

  if (previousIndex.size !== nextIndex.size) {
    return { changed: true };
  }

  for (const [key, hash] of nextIndex.entries()) {
    if (previousIndex.get(key) !== hash) {
      return { changed: true };
    }
  }

  return { changed: false };
}

export async function refreshTaskArtifactBindings(projectPath, task, expectedKinds = []) {
  const artifacts = await listProjectArtifacts(projectPath);
  const filteredKinds = expectedKinds.length > 0 ? new Set(expectedKinds) : null;
  const latestByKind = new Map();

  for (const artifact of artifacts) {
    if (filteredKinds && !filteredKinds.has(artifact.kind)) {
      continue;
    }

    const current = latestByKind.get(artifact.kind);
    if (!current || current.updatedAt < artifact.updatedAt) {
      latestByKind.set(artifact.kind, artifact);
    }
  }

  const preservedBindings = Array.isArray(task.artifactBindings)
    ? task.artifactBindings.filter((binding) => !latestByKind.has(binding.kind))
    : [];
  const refreshedBindings = [
    ...preservedBindings,
    ...Array.from(latestByKind.values()).map((artifact) => buildBindingRecord(artifact, task.taskId)),
  ];

  const comparison = compareArtifactBindings(task.artifactBindings || [], refreshedBindings);

  return {
    artifacts: artifacts.map((artifact) => {
      const binding = refreshedBindings.find((entry) => entry.path === artifact.path);
      return {
        ...artifact,
        boundTaskId: binding ? task.taskId : null,
        status: binding?.status || artifact.status,
      };
    }),
    artifactBindings: refreshedBindings,
    changed: comparison.changed,
  };
}

export function decorateArtifactsWithBindings(artifacts, bindings = [], taskId = null) {
  return artifacts.map((artifact) => {
    const binding = bindings.find((entry) => entry.path === artifact.path);
    return {
      ...artifact,
      boundTaskId: binding ? taskId : null,
      status: binding?.status || artifact.status,
    };
  });
}
