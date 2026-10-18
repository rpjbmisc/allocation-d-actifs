import { normalizeWeights } from "./constraints";
import { alignAnnualSeries } from "./data";
import type { Row, Mode, Stats } from "./types";
import { returnValue } from "./returns";
export function geometricMean(values: number[]): number | null {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < -100)) return null;
  if (values.includes(-100)) return -100;
  return Math.expm1(values.reduce((sum, value) => sum + Math.log1p(value / 100), 0) / values.length) * 100;
}

export function volatility(values: number[]): number {
  if (values.length < 2 || values.some(value => !Number.isFinite(value))) return Number.NaN;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length);
}

export function cagr(start: number, end: number, years: number): number | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isInteger(years) || !(start > 0) || end < 0 || years <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

export function computeStats(rows: Row[], start: number, end: number, mode: Mode): Stats | null {
  const aligned = alignAnnualSeries({ asset: rows }, ["asset"], start, end, mode);
  if (!aligned.ok) return null;
  const values = aligned.years.map(year => aligned.rowsByAsset.asset.get(year)!);
  const nominalWindow = alignAnnualSeries({ asset: rows }, ["asset"], start, end, "nominal");
  const realWindow = alignAnnualSeries({ asset: rows }, ["asset"], start, end, "real");
  const nominal = nominalWindow.ok ? nominalWindow.years.map(year => nominalWindow.rowsByAsset.asset.get(year)!.nominal) : [];
  const real = realWindow.ok ? realWindow.years.map(year => realWindow.rowsByAsset.asset.get(year)!.real) : [];

  const volatilityValue = volatility(values.map((row) => returnValue(row, mode) as number));
  const sorted = [...values].sort((a, b) => (returnValue(b, mode) as number) - (returnValue(a, mode) as number));

  return {
    count: values.length,
    cagrNominal: geometricMean(nominal),
    cagrReal: geometricMean(real),
    volatility: volatilityValue,
    positiveRate: values.filter((row) => (returnValue(row, mode) as number) > 0).length / values.length * 100,
    best: sorted[0] ?? null,
    worst: sorted[sorted.length - 1] ?? null,
    best5: sorted.slice(0, 5),
    worst5: sorted.slice(-5).reverse(),
  };
}


/** Descriptive weight × individual CAGR only, never an additive portfolio attribution. */
export function weightedCagrDiagnostics(stats: Record<string, Stats | null>, weights: Record<string, number>, mode: Mode): Record<string, { weight: number; contribution: number | null }> {
  const normalized = normalizeWeights(weights);
  return Object.fromEntries(Object.keys(weights).map(id => {
    const weight = normalized ? normalized[id] * 100 : 0;
    const value = mode === "nominal" ? stats[id]?.cagrNominal : stats[id]?.cagrReal;
    return [id, { weight, contribution: normalized && value !== null && value !== undefined ? weight / 100 * value : null }];
  }));
}
