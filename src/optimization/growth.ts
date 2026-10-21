import { alignAnnualSeries } from "../domain/data";
import { computePortfolio } from "../domain/portfolio";
import { validateWeights } from "../domain/constraints";
import type { PortfolioStats } from "../domain/types";
import type { AllocationInput, OptimizationResult, PortfolioConstraints } from "./interface";

const WEIGHT_TOLERANCE = 1e-10;
const DEFAULT_GRID_STEP_PCT = 5;
const DEFAULT_MAX_EVALUATIONS = 100_000;

export type ValidatedConstraints = {
  minWeight: number;
  maxWeightByAsset: Record<string, number>;
  maxAnnualCloseDrawdownPct: number | null;
  maxAnnualVolatilityPct: number | null;
  gridStepPct: number;
  maxEvaluations: number;
};

export type GridCandidate<Metadata = undefined> = {
  weights: Record<string, number>;
  stats: PortfolioStats;
  score: number;
  metadata?: Metadata;
};

export type GridSearchState<Metadata = undefined> = {
  best: GridCandidate<Metadata> | null;
  evaluatedCandidates: number;
  stoppedByBudget: boolean;
};

function emptyResult(diagnostics: string[], gridStepPct: number | null = null): OptimizationResult {
  return {
    strategy: "growth",
    weights: null,
    feasible: false,
    diagnostics,
    score: null,
    stats: null,
    evaluatedCandidates: 0,
    gridStepPct,
  };
}

export function validateOptimizationConfiguration(assetIds: string[], constraints: PortfolioConstraints): { value: ValidatedConstraints } | { diagnostics: string[] } {
  if (constraints.longOnly !== true) return { diagnostics: ["Les stratégies d'optimisation exigent une allocation long-only."] };
  if (!assetIds.length || new Set(assetIds).size !== assetIds.length) return { diagnostics: ["L'univers d'actifs est vide ou contient des doublons."] };

  const minWeight = constraints.minWeight ?? 0;
  const maxWeightByAsset = Object.fromEntries(assetIds.map(id => [id, constraints.maxWeightByAsset?.[id] ?? 1]));
  const maxAnnualCloseDrawdownPct = constraints.maxAnnualCloseDrawdownPct ?? null;
  const maxAnnualVolatilityPct = constraints.maxAnnualVolatilityPct ?? null;
  const gridStepPct = constraints.gridStepPct ?? DEFAULT_GRID_STEP_PCT;
  const maxEvaluations = constraints.maxEvaluations ?? DEFAULT_MAX_EVALUATIONS;
  const diagnostics: string[] = [];

  if (!Number.isFinite(minWeight) || minWeight < 0 || minWeight > 1) diagnostics.push("Le poids minimal doit être compris entre 0 % et 100 %.");
  for (const id of assetIds) {
    const maxWeight = maxWeightByAsset[id];
    if (!Number.isFinite(maxWeight) || maxWeight < 0 || maxWeight > 1) diagnostics.push(`Le plafond de poids est invalide pour ${id}.`);
    if (Number.isFinite(maxWeight) && maxWeight + WEIGHT_TOLERANCE < minWeight) diagnostics.push(`Le plafond de ${id} est inférieur au poids minimal.`);
  }
  if (maxAnnualCloseDrawdownPct !== null && (!Number.isFinite(maxAnnualCloseDrawdownPct) || maxAnnualCloseDrawdownPct < 0 || maxAnnualCloseDrawdownPct > 100)) {
    diagnostics.push("Le budget de drawdown annuel doit être compris entre 0 % et 100 % ou désactivé.");
  }
  if (maxAnnualVolatilityPct !== null && (!Number.isFinite(maxAnnualVolatilityPct) || maxAnnualVolatilityPct < 0)) {
    diagnostics.push("Le budget de volatilité annuelle doit être positif ou désactivé.");
  }
  if (!Number.isFinite(gridStepPct) || gridStepPct <= 0 || Math.abs(100 / gridStepPct - Math.round(100 / gridStepPct)) > WEIGHT_TOLERANCE) {
    diagnostics.push("La granularité de recherche doit diviser exactement 100 %.");
  }
  if (!Number.isInteger(maxEvaluations) || maxEvaluations < 1) diagnostics.push("Le budget d'évaluations doit être un entier positif.");
  if (Number.isFinite(minWeight) && assetIds.length * minWeight > 1 + WEIGHT_TOLERANCE) diagnostics.push("Les poids minimaux rendent la contrainte de somme impossible.");
  if (assetIds.reduce((sum, id) => sum + (maxWeightByAsset[id] ?? 0), 0) < 1 - WEIGHT_TOLERANCE) diagnostics.push("Les plafonds par actif rendent la contrainte de somme impossible.");

  return diagnostics.length ? { diagnostics } : {
    value: { minWeight, maxWeightByAsset, maxAnnualCloseDrawdownPct, maxAnnualVolatilityPct, gridStepPct, maxEvaluations },
  };
}

