import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import {
  createRun,
  deleteFinishedRuns,
  getActiveRun,
  getLastRunPoint,
  getRun,
  insertRunPoint,
  listRunPoints,
  updateRun,
} from './db';
import { shouldAcceptPoint } from './routeFilter';
import { RunPoint, RunRecord, RunSport } from './types';

export const RUN_TRACKING_TASK = 'naphab_run_tracking_v2';

const pointId = (): string => `pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const runId = (): string => `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const speedToPaceSecPerKm = (mps: number): number => {
  if (mps <= 0) return 0;
  return 1000 / mps;
};

const RUN_LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  distanceInterval: 1,
  timeInterval: 1000,
  deferredUpdatesInterval: 0,
  deferredUpdatesDistance: 0,
  activityType: Location.ActivityType.Fitness,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'Lopprunda pagar',
    notificationBody: 'Hogprecision GPS-spårning ar aktiv.',
    notificationColor: '#4CAF50',
    // Keep location service alive if app process is recreated.
    killServiceOnDestroy: false,
  },
};

const toRunPoint = (runIdValue: string, location: Location.LocationObject): RunPoint => ({
  id: pointId(),
  runId: runIdValue,
  timestamp: location.timestamp,
  latitude: location.coords.latitude,
  longitude: location.coords.longitude,
  accuracy: location.coords.accuracy ?? 999,
  altitude: location.coords.altitude ?? null,
  speed: location.coords.speed ?? null,
  heading: location.coords.heading ?? null,
});

async function persistAcceptedPoint(run: RunRecord, point: RunPoint): Promise<RunRecord> {
  try {
    const last = await getLastRunPoint(run.id);
    const filter = shouldAcceptPoint(last, point);
    if (!filter.accept) return run;
    await insertRunPoint(point);
    const now = Date.now();
    const durationMs = Math.max(0, now - run.startedAt);
    const totalDistanceM = Math.max(0, run.totalDistanceM + filter.distanceM);
    const avgSpeed = durationMs > 0 ? totalDistanceM / (durationMs / 1000) : 0;
    const avgPace = speedToPaceSecPerKm(avgSpeed);
    await updateRun(run.id, {
      durationMs,
      totalDistanceM,
      avgSpeed,
      avgPace,
    });
    return {
      ...run,
      durationMs,
      totalDistanceM,
      avgSpeed,
      avgPace,
      updatedAt: now,
    };
  } catch {
    // Never crash the tracking task because a single point failed to persist.
    return run;
  }
}

if (!TaskManager.isTaskDefined(RUN_TRACKING_TASK)) {
  TaskManager.defineTask(RUN_TRACKING_TASK, async ({ data, error }) => {
    try {
      if (error) return;
      const activeRun = await getActiveRun();
      if (!activeRun || activeRun.status !== 'active') return;
      const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
      if (!Array.isArray(locations) || locations.length === 0) return;
      let evolvingRun = activeRun;
      for (const location of locations) {
        evolvingRun = await persistAcceptedPoint(evolvingRun, toRunPoint(evolvingRun.id, location));
      }
    } catch {
      // Ignore background task errors to keep process alive and keep tracking on next update.
    }
  });
}

async function ensureLocationUpdatesStarted(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(RUN_TRACKING_TASK);
  if (started) return;
  await Location.startLocationUpdatesAsync(RUN_TRACKING_TASK, RUN_LOCATION_OPTIONS);
}

export async function startRunSession(sport: RunSport): Promise<RunRecord> {
  const now = Date.now();
  const run: RunRecord = {
    id: runId(),
    startedAt: now,
    endedAt: null,
    durationMs: 0,
    totalDistanceM: 0,
    avgPace: 0,
    avgSpeed: 0,
    status: 'active',
    sport,
    createdAt: now,
    updatedAt: now,
  };
  await createRun(run);
  try {
    const immediate = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });
    await persistAcceptedPoint(run, toRunPoint(run.id, immediate));
  } catch {
    // First GPS fix can fail briefly when starting indoors.
  }
  await ensureLocationUpdatesStarted();
  return (await getRun(run.id)) ?? run;
}

export async function pauseRunSession(runIdValue: string): Promise<void> {
  await updateRun(runIdValue, { status: 'paused' });
  if (await Location.hasStartedLocationUpdatesAsync(RUN_TRACKING_TASK)) {
    await Location.stopLocationUpdatesAsync(RUN_TRACKING_TASK);
  }
}

export async function resumeRunSession(runIdValue: string): Promise<void> {
  await updateRun(runIdValue, { status: 'active' });
  await ensureLocationUpdatesStarted();
}

export async function finishRunSession(runIdValue: string): Promise<RunRecord | null> {
  const existing = await getRun(runIdValue);
  if (!existing) return null;

  let run = existing;
  if (run.status === 'active') {
    try {
      // Capture one final fix before stopping updates to reduce missing tail distance.
      const immediate = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      run = await persistAcceptedPoint(run, toRunPoint(run.id, immediate));
    } catch {
      // Best-effort only; finishing should still succeed.
    }
  }

  if (await Location.hasStartedLocationUpdatesAsync(RUN_TRACKING_TASK)) {
    await Location.stopLocationUpdatesAsync(RUN_TRACKING_TASK);
  }
  run = (await getRun(runIdValue)) ?? run;
  const now = Date.now();
  const durationMs = Math.max(0, now - run.startedAt);
  const avgSpeed = durationMs > 0 ? run.totalDistanceM / (durationMs / 1000) : 0;
  const avgPace = speedToPaceSecPerKm(avgSpeed);
  await updateRun(run.id, {
    status: 'finished',
    endedAt: now,
    durationMs,
    avgSpeed,
    avgPace,
  });
  return getRun(runIdValue);
}

export async function readActiveRunSnapshot(): Promise<{ run: RunRecord; points: RunPoint[] } | null> {
  const run = await getActiveRun();
  if (!run) return null;
  const points = await listRunPoints(run.id);
  return { run, points };
}

export async function deleteFinishedRunHistory(runIds: string[]): Promise<void> {
  await deleteFinishedRuns(runIds);
}

export async function ensureRunTrackingIsAlive(run: RunRecord | null): Promise<void> {
  if (!run) return;
  if (run.status !== 'active') return;
  await ensureLocationUpdatesStarted();
}
