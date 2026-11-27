#!/usr/bin/env python3
"""TIP 문서 리더 — 실제 샘플 파일 만들기 (v1.26.0)

E2E(tools/doc-reader-e2e.mjs)가 여는 진짜 문서를 만든다. 저장소의 samples/doc-reader/ 에
그대로 커밋해 두고, 형식이 바뀌면 이 스크립트로 다시 만든다.

    python3 tools/make-doc-samples.py

필요한 것: openpyxl, python-docx, python-pptx, pillow (샘플을 만드는 개발용 도구일 뿐,
앱은 이 라이브러리들을 쓰지 않는다 — 앱 안의 파서는 전부 직접 쓴 로컬 코드다).
"""

import io
import os
import struct
import zipfile
from datetime import date, datetime
from pathlib import Path

from PIL import Image, ImageDraw
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor as DocxRGB
from pptx import Presentation
from pptx.util import Inches as PInches, Pt as PPt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "samples" / "doc-reader"
OUT.mkdir(parents=True, exist_ok=True)


def png_bytes(width=320, height=180, color=(46, 94, 78), label="TIP"):
    image = Image.new("RGB", (width, height), color)
    draw = ImageDraw.Draw(image)
    draw.rectangle([8, 8, width - 8, height - 8], outline=(255, 255, 255), width=3)
    draw.text((width // 2 - 24, height // 2 - 8), label, fill=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


PNG = png_bytes()


# --------------------------------------------------------------------------- xlsx
def make_xlsx():
    wb = Workbook()
    ws = wb.active
    ws.title = "매출"

    ws.merge_cells("A1:E1")
    ws["A1"] = "2026년 4분기 매출 보고서"
    ws["A1"].font = Font(size=16, bold=True)
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 28

    ws.merge_cells("A2:A3")
    ws["A2"] = "구분"
    ws["B2"] = "10월"
    ws.merge_cells("B2:C2")
    ws["D2"] = "11월"
    ws.merge_cells("D2:E2")

    headers = ["매출", "비용", "매출", "비용"]
    for column, value in zip("BCDE", headers):
        ws[f"{column}3"] = value

    rows = [
        ("서울", 12500000, 8300000, 13820000, 8700000),
        ("기흥", 4300000, 3100000, 4750000, 3250000),
        ("부산", 7600000, 6200000, 7180000, 6010000),
        ("합계", 24400000, 17600000, 25750000, 17960000),
    ]
    for index, row in enumerate(rows, start=4):
        for column, value in zip("ABCDE", row):
            cell = ws[f"{column}{index}"]
            cell.value = value
            if column != "A":
                cell.number_format = "#,##0"
            if index == 7:
                cell.font = Font(bold=True)

    thin = Side(style="thin", color="B7C0CC")
    for row in ws["A1:E7"]:
        for cell in row:
            cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for letter, width in {"A": 14, "B": 14, "C": 12, "D": 14, "E": 12}.items():
        ws.column_dimensions[letter].width = width
    ws.freeze_panes = "A4"

    # 두 번째 시트 — 페이지 나눔(행 제한)을 확인할 만큼 긴 표
    long_sheet = wb.create_sheet("재고")
    long_sheet.append(["번호", "품목", "규격", "수량", "입고일", "비고"])
    for index in range(1, 321):
        long_sheet.append([
            index,
            f"부품 {index:03d}",
            f"{index % 7 + 1}0x{index % 5 + 2}0",
            index * 3,
            date(2026, (index % 12) + 1, (index % 27) + 1),
            "" if index % 11 else "검수 필요",
        ])
    for letter, width in {"A": 8, "B": 16, "C": 12, "D": 10, "E": 14, "F": 14}.items():
        long_sheet.column_dimensions[letter].width = width

    # 세 번째 시트 — 줄바꿈·여러 줄 메모
    memo = wb.create_sheet("메모")
    memo.column_dimensions["A"].width = 22
    memo.column_dimensions["B"].width = 56
    memo["A1"] = "확인 사항"
    memo["A1"].font = Font(bold=True)
    memo["A2"] = "담당"
    memo["B2"] = "유동규"
    memo["A3"] = "메모"
    memo["B3"] = "줄바꿈이 있는 셀입니다.\n둘째 줄도 보여야 합니다."
    memo["B3"].alignment = Alignment(wrap_text=True, vertical="top")
    memo.row_dimensions[3].height = 40

    wb.save(OUT / "sheet-basic.xlsx")
    # xlsm 은 같은 OOXML 패키지에 매크로 허용 콘텐츠 타입만 다르다 — 파서는 같게 읽는다.
    (OUT / "sheet-macro.xlsm").write_bytes((OUT / "sheet-basic.xlsx").read_bytes())


# --------------------------------------------------------------------------- xls
def make_xls():
    """BIFF8(.xls) — SheetJS 로 만든다(엑셀 97-2003 형식)."""
    import subprocess
    import sys

    script = r"""
import * as XLSX from 'file://ROOT/vendor/xlsx/xlsx.mjs';
import { writeFileSync } from 'node:fs';
const rows = [
  ['품목', '수량', '단가', '금액', '입고일'],
  ['모자', 12, 15000, 180000, new Date(2026, 10, 3)],
  ['장갑', 40, 3000, 120000, new Date(2026, 10, 5)],
  ['양말', 25, 2500, 62500, new Date(2026, 10, 9)],
  ['합계', 77, '', 362500, ''],
];
const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
ws['!merges'] = [{ s: { r: 4, c: 0 }, e: { r: 4, c: 1 } }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '입고');
writeFileSync('OUT/legacy-excel.xls', XLSX.write(wb, { bookType: 'biff8', type: 'buffer' }));
""".replace("ROOT", str(ROOT)).replace("OUT", str(OUT))
    subprocess.run(["node", "--input-type=module", "-e", script], check=True, cwd=str(ROOT))


# --------------------------------------------------------------------------- csv / tsv
def make_csv():
    rows = [
        ["이름", "부서", "금액", "메모"],
        ["김하늘", "개발", "120000", "쉼표, 포함된 메모"],
        ['이"바다', "디자인", "98000", "따옴표 \" 포함"],
        ["박산", "운영", "75000", "줄바꿈\n있는 메모"],
        ["최들", "개발", "110000", ""],
    ]
    lines = []
    for row in rows:
        cells = []
        for value in row:
            if any(character in value for character in ',"\n'):
                cells.append('"' + value.replace('"', '""') + '"')
            else:
                cells.append(value)
        lines.append(",".join(cells))
    (OUT / "table.csv").write_text("\ufeff" + "\n".join(lines) + "\n", encoding="utf-8")
    (OUT / "table.tsv").write_text("\ufeff" + "\n".join("\t".join(row) for row in rows) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- ods
ODS_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 office:version="1.2">
 <office:automatic-styles>
  <style:style style:name="ce1" style:family="table-cell">
   <style:table-cell-properties fo:background-color="#e8f0ec"/>
  </style:style>
 </office:automatic-styles>
 <office:body>
  <office:spreadsheet>
   <table:table table:name="예산">
    <table:table-column table:number-columns-repeated="4"/>
    <table:table-row>
     <table:table-cell table:number-columns-spanned="4" table:number-rows-spanned="1" office:value-type="string">
      <text:p>2026년 예산안</text:p>
     </table:table-cell>
     <table:covered-table-cell/><table:covered-table-cell/><table:covered-table-cell/>
    </table:table-row>
    <table:table-row>
     <table:table-cell office:value-type="string" table:style-name="ce1"><text:p>항목</text:p></table:table-cell>
     <table:table-cell office:value-type="string" table:style-name="ce1"><text:p>계획</text:p></table:table-cell>
     <table:table-cell office:value-type="string" table:style-name="ce1"><text:p>집행</text:p></table:table-cell>
     <table:table-cell office:value-type="string" table:style-name="ce1"><text:p>차이</text:p></table:table-cell>
    </table:table-row>
    <table:table-row>
     <table:table-cell office:value-type="string"><text:p>장비</text:p></table:table-cell>
     <table:table-cell office:value-type="float" office:value="3200000"><text:p>3,200,000</text:p></table:table-cell>
     <table:table-cell office:value-type="float" office:value="2980000"><text:p>2,980,000</text:p></table:table-cell>
     <table:table-cell office:value-type="float" office:value="220000"><text:p>220,000</text:p></table:table-cell>
    </table:table-row>
    <table:table-row>
     <table:table-cell office:value-type="string"><text:p>교육</text:p></table:table-cell>
     <table:table-cell office:value-type="float" office:value="1500000"><text:p>1,500,000</text:p></table:table-cell>
     <table:table-cell office:value-type="float" office:value="1620000"><text:p>1,620,000</text:p></table:table-cell>
     <table:table-cell office:value-type="string"><text:p>-120,000</text:p></table:table-cell>
    </table:table-row>
   </table:table>
  </office:spreadsheet>
 </office:body>
</office:document-content>
"""


def make_ods():
    manifest = """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
"""
    styles = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
 <office:styles>
  <style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
 </office:styles>
</office:document-styles>
"""
    meta = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2">
 <office:meta><meta:generator>TIP sample maker</meta:generator></office:meta>
</office:document-meta>
"""
    with zipfile.ZipFile(OUT / "budget.ods", "w") as package:
        package.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.oasis.opendocument.spreadsheet",
                         compress_type=zipfile.ZIP_STORED)
        package.writestr("META-INF/manifest.xml", manifest, compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("content.xml", ODS_CONTENT, compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("styles.xml", styles, compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("meta.xml", meta, compress_type=zipfile.ZIP_DEFLATED)


# --------------------------------------------------------------------------- docx
def make_docx():
    document = Document()
    section = document.sections[0]
    section.left_margin = Inches(0.9)
    section.right_margin = Inches(0.9)

    title = document.add_heading("TIP 문서 리더 시험 문서", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    document.add_heading("1. 서식", level=1)
    paragraph = document.add_paragraph()
    paragraph.add_run("굵은 글씨").bold = True
    paragraph.add_run(", ")
    paragraph.add_run("기울임").italic = True
    paragraph.add_run(", ")
    underlined = paragraph.add_run("밑줄")
    underlined.underline = True
    paragraph.add_run(", ")
    red = paragraph.add_run("빨간 글씨")
    red.font.color.rgb = DocxRGB(0xC0, 0x20, 0x20)
    paragraph.add_run(", ")
    big = paragraph.add_run("큰 글씨")
    big.font.size = Pt(18)
    paragraph.add_run("가 한 문단에 섞여 있습니다.")

    document.add_heading("2. 목록", level=2)
    document.add_paragraph("불릿 하나", style="List Bullet")
    document.add_paragraph("불릿 둘", style="List Bullet")
    document.add_paragraph("번호 하나", style="List Number")
    document.add_paragraph("번호 둘", style="List Number")

    document.add_heading("3. 표", level=2)
    table = document.add_table(rows=3, cols=3)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    header = table.rows[0].cells
    header[0].merge(header[1])
    header[0].text = "구분"
    header[2].text = "금액"
    table.rows[1].cells[0].text = "10월"
    table.rows[1].cells[1].text = "1,250,000"
    table.rows[1].cells[2].text = "비고 없음"
    table.rows[2].cells[0].text = "11월"
    table.rows[2].cells[1].text = "1,382,000"
    table.rows[2].cells[2].text = "검수 완료"

    document.add_heading("4. 그림", level=2)
    image_path = OUT / "_sample-image.png"
    image_path.write_bytes(PNG)
    document.add_picture(str(image_path), width=Inches(2.6))
    document.add_paragraph("위 그림은 샘플 이미지입니다.")

    document.add_page_break()
    document.add_heading("5. 다음 쪽", level=2)
    document.add_paragraph("페이지 나눔 뒤 문단입니다. 스크롤해서 보여야 합니다.")

    document.save(OUT / "report.docx")
    image_path.unlink(missing_ok=True)


def make_docx_xss():
    """script·onerror·javascript: 가 든 docx — 새니타이즈 시험용."""
    document = Document()
    document.add_heading("안전한가?", level=1)
    document.add_paragraph().add_run("<script>window.__DOCX_XSS__ = 1</script>")
    document.add_paragraph().add_run('<img src=x onerror="window.__DOCX_XSS__ = 2">')
    hyperlink = document.add_paragraph()
    run = hyperlink.add_run("위험한 링크")
    # python-docx 에는 하이퍼링크 API 가 없어 관계를 직접 넣는다.
    part = hyperlink.part
    r_id = part.relate_to("javascript:window.__DOCX_XSS__=3",
                          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
                          is_external=True)
    from docx.oxml import OxmlElement
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), r_id)
    new_run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = "위험한 링크"
    new_run.append(text)
    link.append(new_run)
    hyperlink._p.append(link)
    run.text = ""
    document.save(OUT / "unsafe.docx")


# --------------------------------------------------------------------------- odt
ODT_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:xlink="http://www.w3.org/1999/xlink"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 office:version="1.2">
 <office:automatic-styles>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
  <style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic" fo:color="#1b5e20"/></style:style>
  <style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>
 </office:automatic-styles>
 <office:body>
  <office:text>
   <text:h text:outline-level="1">오픈도큐먼트 시험</text:h>
   <text:p text:style-name="P1">가운데 정렬 문단입니다.</text:p>
   <text:p>보통 문단에 <text:span text:style-name="T1">굵은 글씨</text:span>와
    <text:span text:style-name="T2">초록 기울임</text:span>이 섞여 있습니다.<text:line-break/>줄바꿈도 있습니다.</text:p>
   <text:h text:outline-level="2">목록</text:h>
   <text:list><text:list-item><text:p>첫째 항목</text:p></text:list-item>
    <text:list-item><text:p>둘째 항목</text:p></text:list-item></text:list>
   <text:h text:outline-level="2">표</text:h>
   <table:table table:name="표1">
    <table:table-column table:number-columns-repeated="3"/>
    <table:table-row>
     <table:table-cell table:number-columns-spanned="2" office:value-type="string"><text:p>항목</text:p></table:table-cell>
     <table:covered-table-cell/>
     <table:table-cell office:value-type="string"><text:p>값</text:p></table:table-cell>
    </table:table-row>
    <table:table-row>
     <table:table-cell office:value-type="string"><text:p>수량</text:p></table:table-cell>
     <table:table-cell office:value-type="string"><text:p>단가</text:p></table:table-cell>
     <table:table-cell office:value-type="float" office:value="3000"><text:p>3,000</text:p></table:table-cell>
    </table:table-row>
   </table:table>
   <text:p><draw:frame draw:name="그림1" svg:width="6cm" svg:height="3.4cm">
     <draw:image xlink:href="Pictures/sample.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>
   </draw:frame></text:p>
   <text:p>그림 아래 문단입니다.</text:p>
  </office:text>
 </office:body>
</office:document-content>
"""


def make_odt():
    manifest = """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="Pictures/sample.png" manifest:media-type="image/png"/>
</manifest:manifest>
"""
    styles = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
 <office:styles/>
</office:document-styles>
"""
    with zipfile.ZipFile(OUT / "notes.odt", "w") as package:
        package.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.oasis.opendocument.text",
                         compress_type=zipfile.ZIP_STORED)
        package.writestr("META-INF/manifest.xml", manifest, compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("content.xml", ODT_CONTENT, compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("styles.xml", styles, compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("Pictures/sample.png", PNG, compress_type=zipfile.ZIP_DEFLATED)


# --------------------------------------------------------------------------- rtf
def rtf_escape(text):
    """한글은 cp949 바이트의 \\'hh 로 적는다(한국어 RTF 의 흔한 방식)."""
    out = []
    for character in text:
        code = ord(character)
        if character in "\\{}":
            out.append("\\" + character)
        elif code < 128:
            out.append(character)
        else:
            out.append("".join("\\'%02x" % byte for byte in character.encode("cp949")))
    return "".join(out)


def make_rtf():
    body = []
    body.append(r"{\rtf1\ansi\ansicpg949\deff0\uc1")
    body.append(r"{\fonttbl{\f0\fnil Malgun Gothic;}{\f1\fswiss Helvetica;}}")
    body.append(r"{\colortbl;\red192\green32\blue32;\red27\green94\blue32;}")
    body.append(r"\pard\qc\f0\fs32\b 문서 리더 RTF 시험\b0\par")
    body.append(r"\pard\fs22 ")
    body.append("보통 문단입니다. ")
    body.append(r"\b 굵은 글씨\b0 , ")
    body.append(r"\i 기울임\i0 , ")
    body.append(r"\ul 밑줄\ulnone , ")
    body.append(r"\cf1 빨간 글씨\cf0 . ")
    body.append(rtf_escape("한글도 그대로 보여야 합니다."))
    body.append(r"\par")
    body.append(r"\pard\fs22 ")
    body.append(rtf_escape("둘째 문단: 탭"))
    body.append(r"\tab ")
    body.append(rtf_escape("뒤 텍스트."))
    body.append(r"\par")
    body.append(r"\trowd\trgaph108\cellx3000\cellx6000\cellx8600")
    body.append(r"\pard\intbl\b 품목\b0\cell ")
    body.append(r"\pard\intbl\b 수량\b0\cell ")
    body.append(r"\pard\intbl\b 금액\b0\cell\row")
    body.append(r"\trowd\trgaph108\cellx3000\cellx6000\cellx8600")
    body.append(r"\pard\intbl 모자\cell 12\cell 180,000\cell\row")
    body.append(r"\trowd\trgaph108\cellx3000\cellx6000\cellx8600")
    body.append(r"\pard\intbl 장갑\cell 40\cell 120,000\cell\row")
    body.append(r"\pard\fs22 ")
    body.append(rtf_escape("표 아래 문단입니다."))
    body.append(r"\par}")
    (OUT / "letter.rtf").write_bytes("".join(body).encode("cp949"))


# --------------------------------------------------------------------------- epub
def make_epub():
    chapters = [
        ("chapter-1.xhtml", "1. 시작", [
            "<p>전자책의 첫 장입니다. <strong>굵은 글씨</strong>와 <em>기울임</em>이 보입니다.</p>",
            "<p>다음 장으로 가는 링크: <a href=\"chapter-2.xhtml\">2장으로</a></p>",
            "<img src=\"images/sample.png\" alt=\"샘플 그림\"/>",
        ]),
        ("chapter-2.xhtml", "2. 본문", [
            "<h2>절 하나</h2>",
            "<p>둘째 장입니다. 목록도 있습니다.</p>",
            "<ul><li>첫째</li><li>둘째</li></ul>",
            "<blockquote>인용문입니다.</blockquote>",
            "<p><a href=\"chapter-1.xhtml\">1장으로 돌아가기</a> · <a href=\"chapter-3.xhtml#끝\">마지막으로</a></p>",
        ]),
        ("chapter-3.xhtml", "3. 끝", [
            "<h2>마무리</h2>",
            "<p>마지막 장입니다. 표도 있습니다.</p>",
            "<table><tr><th>항목</th><th>값</th></tr><tr><td>쪽</td><td>3</td></tr></table>",
            "<p id=\"끝\">끝까지 읽었습니다.</p>",
            "<script>window.__EPUB_XSS__ = 1</script>",
            "<p><img src=\"images/sample.png\" onerror=\"window.__EPUB_XSS__=2\" alt=\"그림\"/></p>",
        ]),
    ]
    with zipfile.ZipFile(OUT / "book.epub", "w") as package:
        package.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        package.writestr("META-INF/container.xml", """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
 <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""", compress_type=zipfile.ZIP_DEFLATED)

        manifest_items = "\n".join(
            f'    <item id="c{index}" href="{name}" media-type="application/xhtml+xml"/>'
            for index, (name, _, _) in enumerate(chapters, start=1)
        )
        spine_items = "\n".join(f'    <itemref idref="c{index}"/>'
                                for index in range(1, len(chapters) + 1))
        package.writestr("OEBPS/content.opf", f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
 <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>TIP 전자책 시험</dc:title>
  <dc:creator>유동규</dc:creator>
  <dc:language>ko</dc:language>
  <dc:identifier id="bookid">tip-sample-epub</dc:identifier>
 </metadata>
 <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
{manifest_items}
    <item id="img" href="images/sample.png" media-type="image/png"/>
 </manifest>
 <spine>
{spine_items}
 </spine>
</package>""", compress_type=zipfile.ZIP_DEFLATED)

        nav_items = "\n".join(
            f'    <li><a href="{name}">{title}</a></li>' for name, title, _ in chapters
        )
        package.writestr("OEBPS/nav.xhtml", f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>목차</title></head>
<body><nav epub:type="toc" id="toc"><h1>목차</h1><ol>
{nav_items}
</ol></nav></body></html>""", compress_type=zipfile.ZIP_DEFLATED)

        for name, title, blocks in chapters:
            package.writestr(f"OEBPS/{name}", f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>{title}</title><link rel="stylesheet" href="book.css"/></head>
<body><h1>{title}</h1>
{chr(10).join(blocks)}
</body></html>""", compress_type=zipfile.ZIP_DEFLATED)

        package.writestr("OEBPS/book.css", "body { font-family: serif; } h1 { color: #2E5E4E; }",
                         compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("OEBPS/images/sample.png", PNG, compress_type=zipfile.ZIP_DEFLATED)


# --------------------------------------------------------------------------- pptx
def make_pptx():
    presentation = Presentation()
    presentation.slide_width = PInches(13.333)
    presentation.slide_height = PInches(7.5)

    # 1 — 제목
    slide = presentation.slides.add_slide(presentation.slide_layouts[0])
    slide.shapes.title.text = "TIP 문서 리더"
    slide.placeholders[1].text = "프레젠테이션 시험 · 2026"
    slide.notes_slide.notes_text_frame.text = "첫 장 발표자 노트입니다."

    # 2 — 불릿
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = "이번에 더한 것"
    body = slide.placeholders[1].text_frame
    body.text = "스프레드시트"
    for text in ["문서와 전자책", "프레젠테이션", "텍스트·개발 포맷"]:
        paragraph = body.add_paragraph()
        paragraph.text = text
        paragraph.level = 1
    slide.notes_slide.notes_text_frame.text = "둘째 장 노트: 확장자 목록을 짚어 주세요."

    # 3 — 표
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    slide.shapes.title.text = "매출 요약"
    rows, columns = 4, 3
    table = slide.shapes.add_table(rows, columns, PInches(0.8), PInches(1.8),
                                   PInches(9), PInches(2.6)).table
    for column, text in enumerate(["구분", "10월", "11월"]):
        table.cell(0, column).text = text
    for row, values in enumerate([["서울", "12,500,000", "13,820,000"],
                                  ["기흥", "4,300,000", "4,750,000"],
                                  ["합계", "16,800,000", "18,570,000"]], start=1):
        for column, value in enumerate(values):
            table.cell(row, column).text = value

    # 4 — 그림
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    slide.shapes.title.text = "그림"
    image_path = OUT / "_slide-image.png"
    image_path.write_bytes(PNG)
    slide.shapes.add_picture(str(image_path), PInches(2.2), PInches(2), width=PInches(6))
    image_path.unlink(missing_ok=True)
    slide.notes_slide.notes_text_frame.text = "넷째 장 노트: 그림 설명."

    presentation.save(OUT / "deck.pptx")


# --------------------------------------------------------------------------- 텍스트
def make_texts():
    (OUT / "readme.md").write_text("""# TIP 문서 리더

**마크다운**도 이제 TIP 안에서 읽습니다. `코드`와 [링크](https://example.com)도 보입니다.

## 목록

- 첫째
- 둘째
  - 들여쓴 항목

1. 하나
2. 둘

## 표

| 항목 | 값 |
| --- | --- |
| 형식 | md |
| 처리 | 로컬 |

> 인용문입니다.

```js
const tip = 'TOOL-IN-PACK';
console.log(tip);
```

<script>window.__MD_XSS__ = 1</script>
<img src="x" onerror="window.__MD_XSS__ = 2">

본문 끝.
""", encoding="utf-8")

    (OUT / "config.json").write_text("""{
  "name": "tool-in-pack",
  "version": "1.26.0",
  "private": true,
  "modules": [
    { "id": "doc-reader", "formats": ["pdf", "xlsx", "docx", "pptx"], "enabled": true },
    { "id": "pdf-tools", "formats": ["pdf"], "enabled": false }
  ],
  "limits": { "maxRows": 5000, "maxSizeMb": 40, "unicode": true },
  "meta": { "updated": "2026-11-27", "note": "한글 값도 들어 있습니다" }
}
""", encoding="utf-8")

    (OUT / "broken.json").write_text("""{
  "name": "깨진 파일",
  "items": [1, 2, 3,],
  "note": "쉼표 뒤에 닫는 괄호가 와서 올바른 JSON 이 아닙니다"
""", encoding="utf-8")

    (OUT / "settings.yaml").write_text("""# TIP 설정 예시
app:
  name: TIP
  version: 1.26.0
  modules:
    - doc-reader
    - pdf-tools
  limits:
    rows: 5000
    sizeMb: 40
features:
  darkMode: true
  accent: green
  note: "따옴표 안의 값: 콜론도 됩니다"
""", encoding="utf-8")

    (OUT / "feed.xml").write_text("""<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="b1" available="true">
    <title>한글 제목</title>
    <author>유동규</author>
    <price currency="KRW">18000</price>
  </book>
  <book id="b2" available="false">
    <title>Second Book</title>
    <author>Someone</author>
    <price currency="USD">12.99</price>
  </book>
</catalog>
""", encoding="utf-8")

    log_lines = []
    for index in range(1, 61):
        level = "ERROR" if index % 13 == 0 else "WARN" if index % 7 == 0 else "INFO"
        log_lines.append(f"2026-11-27 09:{index:02d}:00 {level}  worker-{index % 3}  "
                         f"{'요청을 처리하지 못했습니다' if level == 'ERROR' else '작업을 마쳤습니다'} ({index})")
    (OUT / "app.log").write_text("\n".join(log_lines) + "\n", encoding="utf-8")

    (OUT / "notes.txt").write_text("""문서 리더가 여는 텍스트 파일입니다.

둘째 문단: 줄 번호가 왼쪽에 붙습니다.
아주 긴 줄도 넘치지 않고 접혀야 합니다. """ + "가" * 160 + """

마지막 줄.
""", encoding="utf-8")


def main():
    make_xlsx()
    make_xls()
    make_csv()
    make_ods()
    make_docx()
    make_docx_xss()
    make_odt()
    make_rtf()
    make_epub()
    make_pptx()
    make_texts()
    for path in sorted(OUT.iterdir()):
        print(f"{path.name:24} {path.stat().st_size:>8} bytes")


if __name__ == "__main__":
    main()
