import { describe, it, expect } from "vitest";
import { rows } from "./fixtures";
import {
  normalizeRows, alignAnnualSeries, auditRows, localizeRows, returnValue, computeStats,
  cagr, geometricMean, volatility, computePortfolio, normalizeWeights, validateWeights,
  computeCorrelationDetails, computeDiversificationMetrics, covariance,
  searchPortfolioCandidates, searchPortfolioOptimizationProfiles, searchPortfolioAcrossWindows,
  computeGrowthData, computeDecadeData,
} from "../analytics";

describe("annual data contract", () => {
  it("normalizes aliases and locale numbers without inventing a baseline return", () => {
    const result = normalizeRows([{ Year: 2001, Index: "1 200,5", Annual_Return_Pct: "10,5" }, { year: 2000, Price: 1000, Annual_Return_Pct: " " }]);
    expect(result.map(r => r.year)).toEqual([2000, 2001]);
    expect(result[0].nominal).toBeNaN(); expect(result[1].price).toBe(1200.5); expect(result[1].nominal).toBe(10.5);
    expect(alignAnnualSeries({ a: result }, ["a"], 2000, 2001, "nominal")).toMatchObject({ ok: true, years: [2001] });
  });
  it.each([
    ["hole", rows([10, 20, 30]).filter(r => r.year !== 2001)],
    ["missing return", rows([10, NaN, 30])],
    ["duplicate", [rows([10])[0], rows([20])[0]]],
    ["unsorted", rows([10, 20]).reverse()],
    ["nonfinite", rows([10, Infinity])],
    ["below total loss", rows([10, -101])],
    ["fractional year", [{ ...rows([10])[0], year: 2000.5 }]],
  ])("rejects %s instead of compressing years", (_, series) => {
    const result = alignAnnualSeries({ a: series }, ["a"], 2000, 2002, "nominal");
    expect(result.ok).toBe(false); expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(computePortfolio({ a: series }, { a: 100 }, 2000, 2002, "nominal")).toBeNull();
    expect(computeStats(series, 2000, 2002, "nominal")).toBeNull();
  });
  it("does not truncate missing start or end and does not zero-fill initial levels", () => {
    const series = rows([NaN, 10, 10]);
    const p = computePortfolio({ a: series }, { a: 100 }, 2000, 2002, "nominal")!;
    expect(p.count).toBe(2); expect(p.cagr).toBeCloseTo(10); expect(p.points[0].year).toBe(2001);
    expect(computePortfolio({ a: rows([10]) }, { a: 100 }, 1999, 2000, "nominal")).toBeNull();
    expect(computePortfolio({ a: series }, { a: 100 }, 2000, 2003, "nominal")).toBeNull();
    expect(computeStats(rows([NaN]), 2000, 2000, "nominal")).toBeNull();
  });
  it("audits invalid years, levels and registry bounds", () => {
    expect(auditRows(rows([10, 20]), { startYear: 1999, endYear: 2001 }).map(i => i.code)).toContain("metadata_mismatch");
    expect(auditRows([{ ...rows([10])[0], price: -1 }])[0].code).toBe("invalid_level");
    expect(auditRows(normalizeRows([{ Year: "bad" }])).length).toBeGreaterThan(0);
  });
});

describe("currency and French inflation", () => {
  it("combines uncovered USD/EUR geometrically then deflates once", () => {
    const context = { usdPerEur: { 1999: 1, 2000: 1.1 }, frenchInflation: { 2000: 10 } };
    const eur = localizeRows(rows([21]), "eur", context)[0];
    expect(eur.nominal).toBeCloseTo(10); expect(eur.real).toBeCloseTo(0);
    expect(localizeRows(rows([21]), "usd", context)[0].nominal).toBeCloseTo(21);
    expect(localizeRows(rows([0]), "eur", { usdPerEur: { 1999: 1, 2000: 1 }, frenchInflation: { 2000: 0 } })[0].real).toBeCloseTo(0);
  });
  it("refuses absent/nonpositive FX and inflation at or below -100%", () => {
    for (const fx of [0, -1, NaN]) expect(localizeRows(rows([10]), "eur", { usdPerEur: { 1999: 1, 2000: fx }, frenchInflation: {} })[0].nominal).toBeNaN();
    const r = localizeRows(rows([10]), "usd", { usdPerEur: {}, frenchInflation: { 2000: -100 } })[0];
    expect(returnValue(r, "real")).toBeNull(); expect(returnValue(r, "nominal")).toBeCloseTo(10);
    expect(localizeRows(rows([10]), "usd", { usdPerEur: {}, frenchInflation: {} })[0].real).toBeNaN();
  });
});

