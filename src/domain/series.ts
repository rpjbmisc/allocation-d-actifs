import type { Row, Mode } from "./types";
import { computePortfolio } from "./portfolio";
import { computeStats } from "./metrics";
import { assetAnalysisWindow } from "./data";

/** Each asset starts at 100 immediately before its first observed annual return.
 * Partial histories remain visible; non-overlapping years are null, not zero or interpolated. */
export function computeGrowthData(data: Record<string, Row[]>, ids: string[], start: number, end: number, mode: Mode): Record<string, number | null>[] {
  const trajectories = Object.fromEntries(ids.map(id => {
    const window = assetAnalysisWindow(data[id], start, end, mode);
    return [id, window ? computePortfolio(data, { [id]: 100 }, window[0], window[1], mode) : null];
  }));
  const baselines = ids.flatMap(id => trajectories[id]?.points.length ? [trajectories[id]!.points[0].year - 1] : []);
  if (!baselines.length) return [];
  const firstYear = Math.min(...baselines);
  const maps = Object.fromEntries(ids.map(id => {
    const points = trajectories[id]?.points ?? [];
    return [id, new Map<number, number>(points.length ? [[points[0].year - 1, 100], ...points.map(p => [p.year, Math.round(p.value * 10) / 10] as [number, number])] : [])];
  }));
  return Array.from({ length: end - firstYear + 1 }, (_, i) => ({ year: firstYear + i,
    ...Object.fromEntries(ids.map(id => [id, maps[id].get(firstYear + i) ?? null])) }));
}

export function computeDecadeData(data: Record<string, Row[]>, ids: string[], start: number, end: number, mode: Mode): Record<string, number | string | null>[] {
  if (start > end) return [];
  const decades = Array.from({ length: Math.floor(end / 10) - Math.floor(start / 10) + 1 }, (_, i) => (Math.floor(start / 10) + i) * 10);
  return decades.map(decade => ({ decade: `${decade}s`, ...Object.fromEntries(ids.map(id => {
    const window = assetAnalysisWindow(data[id], Math.max(start, decade), Math.min(end, decade + 9), mode);
    const stats = window ? computeStats(data[id], window[0], window[1], mode) : null;
    return [id, mode === "nominal" ? stats?.cagrNominal ?? null : stats?.cagrReal ?? null];
  })) }));
}
