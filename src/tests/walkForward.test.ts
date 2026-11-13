import { describe, expect, it, vi } from "vitest";
import * as optimization from "../optimization/interface";
import { defaultProspectiveSettings } from "../scenarios/prospective";
import { rows } from "./fixtures";
import { buildWalkForwardWindows, calculateWeightStability, combineWalkForwardResults, runWalkForward, runWalkForwardOptimized, runWalkForwardFixed, weightStabilityLabel } from "../analytics";

const constraints = {
  longOnly: true as const,
  maxAnnualCloseDrawdownPct: null,
  maxAnnualVolatilityPct: null,
  gridStepPct: 50,
  maxEvaluations: 100,
};

describe("walk-forward validation", () => {
  it("updates custom validation without rerunning optimizers and retains the goal strategy", () => {
    const input = {
      data: { a: rows([10, 10, 10, 5, 5]), b: rows([5, 5, 5, 10, 10]) },
      assetIds: ["a", "b"], periodStart: 2000, periodEnd: 2004,
      returnMode: "nominal" as const, customWeights: { a: 100, b: 0 },
      settings: { minTrainYears: 3, testYears: 2, expanding: true }, constraints,
      scenarioSettings: { scenarioCount: 20, horizonYears: 4, blockYears: 1, seed: 99, quantilePct: 20 },
    };
    const optimized = runWalkForwardOptimized(input);
    const spy = vi.spyOn(optimization, "optimize");
    try {
      const fixed = runWalkForwardFixed({ ...input, customWeights: { a: 0, b: 100 } });
      expect(spy).not.toHaveBeenCalled();
      const combined = combineWalkForwardResults(optimized, fixed);
      expect(combined.strategies.map(strategy => strategy.id)).toEqual(["growth", "robust", "goal", "custom", "equal", "benchmark"]);
      expect(combined.strategies.find(strategy => strategy.id === "custom")!.stats!.points.map(point => point.return)).toEqual([10, 10]);
      expect(combined.strategies.find(strategy => strategy.id === "goal")).toEqual(optimized.strategies.find(strategy => strategy.id === "goal"));
    } finally { spy.mockRestore(); }
  });

  it("validates the same four-future optimizer as Tout-terrain using training data only", () => {
    const settings = { ...defaultProspectiveSettings(), pathsPerRegime: 5 };
    const sample = (secondBlock: number[]) => ({
      data: {
        sp500: rows([8, 9, 7, ...secondBlock]),
        gold: rows([3, 4, 5, 4, 5]),
      },
      assetIds: ["sp500", "gold"],
      periodStart: 2000,
      periodEnd: 2004,
      returnMode: "nominal" as const,
      settings: { minTrainYears: 3, testYears: 2, expanding: true },
      scenarioSettings: { scenarioCount: 10, horizonYears: 25, blockYears: 1, seed: 42, quantilePct: 20 },
      prospectiveSettings: settings,
      constraints,
    });
    const first = runWalkForwardOptimized(sample([30, 40]));
    const second = runWalkForwardOptimized(sample([-30, -40]));
    const terrain1 = first.strategies.find(strategy => strategy.id === "robust")!;
    const terrain2 = second.strategies.find(strategy => strategy.id === "robust")!;
    expect(terrain1.label).toBe("Tout-terrain");
    expect(terrain1.windows[0].optimization?.prospectiveSummary?.regimeCagrs).toHaveLength(4);
    expect(terrain1.windows[0].optimization?.scenarioSummary).toBeUndefined();
    expect(terrain1.windows[0].weights).toEqual(terrain2.windows[0].weights);
  });

  it("calculates weight rotation in percentage points and classifies stability", () => {
    const result = calculateWeightStability([
      { stocks: 0.8, gold: 0.2 },
      { stocks: 0.6, gold: 0.4 },
    ]);
    expect(result.turnover).toBeCloseTo(20);
    expect(result.stability).toBeCloseTo(80);
    expect(weightStabilityLabel(result.stability)).toBe("Très stable");
    expect(weightStabilityLabel(53.3)).toBe("Variable");
    expect(calculateWeightStability([{ stocks: 1 }])).toEqual({ turnover: null, stability: null });
  });

  it("creates expanding training windows and non-overlapping tests", () => {
    const data = { a: rows(Array(12).fill(5)), b: rows(Array(12).fill(3)) };
    expect(buildWalkForwardWindows(data, ["a", "b"], 2000, 2011, "nominal", { minTrainYears: 3, testYears: 2, expanding: true })).toEqual([
      { index: 0, trainStart: 2000, trainEnd: 2002, testStart: 2003, testEnd: 2004 },
      { index: 1, trainStart: 2000, trainEnd: 2004, testStart: 2005, testEnd: 2006 },
      { index: 2, trainStart: 2000, trainEnd: 2006, testStart: 2007, testEnd: 2008 },
      { index: 3, trainStart: 2000, trainEnd: 2008, testStart: 2009, testEnd: 2010 },
    ]);
  });

  it("does not use future test returns to choose earlier weights", () => {
    const before = {
      a: rows([10, 10, 10, 100, 100]),
      b: rows([5, 5, 5, 0, 0]),
    };
    const after = {
      a: rows([10, 10, 10, -100, -100]),
      b: rows([5, 5, 5, 50, 50]),
    };
    const input = (data: typeof before) => ({
      data,
      assetIds: ["a", "b"],
      periodStart: 2000,
      periodEnd: 2004,
      returnMode: "nominal" as const,
      customWeights: { a: 50, b: 50 },
      settings: { minTrainYears: 3, testYears: 2, expanding: true },
      scenarioSettings: { scenarioCount: 20, horizonYears: 4, blockYears: 1, seed: 99, quantilePct: 20 },
      constraints,
      benchmarkAssetId: null,
    });
    const first = runWalkForward(input(before));
    const second = runWalkForward(input(after));
    expect(first.windows).toHaveLength(1);
    expect(first.strategies.find(strategy => strategy.id === "growth")?.windows[0].weights).toEqual(
      second.strategies.find(strategy => strategy.id === "growth")?.windows[0].weights,
    );
    expect(first.strategies.find(strategy => strategy.id === "robust")?.windows[0].weights).toEqual(
      second.strategies.find(strategy => strategy.id === "robust")?.windows[0].weights,
    );
  });

  it("composes OOS returns instead of averaging window CAGRs", () => {
    const result = runWalkForward({
      data: { a: rows([1, 1, 10, 10, -50, -50, 100, 100]) },
      assetIds: ["a"],
      periodStart: 2000,
      periodEnd: 2007,
      returnMode: "nominal",
      customWeights: { a: 100 },
      settings: { minTrainYears: 2, testYears: 2, expanding: true },
      constraints,
      benchmarkAssetId: null,
    });
    const custom = result.strategies.find(strategy => strategy.id === "custom")!;
    expect(custom.feasible).toBe(true);
    expect(custom.windows.every(window => window.weights?.a === 1)).toBe(true);
    expect(custom.stats?.points.map(point => point.return)).toEqual([10, 10, -50, -50, 100, 100]);
    expect(custom.stats?.cagr).toBeCloseTo((1.21 ** (1 / 6) - 1) * 100);
    expect(custom.stats?.cagr).not.toBeCloseTo((custom.windows.reduce((sum, window) => sum + (window.testStats?.cagr ?? 0), 0) / custom.windows.length));
  });

  it("refuses insufficient windows when a common history has a hole", () => {
    const broken = rows([5, 5, 5, 5, 5]).filter(row => row.year !== 2002);
    const result = runWalkForward({
      data: { a: broken, b: broken },
      assetIds: ["a", "b"],
      periodStart: 2000,
      periodEnd: 2004,
      returnMode: "nominal",
      customWeights: { a: 50, b: 50 },
      settings: { minTrainYears: 2, testYears: 2, expanding: true },
      constraints,
      benchmarkAssetId: null,
    });
    expect(result.windows).toEqual([]);
    expect(result.strategies.find(strategy => strategy.id === "custom")?.stats).toBeNull();
  });
});
