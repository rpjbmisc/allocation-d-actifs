import {describe,it,expect} from "vitest";
import { calculateLookthrough,type LookthroughRegistry,type PhysicalAuditRegistry } from "./lookthrough";
import observations from "../../public/data/index_lookthrough.json";

const fixture:LookthroughRegistry={
  schemaVersion:1,updated:"2026-11-14",
  securities:{
    a:{name:"A",style:"Value",styleSource:"https://example.org/style/a",roic:20,roicSource:"https://example.org/roic/a"},
    b:{name:"B",style:"Growth",styleSource:"https://example.org/style/b",roic:2,roicSource:"https://example.org/roic/b"},
    c:{name:"C",style:"Blend",styleSource:"https://example.org/style/c"},
    unverified:{name:"No evidence",style:"Value",roic:99},
  },
  indices:{
    world:{asOf:"2026-10-30",source:"https://example.org/world",kind:"index",holdings:[{id:"a",weight:20},{id:"b",weight:10},{id:"c",weight:5},{id:"unverified",weight:5}]},
    invalid:{asOf:"2026-10-30",source:"https://example.org/bad",kind:"index",holdings:[{id:"a",weight:70},{id:"a",weight:50}]}
  },
};
const value=(arr:{name:string;percent:number}[],name:string)=>arr.find(x=>x.name===name)?.percent??0;
describe("look-through exposures",()=>{
  it("preserves unclassified 60% of the index rather than renormalizing holdings",()=>{
    const report=calculateLookthrough({world:100},["world"],fixture);
    expect(value(report.styles,"Value")).toBeCloseTo(20);
    expect(value(report.styles,"Growth")).toBeCloseTo(10);
    expect(value(report.styles,"Blend")).toBeCloseTo(5);
    expect(value(report.styles,"Style non documenté")).toBeCloseTo(65);
    expect(report.coverage.holdings).toBeCloseTo(40);
    expect(report.coverage.styles).toBeCloseTo(35);
    expect(report.coverage.profitability).toBeCloseTo(30);
    expect(value(report.profitability,"ROIC ≥ 15 % (proxy)")).toBeCloseTo(20);
    expect(value(report.profitability,"ROIC < 15 %")).toBeCloseTo(10);
    expect(value(report.profitability,"ROIC non documenté")).toBeCloseTo(70);
  });
  it("normalizes to the equity sleeve, not to the whole portfolio or observed securities",()=>{
    const report=calculateLookthrough({world:50,missing:25,gold:25},["world","missing"],fixture);
    expect(value(report.styles,"Value")).toBeCloseTo(20*50/75);
    expect(report.coverage.styles).toBeCloseTo(35*50/75);
    expect(report.styles.reduce((s,r)=>s+r.percent,0)).toBeCloseTo(100);
    expect(report.profitability.reduce((s,r)=>s+r.percent,0)).toBeCloseTo(100);
    expect(report.indices.find(x=>x.id==="missing")?.holdingsWeight).toBe(0);
  });
  it("rejects invalid duplicate and overweight snapshots without leaking their weights",()=>{
    const report=calculateLookthrough({invalid:100},["invalid"],fixture);
    expect(report.coverage.holdings).toBe(0);
    expect(value(report.styles,"Style non documenté")).toBe(100);
  });

  it("uses audited full physical ETF style aggregates without double counting the top-ten snapshot",()=>{
    const audit:PhysicalAuditRegistry={
      schemaVersion:1,asOf:"2026-11-12",
      assets:{world:{
        ticker:"SPPW",holdingsCount:1237,source:"https://example.org/physical.xlsx",
        styleWeightsPct:{Value:10,Blend:20,Growth:25,"Non documenté":45},
        styleCoveragePct:55,
        sectorWeightsPct:{Technology:30,Financials:70}
      }}
    };
    const report=calculateLookthrough({world:60,missing:40},["world","missing"],fixture,audit);
    expect(value(report.styles,"Value")).toBeCloseTo(6);
    expect(value(report.styles,"Blend")).toBeCloseTo(12);
    expect(value(report.styles,"Growth")).toBeCloseTo(15);
    expect(value(report.styles,"Style non documenté")).toBeCloseTo(67);
    expect(report.coverage.holdings).toBeCloseTo(60);
    expect(report.coverage.styles).toBeCloseTo(33);
    expect(report.coverage.sectors).toBeCloseTo(60);
    expect(value(report.sectors,"Technology")).toBeCloseTo(18);
    expect(value(report.sectors,"Secteur non documenté")).toBeCloseTo(40);
    // Profitability remains independently observed from the limited individual ROIC sample.
    expect(report.coverage.profitability).toBeCloseTo(18);
  });
  it("handles zero equity and unavailable data",()=>{
    expect(calculateLookthrough({gold:100},[],fixture).styles).toEqual([]);
    expect(value(calculateLookthrough({world:100},["world"],null).styles,"Style non documenté")).toBe(100);
  });
});
describe("real, externally auditable index data",()=>{
  const data=observations as LookthroughRegistry;
  it("has real source URLs, valid dates, no double counted index positions",()=>{
    for(const [indexId,index] of Object.entries(data.indices)){
      expect(index.source,indexId).toMatch(/^https:\/\//);
      expect(index.asOf,indexId).toMatch(/^2026-/);
      expect(new Set(index.holdings.map(h=>h.id)).size,indexId).toBe(index.holdings.length);
      expect(index.holdings.reduce((s,h)=>s+h.weight,0),indexId).toBeLessThanOrEqual(100.01);
      for(const h of index.holdings)expect(data.securities[h.id],`${indexId}:${h.id}`).toBeDefined();
    }
  });
  it("keeps style and profitability coverage lower than or equal to observed holdings",()=>{
    for(const indexId of Object.keys(data.indices)){
      const p=calculateLookthrough({[indexId]:100},[indexId],data);
      expect(p.coverage.styles,indexId).toBeLessThanOrEqual(p.coverage.holdings+0.0001);
      expect(p.coverage.profitability,indexId).toBeLessThanOrEqual(p.coverage.holdings+0.0001);
      expect(p.styles.reduce((a,b)=>a+b.percent,0)).toBeCloseTo(100);
      expect(p.profitability.reduce((a,b)=>a+b.percent,0)).toBeCloseTo(100);
    }
  });
});
