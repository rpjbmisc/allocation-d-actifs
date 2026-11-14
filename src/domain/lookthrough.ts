/**
 * Verified, date-stamped constituent observations, not a complete replicated portfolio.
 * Unknown weights always remain unknown. Never renormalize the observed top holdings
 * to 100% of an index: that would create artificial style and profitability exposures.
 */
export type StockStyle = "Value" | "Blend" | "Growth";
export interface SecurityObservation {
  name: string;
  style?: StockStyle;
  styleSource?: string;
  roic?: number;
  roicSource?: string;
}
export interface HoldingObservation { id: string; weight: number }
export interface IndexObservation {
  asOf: string;
  source: string;
  kind: string;
  holdings: HoldingObservation[];
  notes?: string;
}
export interface LookthroughRegistry {
  schemaVersion: number;
  updated: string;
  description?: string;
  styleMethod?: string;
  profitabilityMethod?: string;
  securities: Record<string, SecurityObservation>;
  indices: Record<string, IndexObservation>;
}
export interface LookthroughSlice { name: string; percent: number }
export interface LookthroughIndexCoverage {
  id: string;
  name: string;
  portfolioWeight: number;
  holdingsWeight: number;
  styleWeight: number;
  profitabilityWeight: number;
  asOf?: string;
  source?: string;
  notes?: string;
}
export interface LookthroughReport {
  styles: LookthroughSlice[];
  profitability: LookthroughSlice[];
  /** Percent of the *total equity sleeve* covered by verified observations. */
  coverage: { holdings: number; styles: number; profitability: number };
  indices: LookthroughIndexCoverage[];
  sources: string[];
}

const safeWeight=(v: unknown)=> typeof v==="number" && Number.isFinite(v) && v>=0 ? v : 0;
const sum=(items: number[])=>items.reduce((acc,v)=>acc+v,0);
const isSource=(value?:string)=>typeof value==="string" && /^https:\/\//.test(value);
const isStyle=(value?:string):value is StockStyle =>value==="Value"||value==="Blend"||value==="Growth";
const rows=(data:Record<string,number>):LookthroughSlice[]=>
  Object.entries(data).filter(([,n])=>n>0.0000001).map(([name,percent])=>({name,percent})).sort((a,b)=>b.percent-a.percent);

/**
 * Inputs are index weights in any positive scale (fraction, percent, etc.).
 * Asset kinds and the equity-sleeve denominator are supplied by the caller.
 * Snapshots are validated before use; any invalid or missing snapshot stays unknown.
 */
export function calculateLookthrough(
  allocation: Record<string,number>,
  equityIds: string[],
  registry: LookthroughRegistry | null,
): LookthroughReport {
  const pairs=equityIds.map(id=>({id,weight:safeWeight(allocation[id])})).filter(p=>p.weight>0);
  const total=sum(pairs.map(p=>p.weight));
  const styleWeights:Record<string,number>={Value:0,Blend:0,Growth:0,"Style non documenté":0};
  const profitWeights:Record<string,number>={"ROIC ≥ 15 % (proxy)":0,"ROIC < 15 %":0,"ROIC non documenté":0};
  const details:LookthroughIndexCoverage[]=[];
  const sources=new Set<string>();
  let coveredHoldings=0,coveredStyles=0,coveredProfit=0;
  if(total<=0)return {styles:[],profitability:[],coverage:{holdings:0,styles:0,profitability:0},indices:[],sources:[]};
  for(const {id,weight} of pairs) {
    const portfolioPct=weight/total*100;
    const snapshot=registry?.indices?.[id];
    const positions=snapshot?.holdings??[];
    const ids=new Set<string>();
    const valid=!!snapshot && isSource(snapshot.source) && !!snapshot.asOf &&
      positions.length>0 && positions.every(pos=>{
        if(!pos.id||ids.has(pos.id)||!Number.isFinite(pos.weight)||pos.weight<0||pos.weight>100)return false;
        ids.add(pos.id); return true;
      }) && sum(positions.map(p=>p.weight))<=100.0001;
    const indexed=valid?positions:[];
    let holdingsPct=0,stylePct=0,profitPct=0;
    for(const pos of indexed) {
      holdingsPct+=pos.weight;
      const security=registry?.securities?.[pos.id];
      const contribution=portfolioPct*pos.weight/100;
      if(security && isStyle(security.style) && isSource(security.styleSource)) {
        styleWeights[security.style]+=contribution;
        stylePct+=pos.weight;
      } else styleWeights["Style non documenté"]+=contribution;
      if(security && typeof security.roic==="number" && Number.isFinite(security.roic) && isSource(security.roicSource)) {
        profitWeights[security.roic>=15?"ROIC ≥ 15 % (proxy)":"ROIC < 15 %"]+=contribution;
        profitPct+=pos.weight;
      } else profitWeights["ROIC non documenté"]+=contribution;
      if(security?.styleSource && isSource(security.styleSource)) sources.add(security.styleSource);
      if(security?.roicSource && isSource(security.roicSource)) sources.add(security.roicSource);
    }
    const remainder=Math.max(0,100-holdingsPct);
    styleWeights["Style non documenté"]+=portfolioPct*remainder/100;
    profitWeights["ROIC non documenté"]+=portfolioPct*remainder/100;
    coveredHoldings+=portfolioPct*holdingsPct/100;
    coveredStyles+=portfolioPct*stylePct/100;
    coveredProfit+=portfolioPct*profitPct/100;
    if(valid && snapshot) sources.add(snapshot.source);
    details.push({
      id,name:id,portfolioWeight:portfolioPct,
      holdingsWeight:holdingsPct,styleWeight:stylePct,profitabilityWeight:profitPct,
      asOf:valid?snapshot!.asOf:undefined,
      source:valid?snapshot!.source:undefined,
      notes:valid?snapshot!.notes:undefined,
    });
  }
  // Clamp merely for floating point rounding; never infer the unknown portion.
  const clean=(v:number)=>Math.max(0,Math.min(100,v));
  return {
    styles:rows(styleWeights),
    profitability:rows(profitWeights),
    coverage:{holdings:clean(coveredHoldings),styles:clean(coveredStyles),profitability:clean(coveredProfit)},
    indices:details,
    sources:[...sources],
  };
}
