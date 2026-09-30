export type Mode = "nominal" | "real";

export interface Asset {
  id: string;
  name: string;
  csvFile: string;
  accentColor: string;
  startYear: number;
  endYear: number;
}

export interface Row {
  year: number;
  price: number;
  cpi: number;
  nominal: number;
  inflation: number;
  real: number;
}

export interface Stats {
  count: number;
  cagrNominal: number | null;
  cagrReal: number | null;
  volatility: number;
  positiveRate: number;
  best: Row | null;
  worst: Row | null;
  best5: Row[];
  worst5: Row[];
}

export interface PortfolioPoint {
  year: number;
  return: number;
  value: number;
  drawdown: number;
}

export interface PortfolioStats {
  points: PortfolioPoint[];
  count: number;
  cagr: number | null;
  volatility: number;
  sharpe: number | null;
  positiveRate: number;
  best: PortfolioPoint | null;
  worst: PortfolioPoint | null;
  maxDrawdown: number;
  recoveryYears: number | null;
}

export interface PortfolioCandidate {
  weights: Record<string, number>;
  stats: PortfolioStats;
}

export interface PortfolioWindow {
  start: number;
  end: number;
}

export interface CorrelationCell {
  value: number | null;
  observations: number;
}

const aliases = {
  year: ["Year", "year"],
  price: ["Price", "Gold_Price_USD", "Price_Index", "TR_Index", "TotalReturn_Index", "Total_Return_Index", "Gross_TR_Index", "GrossTR_Index_Start", "Close", "Value"],
  cpi: ["CPI", "CPI_U"],
  nominal: ["Nominal_Return", "Nominal_Return_Pct", "Total_Return", "Gross_Total_Return", "GrossTR_Return", "Total_Return_Nominal"],
  inflation: ["Inflation", "Inflation_Pct"],
  real: ["Real_Return", "Real_Return_Pct", "Real_Total_Return", "Real_Return_Gross", "Total_Return_Real"],
} as const;

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const pick = (row: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return null;
};

export function normalizeRows(raw: Record<string, unknown>[]): Row[] {
  return raw
    .map((row) => ({
      year: toNumber(pick(row, aliases.year)),
      price: toNumber(pick(row, aliases.price)),
      cpi: toNumber(pick(row, aliases.cpi)),
      nominal: toNumber(pick(row, aliases.nominal)),
      inflation: toNumber(pick(row, aliases.inflation)),
      real: toNumber(pick(row, aliases.real)),
    }))
    .filter((row) => Number.isFinite(row.year))
    .sort((a, b) => a.year - b.year);
}

export function returnValue(row: Row, mode: Mode): number | null {
  const value = mode === "nominal" ? row.nominal : row.real;
  return Number.isFinite(value) ? value : null;
}

function geometricMean(values: number[]): number | null {
  if (!values.length || values.some((value) => 1 + value / 100 <= 0)) return null;
  const product = values.reduce((total, value) => total * (1 + value / 100), 1);
  return (Math.pow(product, 1 / values.length) - 1) * 100;
}