describe("portfolio, metrics and constraints", () => {
  it("compounds constant returns and uses population volatility", () => {
    const p = computePortfolio({ a: rows([10, 10, 10]) }, { a: 100 }, 2000, 2002, "nominal")!;
    expect(p.cagr).toBeCloseTo(10); expect(p.points.at(-1)!.value).toBeCloseTo(133.1);
    expect(p.volatility).toBe(0); expect(p.grossReturnToVolatility).toBeNull();
    expect(volatility([0, 20])).toBe(10); expect(volatility([10])).toBeNaN();
    expect(geometricMean([NaN])).toBeNull(); expect(cagr(100, 121, 2)).toBeCloseTo(10);
  });
  it("includes the initial capital peak and recovery after a first-year loss", () => {
    const p = computePortfolio({ a: rows([-50, 100]) }, { a: 100 }, 2000, 2001, "nominal")!;
    expect(p.cagr).toBeCloseTo(0); expect(p.maxDrawdown).toBe(-50); expect(p.recoveryYears).toBe(1);
    expect(p.grossReturnToVolatility).toBeCloseTo(25 / 75);
  });
  it("handles bankruptcy and a single observed return without fictional risk metrics", () => {
    const p = computePortfolio({ a: rows([-100, 50]) }, { a: 100 }, 2000, 2001, "nominal")!;
    expect(p.cagr).toBe(-100); expect(p.points.at(-1)!.value).toBe(0); expect(p.maxDrawdown).toBe(-100);
    const single = computePortfolio({ a: rows([10]) }, { a: 100 }, 2000, 2000, "nominal")!;
    expect(single.cagr).toBeCloseTo(10); expect(single.volatility).toBeNaN(); expect(single.grossReturnToVolatility).toBeNull();
  });
  it("rebalances every year and explicitly normalizes arbitrary slider totals", () => {
    const data = { a: rows([100, -50]), b: rows([0, 0]) };
    const p = computePortfolio(data, { a: 30, b: 30 }, 2000, 2001, "nominal")!;
    expect(p.points.map(p => p.return)).toEqual([50, -25]); expect(p.points.at(-1)!.value).toBe(112.5);
    expect(p.cagr).toBeCloseTo((Math.sqrt(1.125) - 1) * 100);
    expect(normalizeWeights({ a: 30, b: 30 })).toEqual({ a: .5, b: .5 });
    expect(validateWeights({ a: .5, b: .5 })).toEqual([]);
    expect(validateWeights({ a: .5 }, { a: .4 }).length).toBe(2);
    for (const weights of ([{ a: -1, b: 101 }, { a: NaN }, { a: Infinity }, { a: 0 }, {}] as Record<string, number>[])) {
      expect(normalizeWeights(weights)).toBeNull(); expect(computePortfolio(data, weights, 2000, 2001, "nominal")).toBeNull();
    }
  });
});

describe("correlation and common-sample diversification", () => {
  const data = { a: rows([-1, 1, -1, 1]), b: rows([-1, -1, 1, 1]), same: rows([-1, 1, -1, 1]), opposite: rows([1, -1, 1, -1]) };
  it("has exact reference Pearson correlations 0, +1, -1 and observation counts", () => {
    const matrix = computeCorrelationDetails(data, Object.keys(data), 2000, 2003, "nominal");
    expect(matrix.a.b).toEqual({ value: 0, observations: 4 }); expect(matrix.a.same.value).toBeCloseTo(1); expect(matrix.a.opposite.value).toBeCloseTo(-1);
    expect(computeCorrelationDetails({ a: rows([5, 5]) }, ["a"], 2000, 2001, "nominal").a.a.value).toBeNull();
    expect(covariance([1, 2], [1, 2])).toBe(.25);
  });
  it.each([[50, 50], [90, 10]])("excludes diagonal for %s/%s but includes variances in portfolio risk", (a, b) => {
    const p = computePortfolio(data, { a, b }, 2000, 2003, "nominal")!;
    const m = computeDiversificationMetrics(data, ["a", "b"], { a, b }, p, 2000, 2003, "nominal");
    expect(m.weightedCorrelation).toBe(0);
    expect(m.diversificationRatio).toBeCloseTo(1 / Math.sqrt((a / 100) ** 2 + (b / 100) ** 2));
  });
  it("makes monoasset correlation unavailable, ignores zero weights and rejects missing years", () => {
    const p = computePortfolio(data, { a: 100 }, 2000, 2003, "nominal")!;
    expect(computeDiversificationMetrics(data, ["a", "b"], { a: 100, b: 0 }, p, 2000, 2003, "nominal")).toEqual({ weightedCorrelation: null, diversificationRatio: 1 });
    const broken = { ...data, b: data.b.slice(1) };
    expect(computeDiversificationMetrics(broken, ["a", "b"], { a: 50, b: 50 }, p, 2000, 2003, "nominal")).toEqual({ weightedCorrelation: null, diversificationRatio: null });
  });
});

