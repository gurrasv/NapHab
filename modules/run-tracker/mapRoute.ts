import { RunPoint } from './types';

export type LineStringFeature = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
};

export const toLineStringFeature = (points: RunPoint[]): LineStringFeature => ({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: points.map((point) => [point.longitude, point.latitude] as [number, number]),
  },
});

export const getRouteBounds = (points: RunPoint[]): [[number, number], [number, number]] | null => {
  if (points.length === 0) return null;
  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLon = points[0].longitude;
  let maxLon = points[0].longitude;
  points.forEach((point) => {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLon = Math.min(minLon, point.longitude);
    maxLon = Math.max(maxLon, point.longitude);
  });
  return [[minLon, minLat], [maxLon, maxLat]];
};
