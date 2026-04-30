import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { listRunPoints, listFinishedRuns } from './db';
import { ensureRunTrackingPermissions } from './permissions';
import {
  deleteFinishedRunHistory,
  ensureRunTrackingIsAlive,
  finishRunSession,
  pauseRunSession,
  readActiveRunSnapshot,
  resumeRunSession,
  startRunSession,
} from './trackingEngine';
import { RunRecord, RunSport, RunPoint } from './types';

const LIVE_REFRESH_MS = 1200;

export function useActiveRunSession() {
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null);
  const [activePoints, setActivePoints] = useState<RunPoint[]>([]);
  const [historyRuns, setHistoryRuns] = useState<RunRecord[]>([]);
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<RunRecord | null>(null);
  const [selectedHistoryPoints, setSelectedHistoryPoints] = useState<RunPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const snapshot = await readActiveRunSnapshot();
    setActiveRun(snapshot?.run ?? null);
    setActivePoints(snapshot?.points ?? []);
    return snapshot;
  }, []);

  const refreshHistory = useCallback(async () => {
    const runs = await listFinishedRuns();
    setHistoryRuns(runs);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    refreshHistory().catch(() => {});
  }, [refresh, refreshHistory]);

  useEffect(() => {
    const id = setInterval(() => {
      refresh().catch(() => {});
    }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refresh()
        .then((snapshot) => ensureRunTrackingIsAlive(snapshot?.run ?? null))
        .catch(() => {});
    });
    return () => sub.remove();
  }, [refresh]);

  const start = useCallback(async (sport: RunSport) => {
    if (loading) return;
    setLoading(true);
    try {
      const granted = await ensureRunTrackingPermissions();
      if (!granted) return;
      await startRunSession(sport);
      const snapshot = await refresh();
      await ensureRunTrackingIsAlive(snapshot?.run ?? null);
    } finally {
      setLoading(false);
    }
  }, [loading, refresh]);

  const pause = useCallback(async () => {
    if (!activeRun || activeRun.status !== 'active') return;
    try {
      await pauseRunSession(activeRun.id);
      await refresh();
    } catch {
      Alert.alert('Kunde inte pausa', 'Nagot gick fel nar passet skulle pausas.');
    }
  }, [activeRun, refresh]);

  const resume = useCallback(async () => {
    if (!activeRun || activeRun.status !== 'paused') return;
    try {
      await resumeRunSession(activeRun.id);
      const snapshot = await refresh();
      await ensureRunTrackingIsAlive(snapshot?.run ?? null);
    } catch {
      Alert.alert('Kunde inte ateruppta', 'Nagot gick fel nar passet skulle aterupptas.');
    }
  }, [activeRun, refresh]);

  const finish = useCallback(async () => {
    if (!activeRun) return;
    try {
      await finishRunSession(activeRun.id);
      await refresh();
      await refreshHistory();
    } catch {
      Alert.alert('Kunde inte avsluta passet', 'Nagot gick fel. Forsok igen om en stund.');
    }
  }, [activeRun, refresh, refreshHistory]);

  const openHistoryRun = useCallback(async (run: RunRecord) => {
    setSelectedHistoryRun(run);
    try {
      const points = await listRunPoints(run.id);
      setSelectedHistoryPoints(points);
    } catch {
      setSelectedHistoryPoints([]);
    }
  }, []);

  const clearHistorySelection = useCallback(() => {
    setSelectedHistoryRun(null);
    setSelectedHistoryPoints([]);
  }, []);

  const deleteHistoryRuns = useCallback(async (runIds: string[]) => {
    if (runIds.length === 0) return;
    await deleteFinishedRunHistory(runIds);
    if (selectedHistoryRun && runIds.includes(selectedHistoryRun.id)) {
      setSelectedHistoryRun(null);
      setSelectedHistoryPoints([]);
    }
    await refreshHistory();
  }, [refreshHistory, selectedHistoryRun]);

  const activeStats = useMemo(() => {
    if (!activeRun) return null;
    const now = Date.now();
    const durationMs = Math.max(activeRun.durationMs, now - activeRun.startedAt);
    const speed = activeRun.avgSpeed;
    const pace = activeRun.avgPace;
    return {
      durationMs,
      distanceM: activeRun.totalDistanceM,
      avgSpeedMps: speed,
      avgPaceSecPerKm: pace,
      currentSpeedMps: speed,
      currentPaceSecPerKm: pace,
    };
  }, [activeRun]);

  return {
    activeRun,
    activePoints,
    activeStats,
    historyRuns,
    selectedHistoryRun,
    selectedHistoryPoints,
    loading,
    start,
    pause,
    resume,
    finish,
    openHistoryRun,
    clearHistorySelection,
    deleteHistoryRuns,
    refreshHistory,
  };
}
