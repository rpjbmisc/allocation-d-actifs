import type { Row, Mode } from "./types";
import { computePortfolio } from "./portfolio";
import { computeStats } from "./metrics";

/** Chart trajectories obey the same continuity policy as portfolio simulation. */
export function computeGrowthData(data: Record<string, Row[]>, ids: string[], start: number, end: number, mode: Mode): Record<string, number | null>[] {
  const trajectories = Object.fromEntries(ids.map(id => [id, computePortfolio(data, { [id]: 100 }, start, end, mode)]));
  const firstYear = Math.min(...ids.flatMap(id => trajectories[id]?.points[0]?.year ?? []));
  if (!Number.isFinite(firstYear)) return [];
  const maps = Object.fromEntries(ids.map(id => {
    const points = trajectories[id]?.points ?? [];
    return [id, new Map<number, number>(points.length ? [[points[0].year - 1, 100], ...points.map(p => [p.year, Math.round(p.value * 10) / 10] as [number, number])] : [])];
  }));
  return Array.from({ length: end - firstYear + 2 }, (_, i) => ({ year: firstYear - 1 + i,
    ...Object.fromEntries(ids.map(id => [id, maps[id].get(firstYear - 1 + i) ?? null])) }));
}

export function computeDecadeData(data: Record<string, Row[]>, ids: string[], start: number, end: number, mode: Mode): Record<string, number | string | null>[] {
  if (start > end) return [];
  const decades = Array.from({ length: Math.floor(end / 10) - Math.floor(start / 10) + 1 }, (_, i) => (Math.floor(start / 10) + i) * 10);
  return decades.map(decade => ({ decade: `${decade}s`, ...Object.fromEntries(ids.map(id => {
    const stats = computeStats(data[id] ?? [], Math.max(start, decade), Math.min(end, decade + 9), mode);
    return [id, mode === "nominal" ? stats?.cagrNominal ?? null : stats?.cagrReal ?? null];
  })) }));
}
