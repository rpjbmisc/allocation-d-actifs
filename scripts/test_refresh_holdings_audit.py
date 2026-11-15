import io
import sys
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0,str(Path(__file__).resolve().parent))
from refresh_holdings_audit import rows_xlsx,extract,number

def synthetic_xlsx(weights=None):
    if weights is None:weights=[2.5]*40
    rows=[
        ["Fund Name:","Illustrative ETF"],
        ["Holdings As Of:","12-Nov-2026"],
        ["ISIN","SEDOL","Security Name","Currency","Percent of Fund","Sector Classification"],
    ]
    for i,w in enumerate(weights):
        rows.append([f"US{i:09d}0","TEST",f"Company {i}","USD",str(w),"Industrials"])
    pieces=[]
    def excel_col(n):
        output=""
        while n:
            n,r=divmod(n-1,26)
            output=chr(65+r)+output
        return output
    for index,row in enumerate(rows,1):
        cols=[]
        for ci,item in enumerate(row,1):
            cols.append(f'<c r="{excel_col(ci)}{index}" t="inlineStr"><is><t>{escape(item)}</t></is></c>')
        pieces.append(f'<row r="{index}">'+"".join(cols)+"</row>")
    xml='<?xml version="1.0" encoding="utf-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+"".join(pieces)+"</sheetData></worksheet>"
    output=io.BytesIO()
    with zipfile.ZipFile(output,"w") as z:
        z.writestr("xl/worksheets/sheet1.xml",xml.encode())
    return output.getvalue()

class TestProviderHoldings(unittest.TestCase):
    def test_ssga_schema_and_full_coverage(self):
        parsed=extract(synthetic_xlsx())
        self.assertEqual(parsed["holdingsCount"],40)
        self.assertEqual(parsed["holdingsAsOf"],"12-Nov-2026")
        self.assertAlmostEqual(parsed["equityWeightPct"],100)
        self.assertAlmostEqual(parsed["sectorWeightsPct"]["Industrials"],100)
        self.assertEqual(parsed["styleCoveragePct"],0)
        self.assertAlmostEqual(parsed["styleWeightsPct"]["Non documenté"],100)
    def test_style_join_never_assigns_unknown_remainder(self):
        raw=synthetic_xlsx()
        styles={"US0000000000":{"style":"Growth","source":"https://example.com"}}
        result=extract(raw,styles)
        self.assertAlmostEqual(result["styleCoveragePct"],2.5)
        self.assertAlmostEqual(result["styleWeightsPct"]["Growth"],2.5)
        self.assertAlmostEqual(result["styleWeightsPct"]["Non documenté"],97.5)
    def test_out_of_range_total_rejected(self):
        with self.assertRaises(ValueError):extract(synthetic_xlsx([3.0]*40))
    def test_decimal_parse(self):
        self.assertEqual(number("1,25"),1.25)
        self.assertEqual(number("1,250.25"),1250.25)

if __name__=="__main__":
    unittest.main()
