import * as SQLite from 'expo-sqlite';
import { RunPoint, RunRecord, RunStatus } from './types';

const DB_NAME = 'run_tracker.db';
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const nowMs = (): number => Date.now();

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          duration_ms INTEGER NOT NULL,
          total_distance_m REAL NOT NULL,
          avg_pace REAL NOT NULL,
          avg_speed REAL NOT NULL,
          status TEXT NOT NULL,
          sport TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
        CREATE TABLE IF NOT EXISTS run_points (
          id TEXT PRIMARY KEY NOT NULL,
          run_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy REAL NOT NULL,
          altitude REAL,
          speed REAL,
          heading REAL
        );
        CREATE INDEX IF NOT EXISTS idx_run_points_run_id_timestamp ON run_points(run_id, timestamp ASC);
      `);
      return db;
    })();
  }
  return dbPromise;
}

const rowToRun = (row: any): RunRecord => ({
  id: row.id,
  startedAt: Number(row.started_at),
  endedAt: row.ended_at == null ? null : Number(row.ended_at),
  durationMs: Number(row.duration_ms),
  totalDistanceM: Number(row.total_distance_m),
  avgPace: Number(row.avg_pace),
  avgSpeed: Number(row.avg_speed),
  status: row.status as RunStatus,
  sport: row.sport,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

const rowToPoint = (row: any): RunPoint => ({
  id: row.id,
  runId: row.run_id,
  timestamp: Number(row.timestamp),
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  accuracy: Number(row.accuracy),
  altitude: row.altitude == null ? null : Number(row.altitude),
  speed: row.speed == null ? null : Number(row.speed),
  heading: row.heading == null ? null : Number(row.heading),
});

export async function createRun(run: RunRecord): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO runs (id, started_at, ended_at, duration_ms, total_distance_m, avg_pace, avg_speed, status, sport, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    run.id,
    run.startedAt,
    run.endedAt,
    run.durationMs,
    run.totalDistanceM,
    run.avgPace,
    run.avgSpeed,
    run.status,
    run.sport,
    run.createdAt,
    run.updatedAt,
  );
}

export async function updateRun(
  runId: string,
  patch: Partial<Pick<RunRecord, 'endedAt' | 'durationMs' | 'totalDistanceM' | 'avgPace' | 'avgSpeed' | 'status'>>,
): Promise<void> {
  const db = await getDb();
  const updatedAt = nowMs();
  await db.runAsync(
    `UPDATE runs
     SET ended_at = COALESCE(?, ended_at),
         duration_ms = COALESCE(?, duration_ms),
         total_distance_m = COALESCE(?, total_distance_m),
         avg_pace = COALESCE(?, avg_pace),
         avg_speed = COALESCE(?, avg_speed),
         status = COALESCE(?, status),
         updated_at = ?
     WHERE id = ?`,
    patch.endedAt ?? null,
    patch.durationMs ?? null,
    patch.totalDistanceM ?? null,
    patch.avgPace ?? null,
    patch.avgSpeed ?? null,
    patch.status ?? null,
    updatedAt,
    runId,
  );
}

export async function getRun(runId: string): Promise<RunRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>('SELECT * FROM runs WHERE id = ? LIMIT 1', runId);
  return row ? rowToRun(row) : null;
}

export async function getActiveRun(): Promise<RunRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    "SELECT * FROM runs WHERE status IN ('active', 'paused') ORDER BY started_at DESC LIMIT 1",
  );
  return row ? rowToRun(row) : null;
}

export async function listFinishedRuns(): Promise<RunRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>("SELECT * FROM runs WHERE status = 'finished' ORDER BY started_at DESC");
  return rows.map(rowToRun);
}

export async function deleteFinishedRuns(runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;
  const db = await getDb();
  for (const runId of runIds) {
    await db.runAsync('DELETE FROM run_points WHERE run_id = ?', runId);
    await db.runAsync("DELETE FROM runs WHERE id = ? AND status = 'finished'", runId);
  }
}

export async function insertRunPoint(point: RunPoint): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO run_points (id, run_id, timestamp, latitude, longitude, accuracy, altitude, speed, heading)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    point.id,
    point.runId,
    point.timestamp,
    point.latitude,
    point.longitude,
    point.accuracy,
    point.altitude,
    point.speed,
    point.heading,
  );
}

export async function getLastRunPoint(runId: string): Promise<RunPoint | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM run_points WHERE run_id = ? ORDER BY timestamp DESC LIMIT 1',
    runId,
  );
  return row ? rowToPoint(row) : null;
}

export async function listRunPoints(runId: string): Promise<RunPoint[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM run_points WHERE run_id = ? ORDER BY timestamp ASC',
    runId,
  );
  return rows.map(rowToPoint);
}
