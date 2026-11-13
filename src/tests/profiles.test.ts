import { describe, expect, it } from "vitest";
import { allocationProfiles, defaultConstraintsForProfile, DEFAULT_ALLOCATION_PROFILE } from "../optimization/profiles";

describe("dynamic allocation intents", () => {
  it("exposes four distinct objectives, with no dedicated Bitcoin preset", () => {
    expect(allocationProfiles.map(profile => profile.id)).toEqual(["growth", "controlled", "robust", "goal"]);
    expect(DEFAULT_ALLOCATION_PROFILE).toBe("controlled");
    expect(allocationProfiles.every(profile => !profile.description.includes("2014–2025"))).toBe(true);
  });

  it("keeps an unrestricted historical growth profile and explicit, editable cautious starting budgets", () => {
    expect(defaultConstraintsForProfile("growth")).toEqual({
      maxAnnualCloseDrawdownPct: null,
      maxAnnualVolatilityPct: null,
      maxWeightPct: 100,
    });
    for (const id of ["controlled", "robust", "goal"] as const) {
      expect(defaultConstraintsForProfile(id)).toEqual({
        maxAnnualCloseDrawdownPct: 40,
        maxAnnualVolatilityPct: 25,
        maxWeightPct: 50,
      });
    }
  });
});
