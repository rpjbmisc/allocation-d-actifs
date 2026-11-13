import { useState } from "react";
import { calculatePortfolioExposure, type ExposureDimension, type ExposureRegistry, type PortfolioExposure } from "../../domain/exposures";

const dims: Array<{id:ExposureDimension;label:string}>=[
  {id:"zones",label:"Zones"}, {id:"countries",label:"Pays"},
  {id:"sizes",label:"Tailles"}, {id:"styles",label:"Facteurs"},
];
const fmt=(x:number)=>`${x.toLocaleString("fr-FR",{maximumFractionDigits:1,minimumFractionDigits:1})} %`;
const pct=(x:number)=>`${x.toLocaleString("fr-FR",{maximumFractionDigits:1,minimumFractionDigits:1})}`;
const colors=["#3478b8","#20a38b","#e6a23c","#9b78b2","#dc8065","#65889e","#8aa44a"];
const dimensionHint:Record<ExposureDimension,string>={
  zones:"Exposition par pays de classification de l'indice (pas par chiffre d'affaires des entreprises).",
  countries:"« Non détaillés » = poids non publiés dans les fiches utilisées, non imputés à un pays.",
  sizes:"Les fiches disponibles regroupent souvent grandes et moyennes capitalisations : ne pas les séparer artificiellement.",
  styles:"Mesure du poids investi dans des indices explicitement orientés Value, Growth ou Quality, PAS de la répartition Value/Blend/Growth des entreprises. Quality est un biais transversal.",
};
function Dimension({ report, dimension }:{report:PortfolioExposure;dimension:ExposureDimension}) {
  const rows=report.breakdown[dimension];
  return <div className="exposure-rows" role="list" aria-label={dims.find(d=>d.id===dimension)?.label}>
    {rows.length===0?<p>Aucune exposition actions.</p>:rows.map((row,i)=><div className="exposure-row" role="listitem" key={row.name}>
      <div className="exposure-label"><span>{row.name}</span><strong>{fmt(row.percent)}</strong></div>
      <div className="exposure-track"><div className="exposure-fill" style={{width:`${Math.min(100,row.percent)}%`,background:colors[i%colors.length]}} /></div>
    </div>)}
  </div>;
}
function Coverage({ report }:{report:PortfolioExposure}){
  return <div className="exposure-coverage">
    <span>Poche actions : <strong>{fmt(report.equityShare)}</strong> du portefeuille total</span>
    {report.otherShare>0.01&&<span>Autres classes : {fmt(report.otherShare)}</span>}
    {report.unknownAssetShare>0.01&&<span>Non classés : {fmt(report.unknownAssetShare)}</span>}
    <span>Précision pays : {fmt(report.precision.countries)} des actions</span>
    <span>Précision tailles : {fmt(report.precision.sizes)} des actions</span>
  </div>;
}
export function ExposurePanel({weights,registry,profileLabel}:{weights:Record<string,number>;registry:ExposureRegistry|null;profileLabel:string}){
  const [dimension,setDimension]=useState<ExposureDimension>("zones");
  if(!registry)return <section className="table-card exposure-panel"><h2>Composition de l'allocation</h2><p>Données de composition indisponibles. Les performances restent accessibles.</p></section>;
  const report=calculatePortfolioExposure(weights,registry);
  return <section className="table-card exposure-panel" aria-label="Composition du portefeuille">
    <div className="card-heading compact"><div><h2>Composition du portefeuille</h2><p>Mode actif : <strong>{profileLabel}</strong> · Photographie des compositions disponibles, parfois estimées via un ETF répliquant l’indice, indépendante des rendements historiques.</p></div></div>
    {report?<><Coverage report={report}/><div className="exposure-dimension-tabs" role="group" aria-label="Dimensions de composition">
      {dims.map(d=><button type="button" key={d.id} className={dimension===d.id?"active":""} onClick={()=>setDimension(d.id)} aria-pressed={dimension===d.id}>{d.label}</button>)}
    </div>
    <p className="method-note">{dimensionHint[dimension]} Les pourcentages ci-dessous sont normalisés à la poche actions.</p>
    <Dimension report={report} dimension={dimension}/>
    <details className="exposure-sources"><summary>Sources et limites des compositions</summary>
      <p>Photographies des indices à des dates parfois différentes : {report.snapshotDates.length?report.snapshotDates.join(" · "):"dates indisponibles"}. « Pays non détaillés » ne signifie pas exposition nulle.</p>
      {report.notes.map(n=><p key={n}>{n}</p>)}
      <ul className="exposure-source-list">{Object.entries(weights).filter(([id,w])=>w>0&&registry.assets[id]?.kind==="equity").map(([id])=>{
        const entry=registry.assets[id];
        return <li key={id}>{entry.source?<a href={entry.source} target="_blank" rel="noopener noreferrer">{id}</a>:id} · {entry.asOf??"date non attestée"}{entry.basis==="proxy_etf"?" · proxy ETF répliquant l'indice":entry.countries?" · pays documentés":" · pays non détaillés"}</li>;
      })}</ul>
      <p>La couverture « précision pays » exclut les groupes Autres. Les styles correspondent à des orientations d'indices, pas à une classification ligne par ligne. Les REIT et infrastructures sont comptabilisés en dehors de la poche actions dans cette première version.</p>
    </details></>:<p>Renseigne des pondérations pour afficher la composition.</p>}
  </section>;
}
export interface ComparisonExposureCandidate { id:string;label:string;weights:Record<string,number>|null }
export function ExposurePairComparison({candidates,registry}:{candidates:ComparisonExposureCandidate[];registry:ExposureRegistry|null}){
  const [a,setA]=useState("Personnalisée");
  const [b,setB]=useState("Croissance");
  const [dimension,setDimension]=useState<ExposureDimension>("zones");
  const left=candidates.find(c=>c.id===a),right=candidates.find(c=>c.id===b);
  const one=left?.weights&&registry?calculatePortfolioExposure(left.weights,registry):null;
  const two=right?.weights&&registry?calculatePortfolioExposure(right.weights,registry):null;
  const values1=Object.fromEntries((one?.breakdown[dimension]??[]).map(p=>[p.name,p.percent]));
  const values2=Object.fromEntries((two?.breakdown[dimension]??[]).map(p=>[p.name,p.percent]));
  const names=Array.from(new Set([...Object.keys(values1),...Object.keys(values2)])).sort((x,y)=>Math.max(values2[y]??0,values1[y]??0)-Math.max(values2[x]??0,values1[x]??0));
  return <section className="table-card exposure-panel exposure-comparison" aria-label="Comparaison des compositions">
    <div className="card-heading compact"><div><h2>Comparer la composition de deux allocations</h2><p>Écarts d'exposition en points de pourcentage, sur les poches actions.</p></div></div>
    <div className="exposure-pair-controls">
      <label>Allocation A <select value={a} onChange={e=>setA(e.target.value)}>{candidates.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Allocation B <select value={b} onChange={e=>setB(e.target.value)}>{candidates.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    </div>
    <div className="exposure-dimension-tabs" role="group" aria-label="Dimensions comparées">
      {dims.map(d=><button type="button" key={d.id} className={dimension===d.id?"active":""} onClick={()=>setDimension(d.id)} aria-pressed={dimension===d.id}>{d.label}</button>)}
    </div>
    <p className="method-note">{dimensionHint[dimension]}</p>
    {!registry?<p>Données de composition indisponibles.</p>:!one||!two||one.equityShare===0||two.equityShare===0?<p>Comparaison indisponible : aucune pondération actions exploitable pour au moins un des modes.</p>:
      <div className="table-scroll"><table className="exposure-pair-table"><thead><tr><th>Exposition</th><th>{left?.label??"A"}</th><th>{right?.label??"B"}</th><th>Écart B − A</th></tr></thead>
      <tbody>{names.map(name=>{const x=values1[name]??0,y=values2[name]??0;return <tr key={name}><th scope="row">{name}</th><td>{fmt(x)}</td><td>{fmt(y)}</td><td className={Math.abs(y-x)<0.05?"":y>x?"positive":"negative"}>{y-x>0?"+":""}{pct(y-x)} pts</td></tr>})}</tbody></table></div>}
    {one&&two&&<p className="method-note">Actions dans le portefeuille total : {left?.label} {fmt(one.equityShare)} · {right?.label} {fmt(two.equityShare)}. Couverture des pays nommés : {fmt(one.precision.countries)} / {fmt(two.precision.countries)}. Dates et sources des indices consultables dans Construction.</p>}
  </section>;
}
