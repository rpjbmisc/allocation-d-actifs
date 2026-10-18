import { alignAnnualSeries } from "../domain/data";
// Legacy deterministic grid; strategy replacement belongs to phase 2.
import type { Row, Mode, PortfolioStats, PortfolioCandidate, PortfolioWindow, PortfolioOptimizationResults } from "../domain/types";
import { computePortfolio } from "../domain/portfolio";
import { computeDiversificationMetrics } from "../domain/diversification";
export function searchPortfolioOptimizationProfiles(
  data: Record<string, Row[]>,
  assetIds: string[],
  start: number,
  end: number,
  mode: Mode,
  maxDrawdown: number,
  step = 5,
): PortfolioOptimizationResults {
  const emptyResults: PortfolioOptimizationResults = {
    returnCandidate: null,
    minimumDrawdownCandidate: null,
    moderateDiversificationCandidate: null,
    strongDiversificationCandidate: null,
  };
  if (!assetIds.length || new Set(assetIds).size !== assetIds.length || !Number.isFinite(step) || !Number.isFinite(maxDrawdown) || step <= 0 || 100 % step !== 0) return emptyResults;

  const aligned = alignAnnualSeries(data, assetIds, start, end, mode);
  if (!aligned.ok) return emptyResults;
  start = aligned.years[0];

  const results = { ...emptyResults };
  const minimumObservations = end - start + 1;

  const isBetterReturn = (candidate: PortfolioCandidate, current: PortfolioCandidate | null): boolean => {
    if (!current) return true;
    return (candidate.stats.cagr ?? -Infinity) > (current.stats.cagr ?? -Infinity)
      || ((candidate.stats.cagr ?? -Infinity) === (current.stats.cagr ?? -Infinity) && candidate.stats.volatility < current.stats.volatility);
  };
  const isBetterDrawdown = (candidate: PortfolioCandidate, current: PortfolioCandidate | null): boolean => {
    if (!current) return true;
    return candidate.stats.maxDrawdown > current.stats.maxDrawdown
      || (candidate.stats.maxDrawdown === current.stats.maxDrawdown && isBetterReturn(candidate, current));
  };

  const visit = (index: number, remaining: number, weights: Record<string, number>) => {
    if (index === assetIds.length - 1) {
      const nextWeights = { ...weights, [assetIds[index]]: remaining * step };
      const stats = computePortfolio(data, nextWeights, start, end, mode);
      // The first row can be a starting index without a return; reject shortened histories.
      if (!stats || stats.points.length < minimumObservations || stats.cagr === null) return;
      const baseCandidate: PortfolioCandidate = { weights: nextWeights, stats };

      if (isBetterDrawdown(baseCandidate, results.minimumDrawdownCandidate)) results.minimumDrawdownCandidate = baseCandidate;
      if (stats.maxDrawdown < -Math.abs(maxDrawdown)) return;
      const metrics = computeDiversificationMetrics(data, assetIds, nextWeights, stats, start, end, mode);
      const candidate: PortfolioCandidate = { ...baseCandidate, ...metrics };
      if (isBetterReturn(candidate, results.returnCandidate)) results.returnCandidate = candidate;

      const { weightedCorrelation: correlation, diversificationRatio: diversification } = metrics;
      if (correlation === null || diversification === null) return;
      if (correlation >= 0.2 && correlation <= 0.7 && diversification >= 1.2 && diversification <= 1.5
        && isBetterReturn(candidate, results.moderateDiversificationCandidate)) {
        results.moderateDiversificationCandidate = candidate;
      }
      if (correlation < 0.2 && diversification > 1.5
        && isBetterReturn(candidate, results.strongDiversificationCandidate)) {
        results.strongDiversificationCandidate = candidate;
      }
      return;
    }

    for (let units = 0; units <= remaining; units += 1) {
      visit(index + 1, remaining - units, { ...weights, [assetIds[index]]: units * step });
    }
  };

  visit(0, 100 / step, {});
  return results;
}

