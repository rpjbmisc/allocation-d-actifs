import { describe, expect, it } from "vitest";
import { optimize } from "../analytics";
import { rows } from "./fixtures";

function inputs(data: Record<string, ReturnType<typeof rows>>) {
  return {
    data,
    assetIds: Object.keys(data),
    trainStart: 2000,
    trainEnd: 2002,
    returnMode: "nominal" as const,
    rebalancing: "annual" as const,
  };
}

describe("growth optimization contract", () => {
  it("finds the known CAGR optimum under an explicit per-asset cap", () => {
    const data = { a: rows([10, 10, 10]), b: rows([5, 5, 5]), c: rows([0, 0, 0]) };
    const constraints = {
      longOnly: true as const,
      maxWeightByAsset: { a: 0.5, b: 1, c: 1 },
      gridStepPct: 10,
    };

    const first = optimize("growth", inputs(data), constraints);
    const second = optimize("growth", inputs(data), constraints);

    expect(first).toEqual(second);
    expect(first.feasible).toBe(true);
    expect(first.weights).toEqual({ a: 0.5, b: 0.5, c: 0 });
    expect(first.score).toBeCloseTo(7.5);
  });

  it("rejects candidates exceeding the annual closing drawdown budget", () => {
    const data = { risky: rows([-50, -50, -50]), stable: rows([5, 5, 5]) };
    const result = optimize("growth", inputs(data), {
      longOnly: true,
      maxAnnualCloseDrawdownPct: 0,
      gridStepPct: 50,
    });

    expect(result.feasible).toBe(true);
    expect(result.weights).toEqual({ risky: 0, stable: 1 });
    expect(result.stats?.maxDrawdown).toBe(0);
  });

  it("applies the optional annual volatility budget", () => {
    const data = { volatile: rows([20, -20, 20]), stable: rows([5, 5, 5]) };
    const result = optimize("growth", inputs(data), {
      longOnly: true,
      maxAnnualVolatilityPct: 0,
      gridStepPct: 50,
    });

    expect(result.feasible).toBe(true);
    expect(result.weights).toEqual({ volatile: 0, stable: 1 });
    expect(result.stats?.volatility).toBe(0);
  });

  it("reports an impossible allocation instead of returning a fallback optimum", () => {
    const data = { a: rows([10, 10, 10]), b: rows([5, 5, 5]) };
    const result = optimize("growth", inputs(data), {
      longOnly: true,
      maxWeightByAsset: { a: 0.4, b: 0.4 },
      gridStepPct: 10,
    });

    expect(result.feasible).toBe(false);
    expect(result.weights).toBeNull();
    expect(result.evaluatedCandidates).toBe(0);
    expect(result.diagnostics.join(" ")).toMatch(/impossible/i);
  });

  it("keeps the deterministic search bounded by its evaluation budget", () => {
    const data = {
      a: rows([10, 10, 10]),
      b: rows([9, 9, 9]),
      c: rows([8, 8, 8]),
      d: rows([7, 7, 7]),
    };
    const result = optimize("growth", inputs(data), {
      longOnly: true,
      gridStepPct: 1,
      maxEvaluations: 3,
    });

    expect(result.evaluatedCandidates).toBeLessThanOrEqual(3);
    expect(result.diagnostics.join(" ")).toMatch(/budget déterministe/i);
  });
});
