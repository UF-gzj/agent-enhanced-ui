import path from 'path';
import { promises as fs } from 'fs';
import { findAppRoot, getModuleDir } from '../utils/runtime-paths.js';

const __dirname = getModuleDir(import.meta.url);
const APP_ROOT = findAppRoot(__dirname);

export const PHASE3_RUNTIME_DIR = path.join(APP_ROOT, 'server', 'runtime', 'harness-phase3');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallbackValue;
    }
    throw error;
  }
}

export async function writeJsonFile(filePath, value) {
  const dirPath = path.dirname(filePath);
  await ensureDir(dirPath);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function appendJsonlFile(filePath, value) {
  const dirPath = path.dirname(filePath);
  await ensureDir(dirPath);
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function ensureRuntimeDir() {
  await ensureDir(PHASE3_RUNTIME_DIR);
  return PHASE3_RUNTIME_DIR;
}
