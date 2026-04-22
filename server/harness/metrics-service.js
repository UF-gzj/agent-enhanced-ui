import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import { findAppRoot, getModuleDir } from '../utils/runtime-paths.js';

const __dirname = getModuleDir(import.meta.url);
const APP_ROOT = findAppRoot(__dirname);
const RUNTIME_DIR = path.join(APP_ROOT, 'server', 'runtime');
export const APP_METRICS_EVENTS_PATH = path.join(RUNTIME_DIR, 'app-metrics-events.ndjson');

function createEventId() {
  return `evt_${crypto.randomBytes(8).toString('hex')}`;
}

export async function appendAppMetricEvent(eventInput) {
  const event = {
    eventId: eventInput?.eventId || createEventId(),
    scope: 'app',
    taskId: null,
    sessionId: eventInput?.sessionId || null,
    projectPath: eventInput?.projectPath || null,
    category: eventInput?.category || 'routing',
    name: eventInput?.name || eventInput?.metricKey || 'unknown_event',
    metricKey: eventInput?.metricKey || 'unknown',
    value: typeof eventInput?.value === 'number' ? eventInput.value : 0,
    unit: eventInput?.unit || 'count',
    status: eventInput?.status || 'recorded',
    reason: eventInput?.reason || null,
    provider: eventInput?.provider || null,
    timestamp: eventInput?.timestamp || new Date().toISOString(),
    createdAt: eventInput?.createdAt || eventInput?.timestamp || new Date().toISOString(),
    details: eventInput?.details || null,
  };

  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  await fs.appendFile(APP_METRICS_EVENTS_PATH, `${JSON.stringify(event)}\n`, 'utf8');

  return event;
}

export async function listAppMetricEvents({ projectPath = null, limit = 100 } = {}) {
  try {
    const raw = await fs.readFile(APP_METRICS_EVENTS_PATH, 'utf8');
    const events = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => !projectPath || event.projectPath === projectPath);

    const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 500)) : 100;
    return events.slice(-normalizedLimit);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
