export type RunStatus = 'active' | 'paused' | 'finished';
export type RunSport = 'run' | 'cycle' | 'walk';

export type RunPoint = {
  id: string;
  runId: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
};

export type RunRecord = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  totalDistanceM: number;
  avgPace: number;
  avgSpeed: number;
  status: RunStatus;
  sport: RunSport;
  createdAt: number;
  updatedAt: number;
};

export type ActiveRunSnapshot = {
  run: RunRecord;
  points: RunPoint[];
  currentPace: number;
  currentSpeed: number;
};
