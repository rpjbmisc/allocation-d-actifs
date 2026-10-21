import { describe, expect, it } from "vitest";
import { rows } from "./fixtures";
import { buildWalkForwardWindows, calculateWeightStability, runWalkForward, weightStabilityLabel } from "../analytics";

const constraints = {
  longOnly: true as const,
  maxAnnualCloseDrawdownPct: null,
  maxAnnualVolatilityPct: null,
  gridStepPct: 50,
  maxEvaluations: 100,
};

describe("walk-forward validation", () => {
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
      constraints,
      benchmarkAssetId: null,
    });
    const first = runWalkForward(input(before));
    const second = runWalkForward(input(after));
    expect(first.windows).toHaveLength(1);
    expect(first.strategies.find(strategy => strategy.id === "growth")?.windows[0].weights).toEqual(
      second.strategies.find(strategy => strategy.id === "growth")?.windows[0].weights,
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
