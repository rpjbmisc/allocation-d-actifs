import { normalizeWeights } from "../domain/constraints";
import { alignAnnualSeries } from "../domain/data";
import { generateJointScenarios } from "../scenarios/generator";
import type { JointScenario, ScenarioSettings } from "../scenarios/generator";
import { searchGrid, validateOptimizationConfiguration } from "./growth";
import type { AllocationInput, OptimizationResult, PortfolioConstraints } from "./interface";

/** All cash amounts use the portfolio's selected currency and nominal/real convention. */
export interface GoalSettings {
  initialCapital: number;
  /** Deposit at the END of each simulated year, in the same units as initialCapital. */
  annualContribution: number;
  targetCapital: number;
  horizonYears: number;
}

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
  initialCapital: 100_000,
  annualContribution: 6_000,
  targetCapital: 600_000,
  horizonYears: 25,
};

export interface GoalSummary {
  probabilityPct: number;
  medianCapital: number;
  lowerCapital: number;
  upperCapital: number;
  worstCapital: number;
  scenarioCount: number;
  horizonYears: number;
  targetCapital: number;
  /** A projected model output, NOT an observed probability. */
  model: "historical-joint-bootstrap";
}

export function validateGoalSettings(raw: Partial<GoalSettings> | undefined): { settings: GoalSettings; diagnostics: string[] } {
  const settings = { ...DEFAULT_GOAL_SETTINGS, ...raw };
  const diagnostics: string[] = [];
  for (const [name, value] of [
    ["Capital initial", settings.initialCapital],
    ["Versement annuel", settings.annualContribution],
    ["Capital cible", settings.targetCapital],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1e15) diagnostics.push(`${name} : montant invalide.`);
  }
  if (settings.initialCapital === 0 && settings.annualContribution === 0) diagnostics.push("Le capital initial et les versements ne peuvent pas être tous deux nuls.");
  if (settings.targetCapital <= 0) diagnostics.push("Le capital cible doit être strictement positif.");
  if (!Number.isInteger(settings.horizonYears) || settings.horizonYears < 1 || settings.horizonYears > 100) diagnostics.push("L'horizon doit être compris entre 1 et 100 ans.");
  return { settings, diagnostics };
}

export function terminalGoalCapital(scenario: JointScenario, weights: Record<string, number>, settings: GoalSettings): number | null {
  const normalized = normalizeWeights(weights);
  if (!normalized) return null;
  const ids = Object.keys(normalized);
  if (!ids.length || ids.some(id => !scenario.annualReturns[id] || scenario.annualReturns[id].length !== settings.horizonYears)) return null;
  let capital = settings.initialCapital;
  for (let year = 0; year < settings.horizonYears; year += 1) {
    const annualReturnPct = ids.reduce((sum, id) => sum + normalized[id] * scenario.annualReturns[id][year], 0);
    if (!Number.isFinite(annualReturnPct) || annualReturnPct < -100) return null;
    capital = capital * (1 + annualReturnPct / 100) + settings.annualContribution;
    if (!Number.isFinite(capital)) return null;
  }
  return capital;
}

function percentile(sorted: number[], pct: number): number {
  const position = (sorted.length - 1) * pct / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function summarizeGoal(
  scenarios: JointScenario[], weights: Record<string, number>, goal: GoalSettings,
): GoalSummary | null {
  const capitals = scenarios.map(scenario => terminalGoalCapital(scenario, weights, goal));
  if (!capitals.length || capitals.some(value => value === null)) return null;
  const sorted = (capitals as number[]).sort((a, b) => a - b);
  return {
    probabilityPct: 100 * sorted.filter(capital => capital >= goal.targetCapital).length / sorted.length,
    medianCapital: percentile(sorted, 50),
    lowerCapital: percentile(sorted, 10),
    upperCapital: percentile(sorted, 90),
    worstCapital: sorted[0],
    scenarioCount: sorted.length,
    horizonYears: goal.horizonYears,
    targetCapital: goal.targetCapital,
    model: "historical-joint-bootstrap",
  };
}

function failure(diagnostics: string[], step: number | null): OptimizationResult {
  return { strategy: "goal", weights: null, feasible: false, diagnostics, score: null, stats: null,
    evaluatedCandidates: 0, gridStepPct: step, scoreLabel: "Probabilité simulée d'atteindre la cible", goalSummary: null };
}

export function optimizeGoal(inputs: AllocationInput, constraints: PortfolioConstraints): OptimizationResult {
  const config = validateOptimizationConfiguration(inputs.assetIds, constraints);
  if ("diagnostics" in config) return failure(config.diagnostics, constraints.gridStepPct ?? null);
  const goal = validateGoalSettings(inputs.goalSettings);
  if (goal.diagnostics.length) return failure(goal.diagnostics, config.value.gridStepPct);
  if (inputs.rebalancing !== undefined && inputs.rebalancing !== "annual") return failure(["Rééquilibrage annuel uniquement."], config.value.gridStepPct);

  const mode = inputs.returnMode ?? "nominal";
  const aligned = alignAnnualSeries(inputs.data, inputs.assetIds, inputs.trainStart, inputs.trainEnd, mode);
  if (!aligned.ok || !aligned.years.length) return failure(aligned.ok ? ["Historique vide."] : aligned.diagnostics.map(item => item.message), config.value.gridStepPct);

  const simulation: Partial<ScenarioSettings> = { ...inputs.scenarioSettings, horizonYears: goal.settings.horizonYears };
  const generated = generateJointScenarios({
    data: inputs.data, assetIds: inputs.assetIds, start: inputs.trainStart, end: inputs.trainEnd, mode,
  }, simulation);
  if (generated.diagnostics.length || !generated.scenarios.length) return failure(generated.diagnostics.length ? generated.diagnostics : ["Aucun scénario valide."], config.value.gridStepPct);

  const state = searchGrid<GoalSummary>(inputs, inputs.assetIds, config.value, weights => {
    const summary = summarizeGoal(generated.scenarios, weights, goal.settings);
    return summary ? { score: summary.probabilityPct, metadata: summary } : null;
  });
  const diagnostics = state.best ? [] : ["Aucun portefeuille ne respecte les contraintes."];
  if (state.stoppedByBudget) diagnostics.push("Recherche interrompue au budget de calcul : meilleur candidat trouvé, optimum non garanti.");
  diagnostics.push("Probabilité indicative conditionnée au rééchantillonnage d'années historiques communes, sans frais ni fiscalité. Drawdowns intra-annuels inconnus.");
  return {
    strategy: "goal",
    weights: state.best?.weights ?? null,
    feasible: Boolean(state.best),
    diagnostics,
    score: state.best?.score ?? null,
    stats: state.best?.stats ?? null,
    evaluatedCandidates: state.evaluatedCandidates,
    gridStepPct: config.value.gridStepPct,
    scoreLabel: "Probabilité simulée d'atteindre la cible",
    goalSummary: state.best?.metadata ?? null,
  };
}
