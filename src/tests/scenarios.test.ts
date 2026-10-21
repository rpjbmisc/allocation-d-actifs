import { describe, expect, it } from "vitest";
import { generateJointScenarios, scenarioPortfolioCagr, summarizeScenarioPortfolio } from "../analytics";
import { optimize } from "../analytics";
import { rows } from "./fixtures";

describe("joint historical scenarios", () => {
  const input = {
    data: {
      a: rows([1, 2, 3, 4]),
      b: rows([10, 20, 30, 40]),
    },
    assetIds: ["a", "b"],
    start: 2000,
    end: 2003,
    mode: "nominal" as const,
  };

  it("is reproducible and samples the same historical year for every asset", () => {
    const settings = { scenarioCount: 8, horizonYears: 12, blockYears: 1, seed: 42, quantilePct: 20 };
    const first = generateJointScenarios(input, settings);
    const second = generateJointScenarios(input, settings);

    expect(first).toEqual(second);
    expect(first.scenarios).toHaveLength(8);
    first.scenarios.forEach(scenario => scenario.sourceYears.forEach((year, index) => {
      expect(scenario.annualReturns.b[index]).toBe(scenario.annualReturns.a[index] * 10);
      expect(year).toBeGreaterThanOrEqual(2000);
      expect(year).toBeLessThanOrEqual(2003);
    }));
  });

  it("keeps a historical block contiguous for all assets", () => {
    const result = generateJointScenarios(input, { scenarioCount: 4, horizonYears: 8, blockYears: 2, seed: 7, quantilePct: 20 });
    result.scenarios.forEach(scenario => {
      for (let index = 1; index < scenario.sourceYears.length; index += 1) {
        const startsNewBlock = index % 2 === 0;
        if (!startsNewBlock) expect(scenario.sourceYears[index]).toBe(scenario.sourceYears[index - 1] + 1);
      }
    });
  });

  it("composes a scenario portfolio with annual rebalancing", () => {
    const scenario = {
      index: 0,
      sourceYears: [2000, 2001],
      annualReturns: { a: [10, 0], b: [0, 10] },
    };
    expect(scenarioPortfolioCagr(scenario, { a: 50, b: 50 })).toBeCloseTo(5);
    const summary = summarizeScenarioPortfolio([scenario], { a: 50, b: 50 }, {
      scenarioCount: 1,
      horizonYears: 2,
      blockYears: 1,
      seed: 1,
      quantilePct: 20,
    });
    expect(summary?.quantileCagr).toBeCloseTo(5);
    expect(summary?.fragilityCagr).toBe(0);
  });
});

describe("robust optimization", () => {
  const inputs = (data: Record<string, ReturnType<typeof rows>>) => ({
    data,
    assetIds: Object.keys(data),
    trainStart: 2000,
    trainEnd: 2003,
    returnMode: "nominal" as const,
    rebalancing: "annual" as const,
    scenarioSettings: { scenarioCount: 40, horizonYears: 6, blockYears: 1, seed: 123, quantilePct: 20 },
  });

  it("optimizes the same deterministic scenario set and returns its downside score", () => {
    const data = { growth: rows([20, -10, 20, -10]), stable: rows([5, 5, 5, 5]) };
    const constraints = { longOnly: true as const, gridStepPct: 50, maxEvaluations: 100 };
    const first = optimize("robust", inputs(data), constraints);
    const second = optimize("robust", inputs(data), constraints);

    expect(first).toEqual(second);
    expect(first.feasible).toBe(true);
    expect(first.scenarioSummary?.scenarioCount).toBe(40);
    expect(first.score).toBeCloseTo(first.scenarioSummary?.quantileCagr ?? Number.NaN);
    expect(first.scoreLabel).toMatch(/quantile/i);
  });

  it("fails explicitly when a block cannot be drawn from the training history", () => {
    const result = optimize("robust", {
      ...inputs({ a: rows([5, 5]) }),
      trainEnd: 2001,
      scenarioSettings: { scenarioCount: 10, horizonYears: 3, blockYears: 3, seed: 1, quantilePct: 20 },
    }, {
      longOnly: true,
      gridStepPct: 100,
    });
    expect(result.feasible).toBe(false);
    expect(result.weights).toBeNull();
    expect(result.diagnostics.join(" ")).toMatch(/blocs/i);
  });
});
