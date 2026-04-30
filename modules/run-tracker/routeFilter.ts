import { RunPoint } from './types';

export const FILTER_MAX_ACCURACY_M = 40;
export const FILTER_MIN_MOVE_M = 3;
export const FILTER_MAX_TELEPORT_SPEED_MPS = 9.5; // ~34 km/h for running use-cases
export const FILTER_RELAXED_MAX_ACCURACY_M = 80;
export const FILTER_RELAXED_MIN_MOVE_M = 5;
export const FILTER_RELAXED_AFTER_GAP_SEC = 12;

const earthRadiusM = 6371000;

const toRad = (value: number): number => (value * Math.PI) / 180;

export const calculateDistanceM = (from: RunPoint, to: RunPoint): number => {
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
};

export const shouldAcceptPoint = (
  previous: RunPoint | null,
  candidate: RunPoint,
): { accept: boolean; distanceM: number } => {
  if (!Number.isFinite(candidate.accuracy)) {
    return { accept: false, distanceM: 0 };
  }
  if (!previous) return { accept: true, distanceM: 0 };

  const distanceM = calculateDistanceM(previous, candidate);
  if (!Number.isFinite(distanceM)) return { accept: false, distanceM: 0 };

  const dtSec = Math.max((candidate.timestamp - previous.timestamp) / 1000, 0.001);
  const relaxed = dtSec >= FILTER_RELAXED_AFTER_GAP_SEC;
  const maxAccuracy = relaxed ? FILTER_RELAXED_MAX_ACCURACY_M : FILTER_MAX_ACCURACY_M;
  if (candidate.accuracy > maxAccuracy) {
    return { accept: false, distanceM: 0 };
  }

  const minMoveM = relaxed ? FILTER_RELAXED_MIN_MOVE_M : FILTER_MIN_MOVE_M;
  if (distanceM < minMoveM) {
    return { accept: false, distanceM: 0 };
  }

  const speedMps = distanceM / dtSec;
  if (speedMps > FILTER_MAX_TELEPORT_SPEED_MPS) {
    return { accept: false, distanceM: 0 };
  }

  return { accept: true, distanceM };
};
