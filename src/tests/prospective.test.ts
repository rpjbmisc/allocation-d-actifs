import { describe, expect, it } from "vitest";
import { defaultProspectiveSettings, generateProspectiveScenarios } from "../scenarios/prospective";
import { optimizeProspective } from "../optimization/prospective";
import { rows } from "./fixtures";
const data={sp500:rows([10,-10,10,-10,10,5]),gold:rows([2,8,2,8,2,8])};
const input={data,assetIds:["sp500","gold"],start:2000,end:2005,mode:"nominal" as const};
const scenarios={scenarioCount:20,horizonYears:5,blockYears:1,seed:42,quantilePct:20};
describe("prospective robustness: hypothetical economic regimes",()=>{
  it("has four explicitly hypothetical, user-editable regimes",()=>{
    const settings=defaultProspectiveSettings();
    expect(settings.regimes).toHaveLength(4);
    expect(settings.regimes.find(r=>r.id==="inflation")?.shiftsPct.gold).toBeGreaterThan(0);
  });
  it("preserves the same draws across regimes and applies different shifts",()=>{
    const settings={...defaultProspectiveSettings(),pathsPerRegime:6};
    const result=generateProspectiveScenarios(input,scenarios,settings);
    expect(result.diagnostics).toEqual([]);
    expect(result.sets[0].scenarios[0].sourceYears).toEqual(result.sets[1].scenarios[0].sourceYears);
    expect(result.sets[0].scenarios[0].annualReturns.sp500).not.toEqual(result.sets[1].scenarios[0].annualReturns.sp500);
    expect(generateProspectiveScenarios(input,scenarios,settings)).toEqual(result);
  });
  it("is reproducible and respects allocation caps with mean, worst and regret objectives",()=>{
    const base=defaultProspectiveSettings();
    for(const objective of ["average","worst","regret"] as const){
      const settings={...base,objective,pathsPerRegime:8};
      const args={data,assetIds:["sp500","gold"],trainStart:2000,trainEnd:2005,returnMode:"nominal" as const,scenarioSettings:scenarios};
      const constraints={longOnly:true as const,maxWeightByAsset:{sp500:0.5,gold:1},gridStepPct:50,maxEvaluations:10};
      const x=optimizeProspective(args,constraints,settings);
      expect(x).toEqual(optimizeProspective(args,constraints,settings));
      expect(x.feasible).toBe(true);
      expect(x.weights?.sp500).toBeLessThanOrEqual(0.5);
      expect(x.prospectiveSummary?.regimeCagrs).toHaveLength(4);
    }
  });
  it("rejects impossible scenarios rather than inventing data",()=>{
    const settings=defaultProspectiveSettings();
    settings.regimes[0].shiftsPct.sp500=Number.NaN;
    expect(generateProspectiveScenarios(input,scenarios,settings).diagnostics.length).toBeGreaterThan(0);
  });
});
