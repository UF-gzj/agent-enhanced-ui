import crypto from 'crypto';
import path from 'path';
import { readJsonFile, writeJsonFile, PHASE3_RUNTIME_DIR } from './phase3-storage-service.js';

const DATASETS_PATH = path.join(PHASE3_RUNTIME_DIR, 'eval-datasets.json');
const RESULTS_PATH = path.join(PHASE3_RUNTIME_DIR, 'eval-results.json');

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function uniqueTaskKeys(tasks = []) {
  return Array.from(new Set(tasks.map((task) => task.taskKey))).sort();
}

function normalizeDatasetTask(task, index) {
  return {
    taskKey: String(task?.taskKey || `task-${index + 1}`).trim(),
    repositoryClass: String(task?.repositoryClass || 'unknown').trim(),
    taskType: String(task?.taskType || 'unknown').trim(),
    difficulty: String(task?.difficulty || 'unknown').trim(),
    title: String(task?.title || task?.taskKey || `Task ${index + 1}`).trim(),
  };
}

function normalizeRunRecord(run, index) {
  const mode = run?.mode === 'harness' ? 'harness' : 'baseline';
  const signature = String(
    run?.signature ||
      JSON.stringify({
        success: Boolean(run?.success),
        firstPassValidation: Boolean(run?.firstPassValidation),
        hallucinationEvents: toNumber(run?.hallucinationEvents, 0),
        outOfScopeEdits: Boolean(run?.outOfScopeEdits),
      }),
  );

  return {
    taskKey: String(run?.taskKey || '').trim(),
    mode,
    attempt: toNumber(run?.attempt, index + 1),
    success: Boolean(run?.success),
    firstPassValidation: Boolean(run?.firstPassValidation),
    hallucinationEvents: toNumber(run?.hallucinationEvents, 0),
    outOfScopeEdits: Boolean(run?.outOfScopeEdits),
    signature,
  };
}

function countSuccessRate(runs = []) {
  if (!runs.length) {
    return 0;
  }
  const successCount = runs.filter((run) => run.success).length;
  return successCount / runs.length;
}

function countFirstPassRate(runs = []) {
  if (!runs.length) {
    return 0;
  }
  const passCount = runs.filter((run) => run.firstPassValidation).length;
  return passCount / runs.length;
}

function countReproducibility(runs = []) {
  if (!runs.length) {
    return 1;
  }

  const buckets = new Map();
  for (const run of runs) {
    const key = `${run.taskKey}:${run.mode}`;
    const entry = buckets.get(key) || [];
    entry.push(run);
    buckets.set(key, entry);
  }

  let consistentRuns = 0;
  let totalRuns = 0;
  for (const bucketRuns of buckets.values()) {
    const signatureCounts = new Map();
    for (const run of bucketRuns) {
      signatureCounts.set(run.signature, (signatureCounts.get(run.signature) || 0) + 1);
    }
    const modalCount = Math.max(...signatureCounts.values());
    consistentRuns += modalCount;
    totalRuns += bucketRuns.length;
  }

  return totalRuns > 0 ? consistentRuns / totalRuns : 1;
}

function countHallucinationRate(taskKeys, harnessRuns = []) {
  if (!taskKeys.length) {
    return 0;
  }
  const incidents = harnessRuns.reduce((sum, run) => sum + toNumber(run.hallucinationEvents, 0), 0);
  return incidents / taskKeys.length;
}

function countOutOfScopeRate(taskKeys, harnessRuns = []) {
  if (!taskKeys.length) {
    return 0;
  }
  const impactedTaskKeys = new Set(
    harnessRuns.filter((run) => run.outOfScopeEdits).map((run) => run.taskKey),
  );
  return impactedTaskKeys.size / taskKeys.length;
}

