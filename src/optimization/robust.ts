import { alignAnnualSeries } from "../domain/data";
import { generateJointScenarios, summarizeScenarioPortfolio } from "../scenarios/generator";
import type { ScenarioSummary } from "../scenarios/generator";
import { searchGrid, validateOptimizationConfiguration } from "./growth";
import type { AllocationInput, OptimizationResult, PortfolioConstraints } from "./interface";

function emptyResult(diagnostics: string[], gridStepPct: number | null = null): OptimizationResult {
  return {
    strategy: "robust",
    weights: null,
    feasible: false,
    diagnostics,
    score: null,
    stats: null,
    evaluatedCandidates: 0,
    gridStepPct,
    scoreLabel: "TCAM simulé · quantile défavorable",
    scenarioSummary: null,
  };
}

export function optimizeRobust(inputs: AllocationInput, rawConstraints: PortfolioConstraints): OptimizationResult {
  const configuration = validateOptimizationConfiguration(inputs.assetIds, rawConstraints);
  if ("diagnostics" in configuration) return emptyResult(configuration.diagnostics, rawConstraints.gridStepPct ?? null);
  if (inputs.rebalancing !== undefined && inputs.rebalancing !== "annual") return emptyResult(["Seul le rééquilibrage annuel est disponible dans cette phase."], configuration.value.gridStepPct);

  const mode = inputs.returnMode ?? "nominal";
  const aligned = alignAnnualSeries(inputs.data, inputs.assetIds, inputs.trainStart, inputs.trainEnd, mode);
  if (!aligned.ok) return emptyResult(aligned.diagnostics.map(diagnostic => diagnostic.message), configuration.value.gridStepPct);
  if (!aligned.years.length) return emptyResult(["La fenêtre d'apprentissage ne contient aucun rendement annuel."], configuration.value.gridStepPct);

  const generated = generateJointScenarios({
    data: inputs.data,
    assetIds: inputs.assetIds,
    start: inputs.trainStart,
    end: inputs.trainEnd,
    mode,
  }, inputs.scenarioSettings);
  if (generated.diagnostics.length || !generated.scenarios.length) {
    return emptyResult(generated.diagnostics.length ? generated.diagnostics : ["Aucun scénario historique conjoint n'est disponible."], configuration.value.gridStepPct);
  }

  const state = searchGrid<ScenarioSummary>(inputs, inputs.assetIds, configuration.value, (weights) => {
    const summary = summarizeScenarioPortfolio(generated.scenarios, weights, generated.settings);
    return summary ? { score: summary.quantileCagr, metadata: summary } : null;
  });
  const diagnostics = state.best
    ? []
    : ["Aucune allocation faisable ne respecte simultanément les contraintes et la qualité des données."];
  if (state.stoppedByBudget) diagnostics.push(`Recherche arrêtée au budget déterministe de ${configuration.value.maxEvaluations.toLocaleString("fr-FR")} évaluations.`);
  if (state.best && state.stoppedByBudget) diagnostics.push("Le résultat est le meilleur candidat trouvé à la résolution choisie, pas une garantie d'optimum continu.");

  return {
    strategy: "robust",
    weights: state.best?.weights ?? null,
    feasible: state.best !== null,
    diagnostics,
    score: state.best?.score ?? null,
    stats: state.best?.stats ?? null,
    evaluatedCandidates: state.evaluatedCandidates,
    gridStepPct: configuration.value.gridStepPct,
    scoreLabel: "TCAM simulé · quantile défavorable",
    scenarioSummary: state.best?.metadata ?? null,
  };
}
