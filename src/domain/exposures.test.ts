import { describe, expect, it } from "vitest";
import { calculatePortfolioExposure, type ExposureRegistry } from "./exposures";

const registry: ExposureRegistry = {
  schemaVersion: 2,
  updated: "2026-11-14",
  assets: {
    world: { kind: "equity", countries: { US: 100 }, sizes: { Large: 85.59, Mid: 14.41 }, sizeMethod: "documented", factor: "none" },
    em: { kind: "equity", countries: { TW: 100 }, sizes: { Large: 82.35, Mid: 17.65 }, sizeMethod: "estimated", factor: "none" },
    pacific: { kind: "equity", countries: { AU: 100 }, sizes: { Large: 70.71, Mid: 15.15, Small: 14.14 }, sizeMethod: "estimated" },
    small: { kind: "equity", countries: { US: 100 }, sizes: { Small: 100 }, sizeMethod: "documented", factor: "value" },
    quality: { kind: "equity", countries: { GB: 100 }, sizes: { large_mid: 100 }, factor: "quality", styles: { Value: 20, Blend: 50, Growth: 30 } },
    gold: { kind: "other", assetClass: "Or" },
  },
};
const pct = (rows: { name: string; percent: number }[], name: string) =>
  rows.find((item) => item.name === name)?.percent ?? 0;
describe("portfolio exposures - data provenance and dimensional separation", () => {
  it("normalises to the equity sleeve and keeps estimated vs measured sizes separate", () => {
    const report = calculatePortfolioExposure({world: 55, em: 12, pacific: 3, small: 10, quality: 4, gold: 16}, registry)!;
    expect(report.equityShare).toBe(84);
    expect(report.otherShare).toBe(16);
    expect(report.breakdown.sizes.reduce((s,r)=>s+r.percent,0)).toBeCloseTo(100);
    expect(report.precision.sizes).toBeCloseTo(65/84*100);
    expect(report.precision.sizesEstimated).toBeCloseTo(15/84*100);
    expect(pct(report.breakdown.sizes,"Petites capitalisations")).toBeCloseTo((10+3*.1414)/84*100);
  });
  it("does not treat cap-weighted indices as 100% blend or zero-growth", () => {
    const report = calculatePortfolioExposure({world: 55,small:10,quality:4},registry)!;
    expect(pct(report.breakdown.styles,"Style non documenté")).toBeCloseTo(65/69*100);
    expect(report.precision.styles).toBeCloseTo(4/69*100);
    expect(pct(report.breakdown.factors,"Indice à biais Value")).toBeCloseTo(10/69*100);
    expect(pct(report.breakdown.factors,"Indice à biais Quality")).toBeCloseTo(4/69*100);
    expect(pct(report.breakdown.factors,"Indice sans filtre factoriel explicite")).toBeCloseTo(55/69*100);
  });
  it("does not invent precision when style or size data is absent",()=>{
    const report=calculatePortfolioExposure({quality:100},registry)!;
    expect(report.precision.styles).toBe(100);
    expect(report.precision.sizes).toBe(0);
    expect(pct(report.breakdown.sizes,"Grandes et moyennes (non séparées)")).toBe(100);
  });
  it("handles zero equity and unknown entries without NaN",()=>{
    const report=calculatePortfolioExposure({gold:50,missing:50},registry)!;
    expect(report.equityShare).toBe(0);
    expect(report.otherShare).toBe(50);
    expect(report.unknownAssetShare).toBe(50);
    expect(report.breakdown.styles).toEqual([]);
  });
});
