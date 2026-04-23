import path from 'path';
import { promises as fs } from 'fs';
import { parseFrontmatter } from '../utils/frontmatter.js';
import {
  formatClaudeCommandName,
  getAllowedNextStages,
  getPreferredCommandNameForStage,
  getStageDefinition,
  inferStageFromCommandName,
} from './stage-state-machine.js';

async function scanCommandFiles(dir, baseDir) {
  const commands = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        commands.push(...await scanCommandFiles(fullPath, baseDir));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        commands.push(fullPath);
      }
    }
  } catch (error) {
    if (!['ENOENT', 'EACCES'].includes(error?.code)) {
      throw error;
    }
  }

  return commands.sort();
}

function inferCommandNameFromPath(commandsRoot, filePath) {
  const relativePath = path.relative(commandsRoot, filePath).replace(/\\/g, '/').replace(/\.md$/i, '');
  return formatClaudeCommandName(`/${relativePath}`);
}

function buildCommandArtifacts(stage) {
  return getStageDefinition(stage)?.artifacts || [];
}

export async function listHarnessCommands(projectPath) {
  const commandsRoot = path.join(projectPath, '.claude', 'commands');
  const commandFiles = await scanCommandFiles(commandsRoot, commandsRoot);

  const commands = await Promise.all(
    commandFiles.map(async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf8');
      const { data: metadata, content } = parseFrontmatter(raw);
      const name = inferCommandNameFromPath(commandsRoot, filePath);
      const stage = inferStageFromCommandName(name);
      const canonicalName =
        getPreferredCommandNameForStage(stage) || formatClaudeCommandName(metadata.alias_for || name);
      const type = name === canonicalName ? 'canonical' : 'alias';
      const definition = getStageDefinition(stage);
      const firstContentLine = content.trim().split('\n').find(Boolean) || '';
      const description =
        metadata.description ||
        firstContentLine.replace(/^#+\s*/, '').trim() ||
        canonicalName;

      return {
        name,
        canonicalName,
        type,
        stage,
        requiresHarness: true,
        path: filePath,
        relativePath: path.relative(projectPath, filePath).replace(/\\/g, '/'),
        description,
        preconditions: definition?.preconditions || [],
        nextStages: getAllowedNextStages(stage),
        artifacts: buildCommandArtifacts(stage),
        metadata,
      };
    }),
  );

  const dedupedCommands = commands.reduce((bucket, command) => {
    const existingIndex = bucket.findIndex(
      (existingCommand) => existingCommand.canonicalName === command.canonicalName,
    );

    if (existingIndex === -1) {
      bucket.push(command);
      return bucket;
    }

    if (bucket[existingIndex].type === 'alias' && command.type !== 'alias') {
      bucket[existingIndex] = command;
    }

    return bucket;
  }, []);

  return dedupedCommands.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
}
