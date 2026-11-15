#!/usr/bin/env python3
"""Download public ETF holdings and create an aggregate audit snapshot.

This deliberately does NOT redistribute full holdings: the source Excel is
processed in memory and only counts, weighted coverage and top-ten factual
observations are emitted. An ETF's holdings may differ from its MSCI benchmark.
No stock style (Value/Core/Growth) is inferred from sector or ETF name.
"""
import argparse
import datetime as dt
import json
import re
import urllib.request
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = "https://www.ssga.com/library-content/products/fund-data/etfs/emea/"
SOURCES = {
    "msci_world": ("sppw-gy", "SPPW", "MSCI World"),
    "msci_em": ("spym-gy", "SPYM", "MSCI Emerging Markets"),
    "msci_europe": ("ero-fp", "ERO", "MSCI Europe"),
    "msci_usa_small_cap_weighted": ("zprv-gy", "ZPRV", "MSCI USA Small Cap Value Weighted"),
    "msci_europe_small_cap_weighted": ("zprx-gy", "ZPRX", "MSCI Europe Small Cap Value Weighted"),
}
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def colnum(col):
    x = 0
    for char in col:
        x = 26*x + ord(char)-64
    return x-1

def normal(s):
    return "".join(c for c in unicodedata.normalize("NFKD", str(s)).lower()
                   if not unicodedata.combining(c)).replace("\n"," ").strip()

def rows_xlsx(raw):
    with zipfile.ZipFile(BytesIO(raw)) as z:
        shared=[]
        if "xl/sharedStrings.xml" in z.namelist():
            root=ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("x:si",NS):
                shared.append("".join(t.text or "" for t in si.findall(".//x:t",NS)))
        sheets=sorted(n for n in z.namelist()
                      if re.fullmatch(r"xl/worksheets/sheet\d+\.xml",n))
        if not sheets: raise ValueError("Aucune feuille Excel")
        root=ET.fromstring(z.read(sheets[0]))
        out=[]
        for row in root.findall(".//x:sheetData/x:row",NS):
            cells={}
            for c in row.findall("x:c",NS):
                ref=c.attrib.get("r","A1")
                m=re.match(r"([A-Z]+)",ref)
                if not m: continue
                typ=c.attrib.get("t")
                if typ=="inlineStr":
                    val="".join(t.text or "" for t in c.findall(".//x:t",NS))
                else:
                    v=c.find("x:v",NS)
                    val=v.text if v is not None and v.text is not None else ""
                    if typ=="s" and val: val=shared[int(val)]
                cells[colnum(m.group(1))]=val
            if cells:
                out.append([cells.get(j,"") for j in range(max(cells)+1)])
        return out

def lookup_header(rows):
    for rownum,row in enumerate(rows[:55]):
        keys=[normal(x) for x in row]
        name=next((i for i,k in enumerate(keys)
                   if k in ("security name","name","security","nom du titres","nom du titre","constituent name")),None)
        weight=next((i for i,k in enumerate(keys)
                     if k in ("weight","weight (%)","weight %","poids","poids (%)","portfolio weight")),None)
        if name is not None and weight is not None:
            sector=next((i for i,k in enumerate(keys) if k in ("sector","gics sector","secteur")),None)
            asset=next((i for i,k in enumerate(keys) if k in ("asset class","asset type","type of security")),None)
            return rownum,name,weight,sector,asset
    raise ValueError("En-têtes Name/Weight introuvables : " + repr(rows[:12])[:1700])

def number(v):
    t=str(v).strip().replace("\u00a0","").replace(" ","").replace("%","")
    if not t or t=="-": return None
    if "," in t and "." in t:
        t=t.replace(",","") if t.rfind(".")>t.rfind(",") else t.replace(".","").replace(",",".")
    elif "," in t: t=t.replace(",",".")
    try: return float(t)
    except ValueError: return None

def extract(raw):
    rows=rows_xlsx(raw)
    header,name_idx,weight_idx,sector_idx,asset_idx=lookup_header(rows)
    holdings=[]
    for row in rows[header+1:]:
        name=str(row[name_idx]).strip() if name_idx<len(row) else ""
        w=number(row[weight_idx]) if weight_idx<len(row) else None
        if not name or w is None or w<0:continue
        if normal(name) in ("total","total fund","total fund holdings","fund total"): continue
        asset=str(row[asset_idx]).lower() if asset_idx is not None and asset_idx<len(row) else ""
        if asset and not any(t in asset for t in ("equity","stock","share","action")): continue
        sector=str(row[sector_idx]).strip() if sector_idx is not None and sector_idx<len(row) else ""
        holdings.append({"name":name,"weight":w,"sector":sector})
    if len(holdings)<30:
        raise ValueError(f"Seulement {len(holdings)} positions reconnues, header {rows[header]!r}")
    summed=sum(h["weight"] for h in holdings)
    if 0.65<=summed<=1.05:
        for h in holdings:h["weight"]*=100
        summed*=100
    if not 65<=summed<=105:
        raise ValueError(f"Poids totaux suspects {summed:.4f} ; premières positions {holdings[:3]!r}")
    sector_weights={}
    for h in holdings:
        if h["sector"]:
            sector_weights[h["sector"]]=round(sector_weights.get(h["sector"],0)+h["weight"],4)
    top=sorted(holdings,key=lambda x:x["weight"],reverse=True)[:10]
    return {"holdingsCount":len(holdings),"equityWeightPct":round(summed,4),
            "top10WeightPct":round(sum(h["weight"] for h in top),4),
            "top10":[{"name":h["name"],"weight":round(h["weight"],4)} for h in top],
            "sectorWeightsPct":sector_weights}

def fetch(url):
    request=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (compatible; portfolio-research/1.0)","Accept":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*"})
    with urllib.request.urlopen(request,timeout=35) as response:
        raw=response.read(25_000_000)
    if not raw.startswith(b"PK"):
        raise ValueError(f"Réponse non XLSX : {raw[:80]!r}")
    return raw

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",default="public/data/holdings_audit.json")
    parser.add_argument("--require-all",action="store_true")
    args=parser.parse_args()
    data={"schemaVersion":1,"retrievedAt":dt.datetime.now(dt.timezone.utc).isoformat(),
          "description":"Diagnostics dérivés d'inventaires d'ETF physiques, non listes officielles MSCI. Pas de styles imputés aux titres.",
          "assets":{},"errors":{}}
    for index,(slug,ticker,benchmark) in SOURCES.items():
        url=ROOT+f"holdings-daily-emea-en-{slug}.xlsx"
        try:
            item=extract(fetch(url))
            item.update({"etf":ticker,"benchmark":benchmark,"downloadUrl":url,
                         "sourceType":"physical_etf_holdings_proxy","asOf":None,
                         "warning":"Le panier d'un ETF physique/échantillonné peut différer de l'indice."})
            data["assets"][index]=item
            print(f"{ticker}: {item['holdingsCount']} positions; {item['equityWeightPct']:.2f}% poids actions; top 10 {item['top10WeightPct']:.2f}%")
        except Exception as ex:
            data["errors"][index]=str(ex)[:350]
            print(f"{ticker}: ERROR: {ex}")
    # Avoid overwriting a known-good audit when every remote request fails.
    if not data["assets"]: raise SystemExit("Aucun inventaire exploitable ; résultat précédent conservé")
    if args.require_all and data["errors"]: raise SystemExit("Sources partielles : "+str(data["errors"]))
    output=Path(args.output)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Résumé dérivé écrit:",output)

if __name__=="__main__":
    main()