function compareCandidates<Metadata>(
  candidate: GridCandidate<Metadata>,
  current: GridCandidate<Metadata> | null,
  assetIds: string[],
): boolean {
  if (!current) return true;
  if (candidate.score !== current.score) return candidate.score > current.score;

  const candidateVolatility = Number.isFinite(candidate.stats.volatility) ? candidate.stats.volatility : Infinity;
  const currentVolatility = Number.isFinite(current.stats.volatility) ? current.stats.volatility : Infinity;
  if (candidateVolatility !== currentVolatility) return candidateVolatility < currentVolatility;
  if (candidate.stats.maxDrawdown !== current.stats.maxDrawdown) return candidate.stats.maxDrawdown > current.stats.maxDrawdown;

  // The final tie-breaker makes equal historical results reproducible across engines.
  return assetIds.some((id, index) => {
    const left = candidate.weights[id] ?? 0;
    const right = current.weights[id] ?? 0;
    if (Math.abs(left - right) <= WEIGHT_TOLERANCE) return false;
    return left < right && assetIds.slice(0, index).every(previousId => Math.abs((candidate.weights[previousId] ?? 0) - (current.weights[previousId] ?? 0)) <= WEIGHT_TOLERANCE);
  });
}

export function candidateRespectsConstraints(
  weights: Record<string, number>,
  stats: PortfolioStats,
  assetIds: string[],
  constraints: ValidatedConstraints,
): boolean {
  if (validateWeights(weights, constraints.maxWeightByAsset).length) return false;
  if (assetIds.some(id => (weights[id] ?? 0) + WEIGHT_TOLERANCE < constraints.minWeight)) return false;
  if (constraints.maxAnnualCloseDrawdownPct !== null && stats.maxDrawdown < -constraints.maxAnnualCloseDrawdownPct - WEIGHT_TOLERANCE) return false;
  if (constraints.maxAnnualVolatilityPct !== null && (!Number.isFinite(stats.volatility) || stats.volatility > constraints.maxAnnualVolatilityPct + WEIGHT_TOLERANCE)) return false;
  return true;
}

