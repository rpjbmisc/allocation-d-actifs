import { alignAnnualSeries } from "./data";
import { normalizeWeights } from "./constraints";
import type { Row, Mode, PortfolioStats, PortfolioPoint } from "./types";
import { returnValue } from "./returns";
import { volatility, cagr as cagrValue } from "./metrics";
export function computePortfolio(
  data: Record<string, Row[]>,
  weights: Record<string, number>,
  start: number,
  end: number,
  mode: Mode,
): PortfolioStats | null {
  const normalized = normalizeWeights(weights);
  if (!normalized) return null;
  const weightedAssets = Object.entries(normalized).filter(([, weight]) => weight > 0);
  const aligned = alignAnnualSeries(data, weightedAssets.map(([id]) => id), start, end, mode);
  if (!aligned.ok) return null;
  const { years: validYears, rowsByAsset } = aligned;

  let value = 100;
  let peak = value;
  let maxDrawdown = 0;
  const points = validYears.map((year) => {
    const portfolioReturn = weightedAssets.reduce((sum, [id, weight]) => {
      const row = rowsByAsset[id].get(year) as Row;
      return sum + weight * (returnValue(row, mode) as number);
    }, 0);
    value *= 1 + portfolioReturn / 100;
    peak = Math.max(peak, value);
    const drawdown = (value / peak - 1) * 100;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    return { year, return: portfolioReturn, value, drawdown };
  });

  if (points.some(point => !Number.isFinite(point.value) || !Number.isFinite(point.return))) return null;
  const returns = points.map((point) => point.return);
  const mean = returns.reduce((sum, current) => sum + current, 0) / returns.length;
  const volatilityValue = volatility(returns);
  const cagr = cagrValue(100, value, points.length);
  const troughIndex = points.reduce((index, point, current) => point.drawdown < points[index].drawdown ? current : index, 0);
  const recoveryIndex = points.findIndex((point, index) => index > troughIndex && point.drawdown >= -0.01);
  const recoveryYears = maxDrawdown < 0 && recoveryIndex > troughIndex ? points[recoveryIndex].year - points[troughIndex].year : null;

  return {
    points,
    count: points.length,
    cagr,
    volatility: volatilityValue,
    grossReturnToVolatility: volatilityValue > 0 ? mean / volatilityValue : null,
    positiveRate: returns.filter((current) => current > 0).length / returns.length * 100,
    best: points.reduce((best, point) => !best || point.return > best.return ? point : best, null as PortfolioPoint | null),
    worst: points.reduce((worst, point) => !worst || point.return < worst.return ? point : worst, null as PortfolioPoint | null),
    maxDrawdown,
    recoveryYears,
  };
}


export function maxDrawdown(rows: Row[], start: number, end: number, mode: Mode): number | null {
  return computePortfolio({ asset: rows }, { asset: 100 }, start, end, mode)?.maxDrawdown ?? null;
}
