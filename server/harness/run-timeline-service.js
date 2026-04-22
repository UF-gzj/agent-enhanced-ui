import { listRunRecords, listTaskEvents } from './task-manager.js';

export async function listTaskTimeline(projectPath, taskId) {
  const [runs, events] = await Promise.all([
    listRunRecords(projectPath, taskId),
    listTaskEvents(projectPath, taskId, 500),
  ]);

  const runEntries = runs.map((run) => ({
    entryType: 'run',
    timestamp: run.endedAt || run.updatedAt || run.createdAt,
    stage: run.stage,
    lane: run.role,
    status: run.status,
    summary: run.summary || null,
    inputPackVersion: run.inputPackVersion ?? null,
    blockers: run.blockers || [],
    modelResolution: run.modelResolution || null,
    source: run,
  }));

  const eventEntries = events.map((event) => ({
    entryType: 'event',
    timestamp: event.createdAt,
    stage: event.stage || null,
    lane: event.lane || 'main',
    status: event.status || event.type,
    summary: event.summary || event.reason || event.type,
    inputPackVersion: event.packVersion ?? null,
    blockers: event.blockers || [],
    modelResolution: null,
    source: event,
  }));

  return [...runEntries, ...eventEntries].sort((a, b) => {
    const left = Date.parse(a.timestamp || 0) || 0;
    const right = Date.parse(b.timestamp || 0) || 0;
    return left - right;
  });
}

