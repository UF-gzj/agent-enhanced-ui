import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  HarnessArtifactRecord,
  HarnessCommandRegistryEntry,
  HarnessCheckpointRecord,
  HarnessEvalDataset,
  HarnessEvalResult,
  HarnessEvalSummary,
  HarnessKnowledgeFeedbackRecord,
  HarnessPackRecord,
  HarnessRunRecord,
  HarnessTask,
  HarnessTimelineEntry,
  HarnessBootstrapResult,
  HarnessWorkspaceStatus,
  Project,
} from '../../types/app';
import { authenticatedFetch } from '../../utils/api';
import Tooltip from '../../shared/view/ui/Tooltip';

type HarnessPanelProps = {
  selectedProject: Project | null;
  isVisible: boolean;
};

export default function HarnessPanel({ selectedProject, isVisible }: HarnessPanelProps) {
  const { t } = useTranslation('chat');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<HarnessTask | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<HarnessWorkspaceStatus | null>(null);
  const [commands, setCommands] = useState<HarnessCommandRegistryEntry[]>([]);
  const [artifacts, setArtifacts] = useState<HarnessArtifactRecord[]>([]);
  const [packs, setPacks] = useState<HarnessPackRecord[]>([]);
  const [runs, setRuns] = useState<HarnessRunRecord[]>([]);
  const [timeline, setTimeline] = useState<HarnessTimelineEntry[]>([]);
  const [evalDatasets, setEvalDatasets] = useState<HarnessEvalDataset[]>([]);
  const [evalResults, setEvalResults] = useState<HarnessEvalResult[]>([]);
  const [evalSummary, setEvalSummary] = useState<HarnessEvalSummary | null>(null);
  const [selectedEvalDatasetId, setSelectedEvalDatasetId] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<HarnessCheckpointRecord[]>([]);
  const [knowledgeFeedback, setKnowledgeFeedback] = useState<HarnessKnowledgeFeedbackRecord[]>([]);
  const [bootstrapResult, setBootstrapResult] = useState<HarnessBootstrapResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateActionLoading, setGateActionLoading] = useState<string | null>(null);

  const projectPath = selectedProject?.fullPath || selectedProject?.path || '';

  const refreshTask = useCallback(async (options?: { background?: boolean }) => {
    if (!selectedProject || !projectPath) {
      setTask(null);
      setTaskId(null);
      setWorkspaceStatus(null);
      setCommands([]);
      setArtifacts([]);
      setPacks([]);
      setRuns([]);
      setTimeline([]);
      setEvalDatasets([]);
      setEvalResults([]);
      setEvalSummary(null);
      setSelectedEvalDatasetId(null);
      setCheckpoints([]);
      setKnowledgeFeedback([]);
      setBootstrapResult(null);
      setHasLoadedOnce(false);
      setError(null);
      return;
    }

    if (!options?.background) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const workspaceResponse = await authenticatedFetch(
        `/api/harness/workspaces/status?projectPath=${encodeURIComponent(projectPath)}`,
      );
      if (!workspaceResponse.ok) {
        throw new Error(`HTTP ${workspaceResponse.status}`);
      }
      const workspaceData = await workspaceResponse.json();
      setWorkspaceStatus(workspaceData.workspace || null);

      const commandsResponse = await authenticatedFetch(
        `/api/harness/commands?projectPath=${encodeURIComponent(projectPath)}`,
      );
      if (commandsResponse.ok) {
        const commandsData = await commandsResponse.json();
        setCommands(Array.isArray(commandsData.commands) ? commandsData.commands : []);
      } else {
        setCommands([]);
      }

      const currentTaskResponse = await authenticatedFetch(
        `/api/harness/projects/current-task?projectPath=${encodeURIComponent(projectPath)}`,
      );
      if (!currentTaskResponse.ok) {
        throw new Error(`HTTP ${currentTaskResponse.status}`);
      }

      const currentTaskData = await currentTaskResponse.json();
      const nextTaskId = currentTaskData.taskId || currentTaskData.task?.taskId || null;
      setTaskId(nextTaskId);
      const [datasetsResponse, resultsResponse, feedbackResponse] = await Promise.all([
        authenticatedFetch('/api/harness/evals/datasets'),
        authenticatedFetch('/api/harness/evals/results'),
        authenticatedFetch(
          `/api/harness/knowledge/feedback?projectPath=${encodeURIComponent(projectPath)}`,
        ),
      ]);

      let nextDatasets: HarnessEvalDataset[] = [];
      if (datasetsResponse.ok) {
        const datasetsData = await datasetsResponse.json();
        nextDatasets = Array.isArray(datasetsData.datasets) ? datasetsData.datasets : [];
        setEvalDatasets(nextDatasets);
      } else {
        setEvalDatasets([]);
      }

      let nextResults: HarnessEvalResult[] = [];
      if (resultsResponse.ok) {
        const resultsData = await resultsResponse.json();
        nextResults = Array.isArray(resultsData.results) ? resultsData.results : [];
        setEvalResults(nextResults);
      } else {
        setEvalResults([]);
      }

      const preferredDataset =
        nextDatasets.find((dataset) => dataset.datasetId === selectedEvalDatasetId) ||
        [...nextDatasets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ||
        null;
      const nextDatasetId = preferredDataset?.datasetId || null;
      setSelectedEvalDatasetId(nextDatasetId);

      const summaryQuery = nextDatasetId
        ? `/api/harness/evals/summary?provider=claude&datasetId=${encodeURIComponent(nextDatasetId)}`
        : '/api/harness/evals/summary?provider=claude';
      const summaryResponse = await authenticatedFetch(summaryQuery);

      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        setEvalSummary(summaryData.summary || null);
      } else {
        setEvalSummary(null);
      }

      if (feedbackResponse.ok) {
        const feedbackData = await feedbackResponse.json();
        setKnowledgeFeedback(Array.isArray(feedbackData.feedback) ? feedbackData.feedback : []);
      } else {
        setKnowledgeFeedback([]);
      }

      if (!nextTaskId || !currentTaskData.task) {
        setTask(null);
        setArtifacts([]);
        setPacks([]);
        setRuns([]);
        setTimeline([]);
        setCheckpoints([]);
        setHasLoadedOnce(true);
        return;
      }

      setTask(currentTaskData.task);

      const [artifactsResponse, packsResponse, runsResponse, timelineResponse, checkpointsResponse] = await Promise.all([
        authenticatedFetch(
          `/api/harness/tasks/${encodeURIComponent(nextTaskId)}/artifacts?projectPath=${encodeURIComponent(projectPath)}`,
        ),
        authenticatedFetch(
          `/api/harness/tasks/${encodeURIComponent(nextTaskId)}/packs?projectPath=${encodeURIComponent(projectPath)}`,
        ),
        authenticatedFetch(
          `/api/harness/tasks/${encodeURIComponent(nextTaskId)}/runs?projectPath=${encodeURIComponent(projectPath)}`,
        ),
        authenticatedFetch(
          `/api/harness/tasks/${encodeURIComponent(nextTaskId)}/timeline?projectPath=${encodeURIComponent(projectPath)}`,
        ),
        authenticatedFetch(
          `/api/harness/tasks/${encodeURIComponent(nextTaskId)}/checkpoints?projectPath=${encodeURIComponent(projectPath)}`,
        ),
      ]);

      if (!artifactsResponse.ok || !packsResponse.ok || !runsResponse.ok || !timelineResponse.ok || !checkpointsResponse.ok) {
        throw new Error('Failed to read harness workbench data');
      }

      const artifactsData = await artifactsResponse.json();
      const packsData = await packsResponse.json();
      const runsData = await runsResponse.json();
      const timelineData = await timelineResponse.json();
      const checkpointsData = await checkpointsResponse.json();

      setArtifacts(Array.isArray(artifactsData.artifacts) ? artifactsData.artifacts : []);
      setPacks(Array.isArray(packsData.packs) ? packsData.packs : []);
      setRuns(Array.isArray(runsData.runs) ? runsData.runs : []);
      setTimeline(Array.isArray(timelineData.timeline) ? timelineData.timeline : []);
      setCheckpoints(Array.isArray(checkpointsData.checkpoints) ? checkpointsData.checkpoints : []);
      setHasLoadedOnce(true);
    } catch (fetchError) {
      setTaskId(null);
      setTask(null);
      setWorkspaceStatus(null);
      setCommands([]);
      setArtifacts([]);
      setPacks([]);
      setRuns([]);
      setTimeline([]);
      setEvalDatasets([]);
      setEvalResults([]);
      setEvalSummary(null);
      setSelectedEvalDatasetId(null);
      setCheckpoints([]);
      setKnowledgeFeedback([]);
      setBootstrapResult(null);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load harness workbench');
    } finally {
      if (!options?.background) {
        setIsLoading(false);
      }
    }
  }, [projectPath, selectedProject]);

  useEffect(() => {
    setHasLoadedOnce(false);
  }, [projectPath]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    void refreshTask();
    const intervalId = window.setInterval(() => {
      void refreshTask({ background: true });
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isVisible, refreshTask]);

  const translateHarnessValue = useCallback(
    (value: string | number | null | undefined) => {
      if (value === null || value === undefined || value === '') {
        return t('harness.values.unknown');
      }

      if (typeof value !== 'string') {
        return String(value);
      }

      const normalizedKey = value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      return t(`harness.values.${normalizedKey}`, { defaultValue: value });
    },
    [t],
  );

  const recentRuns = useMemo(() => [...runs].slice(-6).reverse(), [runs]);
  const recentTimeline = useMemo(() => [...timeline].slice(-10).reverse(), [timeline]);
  const selectedEvalDataset = useMemo(
    () => evalDatasets.find((dataset) => dataset.datasetId === selectedEvalDatasetId) || null,
    [evalDatasets, selectedEvalDatasetId],
  );
  const recentEvalResults = useMemo(() => {
    const filtered = selectedEvalDatasetId
      ? evalResults.filter((result) => result.datasetId === selectedEvalDatasetId)
      : evalResults;
    return [...filtered].slice(-6).reverse();
  }, [evalResults, selectedEvalDatasetId]);
  const recentCheckpoints = useMemo(() => [...checkpoints].slice(-6).reverse(), [checkpoints]);
  const recentFeedback = useMemo(() => [...knowledgeFeedback].slice(-6), [knowledgeFeedback]);
  const artifactGroups = useMemo(() => {
    return artifacts.reduce<Record<string, HarnessArtifactRecord[]>>((bucket, artifact) => {
      const key = artifact.kind || 'other';
      bucket[key] = bucket[key] || [];
      bucket[key].push(artifact);
      return bucket;
    }, {});
  }, [artifacts]);

  const handleGateUpdate = useCallback(
    async (
      lane: 'review' | 'validation' | 'human',
      value: 'pending' | 'passed' | 'failed' | 'invalidated' | 'approved' | 'rejected' | 'not_required',
    ) => {
      if (!task || !projectPath) {
        return;
      }

      const actionKey = `${lane}:${value}`;
      setGateActionLoading(actionKey);
      setError(null);

      try {
        const payload =
          lane === 'human'
            ? {
                projectPath,
                lane,
                humanDecision: value,
                summary: `human ${value}`,
              }
            : {
                projectPath,
                lane,
                status: value,
                blockers: value === 'failed' ? [`${lane}-failed`] : [],
                summary: `${lane} ${value}`,
              };

        const response = await authenticatedFetch(`/api/harness/tasks/${encodeURIComponent(task.taskId)}/gate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await refreshTask();
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : 'Failed to update gate');
      } finally {
        setGateActionLoading(null);
      }
    },
    [projectPath, refreshTask, task],
  );

  const handleInvalidate = useCallback(
    async (scope: 'all' | 'review' | 'validation') => {
      if (!task || !projectPath) {
        return;
      }

      const actionKey = `invalidate:${scope}`;
      setGateActionLoading(actionKey);
      setError(null);

      try {
        const response = await authenticatedFetch(
          `/api/harness/tasks/${encodeURIComponent(task.taskId)}/invalidate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              projectPath,
              scope,
              reason: scope === 'all' ? 'manual-upstream-change' : `manual-${scope}-invalidate`,
              summary: `manual ${scope} invalidation`,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await refreshTask();
      } catch (invalidateError) {
        setError(invalidateError instanceof Error ? invalidateError.message : 'Failed to invalidate task');
      } finally {
        setGateActionLoading(null);
      }
    },
    [projectPath, refreshTask, task],
  );

  const handleRefreshArtifacts = useCallback(async () => {
    if (!task || !projectPath) {
      return;
    }

    setGateActionLoading('artifacts:refresh');
    setError(null);
    try {
      const response = await authenticatedFetch(
        `/api/harness/tasks/${encodeURIComponent(task.taskId)}/artifacts/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ projectPath }),
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await refreshTask();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh artifacts');
    } finally {
      setGateActionLoading(null);
    }
  }, [projectPath, refreshTask, task]);

  const handleCreateCheckpoint = useCallback(async () => {
    if (!task || !projectPath) {
      return;
    }
    setGateActionLoading('checkpoint:create');
    setError(null);
    try {
      const response = await authenticatedFetch(
        `/api/harness/tasks/${encodeURIComponent(task.taskId)}/checkpoint`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath, reason: 'ui-manual-checkpoint' }),
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await refreshTask();
    } catch (checkpointError) {
      setError(checkpointError instanceof Error ? checkpointError.message : 'Failed to create checkpoint');
    } finally {
      setGateActionLoading(null);
    }
  }, [projectPath, refreshTask, task]);

  const handleResumeCheckpoint = useCallback(async (checkpointId: string) => {
    if (!task || !projectPath) {
      return;
    }
    setGateActionLoading(`checkpoint:${checkpointId}`);
    setError(null);
    try {
      const response = await authenticatedFetch(
        `/api/harness/tasks/${encodeURIComponent(task.taskId)}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath, checkpointId }),
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await refreshTask();
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : 'Failed to resume checkpoint');
    } finally {
      setGateActionLoading(null);
    }
  }, [projectPath, refreshTask, task]);

  const handleSeedEvalDataset = useCallback(async () => {
    setGateActionLoading('eval:seed');
    setError(null);
    try {
      const response = await authenticatedFetch('/api/harness/evals/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'phase-3-seed-dataset',
          provider: 'claude',
          description: 'Seed dataset created from the Harness panel.',
          tasks: Array.from({ length: 60 }).map((_, index) => ({
            taskKey: `seed-task-${index + 1}`,
            repositoryClass: index % 2 === 0 ? 'backend' : 'frontend',
            taskType: index % 3 === 0 ? 'bugfix' : 'feature',
            difficulty: index % 2 === 0 ? 'medium' : 'hard',
            title: `Seed Task ${index + 1}`,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await refreshTask();
    } catch (datasetError) {
      setError(datasetError instanceof Error ? datasetError.message : 'Failed to seed eval dataset');
    } finally {
      setGateActionLoading(null);
    }
  }, [refreshTask]);

  const handleRunSeedEval = useCallback(async () => {
    const seedDataset = evalDatasets.find((dataset) => dataset.name === 'phase-3-seed-dataset') || evalDatasets[0];
    if (!seedDataset) {
      setError(t('harness.benchmark.createDatasetFirst'));
      return;
    }
    setGateActionLoading('eval:run');
    setError(null);
    try {
      const runs = seedDataset.tasks.flatMap((task) => ([
        { taskKey: task.taskKey, mode: 'baseline', attempt: 1, success: true, firstPassValidation: false, hallucinationEvents: 0, outOfScopeEdits: false },
        { taskKey: task.taskKey, mode: 'baseline', attempt: 2, success: true, firstPassValidation: false, hallucinationEvents: 0, outOfScopeEdits: false },
        { taskKey: task.taskKey, mode: 'baseline', attempt: 3, success: true, firstPassValidation: false, hallucinationEvents: 0, outOfScopeEdits: false },
        { taskKey: task.taskKey, mode: 'harness', attempt: 1, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
        { taskKey: task.taskKey, mode: 'harness', attempt: 2, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
        { taskKey: task.taskKey, mode: 'harness', attempt: 3, success: true, firstPassValidation: true, hallucinationEvents: 0, outOfScopeEdits: false },
      ]));

      const response = await authenticatedFetch('/api/harness/evals/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          benchmarkName: 'phase-3-seed-benchmark',
          datasetId: seedDataset.datasetId,
          provider: seedDataset.provider,
          roundLabel: 'round-1',
          runs,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await refreshTask();
    } catch (evalError) {
      setError(evalError instanceof Error ? evalError.message : 'Failed to run eval benchmark');
    } finally {
      setGateActionLoading(null);
    }
  }, [evalDatasets, refreshTask]);

  const handleWriteFeedback = useCallback(async () => {
    if (!projectPath) {
      return;
    }
    setGateActionLoading('feedback:create');
    setError(null);
    try {
      const response = await authenticatedFetch('/api/harness/knowledge/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          sourceTaskId: task?.taskId || null,
          targetLayer: 'reference',
          title: 'Phase 3 feedback seed',
          summary: 'This feedback record verifies the phase-3 write/read loop.',
          evidencePaths: task ? task.artifactBindings.map((binding) => binding.path).slice(0, 2) : [],
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await refreshTask();
    } catch (feedbackError) {
      setError(feedbackError instanceof Error ? feedbackError.message : 'Failed to write knowledge feedback');
    } finally {
      setGateActionLoading(null);
    }
  }, [projectPath, refreshTask, task]);

  const handleBootstrap = useCallback(async () => {
    if (!projectPath) {
      return;
    }
    setGateActionLoading('bootstrap:init');
    setError(null);
    try {
      const response = await authenticatedFetch('/api/harness/bootstrap/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      setBootstrapResult(payload.result || null);
      await refreshTask();
    } catch (bootstrapError) {
      setError(bootstrapError instanceof Error ? bootstrapError.message : 'Failed to initialize bootstrap');
    } finally {
      setGateActionLoading(null);
    }
  }, [projectPath, refreshTask]);

  if (!isVisible) {
    return null;
  }

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        请选择项目后再查看 Harness 状态。
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Harness 工作台</h2>
                <HelpHint
                  content={
                    <>
                      这是整个 Harness 的总控台。
                      <br />
                      你可以在这里看当前项目有没有进入团队共享系统、任务做到哪一步、哪些验证通过了、哪些工件和评估结果已经生成。
                    </>
                  }
                />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                二期开始展示 workspace prime、命令注册、工件、timeline 与 gate 联动。
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void refreshTask()}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition hover:bg-accent/40"
              >
                {t('harness.actions.refresh')}
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshArtifacts()}
                disabled={!task || Boolean(gateActionLoading)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {gateActionLoading === 'artifacts:refresh'
                  ? t('harness.actions.refreshingArtifacts')
                  : t('harness.actions.refreshArtifacts')}
              </button>
            </div>
          </div>
        </div>

        {workspaceStatus && (
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <SectionHeading
              title={t('harness.sections.workspace.title')}
              helpContent={
                <>
                  {t('harness.sections.workspace.helpLine1')}
                  <br />
                  {t('harness.sections.workspace.helpLine2')}
                </>
              }
            />
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <StatusCard label={t('harness.labels.harnessAvailability')} value={translateHarnessValue(workspaceStatus.harnessAvailability)} />
              <StatusCard label={t('harness.labels.primeState')} value={translateHarnessValue(workspaceStatus.workspacePrimeState)} />
              <StatusCard label={t('harness.labels.currentTask')} value={workspaceStatus.currentTaskId || t('harness.values.none')} monospace wrapValue />
              <StatusCard label={t('harness.labels.currentStage')} value={workspaceStatus.currentStage || t('harness.values.none')} wrapValue />
              <StatusCard label={t('harness.labels.commandCount')} value={String(workspaceStatus.commandCount)} />
              <StatusCard label={t('harness.labels.artifactCount')} value={String(workspaceStatus.artifactCount)} />
            </div>
            {workspaceStatus.lastPrimedAt && (
              <div className="mt-3 text-xs text-muted-foreground">
                {t('harness.workspace.lastPrimedAt', { value: workspaceStatus.lastPrimedAt })}
              </div>
            )}
            {workspaceStatus.staleReasons.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {t('harness.workspace.staleReasons', { value: workspaceStatus.staleReasons.join(', ') })}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm xl:col-span-2">
            <SectionHeading
              title={t('harness.sections.currentTask.title')}
              helpContent={
                <>
                  {t('harness.sections.currentTask.helpLine1')}
                  <br />
                  {t('harness.sections.currentTask.helpLine2')}
                </>
              }
            />

            {!taskId && !isLoading && (
              <div className="text-sm text-muted-foreground">
                {t('harness.currentTask.empty')}
              </div>
            )}

            {isLoading && !hasLoadedOnce && (
              <div className="text-sm text-muted-foreground">{t('harness.currentTask.loading')}</div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}

            {task && (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <StatusCard label={t('harness.labels.taskId')} value={task.taskId} monospace wrapValue />
                  <StatusCard label={t('harness.labels.currentStage')} value={translateHarnessValue(task.currentStage)} wrapValue />
                  <StatusCard label={t('harness.labels.taskStatus')} value={translateHarnessValue(task.status)} />
                  <StatusCard label={t('harness.labels.currentStatus')} value={translateHarnessValue(task.taskSummaryState)} />
                  <StatusCard label={t('harness.labels.primeState')} value={translateHarnessValue(task.primeState)} />
                  <StatusCard label={t('harness.labels.updatedAt')} value={task.updatedAt} wrapValue />
                </div>

                <div className="rounded-lg bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">{t('harness.labels.taskTitle')}</div>
                  <div className="mt-1 text-sm text-foreground">{task.title}</div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <SectionHeading
              title={t('harness.sections.packs.title')}
              helpContent={
                <>
                  {t('harness.sections.packs.helpLine1')}
                  <br />
                  {t('harness.sections.packs.helpLine2')}
                </>
              }
            />
            {!packs.length && <div className="text-sm text-muted-foreground">{t('harness.packs.empty')}</div>}
            <div className="space-y-2">
              {packs.map((pack) => (
                <div key={`${pack.packType}-${pack.version}`} className="rounded-lg bg-muted/30 px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {pack.packType} · {translateHarnessValue(pack.status)}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">v{pack.version}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <SectionHeading
              title={t('harness.sections.commands.title')}
              helpContent={
                <>
                  {t('harness.sections.commands.helpLine1')}
                  <br />
                  {t('harness.sections.commands.helpLine2')}
                </>
              }
            />
            {!commands.length && (
              <div className="text-sm text-muted-foreground">{t('harness.commands.empty')}</div>
            )}
            <div className="space-y-2">
              {commands.map((command) => (
                <div key={command.path} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="font-medium">{command.name}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{command.type}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{command.stage}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{command.description}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('harness.commands.canonical', { value: command.canonicalName })}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('harness.commands.preconditions', {
                      value: command.preconditions.join(', ') || t('harness.values.none'),
                    })}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('harness.commands.artifacts', {
                      value: command.artifacts.join(', ') || t('harness.values.none'),
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <SectionHeading
              title={t('harness.sections.timeline.title')}
              helpContent={
                <>
                  {t('harness.sections.timeline.helpLine1')}
                  <br />
                  {t('harness.sections.timeline.helpLine2')}
                </>
              }
            />
            {!recentTimeline.length && (
              <div className="text-sm text-muted-foreground">{t('harness.timeline.empty')}</div>
            )}
            <div className="space-y-2">
              {recentTimeline.map((entry, index) => (
                <div key={`${entry.entryType}-${entry.timestamp}-${index}`} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="font-medium">{entry.entryType}</span>
                    <span className="text-muted-foreground">/ {entry.lane}</span>
                    {entry.stage && <span className="text-muted-foreground">/ {entry.stage}</span>}
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{translateHarnessValue(entry.status)}</span>
                    {typeof entry.inputPackVersion === 'number' && (
                      <span className="text-xs text-muted-foreground">
                        {t('harness.timeline.packVersion', { value: entry.inputPackVersion })}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{entry.timestamp}</div>
                  {entry.summary && <div className="mt-1 text-xs text-foreground">{entry.summary}</div>}
                  {entry.blockers.length > 0 && (
                    <div className="mt-1 text-xs text-red-600 dark:text-red-300">
                      {t('harness.timeline.blockers', { value: entry.blockers.join(', ') })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          <SectionHeading
            title={t('harness.sections.artifacts.title')}
            helpContent={
              <>
                {t('harness.sections.artifacts.helpLine1')}
                <br />
                {t('harness.sections.artifacts.helpLine2')}
              </>
            }
          />
          {!Object.keys(artifactGroups).length && (
            <div className="text-sm text-muted-foreground">{t('harness.artifacts.empty')}</div>
          )}
          <div className="space-y-4">
            {Object.entries(artifactGroups).map(([kind, items]) => (
              <div key={kind}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{kind}</div>
                <div className="space-y-2">
                  {items.map((artifact) => (
                    <div key={artifact.artifactId} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                        <span className="font-medium">{artifact.relativePath}</span>
                        <span className="rounded bg-muted px-2 py-0.5 text-xs">{translateHarnessValue(artifact.status)}</span>
                        {artifact.boundTaskId && (
                          <span className="rounded bg-muted px-2 py-0.5 text-xs">{t('harness.values.bound')}</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t('harness.artifacts.updatedAt', { value: artifact.updatedAt })}
                      </div>
                      <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{artifact.hash}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {task?.activeGate && (
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <SectionHeading
              title={t('harness.sections.gate.title')}
              helpContent={
                <>
                  {t('harness.sections.gate.helpLine1')}
                  <br />
                  {t('harness.sections.gate.helpLine2')}
                </>
              }
            />
            <div className="grid gap-3 md:grid-cols-3">
              <StatusCard label={t('harness.labels.review')} value={translateHarnessValue(task.activeGate.reviewStatus)} />
              <StatusCard label={t('harness.labels.validation')} value={translateHarnessValue(task.activeGate.validationStatus)} />
              <StatusCard label={t('harness.labels.humanDecision')} value={translateHarnessValue(task.activeGate.humanDecision)} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <ActionGroup
                title={t('harness.gate.reviewActions')}
                loadingKey={gateActionLoading}
                actions={[
                  { key: 'review:passed', label: t('harness.actions.markPassed'), onClick: () => void handleGateUpdate('review', 'passed') },
                  { key: 'review:failed', label: t('harness.actions.markFailed'), onClick: () => void handleGateUpdate('review', 'failed') },
                ]}
              />
              <ActionGroup
                title={t('harness.gate.validationActions')}
                loadingKey={gateActionLoading}
                actions={[
                  { key: 'validation:passed', label: t('harness.actions.markPassed'), onClick: () => void handleGateUpdate('validation', 'passed') },
                  { key: 'validation:failed', label: t('harness.actions.markFailed'), onClick: () => void handleGateUpdate('validation', 'failed') },
                ]}
              />
              <ActionGroup
                title={t('harness.gate.humanActions')}
                loadingKey={gateActionLoading}
                actions={[
                  { key: 'human:approved', label: t('harness.actions.approve'), onClick: () => void handleGateUpdate('human', 'approved') },
                  { key: 'human:rejected', label: t('harness.actions.reject'), onClick: () => void handleGateUpdate('human', 'rejected') },
                ]}
              />
            </div>

            <div className="mt-4 rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">{t('harness.gate.invalidateActions')}</div>
              <div className="flex flex-wrap gap-2">
                <SmallButton
                  actionKey="invalidate:review"
                  loadingKey={gateActionLoading}
                  label={t('harness.actions.invalidateReview')}
                  onClick={() => void handleInvalidate('review')}
                />
                <SmallButton
                  actionKey="invalidate:validation"
                  loadingKey={gateActionLoading}
                  label={t('harness.actions.invalidateValidation')}
                  onClick={() => void handleInvalidate('validation')}
                />
                <SmallButton
                  actionKey="invalidate:all"
                  loadingKey={gateActionLoading}
                  label={t('harness.actions.invalidateAll')}
                  onClick={() => void handleInvalidate('all')}
                />
              </div>
            </div>
          </div>
        )}

        {task && (
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <SectionHeading
              title={t('harness.sections.runs.title')}
              helpContent={
                <>
                  {t('harness.sections.runs.helpLine1')}
                  <br />
                  {t('harness.sections.runs.helpLine2')}
                </>
              }
            />
            {!recentRuns.length && (
              <div className="text-sm text-muted-foreground">{t('harness.runs.empty')}</div>
            )}
            <div className="space-y-2">
              {recentRuns.map((run) => (
                <div key={run.runId} className="rounded-lg bg-muted/20 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="font-medium">{run.role}</span>
                    <span className="text-muted-foreground">/ {run.stage}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{translateHarnessValue(run.status)}</span>
                    {typeof run.inputPackVersion === 'number' && (
                      <span className="text-xs text-muted-foreground">
                        {t('harness.timeline.packVersion', { value: run.inputPackVersion })}
                      </span>
                    )}
                  </div>
                  {run.summary && <div className="mt-1 text-xs text-muted-foreground">{run.summary}</div>}
                  {run.modelResolution && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t('harness.runs.modelResolution', {
                        provider: run.modelResolution.provider,
                        lane: run.modelResolution.lane,
                        mode: run.modelResolution.resolvedMode,
                      })}
                      {run.modelResolution.resolvedModel ? ` / ${run.modelResolution.resolvedModel}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionHeading
                title={t('harness.sections.benchmark.title')}
                helpContent={
                  <>
                    {t('harness.sections.benchmark.helpLine1')}
                    <br />
                    {t('harness.sections.benchmark.helpLine2')}
                  </>
                }
              />
              <div className="flex gap-2">
                <SmallButton
                  actionKey="eval:seed"
                  loadingKey={gateActionLoading}
                  label={t('harness.actions.createSeedDataset')}
                  helpContent={
                    <>
                      {t('harness.help.seedDatasetLine1')}
                      <br />
                      {t('harness.help.seedDatasetLine2')}
                    </>
                  }
                  onClick={() => void handleSeedEvalDataset()}
                />
                <SmallButton
                  actionKey="eval:run"
                  loadingKey={gateActionLoading}
                  label={t('harness.actions.runSeedEval')}
                  helpContent={
                    <>
                      {t('harness.help.runSeedEvalLine1')}
                      <br />
                      {t('harness.help.runSeedEvalLine2')}
                    </>
                  }
                  onClick={() => void handleRunSeedEval()}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {t('harness.benchmark.datasetSummary', {
                datasets: evalDatasets.length,
                results: evalResults.length,
              })}
            </div>
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-semibold text-muted-foreground" htmlFor="harness-eval-dataset-select">
                {t('harness.benchmark.currentDataset')}
              </label>
              <select
                id="harness-eval-dataset-select"
                value={selectedEvalDatasetId || ''}
                onChange={(event) => setSelectedEvalDatasetId(event.target.value || null)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {!evalDatasets.length && <option value="">{t('harness.benchmark.noDataset')}</option>}
                {evalDatasets.map((dataset) => (
                  <option key={dataset.datasetId} value={dataset.datasetId}>
                    {dataset.name} ({dataset.provider})
                  </option>
                ))}
              </select>
              {selectedEvalDataset && (
                <div className="text-xs text-muted-foreground">
                  {t('harness.benchmark.datasetId', { value: selectedEvalDataset.datasetId })}
                </div>
              )}
            </div>
            {evalSummary && (
              <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                <StatusCard label={t('harness.benchmark.rounds')} value={String(evalSummary.totalResults)} />
                <StatusCard label={t('harness.benchmark.m19Gate')} value={translateHarnessValue(evalSummary.thresholds.m19Met ? 'met' : 'not_met')} />
                <StatusCard label={t('harness.benchmark.m20Gate')} value={translateHarnessValue(evalSummary.thresholds.m20Met ? 'met' : 'not_met')} />
                <StatusCard label={t('harness.benchmark.m21Gate')} value={translateHarnessValue(evalSummary.thresholds.m21Met ? 'met' : 'not_met')} />
                <StatusCard label={t('harness.benchmark.direction')} value={translateHarnessValue(evalSummary.directionConsistencyMet ? 'consistent' : 'pending')} />
                <StatusCard label={t('harness.benchmark.claim')} value={translateHarnessValue(evalSummary.claimEligible ? 'eligible' : 'not_ready')} />
              </div>
            )}
            <div className="mt-3 space-y-2">
              {recentEvalResults.length === 0 && <div className="text-sm text-muted-foreground">{t('harness.benchmark.empty')}</div>}
              {recentEvalResults.map((result) => (
                <div key={result.resultId} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="font-medium">{result.benchmarkName}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{result.provider}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{result.roundLabel}</span>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-5">
                    <StatusCard label="M19" value={formatPercent(result.metrics.m19)} />
                    <StatusCard label="M20" value={formatPercent(result.metrics.m20)} />
                    <StatusCard label="M21" value={String(result.metrics.m21)} />
                    <StatusCard label="M22" value={formatPercent(result.metrics.m22)} />
                    <StatusCard label="M24" value={formatPercent(result.metrics.m24)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionHeading
                title={t('harness.sections.checkpoint.title')}
                helpContent={
                  <>
                    {t('harness.sections.checkpoint.helpLine1')}
                    <br />
                    {t('harness.sections.checkpoint.helpLine2')}
                  </>
                }
              />
              <SmallButton
                actionKey="checkpoint:create"
                loadingKey={gateActionLoading}
                label={t('harness.actions.createCheckpoint')}
                helpContent={t('harness.help.createCheckpoint')}
                onClick={() => void handleCreateCheckpoint()}
              />
            </div>
            {recentCheckpoints.length === 0 && <div className="text-sm text-muted-foreground">{t('harness.checkpoint.empty')}</div>}
            <div className="space-y-2">
              {recentCheckpoints.map((checkpoint) => (
                <div key={checkpoint.checkpointId} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="font-medium">{checkpoint.checkpointId}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{checkpoint.snapshot.task.currentStage}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{checkpoint.reason} / {checkpoint.createdAt}</div>
                  <div className="mt-2">
                    <SmallButton
                      actionKey={`checkpoint:${checkpoint.checkpointId}`}
                      loadingKey={gateActionLoading}
                      label={t('harness.actions.resume')}
                      onClick={() => void handleResumeCheckpoint(checkpoint.checkpointId)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionHeading
                title={t('harness.sections.feedback.title')}
                helpContent={
                  <>
                    {t('harness.sections.feedback.helpLine1')}
                    <br />
                    {t('harness.sections.feedback.helpLine2')}
                  </>
                }
              />
              <SmallButton
                actionKey="feedback:create"
                loadingKey={gateActionLoading}
                label={t('harness.actions.writeFeedback')}
                helpContent={t('harness.help.writeFeedback')}
                onClick={() => void handleWriteFeedback()}
              />
            </div>
            {recentFeedback.length === 0 && <div className="text-sm text-muted-foreground">{t('harness.feedback.empty')}</div>}
            <div className="space-y-2">
              {recentFeedback.map((record) => (
                <div key={record.feedbackId} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="font-medium">{record.title}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{translateHarnessValue(record.targetLayer)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{record.relativePath}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionHeading
                title={t('harness.sections.bootstrap.title')}
                helpContent={
                  <>
                    {t('harness.sections.bootstrap.helpLine1')}
                    <br />
                    {t('harness.sections.bootstrap.helpLine2')}
                  </>
                }
              />
              <SmallButton
                actionKey="bootstrap:init"
                loadingKey={gateActionLoading}
                label={t('harness.actions.initProject')}
                helpContent={t('harness.help.initProject')}
                onClick={() => void handleBootstrap()}
              />
            </div>
            {!bootstrapResult && (
              <div className="text-sm text-muted-foreground">
                {t('harness.bootstrap.empty')}
              </div>
            )}
            {bootstrapResult && (
              <div className="space-y-2">
                <StatusCard label={t('harness.labels.harnessAvailability')} value={translateHarnessValue(bootstrapResult.harnessAvailability)} />
                <StatusCard label={t('harness.bootstrap.createdFilesCount')} value={String(bootstrapResult.createdFiles.length)} />
                <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                  {bootstrapResult.createdFiles.join(', ') || t('harness.values.no_new_files')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function HelpHint({ content }: { content: ReactNode }) {
  const { t } = useTranslation('chat');
  return (
    <Tooltip
      content={content}
      className="max-w-xs whitespace-normal px-3 py-2 text-left text-[12px] leading-5"
    >
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition hover:bg-accent/40 hover:text-foreground"
        aria-label={t('harness.helpAriaLabel')}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

function SectionHeading({
  title,
  helpContent,
}: {
  title: string;
  helpContent: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <HelpHint content={helpContent} />
    </div>
  );
}

function StatusCard({
  label,
  value,
  monospace = false,
  wrapValue = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  wrapValue?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-sm font-medium text-foreground ${monospace ? 'font-mono' : ''} ${
          wrapValue ? 'break-all whitespace-normal leading-5' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SmallButton({
  actionKey,
  loadingKey,
  label,
  helpContent,
  onClick,
}: {
  actionKey: string;
  loadingKey: string | null;
  label: string;
  helpContent?: ReactNode;
  onClick: () => void;
}) {
  const { t } = useTranslation('chat');
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={Boolean(loadingKey)}
        className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300"
      >
        {loadingKey === actionKey ? t('harness.actions.processing') : label}
      </button>
      {helpContent ? <HelpHint content={helpContent} /> : null}
    </div>
  );
}

function ActionGroup({
  title,
  loadingKey,
  actions,
}: {
  title: string;
  loadingKey: string | null;
  actions: Array<{ key: string; label: string; onClick: () => void }>;
}) {
  const { t } = useTranslation('chat');
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            disabled={Boolean(loadingKey)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingKey === action.key ? t('harness.actions.processing') : action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
