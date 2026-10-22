import { optimizeGrowth } from "./growth";
import { optimizeRobust } from "./robust";
import { optimizeGoal } from "./goal";
import type { GoalSettings, GoalSummary } from "./goal";
import type { Mode, PortfolioStats, Row } from "../domain/types";
import type { ScenarioSettings, ScenarioSummary } from "../scenarios/generator";

export type StrategyId = "growth" | "robust" | "goal";

export interface AllocationInput {
  data: Record<string, Row[]>;
  assetIds: string[];
  currency?: "eur" | "usd";
  returnMode?: Mode;
  trainStart: number;
  trainEnd: number;
  rebalancing?: "annual";
  scenarioSettings?: Partial<ScenarioSettings>;
  goalSettings?: Partial<GoalSettings>;
}

/** Weights are fractions; risk budgets and grid resolution are percentage points. */
export interface PortfolioConstraints {
  longOnly: true;
  minWeight?: number;
  maxWeightByAsset?: Record<string, number>;
  maxAnnualCloseDrawdownPct?: number | null;
  maxAnnualVolatilityPct?: number | null;
  gridStepPct?: number;
  maxEvaluations?: number;
}

export interface OptimizationResult {
  strategy: StrategyId;
  weights: Record<string, number> | null;
  feasible: boolean;
  diagnostics: string[];
  score: number | null;
  stats: PortfolioStats | null;
  evaluatedCandidates: number;
  gridStepPct: number | null;
  scoreLabel?: string;
  scenarioSummary?: ScenarioSummary | null;
  goalSummary?: GoalSummary | null;
}

export function optimize(strategy: StrategyId, inputs: AllocationInput, constraints: PortfolioConstraints): OptimizationResult {
  if (strategy === "growth") return optimizeGrowth(inputs, constraints);
  if (strategy === "robust") return optimizeRobust(inputs, constraints);
  if (strategy === "goal") return optimizeGoal(inputs, constraints);
  return {
    strategy,
    weights: null,
    feasible: false,
    diagnostics: [`La stratégie ${strategy} sera implémentée dans une phase ultérieure.`],
    score: null,
    stats: null,
    evaluatedCandidates: 0,
    gridStepPct: null,
  };
}