export function searchGrid<Metadata = undefined>(
  inputs: AllocationInput,
  assetIds: string[],
  constraints: ValidatedConstraints,
  scoreCandidate: (weights: Record<string, number>, stats: PortfolioStats) => { score: number; metadata?: Metadata } | null,
): GridSearchState<Metadata> {
  const totalUnits = Math.round(100 / constraints.gridStepPct);
  const minUnits = Math.ceil((constraints.minWeight * 100) / constraints.gridStepPct - WEIGHT_TOLERANCE);
  const maxUnits = Object.fromEntries(assetIds.map(id => [id, Math.floor((constraints.maxWeightByAsset[id] * 100) / constraints.gridStepPct + WEIGHT_TOLERANCE)]));
  const state: GridSearchState<Metadata> = { best: null, evaluatedCandidates: 0, stoppedByBudget: false };
  const mode = inputs.returnMode ?? "nominal";

  const visit = (index: number, remainingUnits: number, units: number[]) => {
    if (state.evaluatedCandidates >= constraints.maxEvaluations) {
      state.stoppedByBudget = true;
      return;
    }
    const remainingAssets = assetIds.length - index;
    if (remainingUnits < remainingAssets * minUnits) return;
    const maxRemainingUnits = assetIds.slice(index).reduce((sum, id) => sum + maxUnits[id], 0);
    if (remainingUnits > maxRemainingUnits) return;

    if (index === assetIds.length - 1) {
      const finalUnits = remainingUnits;
      if (finalUnits < minUnits || finalUnits > maxUnits[assetIds[index]]) return;
      const allUnits = [...units, finalUnits];
      const weights = Object.fromEntries(assetIds.map((id, position) => {
        const weight = allUnits[position] * constraints.gridStepPct / 100;
        return [id, Object.is(weight, -0) ? 0 : weight];
      }));
      state.evaluatedCandidates += 1;
      const stats = computePortfolio(inputs.data, weights, inputs.trainStart, inputs.trainEnd, mode);
       if (!stats || !candidateRespectsConstraints(weights, stats, assetIds, constraints)) return;
       const score = scoreCandidate(weights, stats);
       if (!score || !Number.isFinite(score.score)) return;
       const candidate = { weights, stats, score: score.score, metadata: score.metadata };
      if (compareCandidates(candidate, state.best, assetIds)) state.best = candidate;
      return;
    }

    const maxUnitsForCurrent = Math.min(maxUnits[assetIds[index]], remainingUnits - (remainingAssets - 1) * minUnits);
    for (let currentUnits = minUnits; currentUnits <= maxUnitsForCurrent; currentUnits += 1) {
      visit(index + 1, remainingUnits - currentUnits, [...units, currentUnits]);
      if (state.stoppedByBudget) return;
    }
  };

  visit(0, totalUnits, []);
  return state;
}

export function optimizeGrowth(inputs: AllocationInput, rawConstraints: PortfolioConstraints): OptimizationResult {
  const configuration = validateOptimizationConfiguration(inputs.assetIds, rawConstraints);
  if ("diagnostics" in configuration) return emptyResult(configuration.diagnostics, rawConstraints.gridStepPct ?? null);
  if (inputs.rebalancing !== undefined && inputs.rebalancing !== "annual") return emptyResult(["Seul le rééquilibrage annuel est disponible dans cette phase."], configuration.value.gridStepPct);

  const mode = inputs.returnMode ?? "nominal";
  const aligned = alignAnnualSeries(inputs.data, inputs.assetIds, inputs.trainStart, inputs.trainEnd, mode);
  if (!aligned.ok) return emptyResult(aligned.diagnostics.map(diagnostic => diagnostic.message), configuration.value.gridStepPct);
  if (!aligned.years.length) return emptyResult(["La fenêtre d'apprentissage ne contient aucun rendement annuel."], configuration.value.gridStepPct);

  const state = searchGrid(inputs, inputs.assetIds, configuration.value, (_weights, stats) => stats.cagr === null ? null : { score: stats.cagr });
  const diagnostics = state.best ? [] : ["Aucune allocation faisable ne respecte simultanément les contraintes et la qualité des données."];
  if (state.stoppedByBudget) diagnostics.push(`Recherche arrêtée au budget déterministe de ${configuration.value.maxEvaluations.toLocaleString("fr-FR")} évaluations.`);
  if (state.best && state.stoppedByBudget) diagnostics.push("Le résultat est le meilleur candidat trouvé à la résolution choisie, pas une garantie d'optimum continu.");

  return {
    strategy: "growth",
    weights: state.best?.weights ?? null,
    feasible: state.best !== null,
    diagnostics,
    score: state.best?.score ?? null,
    stats: state.best?.stats ?? null,
    evaluatedCandidates: state.evaluatedCandidates,
    gridStepPct: configuration.value.gridStepPct,
  };
}