function countMinAttemptsByMode(taskKeys, runs = []) {
  const taskRunMap = new Map(taskKeys.map((taskKey) => [taskKey, { baseline: 0, harness: 0 }]));
  for (const run of runs) {
    const entry = taskRunMap.get(run.taskKey);
    if (!entry) {
      continue;
    }
    entry[run.mode] += 1;
  }

  let minBaseline = Infinity;
  let minHarness = Infinity;
  for (const entry of taskRunMap.values()) {
    minBaseline = Math.min(minBaseline, entry.baseline);
    minHarness = Math.min(minHarness, entry.harness);
  }

  return {
    minBaselineAttempts: Number.isFinite(minBaseline) ? minBaseline : 0,
    minHarnessAttempts: Number.isFinite(minHarness) ? minHarness : 0,
  };
}

function buildValiditySummary(provider, dataset, runs, metrics, existingResults = []) {
  const taskKeys = uniqueTaskKeys(dataset.tasks);
  const { minBaselineAttempts, minHarnessAttempts } = countMinAttemptsByMode(taskKeys, runs);
  const providerResults = existingResults.filter((result) => result.provider === provider);
  const roundLabels = Array.from(new Set(providerResults.map((result) => result.roundLabel).filter(Boolean)));

  return {
    providerGrouped: dataset.provider === provider,
    minimumTaskCountMet: taskKeys.length >= 60,
    minimumAttemptsMet: minBaselineAttempts >= 3 && minHarnessAttempts >= 3,
    reproducibilityMet: metrics.m24 >= 0.9,
    hallucinationGuardMet: metrics.m21 === 0,
    roundCountForProvider: roundLabels.length + 1,
  };
}

function buildMetrics(dataset, runs) {
  const taskKeys = uniqueTaskKeys(dataset.tasks);
  const baselineRuns = runs.filter((run) => run.mode === 'baseline');
  const harnessRuns = runs.filter((run) => run.mode === 'harness');
  const baselineSuccessRate = countSuccessRate(baselineRuns);
  const harnessSuccessRate = countSuccessRate(harnessRuns);
  const baselineFirstPassRate = countFirstPassRate(baselineRuns);
  const harnessFirstPassRate = countFirstPassRate(harnessRuns);

  return {
    baselineSuccessRate,
    harnessSuccessRate,
    baselineFirstPassRate,
    harnessFirstPassRate,
    m19: baselineSuccessRate > 0 ? (harnessSuccessRate - baselineSuccessRate) / baselineSuccessRate : 0,
    m20: harnessFirstPassRate - baselineFirstPassRate,
    m21: countHallucinationRate(taskKeys, harnessRuns),
    m22: countOutOfScopeRate(taskKeys, harnessRuns),
    m24: countReproducibility(runs),
  };
}

export async function listEvalDatasets({ provider = null } = {}) {
  const datasets = await readJsonFile(DATASETS_PATH, []);
  return provider ? datasets.filter((dataset) => dataset.provider === provider) : datasets;
}

export async function saveEvalDataset(input) {
  const datasets = await readJsonFile(DATASETS_PATH, []);
  const datasetId = input?.datasetId || createId('dataset');
  const normalizedTasks = Array.isArray(input?.tasks)
    ? input.tasks.map((task, index) => normalizeDatasetTask(task, index)).filter((task) => task.taskKey)
    : [];
  const now = nowIso();

  const nextDataset = {
    datasetId,
    name: String(input?.name || datasetId).trim(),
    provider: String(input?.provider || 'claude').trim(),
    description: String(input?.description || '').trim(),
    tasks: normalizedTasks,
    frozenAt: input?.frozenAt || now,
    createdAt: datasets.find((dataset) => dataset.datasetId === datasetId)?.createdAt || now,
    updatedAt: now,
  };

  const nextDatasets = [
    ...datasets.filter((dataset) => dataset.datasetId !== datasetId),
    nextDataset,
  ].sort((left, right) => left.name.localeCompare(right.name));

  await writeJsonFile(DATASETS_PATH, nextDatasets);
  return nextDataset;
}

