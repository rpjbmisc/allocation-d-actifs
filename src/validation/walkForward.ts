import { returnValue } from "../domain/returns";
import { normalizeWeights } from "../domain/constraints";
import { computePortfolio, summarizePortfolioReturns } from "../domain/portfolio";
import type { AnnualPortfolioReturn } from "../domain/portfolio";
import type { Mode, PortfolioStats, Row } from "../domain/types";
import { optimize } from "../optimization/interface";
import type { AllocationInput, OptimizationResult, PortfolioConstraints } from "../optimization/interface";
import type { ScenarioSettings } from "../scenarios/generator";

export interface WalkForwardSettings {
  minTrainYears: number;
  testYears: number;
  expanding: boolean;
}

export interface WalkForwardWindow {
  index: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
}

export interface WalkForwardWindowEvaluation {
  window: WalkForwardWindow;
  feasible: boolean;
  weights: Record<string, number> | null;
  score: number | null;
  testStats: PortfolioStats | null;
  diagnostics: string[];
  optimization?: OptimizationResult;
}

export type WalkForwardStrategyId = "growth" | "robust" | "custom" | "equal" | "benchmark";

export interface WalkForwardStrategyResult {
  id: WalkForwardStrategyId;
  label: string;
  feasible: boolean;
  stats: PortfolioStats | null;
  plannedWindowCount: number;
  validWindowCount: number;
  windows: WalkForwardWindowEvaluation[];
  averageTurnoverPct: number | null;
  weightStabilityPct: number | null;
  diagnostics: string[];
}

export interface WalkForwardInput {
  data: Record<string, Row[]>;
  assetIds: string[];
  periodStart: number;
  periodEnd: number;
  returnMode: Mode;
  constraints: PortfolioConstraints;
  customWeights: Record<string, number>;
  settings?: Partial<WalkForwardSettings>;
  benchmarkAssetId?: string | null;
  scenarioSettings?: Partial<ScenarioSettings>;
}

export interface WalkForwardResult {
  settings: WalkForwardSettings;
  windows: WalkForwardWindow[];
  strategies: WalkForwardStrategyResult[];
  diagnostics: string[];
  uncertainty: string;
}

export type WeightStabilityLevel = "Très stable" | "Stable" | "Variable" | "Instable" | "Très instable";

const DEFAULT_SETTINGS: WalkForwardSettings = { minTrainYears: 20, testYears: 5, expanding: true };

function normalizedSettings(settings?: Partial<WalkForwardSettings>): WalkForwardSettings | null {
  const result = { ...DEFAULT_SETTINGS, ...settings };
  if (!Number.isInteger(result.minTrainYears) || result.minTrainYears < 1) return null;
  if (!Number.isInteger(result.testYears) || result.testYears < 1) return null;
  if (typeof result.expanding !== "boolean") return null;
  return result;
}

function commonAnnualRuns(
  data: Record<string, Row[]>,
  assetIds: string[],
  start: number,
  end: number,
  mode: Mode,
): number[][] {
  if (!assetIds.length || !Number.isInteger(start) || !Number.isInteger(end) || start > end) return [];
  const first = data[assetIds[0]] ?? [];
  const common = new Set(first.filter(row => row.year >= start && row.year <= end && returnValue(row, mode) !== null).map(row => row.year));
  for (const id of assetIds.slice(1)) {
    const available = new Set((data[id] ?? []).filter(row => row.year >= start && row.year <= end && returnValue(row, mode) !== null).map(row => row.year));
    for (const year of common) if (!available.has(year)) common.delete(year);
  }

  const years = [...common].sort((left, right) => left - right);
  const runs: number[][] = [];
  for (const year of years) {
    const current = runs.at(-1);
    if (!current || year !== current.at(-1)! + 1) runs.push([year]);
    else current.push(year);
  }
  return runs;
}