export function searchPortfolioCandidates(
  data: Record<string, Row[]>,
  assetIds: string[],
  start: number,
  end: number,
  mode: Mode,
  maxDrawdown: number | null,
  step = 5,
  limit = 5,
  objective: "cagr" | "minimumDrawdown" = "cagr",
  requiredAssetId?: string,
): PortfolioCandidate[] {
  if (!assetIds.length || !Number.isFinite(step) || step <= 0 || 100 % step !== 0 || (maxDrawdown !== null && !Number.isFinite(maxDrawdown))) return [];
  const aligned = alignAnnualSeries(data, assetIds, start, end, mode);
  if (!aligned.ok || !Number.isInteger(limit) || limit < 1 || (requiredAssetId && !assetIds.includes(requiredAssetId))) return [];
  start = aligned.years[0];
  const results: PortfolioCandidate[] = [];
  const compareCandidates = (left: PortfolioCandidate, right: PortfolioCandidate) => objective === "minimumDrawdown"
    ? right.stats.maxDrawdown - left.stats.maxDrawdown || right.stats.cagr! - left.stats.cagr! || left.stats.volatility - right.stats.volatility
    : right.stats.cagr! - left.stats.cagr! || left.stats.volatility - right.stats.volatility;

  const visit = (index: number, remaining: number, weights: Record<string, number>) => {
    if (index === assetIds.length - 1) {
      const id = assetIds[index];
      const finalWeight = remaining * step;
      const nextWeights = { ...weights, [id]: finalWeight };
      if (requiredAssetId && nextWeights[requiredAssetId] <= 0) return;
      const stats = computePortfolio(data, nextWeights, start, end, mode);
      // The first row of a series is often only the starting index and has no return.
      // Accept that boundary row, but do not optimize a portfolio with a shortened history.
      const minimumObservations = end - start + 1;
      if (!stats || stats.points.length < minimumObservations || stats.cagr === null) return;
      if (!stats || (maxDrawdown !== null && stats.maxDrawdown < -Math.abs(maxDrawdown))) return;
      results.push({ weights: nextWeights, stats });
      if (results.length > limit) results.sort(compareCandidates).splice(limit);
      return;
    }

    for (let units = 0; units <= remaining; units += 1) {
      visit(index + 1, remaining - units, { ...weights, [assetIds[index]]: units * step });
    }
  };

  visit(0, 100 / step, {});
  return results.sort(compareCandidates);
}

export function searchPortfolioAcrossWindows(
  data: Record<string, Row[]>,
  assetIds: string[],
  windows: PortfolioWindow[],
  mode: Mode,
  maxDrawdown: number | null,
  objective: "averageCagr" | "worstCagr",
  step = 5,
): PortfolioCandidate | null {
  if ((maxDrawdown !== null && !Number.isFinite(maxDrawdown)) || !assetIds.length || !windows.length || !Number.isFinite(step) || step <= 0 || 100 % step !== 0) return null;
  const alignedWindows = windows.map(w => alignAnnualSeries(data, assetIds, w.start, w.end, mode));
  if (alignedWindows.some(w => !w.ok)) return null;
  windows = windows.map((w, i) => ({ ...w, start: alignedWindows[i].ok ? alignedWindows[i].years[0] : w.start }));
  let best: { candidate: PortfolioCandidate; score: number; volatility: number; dispersion: number } | null = null;

  const visit = (index: number, remaining: number, weights: Record<string, number>) => {
    if (index === assetIds.length - 1) {
      const nextWeights = { ...weights, [assetIds[index]]: remaining * step };
      const metrics = windows.map((window) => computePortfolio(data, nextWeights, window.start, window.end, mode));
      if (metrics.some((stats, metricIndex) => !stats || stats.points.length < windowLength(windows[metricIndex]))) return;
      if (maxDrawdown !== null && metrics.some((stats) => (stats as PortfolioStats).maxDrawdown < -Math.abs(maxDrawdown))) return;
      const validMetrics = metrics as PortfolioStats[];
      const cagrs = validMetrics.map((stats) => stats.cagr ?? -Infinity);
      const score = objective === "worstCagr" ? Math.min(...cagrs) : cagrs.reduce((sum, cagr) => sum + cagr, 0) / cagrs.length;
      const averageVolatility = validMetrics.reduce((sum, stats) => sum + stats.volatility, 0) / validMetrics.length;
      const cagrDispersion = Math.max(...cagrs) - Math.min(...cagrs);
      if (!best || score > best.score || (score === best.score && (objective === "worstCagr" ? cagrDispersion < best.dispersion : averageVolatility < best.volatility))) {
        best = { candidate: { weights: nextWeights, stats: validMetrics[validMetrics.length - 1] }, score, volatility: averageVolatility, dispersion: cagrDispersion };
      }
      return;
    }
    for (let units = 0; units <= remaining; units += 1) {
      visit(index + 1, remaining - units, { ...weights, [assetIds[index]]: units * step });
    }
  };

  visit(0, 100 / step, {});
  return (best as { candidate: PortfolioCandidate; score: number; worstCagr: number } | null)?.candidate ?? null;
}

function windowLength(window: PortfolioWindow): number {
  return window.end - window.start + 1;
}
