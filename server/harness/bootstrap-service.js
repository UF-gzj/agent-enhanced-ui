import path from 'path';
import { promises as fs } from 'fs';
import { getHarnessProjectCapability } from './provider-capability-service.js';

const COMMAND_CONTENT = {
  prim: '# Prime\n\nLoad minimal workspace context.\n',
  pinit: '# Init Project\n\nInitialize minimal team workspace files.\n',
  refr: '# Refresh\n\nRefresh project context.\n',
  bref: '# Backend Review Plan\n\nReview backend options before implementation.\n',
  pln: '# Plan\n\nWrite the current plan.\n',
  exec: '# Execute\n\nImplement the current plan.\n',
  iter: '# Iterate\n\nRe-enter the affected chain after feedback.\n',
  rca: '# RCA\n\nCapture root cause analysis.\n',
  fix: '# Fix\n\nApply the current bugfix.\n',
  revu: '# Review\n\nReview the current implementation.\n',
  vald: '# Validate\n\nValidate the current implementation.\n',
  xrep: '# Execution Report\n\nWrite the execution report.\n',
  srev: '# System Review\n\nReview the process and system changes.\n',
  cmit: '# Commit\n\nPrepare for commit.\n',
};

async function ensureFile(targetPath, content) {
  try {
    await fs.access(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf8');
      return true;
    }
    throw error;
  }
  return false;
}

function buildBootstrapManifest(projectPath, createdFiles) {
  return JSON.stringify(
    {
      projectPath,
      createdAt: new Date().toISOString(),
      createdFiles,
      template: 'default-harness-bootstrap-v1',
    },
    null,
    2,
  );
}

export async function initializeHarnessBootstrap(projectPath) {
  const before = await getHarnessProjectCapability(projectPath);
  if (before.harnessAvailability === 'available') {
    return {
      projectPath,
      created: false,
      alreadyInitialized: true,
      createdFiles: [],
      harnessAvailability: before.harnessAvailability,
    };
  }

  const createdFiles = [];
  const trackedWrites = async (relativePath, content) => {
    const absolutePath = path.join(projectPath, relativePath);
    const created = await ensureFile(absolutePath, content);
    if (created) {
      createdFiles.push(relativePath.replace(/\\/g, '/'));
    }
  };

  await trackedWrites(
    path.join('.claude', 'CLAUDE.md'),
    '# Team Harness Workspace\n\nThis file was created by phase-3 bootstrap.\n',
  );
  await trackedWrites(
    path.join('.claude', 'prime-context.md'),
    '# Prime Context\n\n- Project type: bootstrapped workspace\n- Goal: enable the base Harness chain\n',
  );
  await trackedWrites(
    path.join('.claude', 'reference', 'knowledge-index.md'),
    '# Knowledge Index\n\n1. Start with /prim.\n2. Keep plans, reviews, reports, and RCA as artifacts.\n3. Treat bootstrap output as reusable template content.\n',
  );

  for (const [commandName, content] of Object.entries(COMMAND_CONTENT)) {
    await trackedWrites(path.join('.claude', 'commands', `${commandName}.md`), content);
  }

  await trackedWrites(path.join('.claude', 'docs', 'plans', 'bootstrap-plan.md'), '# Bootstrap Plan\n');
  await trackedWrites(path.join('.claude', 'docs', 'decisions', 'bootstrap-decision.md'), '# Bootstrap Decision\n');
  await trackedWrites(path.join('.claude', 'docs', 'rca', 'bootstrap-rca.md'), '# Bootstrap RCA\n');
  await trackedWrites(path.join('.claude', 'docs', 'reviews', 'bootstrap-review.md'), '# Bootstrap Review\n');
  await trackedWrites(path.join('.claude', 'docs', 'reports', 'bootstrap-report.md'), '# Bootstrap Report\n');
  await trackedWrites(
    path.join('.claude', 'bootstrap', 'bootstrap-manifest.json'),
    buildBootstrapManifest(projectPath, createdFiles),
  );

  const after = await getHarnessProjectCapability(projectPath);
  return {
    projectPath,
    created: true,
    alreadyInitialized: false,
    createdFiles,
    harnessAvailability: after.harnessAvailability,
  };
}
