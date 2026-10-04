/**
 * Distance to the workplace, for display only (enabling the Check in button and showing
 * "about N m away"). The server recomputes the distance itself and decides; nothing computed
 * here is ever sent as a verdict.
 */
import type { Workplace } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dphi = rad(lat2 - lat1);
  const dlmb = rad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dlmb / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
  at: number;
}

export type GeoVerdict =
  | { kind: "not-required" }
  | { kind: "unknown" }
  | { kind: "imprecise"; distance: number; accuracy: number }
  | { kind: "inside"; distance: number }
  | { kind: "outside"; distance: number };

/** Mirrors the server's check-in rule: precise enough, and distance <= radius (boundary inside). */
export function checkInVerdict(workplace: Workplace | undefined, fix: Fix | null): GeoVerdict {
  if (!workplace?.configured || workplace.latitude === null || workplace.longitude === null) return { kind: "not-required" };
  if (!fix) return { kind: "unknown" };
  const distance = haversineM(fix.latitude, fix.longitude, workplace.latitude, workplace.longitude);
  if (fix.accuracy > workplace.max_accuracy_m) return { kind: "imprecise", distance, accuracy: fix.accuracy };
  return distance <= workplace.radius_m ? { kind: "inside", distance } : { kind: "outside", distance };
}
