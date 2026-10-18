import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { assets, read, historicalData } from "./fixtures";
import reference from "./fixtures/legacy-reference.json";
import { auditRows, normalizeRows, computePortfolio, computeStats, computeDiversificationMetrics } from "../analytics";
import { loadHistoricalData } from "../data/load";

export const diskFetch = async (url: string): Promise<Response> => {
  try { return new Response(await readFile(`public/${url.replace(/^\//, "")}`, "utf8")); }
  catch { return new Response("missing", { status: 404 }); }
};

describe("historical input audit", () => {
  it.each(assets)("preserves and validates $id observations and registry bounds", asset => {
    expect(auditRows(normalizeRows(read(asset.csvFile)), asset)).toEqual([]);
  });
  it("loads the real registry, CSV series, FX, CPI and static presets", async () => {
    const loaded = await loadHistoricalData("/", diskFetch);
    expect(loaded.assets).toHaveLength(15); expect(Object.keys(loaded.rawData)).toHaveLength(15); expect(loaded.presets.length).toBeGreaterThan(0);
    expect(loaded.currencyContext.usdPerEur[2000]).toBeGreaterThan(0);
  });
  it("reports missing files rather than silently loading an empty asset", async () => {
    await expect(loadHistoricalData("/", url => url.endsWith(assets[0].csvFile) ? Promise.resolve(new Response("", { status: 404 })) : diskFetch(url))).rejects.toThrow(assets[0].csvFile);
  });
});

describe("pre-refactor dashboard references, equal-weight default assets 1970–2025", () => {
  for (const currency of ["usd", "eur"] as const) for (const mode of ["nominal", "real"] as const) {
    it(`${currency} ${mode}: unchanged financial values; explained off-diagonal correction`, () => {
      const data = historicalData(currency);
      const ids = ["msci_world", "gold", "us_lt_govt_bonds"];
      const weights = Object.fromEntries(ids.map(id => [id, 100 / 3]));
      const baseline = reference[`${currency}_${mode}`];
      const p = computePortfolio(data, weights, 1970, 2025, mode)!;
      expect(p.count).toBe(baseline.portfolio.count);
      for (const key of ["cagr", "volatility", "maxDrawdown"] as const) expect(p[key]).toBeCloseTo(baseline.portfolio[key]!, 9);
      expect(p.points.at(-1)!.value).toBeCloseTo(baseline.portfolio.finalValue, 8);
      for (const id of ids) {
        const actual = computeStats(data[id], 1970, 2025, mode)!;
        const expected = baseline.stats[id as keyof typeof baseline.stats];
        for (const key of ["count", "cagrNominal", "cagrReal", "volatility", "positiveRate"] as const) expect(actual[key]).toBeCloseTo(expected[key]!, 9);
      }
      const metrics = computeDiversificationMetrics(data, ids, weights, p, 1970, 2025, mode);
      expect(metrics.diversificationRatio).toBeCloseTo(baseline.diversification.diversificationRatio!, 9);
      // Old equal-weight average included 3 diagonal ones among 9 terms.
      expect(metrics.weightedCorrelation).toBeCloseTo((3 * baseline.diversification.weightedCorrelation! - 1) / 2, 9);
    });
  }
});

it("rejects malformed CSV and inconsistent registry bounds without changing source files", async () => {
  await expect(loadHistoricalData("/", async url => url.endsWith(assets[0].csvFile)
    ? new Response('Year,Series_Level,Annual_Return_Pct\n2000,100,10,unexpected\n') : diskFetch(url))).rejects.toThrow("CSV invalide");
  await expect(loadHistoricalData("/", async url => url.endsWith("assets_index.json")
    ? new Response(JSON.stringify(assets.map((a, i) => i ? a : { ...a, startYear: a.startYear - 1 }))) : diskFetch(url))).rejects.toThrow("Bornes du registre");
});
