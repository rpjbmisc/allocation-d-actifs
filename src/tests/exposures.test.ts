import {describe,it,expect} from "vitest";
import {calculatePortfolioExposure,type ExposureRegistry} from "../domain/exposures";

const data:ExposureRegistry={
  schemaVersion:1,updated:"2026-11-13",
  assets:{
    world:{kind:"equity",countries:{US:70,JP:10,OTHER:20},sizes:{large_mid:100},factor:"none",asOf:"2026-10-30"},
    small:{kind:"equity",countries:{US:100},sizes:{Small:100},factor:"value"},
    euro:{kind:"equity",countries:{EU_OTHER:100},sizes:{Small:100},factor:"none"},
    gold:{kind:"other",assetClass:"Or"},
  }
};
const asMap=(rows:{name:string;percent:number}[])=>Object.fromEntries(rows.map(x=>[x.name,x.percent]));
describe("composition économique des portefeuilles",()=>{
  it("combine les poids et normalise à la poche actions uniquement",()=>{
    const p=calculatePortfolioExposure({world:50,small:25,gold:25},data)!;
    expect(p.equityShare).toBeCloseTo(75);
    expect(p.otherShare).toBeCloseTo(25);
    const zones=asMap(p.breakdown.zones);
    expect(zones["Amérique du Nord"]).toBeCloseTo(80);
    expect(zones["Japon"]).toBeCloseTo(6.6666667);
    expect(zones["Zone non détaillée"]).toBeCloseTo(13.3333333);
    expect(p.breakdown.zones.reduce((n,x)=>n+x.percent,0)).toBeCloseTo(100);
    expect(asMap(p.breakdown.styles)["Indice à biais Value"]).toBeCloseTo(33.3333333);
  });
  it("préserve une zone connue sans inventer les pays",()=>{
    const p=calculatePortfolioExposure({euro:100},data)!;
    expect(asMap(p.breakdown.zones).Europe).toBe(100);
    expect(asMap(p.breakdown.countries)["Pays européens non détaillés"]).toBe(100);
    expect(p.precision.countries).toBe(0);
  });
  it("conserve la distinction grandes/moyennes sans inventer les tailles",()=>{
    const p=calculatePortfolioExposure({world:50,small:50},data)!;
    expect(asMap(p.breakdown.sizes)["Grandes et moyennes (non séparées)"]).toBe(50);
    expect(asMap(p.breakdown.sizes)["Petites capitalisations"]).toBe(50);
    expect(p.precision.sizes).toBe(50);
  });
  it("n'impute pas une composition pays invalide ou absente",()=>{
    const broken:ExposureRegistry={...data,assets:{...data.assets,small:{...data.assets.small,countries:{US:90}}}};
    const p=calculatePortfolioExposure({small:100},broken)!;
    expect(asMap(p.breakdown.countries)["Pays non détaillés"]).toBe(100);
    expect(p.precision.countries).toBe(0);
  });
  it("gère les actifs non actions et inconnus",()=>{
    const p=calculatePortfolioExposure({gold:80,unknown:20},data)!;
    expect(p.equityShare).toBe(0);
    expect(p.otherShare).toBe(80);
    expect(p.unknownAssetShare).toBe(20);
    expect(p.breakdown.countries).toHaveLength(0);
  });
  it("refuse une allocation nulle et ignore les poids négatifs",()=>{
    expect(calculatePortfolioExposure({gold:0,small:-4},data)).toBeNull();
    expect(calculatePortfolioExposure({gold:0,small:20},data)?.equityShare).toBe(100);
  });
  it("accepte les poids exprimés en fractions ou pourcentages",()=>{
    const a=calculatePortfolioExposure({world:0.6,small:0.4},data)!;
    const b=calculatePortfolioExposure({world:60,small:40},data)!;
    expect(a.breakdown.countries).toEqual(b.breakdown.countries);
  });
});
