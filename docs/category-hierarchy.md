# Original category / folder hierarchy (exact source names)

Generated from the archive `Excel.zip` by `migration/generate_docs.py`. Names are verbatim, **including source typos** (e.g. `STRIGHT`, `STCK`). Nothing has been renamed, merged or removed. Empty folders are kept.

Hierarchy depth is **not uniform** across the three families. Folder names mix *product line*, *power range*, *axis type* and *document role* (INVENTORY / ORDER LENS SHEET / ORDER LENS PDF / STOCK LENS SHEET / STOCK LENS PDF) at different levels, so the application stores the tree as-is (`catalog_nodes`) instead of forcing a fixed category/subcategory/product model. Which level the client regards as 'category', 'subcategory' and 'product' is open question Q-HIER-1.

Legend: `[triad]` = inventory workbook with STOCK LENS / ORDER LENS / LENS QUANTITY sheets (n = grid positions); `[order-snapshot]`, `[stock-sheet]` = values-only/printed sheets; `[pdf]` = printed PDF.

```
KRIPTOK LENS/
  BLUE CUT KT/
    INVENTORY BLUE CUT KT/
      BLUE CUT KT STRIGHT AXIS/
        BLUE CUT KT CYL/
          BLUE CUT KT CYL-3.00'90.xlsx  [triad n=72]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
          BLUE CUT KTCYL+3.00'180.xlsx  [triad n=72]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        BLUE CUT KT SPH/
          BLUE CUT KT SPH +3.00.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
          BLUE CUT KT SPH -3.00.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    ORDER LENS PDF BLUE CUT KT/
      ORDER LENS BLUE CUT KT CYL +2.00'180.pdf  [pdf]
      ORDER LENS BLUE CUT KT CYL -2.00'90.pdf  [pdf]
      ORDER LENS BLUE CUT KT SPH +3.00.pdf  [pdf]
      ORDER LENS BLUE CUT KT SPH -3.00.pdf  [pdf]
    ORDER LENS SHEET BLUE CUT KT/
      ORDER LENS KT HC ALL STRIGHT AXIS.xlsx  [order-snapshot]  sheets: 'BLUE CUT KT SPH +3', 'BLUE CUT KT SPH -3', "BLUE CUT KT CYL +2'180", "BLUE CUT KT CYL -2'90"
    STOCK LENS PDF BLUE CUT KT/
      KT HC STOCK LENS SHEET.pdf  [pdf]
    STOCK LENS SHEET BLUE CUT KT/
      KT HC CROSS AXIS LENS SHEET.xlsx  [stock-sheet]  sheets: 'Sheet1', 'Sheet2'
      KT HC STOCK LENS SHEET.xlsx  [stock-sheet]  sheets: 'KT HC SPH +6', 'KT HC SPH -6', "KT HC CYL +3'180", "KT HC CYL -4'90", "KT HC COMP +0.50'180", "KT HC COMP +1.00'180", "KT HC COMP +3'180", "KT HC COMP -0.50'90", "KT HC COMP -1.00'90", "KT HC COMP -3'90"
  CR HC KT/
    INVENTORY CR HC KT/
      CR HC KT CROSS AXIS/
        KT HC COMP +0.50'90.xlsx  [triad n=126]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        KT HC COMP +1.00'90.xlsx  [triad n=153]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        KT HC COMP -0.50'180.xlsx  [triad n=126]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        KT HC COMP -1.00'180.xlsx  [triad n=153]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        KT HC CYL+3'90.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        KT HC CYL-3'180.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      CR HC KT STRIGHT AXIS/
        CR HC KT CMP/
          KT HC CMP (+180)/
            KT HC COMP +1.00+3.00'180.xlsx  [triad n=126]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
            KT HC COMP +3.00+0.50'180.xlsx  [triad n=126]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
            KT HC COMP +3.00+1.00'180.xlsx  [triad n=153]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
          KT HC CMP (-90)/
            KT HC COMP -1.00-3.00'90.xlsx  [triad n=144]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
            KT HC COMP -3.00-0.50'90.xlsx  [triad n=126]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
            KT HC COMP -3.00-1.00'90.xlsx  [triad n=153]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        CR HC KT CROSS CMP (+-)/
          KT HC CROSS COMP +2.00-4.00'90.xlsx  [triad n=270]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        CR HC KT CYL/
          KT HC CYL STRIGHT AXIS/
            KT HC CYL+3.00'180.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
            KT HC CYL-3.00'90.xlsx  [triad n=108]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        CR HC KT SPH/
          KT HC SPH +6.00.xlsx  [triad n=162]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
          KT HC SPH -6.00.xlsx  [triad n=153]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    ORDER LENS PDF CR HC KT/
      HC KT -4 COMP.pdf  [pdf]
      ORDER LENS HC KT CYL +3.00.pdf  [pdf]
      ORDER LENS HC KT CYL-4.00.pdf  [pdf]
      ORDER LENS KT HC SPH+6.00.pdf  [pdf]
    ORDER LENS SHEET CR HC KT/
      ORDER LENS KT HC ALL STRIGHT AXIS.xlsx  [order-snapshot]  sheets: 'KT HC SPH +6', 'KT HC SPH -6', "KT HC CYL +3'180", "KT HC CYL -4'90", "KT HC COMP +0.50'180", "KT HC COMP +1.00'180", "KT HC COMP +3'180", "KT HC COMP -0.50'90", "KT HC COMP -1.00'90", "KT HC COMP -3'90", "KT HC COMP +2.00-4.00'90"
    STOCK LENS PDF CR HC KT/
      KT HC STOCK LENS SHEET.pdf  [pdf]
    STOCK LENS SHEET CR HC KT/
      KT HC CROSS AXIS LENS SHEET.xlsx  [stock-sheet]  sheets: 'Sheet1', 'Sheet2'
      KT HC STOCK LENS SHEET.xlsx  [stock-sheet]  sheets: 'KT HC SPH +6', 'KT HC SPH -6', "KT HC CYL +3'180", "KT HC CYL -4'90", "KT HC COMP +0.50'180", "KT HC COMP +1.00'180", "KT HC COMP +3'180", "KT HC COMP -0.50'90", "KT HC COMP -1.00'90", "KT HC COMP -3'90"
  PG HC KT/
    INVENTORY PG KT/
      PG KT HC CROSS AXIS/
        PG KT HC CYL +3.00'90.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        PG KT HC CYL-3.00'180.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      PG KT HC SPH (+-)/
        PG KT HC SPH +4.00.xlsx  [triad n=126]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        PG KT HC SPH -5.00.xlsx  [triad n=135]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      PG KT HC STRIGHT AXIS/
        PG KT HC CMP +1.00+2.00'180.xlsx  [triad n=153]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        PG KT HC CMP +3.00+0.50'180.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        PG KT HC CMP -1.00-2.00'90.xlsx  [triad n=153]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        PG KT HC CMP -3.00-0.50'90.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        PG KT HC CYL +3.00'180.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
        PG KT HC CYL-3.00'90.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    ORDER LENS PDF PG KT/
      ORDER LENS PG KT HC CMP +1.00+2.00'180.pdf  [pdf]
      ORDER LENS PG KT HC CMP +3.00+0.50'180.pdf  [pdf]
      ORDER LENS PG KT HC CMP -1.00-2.00'90.pdf  [pdf]
      ORDER LENS PG KT HC CMP -3.00-0.50'90.pdf  [pdf]
      ORDER LENS PG KT HC CYL +3.00'180.pdf  [pdf]
      ORDER LENS PG KT HC CYL +3.00'90.pdf  [pdf]
      ORDER LENS PG KT HC CYL -3.00'180.pdf  [pdf]
      ORDER LENS PG KT HC CYL -3.00'90.pdf  [pdf]
      ORDER LENS PG KT HC SPH +4.00.pdf  [pdf]
      ORDER LENS PG KT HC SPH -5.00.pdf  [pdf]
    ORDER LENS SHEET PG KT/
      ORDER LENS PG KT HC ALL CROSS AXIS.xlsx  [order-snapshot]  sheets: "PG KT HC CYL-3.00'180", "PG KT HC CYL +3.00'90"
      ORDER LENS PG KT HC ALL STRIGHT AXIS.xlsx  [order-snapshot]  sheets: 'PG KT HC SPH +4', 'PG KT HC SPH -5', "PG KT HC CYL +3'180", "PG KT HC CYL -3'90", "PG KT HC CMP +3.00+0.50'180", "PG KT HC CMP +1.00+2.00'180", "PG KT HC COMP -3.00-0.50'90", "PG KT HC COMP -1.00-2.00'90"
    STOCK LENS PDF PG KT/  (empty)
    STOCK LENS SHEET PG KT/
      PG KT HC SPH +6 Lens Sheet.xlsx  [stock-sheet]  sheets: 'Sheet1'
      PG KT HC SPH -4 Lens Sheet.xlsx  [stock-sheet]  sheets: 'Sheet1'
      STCK LENS PG KT HC ALL STRIGHT AXIS.xlsx  [stock-sheet]  sheets: 'PG KT HC SPH +4', 'PG KT HC SPH -5', "PG KT HC CYL +3'180", "PG KT HC CYL -3'90", "PG KT HC COMP +0.50'180", "PG KT HC COMP +1.00'180", "PG KT HC COMP +3'180", "PG KT HC COMP -0.50'90", "PG KT HC COMP -1.00'90", "PG KT HC COMP -3'90"
PROGRESSIVE LENS/
  PROGRESSIVE INVENTORY/
    BLUE CUT PROG SPH+3.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    BLUE LIGHT PROG SPH+3.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    HC PROG SPH+3.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    HMC PROG SPH+3.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    PG BLUE LIGHT PROG SPH+3.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    PG HC PROG SPH+3.xlsx  [triad n=99]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
  PROGRESSIVE ORDER LENS PDF/
    PROG BLUE CUT SPH +3.00 ORDER LENS.pdf  [pdf]
    PROG HC SPH+3.00 ORDER LENS.pdf  [pdf]
    PROG HMC SPH+3.00 ORDER LENS.pdf  [pdf]
    PROG PG HC SPH +3.00 ORDER LENS.pdf  [pdf]
    VISTA GEN 2.0 PGX PROG SPH+3.00.pdf  [pdf]
    VISTA GEN 2.0 PROG ORDER LENS.pdf  [pdf]
  PROGRESSIVE ORDER LENS SHEET/
    PROG ORDER SHEET.xlsx  [order-snapshot]  sheets: 'HC PROG', 'HMC PROG', 'PG HC PROG', 'VISTA GEN 2.0 PG PROG', 'BLUE CUT PROG', 'VISTA GEN 2.0 PROG'
  PROGRESSIVE STOCK LENS PDF/  (empty)
  PROGRESSIVE STOCK LENS SHEET/  (empty)
SINGLE VISION LENS/
  SV +6+2 Lens/
    INVENTORY SV +POWER/
      BLUE CUT HMC BLUE +POWER.xlsx  [triad n=26]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      BLUE CUT HMC GREEN +POWER.xlsx  [triad n=26]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      CR HC +POWER.xlsx  [triad n=357]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      CR HMC +POWER.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      PG HC +POWER.xlsx  [triad n=26]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    ORDER LENS PDF SV -6-2/
      ORDER LENS BLUE CUT SV +SPH +CYL.pdf  [pdf]
      ORDER LENS BLUE LIGHT SV +SPH +CYL.pdf  [pdf]
      ORDER LENS PG HC SV +SPH +CYL.pdf  [pdf]
    ORDER LENS SHEET SV -6-2/
      SV -6-2 Order Lens Sheet.xlsx  [order-snapshot]  sheets: 'CR HC SV -6-2', 'CR HMC SV -6-2 ', 'BLUE CUT GREEN SV -6-2', 'BLUE LIGHT BLUE SV -6-2', 'MAGNUS CLIK SV -6-2', 'POLY BLUE LIGHT SV -6-2', 'PG BLUE LIGHT SV -6-2', 'PG HC SV -6-2'
    STOCK LENS PDF SV -6-2/  (empty)
    STOCK LENS SHEET SV -6-2/
      SV -6-2 Stock Lens Sheet.xlsx  [stock-sheet]  sheets: 'CR HC SV-6-2', 'CR HMC SV-6-2', 'BLUE CUT HMC GREEN SV-6-2', 'BLUE CUT HMC BLUE SV-6-2', 'Sheet5', 'Sheet6'
  SV -12-2 Lens/
    INVENTORY SV -14-2.xlsx  [triad n=90]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    ORDER LENS PDF CR HC SV -14-2.pdf  [pdf]
    ORDER LENS SHEET CR HC SV -14-2.xlsx  [order-snapshot]  sheets: 'HC SV -14-2'
  SV -6-2 Lens/
    INVENTORY SV -6-2/
      BLUE CUT HMC BLUE SV -6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      BLUE CUT HMC GREEN SV -6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      CR HC -6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      CR HMC -6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      Magnus Click -6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      PG BLUE LIGHT BLUE SV -6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      PG HC -6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      PG HMC.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      POLY BLUE LIGHT SV-6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      Poly HMC -6-2.xlsx  [triad n=225]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    ORDER LENS PDF SV -6-2/
      BLUE CUT HMC GREEN SV -6-2.pdf  [pdf]
      BLUE LIGHT BLUE SV -6-2.pdf  [pdf]
      HC SV -6-2.pdf  [pdf]
      PG BLUE LIGHT SV CORAL.pdf  [pdf]
      PG HC SV -6-2.pdf  [pdf]
    ORDER LENS SHEET SV -6-2/
      SV -6-2 Order Lens Sheet.xlsx  [order-snapshot]  sheets: 'CR HC SV -6-2', 'CR HMC SV -6-2 ', 'BLUE CUT GREEN SV -6-2', 'BLUE LIGHT BLUE SV -6-2', 'MAGNUS CLIK SV -6-2', 'POLY BLUE LIGHT SV -6-2', 'PG BLUE LIGHT SV -6-2', 'PG HC SV -6-2'
    STOCK LENS PDF SV -6-2/
      BLUE CUT GREEN SV -6-2 STOCK LENS.pdf  [pdf]
      BLUE LIGHT BLUE  SV -6-2 STOCK LENS.pdf  [pdf]
      CR HC SV -6-2 STOCK LENS.pdf  [pdf]
      CR HMC SV -6-2 STOCK LENS.pdf  [pdf]
    STOCK LENS SHEET SV -6-2/
      SV -6-2 Stock Lens Sheet.xlsx  [stock-sheet]  sheets: 'CR HC SV-6-2', 'CR HMC SV-6-2', 'BLUE CUT HMC GREEN SV-6-2', 'BLUE CUT HMC BLUE SV-6-2', 'Sheet5', 'Sheet6'
  SV -6-4 Lens/
    INVENTORY SV -6-4/
      Blue Cut -6-4.xlsx  [triad n=124]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      Blue Light -6-4.xlsx  [triad n=124]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      CR HC -6-4.xlsx  [triad n=92]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      CR HMC -6-4.xlsx  [triad n=96]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
      PG HC -6-4.xlsx  [triad n=94]  sheets: 'STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'
    ORDER LENS PDF SV -6-4/
      ORDER LENS BLUE CUT SV -6-4.pdf  [pdf]
      ORDER LENS BLUE LIGHT SV -6-4.pdf  [pdf]
      ORDER LENS HC SV -6-4.pdf  [pdf]
      ORDER LENS PG HC SV -6-4.pdf  [pdf]
    ORDER LENS SHEET SV -6-4/
      CR HC SV ORDER LENS SHEET.xlsx  [order-snapshot]  sheets: 'HC SV -6-4', 'PG HC SV -6-4', 'BLUE LIGHT SV -6-4'
```