import { describe, expect, it } from "vitest";
import { optimize, terminalGoalCapital, summarizeGoal, validateGoalSettings } from "../analytics";
import { rows } from "./fixtures";

describe("goal-based portfolio simulation", () => {
  const goal = { initialCapital: 100, annualContribution: 10, targetCapital: 140, horizonYears: 2 };
  const scenario = { index: 0, sourceYears: [2000, 2001], annualReturns: { a: [10, -10], b: [0, 0] } };

  it("compounds returns and adds cash at each year end", () => {
    expect(terminalGoalCapital(scenario, { a: 100 }, goal)).toBeCloseTo((100 * 1.1 + 10) * 0.9 + 10);
    expect(terminalGoalCapital(scenario, { b: 100 }, goal)).toBe(120);
  });

  it("evaluates success with the boundary inclusive", () => {
    const summary = summarizeGoal([
      { index: 0, sourceYears: [2000, 2001], annualReturns: { a: [10, 10] } },
      { index: 1, sourceYears: [2000, 2001], annualReturns: { a: [0, 0] } },
    ], { a: 100 }, { initialCapital: 100, annualContribution: 0, targetCapital: 121, horizonYears: 2 });
    expect(summary?.probabilityPct).toBe(50);
    expect(summary?.medianCapital).toBeCloseTo(110.5);
  });

  it("rejects invalid goals", () => {
    expect(validateGoalSettings({ initialCapital: -2 }).diagnostics.length).toBeGreaterThan(0);
    expect(validateGoalSettings({ initialCapital: 0, annualContribution: 0 }).diagnostics.length).toBeGreaterThan(0);
    expect(validateGoalSettings({ horizonYears: 0 }).diagnostics.length).toBeGreaterThan(0);
  });

  it("optimizes deterministically with the same scenario settings", () => {
    const input = {
      data: { risky: rows([12, 12, 12, 12]), safe: rows([1, 1, 1, 1]) },
      assetIds: ["risky", "safe"],
      trainStart: 2000, trainEnd: 2003, returnMode: "nominal" as const,
      goalSettings: { initialCapital: 100, annualContribution: 0, targetCapital: 120, horizonYears: 2 },
      scenarioSettings: { scenarioCount: 32, seed: 123, blockYears: 1 },
    };
    const constraints = { longOnly: true as const, gridStepPct: 50, maxEvaluations: 50 };
    const result = optimize("goal", input, constraints);
    expect(result).toEqual(optimize("goal", input, constraints));
    expect(result.feasible).toBe(true);
    expect(result.weights?.risky).toBe(1);
    expect(result.goalSummary?.probabilityPct).toBe(100);
  });

  it("uses the selected real/nominal return mode, not an implicit inflation forecast", () => {
    const input = { data: { a: rows([12, 12, 12]) }, assetIds: ["a"], trainStart: 2000, trainEnd: 2002,
      returnMode: "nominal" as const,
      goalSettings: { initialCapital: 100, annualContribution: 0, targetCapital: 125, horizonYears: 2 },
      scenarioSettings: { scenarioCount: 6, seed: 4 },
    };
    expect(optimize("goal", input, { longOnly: true, gridStepPct: 100 }).goalSummary?.probabilityPct).toBe(100);
  });
});