export async function listEvalResults({ provider = null, datasetId = null } = {}) {
  const results = await readJsonFile(RESULTS_PATH, []);
  return results.filter((result) => {
    if (provider && result.provider !== provider) {
      return false;
    }
    if (datasetId && result.datasetId !== datasetId) {
      return false;
    }
    return true;
  });
}

export async function runEvalBenchmark(input) {
  const datasets = await listEvalDatasets();
  const dataset = datasets.find((entry) => entry.datasetId === input?.datasetId);
  if (!dataset) {
    const error = new Error('dataset-not-found');
    error.code = 'DATASET_NOT_FOUND';
    throw error;
  }

  const normalizedRuns = Array.isArray(input?.runs)
    ? input.runs.map((run, index) => normalizeRunRecord(run, index)).filter((run) => run.taskKey)
    : [];
  const existingResults = await listEvalResults({ provider: input?.provider || dataset.provider });
  const metrics = buildMetrics(dataset, normalizedRuns);
  const validity = buildValiditySummary(
    input?.provider || dataset.provider,
    dataset,
    normalizedRuns,
    metrics,
    existingResults,
  );

  const result = {
    resultId: createId('eval'),
    benchmarkName: String(input?.benchmarkName || dataset.name).trim(),
    datasetId: dataset.datasetId,
    provider: String(input?.provider || dataset.provider).trim(),
    roundLabel: String(input?.roundLabel || `round-${existingResults.length + 1}`).trim(),
    taskCount: uniqueTaskKeys(dataset.tasks).length,
    runCount: normalizedRuns.length,
    metrics,
    validity,
    runs: normalizedRuns,
    createdAt: nowIso(),
  };

  const results = await readJsonFile(RESULTS_PATH, []);
  await writeJsonFile(RESULTS_PATH, [...results, result]);
  return result;
}

function computeDirectionConsistency(results = []) {
  if (!results.length) {
    return false;
  }

  const positiveM19 = results.every((result) => result.metrics.m19 >= 0.15);
  const positiveM20 = results.every((result) => result.metrics.m20 >= 0.15);
  const guardedM21 = results.every((result) => result.metrics.m21 === 0);
  const guardedM22 = results.every((result) => result.metrics.m22 <= 0.05);

  return positiveM19 && positiveM20 && guardedM21 && guardedM22;
}

export async function getEvalSummary({ provider = null, datasetId = null } = {}) {
  const results = await listEvalResults({ provider, datasetId });

  if (!results.length) {
    return {
      provider: provider || null,
      datasetId: datasetId || null,
      totalResults: 0,
      latestMetrics: null,
      rounds: [],
      thresholds: {
        m19Met: false,
        m20Met: false,
        m21Met: false,
        m22Met: false,
        m24Met: false,
        minimumRoundsMet: false,
      },
      directionConsistencyMet: false,
      claimEligible: false,
    };
  }

  const rounds = results
    .map((result) => ({
      resultId: result.resultId,
      roundLabel: result.roundLabel,
      datasetId: result.datasetId,
      provider: result.provider,
      metrics: result.metrics,
      validity: result.validity,
      createdAt: result.createdAt,
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const latest = rounds[rounds.length - 1];
  const thresholds = {
    m19Met: latest.metrics.m19 >= 0.15,
    m20Met: latest.metrics.m20 >= 0.15,
    m21Met: latest.metrics.m21 === 0,
    m22Met: latest.metrics.m22 <= 0.05,
    m24Met: latest.metrics.m24 >= 0.9,
    minimumRoundsMet: rounds.length >= 2,
  };
  const directionConsistencyMet = computeDirectionConsistency(rounds);

  return {
    provider: latest.provider,
    datasetId: latest.datasetId,
    totalResults: rounds.length,
    latestMetrics: latest.metrics,
    rounds,
    thresholds,
    directionConsistencyMet,
    claimEligible:
      thresholds.m19Met &&
      thresholds.m20Met &&
      thresholds.m21Met &&
      thresholds.m22Met &&
      thresholds.m24Met &&
      thresholds.minimumRoundsMet &&
      directionConsistencyMet,
  };
}
