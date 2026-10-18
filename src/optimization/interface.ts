import { optimizeGrowth } from "./growth";
import type { Mode, PortfolioStats, Row } from "../domain/types";

export type StrategyId = "growth" | "robust" | "goal";

export interface AllocationInput {
  data: Record<string, Row[]>;
  assetIds: string[];
  currency?: "eur" | "usd";
  returnMode?: Mode;
  trainStart: number;
  trainEnd: number;
  rebalancing?: "annual";
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
}

export function optimize(strategy: StrategyId, inputs: AllocationInput, constraints: PortfolioConstraints): OptimizationResult {
  if (strategy === "growth") return optimizeGrowth(inputs, constraints);
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
