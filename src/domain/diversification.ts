import { alignAnnualSeries } from "./data";
import { normalizeWeights } from "./constraints";
import type { Row, Mode, CorrelationCell, PortfolioStats } from "./types";
import { returnValue } from "./returns";
import { volatility } from "./metrics";
export function computeCorrelationMatrix(
  data: Record<string, Row[]>,
  assetIds: string[],
  start: number,
  end: number,
  mode: Mode,
): Record<string, Record<string, number | null>> {
  const details = computeCorrelationDetails(data, assetIds, start, end, mode);
  return Object.fromEntries(assetIds.map((leftId) => [
    leftId,
    Object.fromEntries(assetIds.map((rightId) => [rightId, details[leftId]?.[rightId]?.value ?? null])),
  ]));
}

export function computeCorrelationDetails(
  data: Record<string, Row[]>,
  assetIds: string[],
  start: number,
  end: number,
  mode: Mode,
): Record<string, Record<string, CorrelationCell>> {
  const series = Object.fromEntries(assetIds.map((id) => {
    const source = data[id] ?? [];
    const valid = source.every((row, i) => Number.isInteger(row.year) && (i === 0 || row.year > source[i - 1].year));
    const rows = (valid ? source : []).filter((row) => row.year >= start && row.year <= end && returnValue(row, mode) !== null);
    return [id, new Map(rows.map((row) => [row.year, returnValue(row, mode) as number]))];
  }));

  return Object.fromEntries(assetIds.map((leftId) => [leftId, Object.fromEntries(assetIds.map((rightId) => {
    const sharedYears = [...series[leftId].keys()].filter((year) => series[rightId].has(year));
    if (sharedYears.length < 2) return [rightId, { value: null, observations: sharedYears.length }];
    const leftValues = sharedYears.map((year) => series[leftId].get(year) as number);
    const rightValues = sharedYears.map((year) => series[rightId].get(year) as number);
    const leftMean = leftValues.reduce((sum, value) => sum + value, 0) / leftValues.length;
    const rightMean = rightValues.reduce((sum, value) => sum + value, 0) / rightValues.length;
    const numerator = sharedYears.reduce((sum, _, index) => sum + (leftValues[index] - leftMean) * (rightValues[index] - rightMean), 0);
    const leftDeviation = Math.sqrt(leftValues.reduce((sum, value) => sum + Math.pow(value - leftMean, 2), 0));
    const rightDeviation = Math.sqrt(rightValues.reduce((sum, value) => sum + Math.pow(value - rightMean, 2), 0));
    return [rightId, {
      value: leftDeviation && rightDeviation ? numerator / (leftDeviation * rightDeviation) : null,
      observations: sharedYears.length,
    }];
  }))]));
}

/** Diagnostics use the same contiguous observations for every active asset.
 * Pairwise display correlations above are descriptive and never used as a covariance matrix. */
export function computeDiversificationMetrics(
  data: Record<string, Row[]>, assetIds: string[], weights: Record<string, number>,
  portfolio: PortfolioStats | null, start: number, end: number, mode: Mode,
): { weightedCorrelation: number | null; diversificationRatio: number | null } {
  const unavailable = { weightedCorrelation: null, diversificationRatio: null };
  const normalized = normalizeWeights(weights);
  if (!normalized || !portfolio) return unavailable;
  const ids = assetIds.filter(id => normalized[id] > 0);
  if (Object.keys(normalized).some(id => normalized[id] > 0 && !ids.includes(id))) return unavailable;
  const aligned = alignAnnualSeries(data, ids, start, end, mode);
  if (!aligned.ok || aligned.years.length < 2 || aligned.years.length !== portfolio.points.length ||
    aligned.years.some((year, i) => portfolio.points[i].year !== year)) return unavailable;
  const series = Object.fromEntries(ids.map(id => [id, aligned.years.map(year => aligned.rowsByAsset[id].get(year)![mode])]));
  const sigmas = Object.fromEntries(ids.map(id => [id, volatility(series[id])]));
  let numerator = 0, denominator = 0;
  for (const left of ids) for (const right of ids) {
    if (left === right || !(sigmas[left] > 0 && sigmas[right] > 0)) continue;
    const pairWeight = normalized[left] * normalized[right];
    numerator += pairWeight * covariance(series[left], series[right]) / (sigmas[left] * sigmas[right]);
    denominator += pairWeight;
  }
  // Covariance includes the diagonal; only the between-asset diagnostic excludes it.
  const portfolioReturns = aligned.years.map((_, i) => ids.reduce((sum, id) => sum + normalized[id] * series[id][i], 0));
  const sigmaPortfolio = volatility(portfolioReturns);
  return {
    weightedCorrelation: denominator > 0 ? Math.max(-1, Math.min(1, numerator / denominator)) : null,
    diversificationRatio: sigmaPortfolio > 0 ? ids.reduce((sum, id) => sum + normalized[id] * sigmas[id], 0) / sigmaPortfolio : null,
  };
}

/** Population covariance in squared percentage points, same common annual sample. */
export function covariance(left: number[], right: number[]): number {
  if (left.length < 2 || left.length !== right.length || [...left, ...right].some(v => !Number.isFinite(v))) return Number.NaN;
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const a = mean(left), b = mean(right);
  return left.reduce((sum, value, i) => sum + (value - a) * (right[i] - b), 0) / left.length;
}