/** Build non-overlapping test blocks from contiguous annual observations. */
export function buildWalkForwardWindows(
  data: Record<string, Row[]>,
  assetIds: string[],
  start: number,
  end: number,
  mode: Mode,
  rawSettings: Partial<WalkForwardSettings> = DEFAULT_SETTINGS,
): WalkForwardWindow[] {
  const settings = normalizedSettings(rawSettings);
  if (!settings) return [];
  const windows: WalkForwardWindow[] = [];
  for (const run of commonAnnualRuns(data, assetIds, start, end, mode)) {
    let testStartIndex = settings.minTrainYears;
    while (testStartIndex + settings.testYears <= run.length) {
      const trainEndIndex = testStartIndex - 1;
      const trainStartIndex = settings.expanding ? 0 : Math.max(0, trainEndIndex - settings.minTrainYears + 1);
      const testEndIndex = testStartIndex + settings.testYears - 1;
      windows.push({
        index: windows.length,
        trainStart: run[trainStartIndex],
        trainEnd: run[trainEndIndex],
        testStart: run[testStartIndex],
        testEnd: run[testEndIndex],
      });
      testStartIndex += settings.testYears;
    }
  }
  return windows;
}

function uniqueDiagnostics(diagnostics: string[]): string[] {
  return [...new Set(diagnostics)];
}

export function calculateWeightStability(weightSeries: Record<string, number>[]): { turnover: number | null; stability: number | null } {
  if (weightSeries.length < 2) return { turnover: null, stability: null };
  const assetIds = [...new Set(weightSeries.flatMap(weights => Object.keys(weights)))];
  const turnovers = weightSeries.slice(1).map((current, index) => {
    const absoluteDifference = assetIds.reduce(
      (sum, id) => sum + Math.abs((current[id] ?? 0) - (weightSeries[index][id] ?? 0)),
      0,
    );
    // Weights are fractions. Divide the L1 change by two because each transfer
    // appears once as a sale and once as a purchase, then express it in points.
    return absoluteDifference * 50;
  });
  const turnover = turnovers.reduce((sum, value) => sum + value, 0) / turnovers.length;
  return { turnover, stability: Math.max(0, Math.min(100, 100 - turnover)) };
}

export function weightStabilityLabel(stability: number | null): WeightStabilityLevel | null {
  if (stability === null || !Number.isFinite(stability)) return null;
  if (stability >= 80) return "Très stable";
  if (stability >= 60) return "Stable";
  if (stability >= 40) return "Variable";
  if (stability >= 20) return "Instable";
  return "Très instable";
}

function weightStability(evaluations: WalkForwardWindowEvaluation[]): { turnover: number | null; stability: number | null } {
  return calculateWeightStability(evaluations.filter(evaluation => evaluation.feasible && evaluation.weights).map(evaluation => evaluation.weights!));
}

function strategyResult(
  id: WalkForwardStrategyId,
  label: string,
  windows: WalkForwardWindow[],
  evaluations: WalkForwardWindowEvaluation[],
  extraDiagnostics: string[] = [],
): WalkForwardStrategyResult {
  const validWindowCount = evaluations.filter(evaluation => evaluation.feasible).length;
  const allWindowsValid = windows.length > 0 && validWindowCount === windows.length;
  const annualReturns: AnnualPortfolioReturn[] = allWindowsValid
    ? evaluations.flatMap(evaluation => evaluation.testStats!.points.map(point => ({ year: point.year, return: point.return })))
    : [];
  const stats = allWindowsValid ? summarizePortfolioReturns(annualReturns) : null;
  const diagnostics = [...extraDiagnostics, ...evaluations.flatMap(evaluation => evaluation.diagnostics)];
  if (!windows.length) diagnostics.push("Aucune fenêtre de validation complète n'est disponible.");
  if (windows.length && validWindowCount !== windows.length) diagnostics.push("Au moins une fenêtre n'est pas exploitable ; le résultat OOS complet est masqué.");
  if (allWindowsValid && !stats) diagnostics.push("Les périodes de test ne sont pas contiguës ; le CAGR OOS n'est pas calculé.");
  const stability = weightStability(evaluations);
  return {
    id,
    label,
    feasible: Boolean(stats),
    stats,
    plannedWindowCount: windows.length,
    validWindowCount,
    windows: evaluations,
    averageTurnoverPct: stability.turnover,
    weightStabilityPct: stability.stability,
    diagnostics: uniqueDiagnostics(diagnostics),
  };
}