export function cagr(start: number, end: number, years: number): number | null {
  if (!(start > 0) || !(end > 0) || years <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

export function computeStats(rows: Row[], start: number, end: number, mode: Mode): Stats | null {
  const range = rows.filter((row) => row.year >= start && row.year <= end);
  const nominal = range.filter((row) => Number.isFinite(row.nominal)).map((row) => row.nominal);
  const real = range.filter((row) => Number.isFinite(row.real)).map((row) => row.real);
  const values = range.filter((row) => returnValue(row, mode) !== null);
  if (!values.length) return null;

  const mean = values.reduce((sum, row) => sum + (returnValue(row, mode) as number), 0) / values.length;
  const volatility = Math.sqrt(values.reduce((sum, row) => sum + Math.pow((returnValue(row, mode) as number) - mean, 2), 0) / values.length);
  const sorted = [...values].sort((a, b) => (returnValue(b, mode) as number) - (returnValue(a, mode) as number));

  return {
    count: values.length,
    cagrNominal: geometricMean(nominal),
    cagrReal: geometricMean(real),
    volatility,
    positiveRate: values.filter((row) => (returnValue(row, mode) as number) > 0).length / values.length * 100,
    best: sorted[0] ?? null,
    worst: sorted[sorted.length - 1] ?? null,
    best5: sorted.slice(0, 5),
    worst5: sorted.slice(-5).reverse(),
  };
}

export function computePortfolio(
  data: Record<string, Row[]>,
  weights: Record<string, number>,
  start: number,
  end: number,
  mode: Mode,
): PortfolioStats | null {
  const weightedAssets = Object.entries(weights).filter(([, weight]) => weight > 0);
  if (!weightedAssets.length) return null;

  const totalWeight = weightedAssets.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) return null;

  const years = [...new Set(weightedAssets.flatMap(([id]) => (data[id] ?? []).map((row) => row.year)))]
    .filter((year) => year >= start && year <= end)
    .sort((a, b) => a - b);
  const rowsByAsset = Object.fromEntries(weightedAssets.map(([id]) => [
    id,
    new Map((data[id] ?? []).map((row) => [row.year, row])),
  ]));
  const validYears = years.filter((year) => weightedAssets.every(([id]) => {
    const row = rowsByAsset[id].get(year);
    return row !== undefined && returnValue(row, mode) !== null;
  }));
  if (!validYears.length) return null;

  let value = 100;
  let peak = value;
  let maxDrawdown = 0;
  const points = validYears.map((year) => {
    const portfolioReturn = weightedAssets.reduce((sum, [id, weight]) => {
      const row = rowsByAsset[id].get(year) as Row;
      return sum + (weight / totalWeight) * (returnValue(row, mode) as number);
    }, 0);
    value *= 1 + portfolioReturn / 100;
    peak = Math.max(peak, value);
    const drawdown = (value / peak - 1) * 100;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    return { year, return: portfolioReturn, value, drawdown };
  });

  const returns = points.map((point) => point.return);
  const mean = returns.reduce((sum, current) => sum + current, 0) / returns.length;
  const volatility = Math.sqrt(returns.reduce((sum, current) => sum + Math.pow(current - mean, 2), 0) / returns.length);
  const cagr = points.length > 1 ? cagrValue(points[0].value / (1 + points[0].return / 100), value, points.length) : null;
  const recoveryIndex = points.findIndex((point, index) => index > 0 && point.drawdown >= -0.01 && points.slice(0, index).some((candidate) => candidate.drawdown < -0.01));
  const troughIndex = points.reduce((index, point, current) => point.drawdown < points[index].drawdown ? current : index, 0);
  const recoveryYears = troughIndex > 0 && recoveryIndex >= troughIndex ? points[recoveryIndex].year - points[troughIndex].year : null;

  return {
    points,
    count: points.length,
    cagr,
    volatility,
    sharpe: volatility > 0 ? mean / volatility : null,
    positiveRate: returns.filter((current) => current > 0).length / returns.length * 100,
    best: points.reduce((best, point) => !best || point.return > best.return ? point : best, null as PortfolioPoint | null),
    worst: points.reduce((worst, point) => !worst || point.return < worst.return ? point : worst, null as PortfolioPoint | null),
    maxDrawdown,
    recoveryYears,
  };
}

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
    const rows = (data[id] ?? []).filter((row) => row.year >= start && row.year <= end && returnValue(row, mode) !== null);
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

export function searchPortfolioCandidates(
  data: Record<string, Row[]>,
  assetIds: string[],
  start: number,
  end: number,
  mode: Mode,
  maxDrawdown: number | null,
  step = 5,
  limit = 5,
  requiredAssetId?: string,
): PortfolioCandidate[] {
  if (!assetIds.length || step <= 0 || 100 % step !== 0) return [];
  const years = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  const rowsByAsset = Object.fromEntries(assetIds.map((id) => [
    id,
    new Map((data[id] ?? []).map((row) => [row.year, row])),
  ]));
  const results: PortfolioCandidate[] = [];

  const visit = (index: number, remaining: number, weights: Record<string, number>) => {
    if (index === assetIds.length - 1) {
      const id = assetIds[index];
      const finalWeight = remaining * step;
      const nextWeights = { ...weights, [id]: finalWeight };
      if (requiredAssetId && nextWeights[requiredAssetId] <= 0) return;
      const activeIds = assetIds.filter((assetId) => nextWeights[assetId] > 0);
      const complete = years.every((year) => activeIds.every((assetId) => {
        const row = rowsByAsset[assetId].get(year);
        return row !== undefined && returnValue(row, mode) !== null;
      }));
      if (!complete) return;
      const stats = computePortfolio(data, nextWeights, start, end, mode);
      if (!stats || (maxDrawdown !== null && stats.maxDrawdown < -Math.abs(maxDrawdown))) return;
      results.push({ weights: nextWeights, stats });
      if (results.length > limit) results.sort((left, right) => right.stats.cagr! - left.stats.cagr! || left.stats.volatility - right.stats.volatility).splice(limit);
      return;
    }

    for (let units = 0; units <= remaining; units += 1) {
      visit(index + 1, remaining - units, { ...weights, [assetIds[index]]: units * step });
    }
  };

  visit(0, 100 / step, {});
  return results.sort((left, right) => right.stats.cagr! - left.stats.cagr! || left.stats.volatility - right.stats.volatility);
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
  if (!assetIds.length || !windows.length || step <= 0 || 100 % step !== 0) return null;
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

function cagrValue(start: number, end: number, years: number): number | null {
  if (!(start > 0) || !(end > 0) || years <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

export const formatPercent = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "n.d."
    : `${value > 0 ? "+" : ""}${value.toFixed(digits)} %`;

export const formatNumber = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "n.d."
    : value.toLocaleString("fr-FR", { maximumFractionDigits: digits });

export const formatMoney = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M$`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} k$`;
  return `${value.toFixed(0)} $`;
};
