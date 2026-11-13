/**
 * Expositions économiques descriptives, indépendantes des séries de rendement.
 * Les valeurs sont des photographies datées; jamais des rendements historiques.
 */
export type ExposureDimension = "zones" | "countries" | "sizes" | "styles";
export type ExposureKind = "equity" | "other";
export interface AssetExposure {
  kind: ExposureKind;
  countries?: Record<string, number>;
  sizes?: Record<string, number>;
  factor?: "none" | "value" | "growth" | "quality";
  assetClass?: string;
  source?: string;
  asOf?: string;
  note?: string;
}
export interface ExposureRegistry {
  schemaVersion: number;
  updated: string;
  assets: Record<string, AssetExposure>;
}
export interface ExposureSlice { name: string; percent: number }
export interface PortfolioExposure {
  equityShare: number;
  otherShare: number;
  unknownAssetShare: number;
  breakdown: Record<ExposureDimension, ExposureSlice[]>;
  /** Fraction of the equity sleeve described at named-country or named-size precision. */
  precision: { countries: number; sizes: number };
  snapshotDates: string[];
  notes: string[];
}
const countries: Record<string, { name: string; zone: string }> = {
  US:{name:"États-Unis",zone:"Amérique du Nord"},
  CA:{name:"Canada",zone:"Amérique du Nord"},
  JP:{name:"Japon",zone:"Asie développée"},
  AU:{name:"Australie",zone:"Asie développée"},
  NZ:{name:"Nouvelle-Zélande",zone:"Asie développée"},
  SG:{name:"Singapour",zone:"Asie développée"},
  HK:{name:"Hong Kong",zone:"Asie développée"},
  GB:{name:"Royaume-Uni",zone:"Europe"},
  CH:{name:"Suisse",zone:"Europe"},
  FR:{name:"France",zone:"Europe"},
  DE:{name:"Allemagne",zone:"Europe"},
  NL:{name:"Pays-Bas",zone:"Europe"},
  ES:{name:"Espagne",zone:"Europe"},
  IT:{name:"Italie",zone:"Europe"},
  SE:{name:"Suède",zone:"Europe"},
  DK:{name:"Danemark",zone:"Europe"},
  NO:{name:"Norvège",zone:"Europe"},
  FI:{name:"Finlande",zone:"Europe"},
  TW:{name:"Taïwan",zone:"Asie émergente"},
  CN:{name:"Chine",zone:"Asie émergente"},
  KR:{name:"Corée du Sud",zone:"Asie émergente"},
  IN:{name:"Inde",zone:"Asie émergente"},
  MY:{name:"Malaisie",zone:"Asie émergente"},
  TH:{name:"Thaïlande",zone:"Asie émergente"},
  BR:{name:"Brésil",zone:"Émergents hors Asie"},
  MX:{name:"Mexique",zone:"Émergents hors Asie"},
  ZA:{name:"Afrique du Sud",zone:"Émergents hors Asie"},
};
const partialCountries: Record<string, { name:string; zone:string }> = {
  OTHER:{name:"Pays non détaillés",zone:"Zone non détaillée"},
  EU_OTHER:{name:"Pays européens non détaillés",zone:"Europe"},
  ASIA_EM_OTHER:{name:"Pays asiatiques émergents non détaillés",zone:"Asie émergente"},
  PACIFIC_OTHER:{name:"Pays du Pacifique développés non détaillés",zone:"Asie développée"},
};
const sizeLabels: Record<string,string> = {
  Large:"Grandes capitalisations",
  Mid:"Moyennes capitalisations",
  Small:"Petites capitalisations",
  large_mid:"Grandes et moyennes (non séparées)",
  all_caps:"Toutes tailles (non ventilées)",
};
const sum = (numbers:number[]) => numbers.reduce((a,b) => a+b,0);
const validMix=(mix: Record<string,number> | undefined):mix is Record<string,number> =>
  !!mix && Object.values(mix).length>0 && Object.values(mix).every(n=>Number.isFinite(n)&&n>=0) &&
  Math.abs(sum(Object.values(mix))-100)<0.15;
const ordered = (values:Record<string,number>):ExposureSlice[] =>
  Object.entries(values).filter(([,v])=>v>0.000001).map(([name,percent])=>({name,percent})).sort((a,b)=>b.percent-a.percent||a.name.localeCompare(b.name,"fr"));
const add=(target:Record<string,number>,key:string,amount:number)=>{target[key]=(target[key]??0)+amount;};

/** Calculs à poids fixes, identiques pour Construction et Comparaison. */
export function calculatePortfolioExposure(weights:Record<string,number>, registry:ExposureRegistry):PortfolioExposure|null {
  const pairs=Object.entries(weights).filter(([,v])=>Number.isFinite(v)&&v>0);
  const total=sum(pairs.map(([,v])=>v));
  if(!Number.isFinite(total)||total<=0)return null;
  const data={zones:{} as Record<string,number>,countries:{} as Record<string,number>,sizes:{} as Record<string,number>,styles:{} as Record<string,number>};
  let equity=0,other=0,unknown=0,preciseCountries=0,preciseSizes=0;
  const dates=new Set<string>(), notes=new Set<string>();
  for(const [id,weight] of pairs){
    const fraction=weight/total*100;
    const entry=registry.assets[id];
    if(!entry){unknown+=fraction;notes.add("Actif non classifié : "+id);continue;}
    if(entry.kind!=="equity"){other+=fraction;continue;}
    equity+=fraction;
    if(entry.asOf)dates.add(entry.asOf);
    if(entry.note)notes.add(entry.note);
    const countryMix=validMix(entry.countries)?entry.countries:{OTHER:100};
    for(const [key,pct] of Object.entries(countryMix)){
      const c=countries[key]??partialCountries[key]??partialCountries.OTHER;
      add(data.countries,c.name,fraction*pct/100);
      add(data.zones,c.zone,fraction*pct/100);
      if(countries[key])preciseCountries+=fraction*pct/100;
    }
    const sizesMix=validMix(entry.sizes)?entry.sizes:{all_caps:100};
    for(const [key,pct] of Object.entries(sizesMix)){
      add(data.sizes,sizeLabels[key]??"Taille non détaillée",fraction*pct/100);
      if(["Large","Mid","Small"].includes(key))preciseSizes+=fraction*pct/100;
    }
    const style=entry.factor==="value"?"Indice à biais Value":entry.factor==="growth"?"Indice à biais Growth":entry.factor==="quality"?"Indice à biais Quality":"Sans biais factoriel explicite";
    add(data.styles,style,fraction);
  }
  const normalise=(values:Record<string,number>)=>ordered(Object.fromEntries(Object.entries(values).map(([k,v])=>[k,equity>0?v/equity*100:0])));
  return {
    equityShare:equity,otherShare:other,unknownAssetShare:unknown,
    breakdown:{zones:normalise(data.zones),countries:normalise(data.countries),sizes:normalise(data.sizes),styles:normalise(data.styles)},
    precision:{countries:equity>0?preciseCountries/equity*100:0,sizes:equity>0?preciseSizes/equity*100:0},
    snapshotDates:[...dates].sort(),
    notes:[...notes],
  };
}
