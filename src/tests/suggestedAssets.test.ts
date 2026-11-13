import { describe, expect, it } from "vitest";
import { suggestProfileAssets } from "../optimization/suggestedAssets";
import { assets, historicalData } from "./fixtures";

describe("suggested asset universes", () => {
  it("automatically selects a bounded candidate universe from every eligible historical asset", () => {
    const data = historicalData("usd");
    const result = suggestProfileAssets(assets, data, 2001, 2025, "nominal", "controlled");
    expect(result.eligibleCount).toBeGreaterThan(10);
    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(6);
    expect(result.ids).not.toContain("bitcoin");
    expect(new Set(result.ids).size).toBe(result.ids.length);
    expect(result.diagnostics.join(" ")).toMatch(/heuristique/i);
  });

  it("rejects insufficient common history rather than comparing non-comparable periods", () => {
    const result = suggestProfileAssets(assets, historicalData("usd"), 2021, 2025, "nominal", "growth");
    expect(result.ids).toEqual([]);
    expect(result.diagnostics.join(" ")).toMatch(/10 années/i);
  });

  it("returns a deterministic selection for an unchanged universe and profile", () => {
    const data = historicalData("usd");
    const first = suggestProfileAssets(assets, data, 2001, 2025, "nominal", "robust");
    const second = suggestProfileAssets(assets, data, 2001, 2025, "nominal", "robust");
    expect(first).toEqual(second);
  });
});
