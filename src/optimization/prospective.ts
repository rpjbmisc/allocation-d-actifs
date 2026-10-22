import { alignAnnualSeries } from "../domain/data";
import { searchGrid, validateOptimizationConfiguration } from "./growth";
import { generateProspectiveScenarios } from "../scenarios/prospective";
import type { ProspectiveSettings } from "../scenarios/prospective";
import { scenarioPortfolioCagr } from "../scenarios/generator";
import type { AllocationInput, OptimizationResult, PortfolioConstraints } from "./interface";

export interface ProspectiveSummary {
  objective: ProspectiveSettings["objective"];
  regimeCagrs: Array<{ id: string; name: string; medianCagr: number }>;
  score: number;
  clippedValues: number;
  assumptions: "illustrative-not-forecast";
}
export type ProspectiveResult = OptimizationResult & { prospectiveSummary: ProspectiveSummary | null };

function median(values: number[]): number {
  const s = [...values].sort((a,b)=>a-b);
  const m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
export function optimizeProspective(inputs: AllocationInput, constraints: PortfolioConstraints, settings: ProspectiveSettings): ProspectiveResult {
  const empty = (diagnostics: string[]): ProspectiveResult => ({
    strategy:"robust",weights:null,feasible:false,diagnostics,score:null,stats:null,evaluatedCandidates:0,
    gridStepPct:constraints.gridStepPct??null,scoreLabel:"TCAM de scénarios hypothétiques",prospectiveSummary:null,
  });
  const config = validateOptimizationConfiguration(inputs.assetIds,constraints);
  if ("diagnostics" in config) return empty(config.diagnostics);
  const aligned=alignAnnualSeries(inputs.data,inputs.assetIds,inputs.trainStart,inputs.trainEnd,inputs.returnMode??"nominal");
  if (!aligned.ok) return empty(aligned.diagnostics.map(d=>d.message));
  const scenarios = generateProspectiveScenarios({
    data:inputs.data,assetIds:inputs.assetIds,start:inputs.trainStart,end:inputs.trainEnd,mode:inputs.returnMode??"nominal"
  }, {scenarioCount:settings.pathsPerRegime,horizonYears:inputs.scenarioSettings?.horizonYears??10,blockYears:inputs.scenarioSettings?.blockYears??1,
    seed:inputs.scenarioSettings?.seed??20261021,quantilePct:inputs.scenarioSettings?.quantilePct??20},settings);
  if (scenarios.diagnostics.length) return empty(scenarios.diagnostics);
  // First pass finds the best achievable scenario median under the SAME constraints;
  // regret measured against these regime-specific best feasible allocations.
  const ceilings = settings.regimes.map(()=>-Infinity);
  const outcomes=new Map<string,number[]>();
  const key=(w:Record<string,number>)=>inputs.assetIds.map(id=>(w[id]??0).toFixed(8)).join("|");
  const getMedians=(w:Record<string,number>):number[]|null=>{
    const k=key(w);if(outcomes.has(k))return outcomes.get(k)!;
    const values=scenarios.sets.map(set=>{
      const cagrs=set.scenarios.map(s=>scenarioPortfolioCagr(s,w));
      return cagrs.some(v=>v===null||!Number.isFinite(v))?NaN:median(cagrs as number[]);
    });
    if(values.some(v=>!Number.isFinite(v)))return null;
    outcomes.set(k,values);return values;
  };
  if(settings.objective==="regret"){
    searchGrid(inputs,inputs.assetIds,config.value,(weights)=>{
      const values=getMedians(weights);if(!values)return null;
      values.forEach((value,i)=>{ceilings[i]=Math.max(ceilings[i],value);});
      return {score:0};
    });
    if(ceilings.some(v=>!Number.isFinite(v)))return empty(["Aucune allocation admissible pour calculer les regrets."]);
  }
  const state=searchGrid<ProspectiveSummary>(inputs,inputs.assetIds,config.value,(weights)=>{
    const values=getMedians(weights);if(!values)return null;
    const score=settings.objective==="average" ? values.reduce((a,b)=>a+b,0)/values.length
      :settings.objective==="worst" ? Math.min(...values)
      : -Math.max(...values.map((value,i)=>ceilings[i]-value));
    return {score,metadata:{objective:settings.objective,score,regimeCagrs:scenarios.sets.map((set,i)=>({id:set.regime.id,name:set.regime.name,medianCagr:values[i]})),
      clippedValues:scenarios.clippedValues,assumptions:"illustrative-not-forecast" as const}};
  });
  const diagnostics:string[]=[];
  if(!state.best)diagnostics.push("Aucune allocation ne respecte les contraintes.");
  if(state.stoppedByBudget)diagnostics.push("Recherche limitée par le nombre maximal de candidats : résultat non garanti optimal.");
  if(scenarios.clippedValues)diagnostics.push(`${scenarios.clippedValues} rendements simulés ont été limités à −100 %.`);
  return {strategy:"robust",weights:state.best?.weights??null,feasible:!!state.best,diagnostics,score:state.best?.score??null,
    stats:state.best?.stats??null,evaluatedCandidates:state.evaluatedCandidates,gridStepPct:config.value.gridStepPct,
    scoreLabel:settings.objective==="regret"?"Regret maximal (opposé)":"TCAM simulé multi-régimes",prospectiveSummary:state.best?.metadata??null};
}
