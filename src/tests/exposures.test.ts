import assetExposures from "../../public/data/asset_exposures.json";
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

describe("photographies réelles du registre",()=>{
  const real = assetExposures as unknown as ExposureRegistry;
  it("normalise toutes les distributions publiées",()=>{
    for (const [id,asset] of Object.entries(real.assets)) {
      if (!asset.countries) continue;
      expect(Object.values(asset.countries).reduce((a,b)=>a+b,0),id).toBeCloseTo(100,1);
      const view=calculatePortfolioExposure({[id]:100},real)!;
      expect(view.breakdown.countries.reduce((a,b)=>a+b.percent,0),id).toBeCloseTo(100,1);
    }
  });

  it("dispose d'une couverture pays élevée pour World et World ex USA",()=>{
    for(const id of ["msci_world","msci_world_ex_usa"]){
      const p=calculatePortfolioExposure({[id]:100},real)!;
      expect(p.precision.countries,id).toBeGreaterThan(99.9);
      expect(p.breakdown.countries.reduce((n,c)=>n+c.percent,0),id).toBeCloseTo(100,1);
    }
    const ex=calculatePortfolioExposure({msci_world_ex_usa:100},real)!;
    expect(asMap(ex.breakdown.countries)["États-Unis"]??0).toBe(0);
  });
  it("ventile correctement les marchés d'Europe, du Pacifique et émergents",()=>{
    const p=calculatePortfolioExposure({msci_europe:40,msci_pacific_ex_japan_imi:40,msci_em:20},real)!;
    expect(p.precision.countries).toBeGreaterThan(99);
    const byCountry=asMap(p.breakdown.countries);
    expect(byCountry["Royaume-Uni"]).toBeGreaterThan(5);
    expect(byCountry["Australie"]).toBeGreaterThan(20);
    expect(byCountry["Taïwan"]).toBeGreaterThan(5);
    expect(byCountry["Pays non détaillés"]??0).toBe(0);
  });
});
