// Generator XLSX minimal tanpa dependensi eksternal (ZIP via node:zlib + OOXML)
// Mendukung: multi-sheet, style header, freeze panes, auto-filter, lebar kolom, wrap text

import { deflateRawSync } from "node:zlib";

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------- ZIP builder ----------
function zipSync(files: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() / 2) & 0x1f);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const comp = deflateRawSync(f.data, { level: 6 });
    const crc = crc32(f.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);       // signature
    local.writeUInt16LE(20, 4);               // version needed
    local.writeUInt16LE(0x0800, 6);           // flags: UTF-8
    local.writeUInt16LE(8, 8);                // method: deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, comp);

    const cent = Buffer.alloc(46);
    cent.writeUInt32LE(0x02014b50, 0);
    cent.writeUInt16LE(20, 4);                // version made by
    cent.writeUInt16LE(20, 6);                // version needed
    cent.writeUInt16LE(0x0800, 8);
    cent.writeUInt16LE(8, 10);
    cent.writeUInt16LE(dosTime, 12);
    cent.writeUInt16LE(dosDate, 14);
    cent.writeUInt32LE(crc, 16);
    cent.writeUInt32LE(comp.length, 20);
    cent.writeUInt32LE(f.data.length, 24);
    cent.writeUInt16LE(nameBuf.length, 28);
    cent.writeUInt16LE(0, 30);                // extra len
    cent.writeUInt16LE(0, 32);                // comment len
    cent.writeUInt16LE(0, 34);                // disk number
    cent.writeUInt16LE(0, 36);                // internal attrs
    cent.writeUInt32LE(0, 38);                // external attrs
    cent.writeUInt32LE(offset, 42);
    central.push(cent, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

// ---------- XML helpers ----------
const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // buang control chars ilegal XML
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

function colLetter(idx: number): string {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export interface SheetChart {
  title: string;               // judul chart + judul seri
  catCol: string;              // kolom kategori (mis. "A")
  valCol: string;              // kolom nilai (mis. "B")
  fromRow: number;             // baris data pertama (1-based)
  toRow: number;               // baris data terakhir (1-based)
  cats: string[];              // label kategori (cache)
  vals: number[];              // nilai (cache)
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number }; // 0-based sel anchor
  color: string;               // warna batang (RRGGBB)
  type?: "bar" | "pie";        // tipe grafik (default bar)
  sliceColors?: string[];      // warna per-irisan pie (RRGGBB, sejajar cats)
}

export interface SheetDef {
  name: string;
  rows: (string | number | null | undefined)[][];
  colWidths?: number[];
  headerRow?: boolean;  // baris 1 = header (style + freeze + autofilter)
  zebra?: boolean;
  chart?: SheetChart;      // grafik Excel asli (OOXML bar chart) — kompatibilitas lama
  charts?: SheetChart[];  // beberapa grafik dalam satu sheet
}

export function buildXlsx(sheets: SheetDef[]): Buffer {
  const sheetXmls: string[] = [];
  const contentTypes: string[] = [];
  const workbookSheets: string[] = [];
  const workbookRels: string[] = [];
  const extraFiles: { name: string; data: Buffer }[] = [];
  let chartCount = 0;
  let drawingSeq = 0;

  sheets.forEach((sheet, si) => {
    const rows = sheet.rows;
    const nCols = Math.max(...rows.map((r) => r.length), 1);
    const colsXml = (sheet.colWidths ?? [])
      .slice(0, nCols)
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join("");

    const rowXmls: string[] = [];
    const hyperlinks: string[] = [];
    const hyperlinkRels: string[] = [];
    rows.forEach((row, ri) => {
      const cells: string[] = [];
      row.forEach((cell, ci) => {
        const ref = `${colLetter(ci)}${ri + 1}`;
        if (cell === null || cell === undefined || cell === "") {
          cells.push(`<c r="${ref}" s="0"/>`);
          return;
        }
        if (typeof cell === "number" && isFinite(cell)) {
          const style = ri === 0 && sheet.headerRow ? 1 : cell % 1 !== 0 ? 3 : 2;
          cells.push(`<c r="${ref}" s="${style}"><v>${cell}</v></c>`);
          return;
        }
        const str = String(cell);
        // string URL → hyperlink eksternal (biru, bisa diklik)
        if (/^https?:\/\//i.test(str)) {
          const hid = `rIdHl${hyperlinks.length + 1}`;
          hyperlinks.push(`<hyperlink ref="${ref}" r:id="${hid}"/>`);
          hyperlinkRels.push(`<Relationship Id="${hid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(str).replace(/"/g, "&quot;")}" TargetMode="External"/>`);
          cells.push(`<c r="${ref}" s="5" t="inlineStr"><is><t xml:space="preserve">${esc(str)}</t></is></c>`);
          return;
        }
        let s = 0;
        if (ri === 0 && sheet.headerRow) s = 1;
        else if (sheet.zebra && ri % 2 === 0) s = 4;
        cells.push(`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(str)}</t></is></c>`);
      });
      const rowAttr = ri === 0 && sheet.headerRow ? ' ht="22"' : "";
      rowXmls.push(`<row r="${ri + 1}"${rowAttr}>${cells.join("")}</row>`);
    });

    const autoFilter = sheet.headerRow && rows.length > 1
      ? `<autoFilter ref="A1:${colLetter(nCols - 1)}${rows.length}"/>`
      : "";
    const pane = sheet.headerRow
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

    // ---- grafik asli (OOXML chart) — bisa lebih dari satu per sheet ----
    const sheetCharts: SheetChart[] = sheet.charts ?? (sheet.chart ? [sheet.chart] : []);
    let drawingRef = "";
    let drawingRelId: string | null = null;
    if (sheetCharts.length > 0) {
      // satu drawing per sheet memuat SEMUA anchor grafik
      const drawingId = ++drawingSeq;
      const relId = `rIdDrw${drawingId}`;
      drawingRelId = relId;
      drawingRef = `<drawing r:id="${relId}"/>`;

      const anchors: string[] = [];
      const drawingRels: string[] = [];
      for (let ci = 0; ci < sheetCharts.length; ci++) {
        const c = sheetCharts[ci];
        chartCount++;
        const chartId = chartCount;

      const catRef = `'${sheet.name}'!$${c.catCol}$${c.fromRow}:$${c.catCol}$${c.toRow}`;
      const valRef = `'${sheet.name}'!$${c.valCol}$${c.fromRow}:$${c.valCol}$${c.toRow}`;
      const catPts = c.cats.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("");
      const valPts = c.vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("");

      // ---- seri data (shared bar & pie) ----
      const serData = `<c:cat><c:strRef><c:f>${catRef}</c:f><c:strCache><c:ptCount val="${c.cats.length}"/>${catPts}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${valRef}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${c.vals.length}"/>${valPts}</c:numCache></c:numRef></c:val>`;

      // ---- isi plotArea: bar (dengan sumbu) atau pie (tanpa sumbu, legend kanan) ----
      let plotXml: string;
      let legendXml = "";
      if (c.type === "pie") {
        const dPts = (c.sliceColors ?? [])
          .map((col, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${col}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`)
          .join("");
        plotXml = `<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(c.title)}</c:v></c:tx>${dPts}<c:dLbls><c:spPr><a:noFill/></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="id-ID"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>${serData}</c:ser></c:pieChart>`;
        legendXml = `<c:legend><c:legendPos val="r"/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="id-ID"/></a:p></c:txPr></c:legend>`;
      } else {
        plotXml = `<c:barChart>
<c:barDir val="bar"/>
<c:grouping val="clustered"/>
<c:varyColors val="0"/>
<c:ser>
<c:idx val="0"/>
<c:order val="0"/>
<c:tx><c:v>${esc(c.title)}</c:v></c:tx>
<c:spPr><a:solidFill><a:srgbClr val="${c.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>
${serData}
</c:ser>
<c:gapWidth val="50"/>
<c:axId val="123456789"/>
<c:axId val="987654321"/>
</c:barChart>
<c:catAx>
<c:axId val="123456789"/>
<c:scaling><c:orientation val="maxMin"/></c:scaling>
<c:delete val="0"/>
<c:axPos val="l"/>
<c:txPr><a:bodyPr rot="0" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="id-ID"/></a:p></c:txPr>
<c:crossAx val="987654321"/>
<c:crosses val="autoZero"/>
</c:catAx>
<c:valAx>
<c:axId val="987654321"/>
<c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/>
<c:axPos val="b"/>
<c:majorGridlines/>
<c:numFmt formatCode="General" sourceLinked="1"/>
<c:tickLblPos val="nextTo"/>
<c:txPr><a:bodyPr rot="0" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="id-ID"/></a:p></c:txPr>
<c:crossAx val="123456789"/>
<c:crosses val="autoZero"/>
<c:crossBetween val="between"/>
</c:valAx>`;
      }

      const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart>
<c:title>
<c:tx><c:rich>
<a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/>
<a:lstStyle/>
<a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:srgbClr val="FF0F766E"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:r><a:rPr lang="id-ID" sz="1200" b="1"><a:solidFill><a:srgbClr val="FF0F766E"/></a:solidFill></a:rPr><a:t>${esc(c.title)}</a:t></a:r></a:p>
</c:rich></c:tx>
<c:overlay val="0"/>
</c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea>
<c:layout/>
${plotXml}
</c:plotArea>
${legendXml}
<c:plotVisOnly val="1"/>
<c:dispBlanksAs val="gap"/>
</c:chart>
<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:endParaRPr lang="id-ID"/></a:p></c:txPr>
</c:chartSpace>`;

      // drawingN.xml — anchor 2 sel di samping data (semua grafik sheet ini)
      const { fromCol, fromRow, toCol, toRow } = c.anchor;
      anchors.push(`<xdr:twoCellAnchor>
<xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr><xdr:cNvPr id="${chartId + 1}" name="Grafik ${chartId}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart${chartId}"/></a:graphicData></a:graphic>
</xdr:graphicFrame>
<xdr:clientData/>
</xdr:twoCellAnchor>`);
      drawingRels.push(`<Relationship Id="rIdChart${chartId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartId}.xml"/>`);

      extraFiles.push(
        { name: `xl/charts/chart${chartId}.xml`, data: Buffer.from(chartXml, "utf8") },
      );
      contentTypes.push(`<Override PartName="/xl/charts/chart${chartId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      }

      const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
${anchors.join("\n")}
</xdr:wsDr>`;

      const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${drawingRels.join("\n")}
</Relationships>`;

      extraFiles.push(
        { name: `xl/drawings/drawing${drawingId}.xml`, data: Buffer.from(drawingXml, "utf8") },
        { name: `xl/drawings/_rels/drawing${drawingId}.xml.rels`, data: Buffer.from(drawingRelsXml, "utf8") },
      );
      contentTypes.push(`<Override PartName="/xl/drawings/drawing${drawingId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    }

    // ---- rels worksheet: drawing (bila ada grafik) + hyperlink eksternal (bila ada URL) ----
    const sheetRelsEntries: string[] = [];
    if (drawingRelId) {
      sheetRelsEntries.push(`<Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingRelId.replace("rIdDrw", "")}.xml"/>`);
    }
    sheetRelsEntries.push(...hyperlinkRels);
    if (sheetRelsEntries.length > 0) {
      const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetRelsEntries.join("\n")}
</Relationships>`;
      extraFiles.push({ name: `xl/worksheets/_rels/sheet${si + 1}.xml.rels`, data: Buffer.from(sheetRelsXml, "utf8") });
    }

    // root worksheet perlu deklarasi xmlns:r bila memuat drawing / hyperlink
    const nsR = sheetCharts.length > 0 || hyperlinks.length > 0 ? ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` : "";

    const hyperlinksXml = hyperlinks.length > 0 ? `<hyperlinks>${hyperlinks.join("")}</hyperlinks>` : "";

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${nsR}>
${pane}
<sheetFormatPr defaultRowHeight="15"/>
<cols>${colsXml}</cols>
<sheetData>${rowXmls.join("")}</sheetData>
${autoFilter}
${hyperlinksXml}
${drawingRef}
</worksheet>`;
    sheetXmls.push(xml);

    contentTypes.push(`<Override PartName="/xl/worksheets/sheet${si + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    workbookSheets.push(`<sheet name="${esc(sheet.name).slice(0, 31)}" sheetId="${si + 1}" r:id="rId${si + 1}"/>`);
    workbookRels.push(`<Relationship Id="rId${si + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${si + 1}.xml"/>`);
  });

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1">
<numFmt numFmtId="164" formatCode="#,##0.0"/>
</numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF0F766E"/><name val="Calibri"/></font>
<font><u/><sz val="11"/><color rgb="FF2563EB"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${workbookSheets.join("")}</sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${workbookRels.join("\n")}
<Relationship Id="rIdStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${contentTypes.join("\n")}
</Types>`;

  const files = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    ...extraFiles,
    ...sheetXmls.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(xml, "utf8") })),
  ];

  return zipSync(files);
}