describe("legacy grid isolation", () => {
  const data = { a: rows([10, 10, 10]), b: rows([0, 0, 0]) };
  it("finds the known optimum deterministically, respects grid and risk limits", () => {
    const find = () => searchPortfolioCandidates(data, ["a", "b"], 2000, 2002, "nominal", 40, 25);
    expect(find()).toEqual(find()); expect(find()[0].weights).toEqual({ a: 100, b: 0 });
    expect(find().every(c => Object.values(c.weights).every(w => w % 25 === 0))).toBe(true);
    expect(searchPortfolioOptimizationProfiles(data, ["a"], 2000, 2002, "nominal", 40).returnCandidate!.weights).toEqual({ a: 100 });
    expect(searchPortfolioCandidates({ a: rows([-50, -50]) }, ["a"], 2000, 2001, "nominal", 40)).toEqual([]);
    expect(searchPortfolioCandidates(data, ["a"], 2000, 2002, "nominal", 40, 3)).toEqual([]);
  });
  it("never optimizes incomparable or shortened histories, including zero-weight candidates", () => {
    const broken = { ...data, b: rows([NaN, NaN, 0]) };
    expect(searchPortfolioCandidates(broken, ["a", "b"], 2000, 2002, "nominal", 40)).toEqual([]);
    expect(searchPortfolioOptimizationProfiles(broken, ["a", "b"], 2000, 2002, "nominal", 40).returnCandidate).toBeNull();
    expect(searchPortfolioAcrossWindows(data, ["a", "b"], [{ start: 2000, end: 2002 }], "nominal", 40, "worstCagr", 25)!.weights).toEqual({ a: 100, b: 0 });
  });
});

it("charts use the same continuity and baseline policy, including historical/decade CAGR", () => {
  const data = { a: rows([NaN, 10, 10]) };
  expect(computeGrowthData(data, ["a"], 2000, 2002, "nominal")).toEqual([{ year: 2000, a: 100 }, { year: 2001, a: 110 }, { year: 2002, a: 121 }]);
  expect(computeDecadeData(data, ["a"], 2000, 2002, "nominal")[0].a).toBeCloseTo(10);
  expect(computeGrowthData({ a: rows([10, NaN, 10]) }, ["a"], 2000, 2002, "nominal")).toEqual([]);
});

it("does not turn invalid source returns or missing conversion/inflation into a baseline", () => {
  const invalid = normalizeRows([{ Year: 2000, Series_Level: 100, Annual_Return_Pct: "bad" }, { Year: 2001, Series_Level: 110, Annual_Return_Pct: 10 }]);
  expect(auditRows(invalid).some(i => i.code === "invalid_return")).toBe(true);
  expect(computeStats(invalid, 2000, 2001, "nominal")).toBeNull();
  const missingInflation = localizeRows(rows([10, 10]), "usd", { usdPerEur: {}, frenchInflation: { 2001: 0 } });
  expect(computeStats(missingInflation, 2000, 2001, "real")).toBeNull();
  const missingFx = localizeRows(rows([10, 10]), "eur", { usdPerEur: { 2000: 1, 2001: 1 }, frenchInflation: { 2000: 0, 2001: 0 } });
  expect(computeStats(missingFx, 2000, 2001, "nominal")).toBeNull();
});