function fixedEvaluation(
  data: Record<string, Row[]>,
  mode: Mode,
  window: WalkForwardWindow,
  weights: Record<string, number> | null,
): WalkForwardWindowEvaluation {
  if (!weights) return { window, feasible: false, weights: null, score: null, testStats: null, diagnostics: ["Les pondérations fixes sont vides ou invalides."] };
  const testStats = computePortfolio(data, weights, window.testStart, window.testEnd, mode);
  return testStats
    ? { window, feasible: true, weights, score: null, testStats, diagnostics: [] }
    : { window, feasible: false, weights, score: null, testStats: null, diagnostics: [`Données insuffisantes sur le test ${window.testStart}–${window.testEnd}.`] };
}

function optimizationEvaluations(
  input: WalkForwardInput,
  windows: WalkForwardWindow[],
  strategy: "growth" | "robust",
): WalkForwardWindowEvaluation[] {
  return windows.map(window => {
    const allocationInput: AllocationInput = {
      data: input.data,
      assetIds: input.assetIds,
      trainStart: window.trainStart,
      trainEnd: window.trainEnd,
      returnMode: input.returnMode,
      rebalancing: "annual",
      scenarioSettings: input.scenarioSettings,
    };
    const optimization = optimize(strategy, allocationInput, input.constraints);
    if (!optimization.weights || !optimization.feasible) {
      return { window, feasible: false, weights: null, score: optimization.score, testStats: null, diagnostics: optimization.diagnostics, optimization };
    }
    const testStats = computePortfolio(input.data, optimization.weights, window.testStart, window.testEnd, input.returnMode);
    if (!testStats) {
      return { window, feasible: false, weights: optimization.weights, score: optimization.score, testStats: null, diagnostics: [`Données insuffisantes sur le test ${window.testStart}–${window.testEnd}.`], optimization };
    }
    return { window, feasible: true, weights: optimization.weights, score: optimization.score, testStats, diagnostics: [], optimization };
  });
}

function uncertainty(windowCount: number): string {
  if (windowCount === 0) return "insuffisante";
  if (windowCount === 1) return "très faible · une seule fenêtre";
  if (windowCount < 4) return "limitée · peu de fenêtres";
  return "indicative · à interpréter avec prudence";
}

export function runWalkForward(input: WalkForwardInput): WalkForwardResult {
  const settings = normalizedSettings(input.settings) ?? DEFAULT_SETTINGS;
  const diagnostics: string[] = [];
  if (!normalizedSettings(input.settings)) diagnostics.push("Les paramètres de fenêtres sont invalides ; les valeurs par défaut 20 ans / 5 ans sont utilisées.");
  if (!input.assetIds.length || new Set(input.assetIds).size !== input.assetIds.length) diagnostics.push("L'univers de validation est vide ou contient des doublons.");

  const windows = buildWalkForwardWindows(input.data, input.assetIds, input.periodStart, input.periodEnd, input.returnMode, settings);
  const customWeights = normalizeWeights(Object.fromEntries(input.assetIds.map(id => [id, input.customWeights[id] ?? 0])));
  const equalWeights = normalizeWeights(Object.fromEntries(input.assetIds.map(id => [id, 1])));
  const growth = strategyResult("growth", "Croissance", windows, optimizationEvaluations(input, windows, "growth"));
  const robust = strategyResult("robust", "Robustesse", windows, optimizationEvaluations(input, windows, "robust"));
  const custom = strategyResult("custom", "Personnalisée", windows, windows.map(window => fixedEvaluation(input.data, input.returnMode, window, customWeights)), ["Poids cibles choisis aujourd'hui, appliqués rétrospectivement ; ce n'est pas une stratégie réoptimisée."]);
  const equal = strategyResult("equal", "Équipondérée", windows, windows.map(window => fixedEvaluation(input.data, input.returnMode, window, equalWeights)));

  const benchmarkId = input.benchmarkAssetId ?? null;
  const benchmark = benchmarkId && input.data[benchmarkId]
    ? strategyResult("benchmark", "MSCI World", windows, windows.map(window => fixedEvaluation(input.data, input.returnMode, window, { [benchmarkId]: 1 })))
    : strategyResult("benchmark", "MSCI World", windows, [], ["Benchmark indépendant indisponible dans les données chargées."]);

  return {
    settings,
    windows,
    strategies: [growth, robust, custom, equal, benchmark],
    diagnostics: uniqueDiagnostics(diagnostics),
    uncertainty: uncertainty(windows.length),
  };
}
