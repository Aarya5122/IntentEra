#!/usr/bin/env python3
"""build_report.py — Builds the BITS WILP M.Tech Final Dissertation Report
for IntentEra (2024MT03013) into a single .docx file.

Run:
    python3 "Final Report/build_report.py"

Output:
    Final Report/2024MT03013_Final_Dissertation.docx

Notes
-----
- Uses python-docx 1.2+ and Pillow.
- After opening the produced .docx in Word for the first time, right-click on
  the Table of Contents, List of Figures, and List of Tables and choose
  "Update Field" so the page numbers populate.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
FIGS_DIR = HERE / "figures"
SHOTS_DIR = FIGS_DIR / "screenshots"
OUT_PATH = HERE / "2024MT03013_Final_Dissertation.docx"

# ---------------------------------------------------------------------------
# Globals: figure + table counters (filled in as we build the body)
# ---------------------------------------------------------------------------
_fig_no = 0
_tbl_no = 0


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def _set_cell_border(cell, **kwargs):
    """Apply borders to a single table cell. kwargs: top, left, bottom, right.

    Each value should be a dict like {"sz": 6, "val": "single", "color": "000000"}.
    """
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = tcPr.find(qn('w:tcBorders'))
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders')
        tcPr.append(tcBorders)
    for edge in ("top", "left", "bottom", "right"):
        if edge in kwargs:
            cfg = kwargs[edge]
            tag = OxmlElement(f'w:{edge}')
            for k, v in cfg.items():
                tag.set(qn(f'w:{k}'), str(v))
            tcBorders.append(tag)


def _add_field(paragraph, instr_text: str):
    """Insert a Word field (e.g. TOC, PAGE) into a paragraph."""
    run = paragraph.add_run()
    fld_begin = OxmlElement('w:fldChar')
    fld_begin.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText')
    instr.set(qn('xml:space'), 'preserve')
    instr.text = instr_text
    fld_sep = OxmlElement('w:fldChar')
    fld_sep.set(qn('w:fldCharType'), 'separate')
    fld_end = OxmlElement('w:fldChar')
    fld_end.set(qn('w:fldCharType'), 'end')
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_sep)
    run._r.append(fld_end)


def _set_page_number_format(section, fmt: str, start: int | None = None):
    """Set page number format on a section (decimal, lowerRoman, etc.).

    `fmt`: one of "decimal", "lowerRoman", "upperRoman", "lowerLetter".
    `start`: integer to restart numbering at (or None to continue).
    """
    sectPr = section._sectPr
    pgNumType = sectPr.find(qn('w:pgNumType'))
    if pgNumType is None:
        pgNumType = OxmlElement('w:pgNumType')
        sectPr.append(pgNumType)
    pgNumType.set(qn('w:fmt'), fmt)
    if start is not None:
        pgNumType.set(qn('w:start'), str(start))


def _add_page_number_in_footer(section, prefix: str = ""):
    """Centre a `prefix + PAGE` field in the section footer."""
    footer = section.footer
    para = footer.paragraphs[0]
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para.text = ""
    if prefix:
        para.add_run(prefix)
    _add_field(para, "PAGE")


def _new_section_continuous(doc):
    """Insert a continuous section break (used when changing page-number fmt)."""
    return doc.add_section(WD_SECTION.NEW_PAGE)


def _heading(doc, text: str, level: int = 1):
    p = doc.add_heading(text, level=level)
    if level == 0:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def _para(doc, text: str, *, bold: bool = False, italic: bool = False,
          align=WD_ALIGN_PARAGRAPH.JUSTIFY, size: int | None = None):
    p = doc.add_paragraph()
    p.alignment = align
    run = p.add_run(text)
    run.bold = bold
    run.italic = italic
    if size is not None:
        run.font.size = Pt(size)
    return p


def _bullets(doc, items: list[str]):
    for it in items:
        p = doc.add_paragraph(style='List Bullet')
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.add_run(it)


def _numbered(doc, items: list[str]):
    for it in items:
        p = doc.add_paragraph(style='List Number')
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.add_run(it)


def _figure(doc, rel_path: str, caption: str, *, width_inches: float = 6.0):
    """Embed a figure from `rel_path` (relative to the report dir)
    and add a numbered caption underneath."""
    global _fig_no
    _fig_no += 1
    full = HERE / rel_path
    if not full.exists():
        # Be tolerant in dev so the script still runs end-to-end.
        _para(doc, f"[Missing figure: {rel_path}]", italic=True,
              align=WD_ALIGN_PARAGRAPH.CENTER)
    else:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run()
        run.add_picture(str(full), width=Inches(width_inches))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    crun = cap.add_run(f"Figure {_fig_no}: ")
    crun.bold = True
    crun.font.size = Pt(11)
    rest = cap.add_run(caption)
    rest.italic = True
    rest.font.size = Pt(11)
    # Apply paragraph style "Caption" so it ends up in List of Figures.
    try:
        cap.style = doc.styles['Caption']
    except KeyError:
        pass
    return _fig_no


def _table_caption(doc, caption: str):
    """Render a numbered table caption ABOVE the next table."""
    global _tbl_no
    _tbl_no += 1
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    crun = cap.add_run(f"Table {_tbl_no}: ")
    crun.bold = True
    crun.font.size = Pt(11)
    rest = cap.add_run(caption)
    rest.italic = True
    rest.font.size = Pt(11)
    try:
        cap.style = doc.styles['Caption']
    except KeyError:
        pass
    return _tbl_no


def _simple_table(doc, headers: list[str], rows: list[list[str]],
                  *, col_widths: list[float] | None = None):
    """Create a 1-header-row table with thin borders and optional column widths
    (in inches)."""
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    # Header row
    for i, h in enumerate(headers):
        cell = table.cell(0, i)
        cell.text = ""
        p = cell.paragraphs[0]
        run = p.add_run(h)
        run.bold = True
        run.font.size = Pt(11)
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    # Body rows
    for r, row in enumerate(rows, start=1):
        for c, val in enumerate(row):
            cell = table.cell(r, c)
            cell.text = ""
            p = cell.paragraphs[0]
            run = p.add_run(val)
            run.font.size = Pt(11)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    # Column widths
    if col_widths:
        for i, w in enumerate(col_widths):
            for r in range(len(table.rows)):
                table.cell(r, i).width = Inches(w)
    # Apply borders to every cell
    border = {"sz": 6, "val": "single", "color": "888888"}
    for row in table.rows:
        for cell in row.cells:
            _set_cell_border(cell, top=border, left=border,
                             bottom=border, right=border)
    return table


def _code_block(doc, text: str):
    """Render a verbatim block in monospace font."""
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.25)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    run.font.name = "Consolas"
    run.font.size = Pt(10)
    return p


def _page_break(doc):
    p = doc.add_paragraph()
    p.add_run().add_break(WD_BREAK.PAGE)


# ---------------------------------------------------------------------------
# Document setup
# ---------------------------------------------------------------------------

def make_document() -> Document:
    doc = Document()
    # Page size & margins (1 inch all sides per guideline)
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        # 8.5 x 11 (close to "thesis size" 9x11, which is non-standard)
        section.page_width = Inches(8.5)
        section.page_height = Inches(11.0)

    # Default body font + double spacing
    style = doc.styles['Normal']
    style.font.name = "Times New Roman"
    style.font.size = Pt(12)
    pf = style.paragraph_format
    pf.line_spacing = 2.0
    pf.space_after = Pt(0)

    # Heading styles: same family, sized
    for lvl, sz in [('Heading 1', 16), ('Heading 2', 14),
                    ('Heading 3', 12), ('Heading 4', 12)]:
        try:
            s = doc.styles[lvl]
            s.font.name = "Times New Roman"
            s.font.size = Pt(sz)
            s.font.bold = True
            s.font.color.rgb = RGBColor(0x00, 0x00, 0x00)
            s.paragraph_format.line_spacing = 1.15
            s.paragraph_format.space_before = Pt(12)
            s.paragraph_format.space_after = Pt(6)
        except KeyError:
            pass

    return doc


# ---------------------------------------------------------------------------
# Front matter
# ---------------------------------------------------------------------------

def add_cover_page(doc: Document):
    """Appendix A specimen: cover page."""
    sec = doc.sections[0]
    # Page numbers off on cover
    _add_page_number_in_footer(sec, prefix="")  # placeholder; we'll override on next sec

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(48)
    run = p.add_run("A REPORT")
    run.bold = True
    run.font.size = Pt(24)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("ON"); r.bold = True; r.font.size = Pt(18)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(36)
    r = p.add_run(
        "SEMANTIC RECONSTRUCTION OF SOFTWARE INTENT: A CLOUD-HOSTED "
        "AGENTIC AI SOLUTION FOR STUDY OF REQUIREMENT TRACEABILITY IN "
        "PRODUCTION GRADE CODEBASES"
    )
    r.bold = True
    r.font.size = Pt(18)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(36)
    r = p.add_run("BY"); r.bold = True; r.font.size = Pt(16)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(12)
    r = p.add_run("Aarya Nanndaann Singh M N"); r.bold = True; r.font.size = Pt(16)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("ID No.: 2024MT03013"); r.font.size = Pt(14)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(48)
    r = p.add_run("AT"); r.bold = True; r.font.size = Pt(16)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Aqueralabs India Pvt Ltd, Bangalore — 560066"); r.font.size = Pt(14)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(36)
    r = p.add_run("BIRLA INSTITUTE OF TECHNOLOGY & SCIENCE, PILANI")
    r.bold = True; r.font.size = Pt(16)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("VIDYA VIHAR, PILANI, RAJASTHAN — 333031"); r.font.size = Pt(14)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(36)
    r = p.add_run("May 2026"); r.bold = True; r.font.size = Pt(14)
    _page_break(doc)


def add_title_page(doc: Document):
    """Appendix B specimen: title (inner cover) page."""
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(36)
    r = p.add_run("A REPORT"); r.bold = True; r.font.size = Pt(22)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("ON"); r.bold = True; r.font.size = Pt(18)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    r = p.add_run(
        "SEMANTIC RECONSTRUCTION OF SOFTWARE INTENT: A CLOUD-HOSTED "
        "AGENTIC AI SOLUTION FOR STUDY OF REQUIREMENT TRACEABILITY IN "
        "PRODUCTION GRADE CODEBASES"
    )
    r.bold = True; r.font.size = Pt(16)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    r = p.add_run("BY"); r.bold = True; r.font.size = Pt(14)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Aarya Nanndaann Singh M N"); r.bold = True; r.font.size = Pt(14)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("ID No.: 2024MT03013"); r.font.size = Pt(13)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Discipline: M.Tech in Cloud Computing"); r.font.size = Pt(13)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("WILP Course No.: CCZG628T  —  Dissertation"); r.font.size = Pt(13)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    r = p.add_run("Prepared in partial fulfilment of the")
    r.italic = True; r.font.size = Pt(13)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("WILP Dissertation / Project / Project Work Course")
    r.italic = True; r.font.size = Pt(13)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    r = p.add_run("AT"); r.bold = True; r.font.size = Pt(14)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Aqueralabs India Pvt Ltd, Bangalore — 560066")
    r.font.size = Pt(13)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    r = p.add_run("Under the Supervision of"); r.italic = True; r.font.size = Pt(13)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Mr. Hanumanthu Indrakanti  (Director of Engineering)")
    r.bold = True; r.font.size = Pt(13)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Aqueralabs India Pvt Ltd, Bangalore"); r.font.size = Pt(13)

    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    r = p.add_run("BIRLA INSTITUTE OF TECHNOLOGY & SCIENCE, PILANI")
    r.bold = True; r.font.size = Pt(14)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("VIDYA VIHAR, PILANI, RAJASTHAN — 333031")
    r.font.size = Pt(13)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(12)
    r = p.add_run("May 2026"); r.bold = True; r.font.size = Pt(13)
    _page_break(doc)


def add_certificate(doc: Document):
    """Supervisor's certificate, signed."""
    _para(doc, "CERTIFICATE FROM THE SUPERVISOR", bold=True,
          align=WD_ALIGN_PARAGRAPH.CENTER, size=16)
    doc.add_paragraph()
    _para(doc,
        "This is to certify that the dissertation entitled \"Semantic "
        "Reconstruction of Software Intent: A Cloud-Hosted Agentic AI Solution "
        "for Study of Requirement Traceability in Production Grade Codebases\", "
        "submitted by Mr. Aarya Nanndaann Singh M N (ID No.: 2024MT03013), in "
        "partial fulfilment of the requirements of the M.Tech (Cloud Computing) "
        "WILP Dissertation Course (CCZG628T) of the Birla Institute of "
        "Technology and Science, Pilani, is a bona fide record of the original "
        "work carried out by him under my supervision and guidance at "
        "Aqueralabs India Pvt Ltd, Bangalore.")
    _para(doc,
        "The dissertation has been completed in accordance with the "
        "academic standards and timelines set by the WILP Division. The work "
        "embodied in the report has not been submitted, in part or in full, "
        "for the award of any other degree or diploma in this or any other "
        "institute. To the best of my knowledge and belief, the contents of "
        "the report represent the candidate's independent technical and "
        "research effort and have been carried out in a manner suitable for a "
        "Master's level dissertation in Cloud Computing and Artificial "
        "Intelligence.")
    _para(doc,
        "I recommend the report for the consideration of the panel of "
        "examiners and the WILP Division.")
    doc.add_paragraph()
    doc.add_paragraph()
    # Signature block as 2-col table
    t = doc.add_table(rows=1, cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    left, right = t.rows[0].cells
    left.text = ""
    p = left.paragraphs[0]
    p.add_run("Signature of the Supervisor\n\n").bold = True
    p.add_run("Name: Mr. Hanumanthu Indrakanti\n")
    p.add_run("Designation: Director of Engineering\n")
    p.add_run("Organization: Aqueralabs India Pvt Ltd, Bangalore — 560066\n")
    p.add_run("Date: 09 May 2026\n")
    p.add_run("Place: Bangalore")

    right.text = ""
    p = right.paragraphs[0]
    p.add_run("Counter-signature (Additional Examiner)\n\n").bold = True
    p.add_run("Name: Mr. Deepan Kumar\n")
    p.add_run("Designation: Staff Engineer\n")
    p.add_run("Organization: Aqueralabs India Pvt Ltd, Bangalore — 560066\n")
    p.add_run("Date: 09 May 2026\n")
    p.add_run("Place: Bangalore")
    _page_break(doc)


def add_acknowledgements(doc: Document):
    _para(doc, "ACKNOWLEDGEMENTS", bold=True,
          align=WD_ALIGN_PARAGRAPH.CENTER, size=16)
    doc.add_paragraph()
    _para(doc,
        "The work presented in this dissertation has been shaped by the "
        "guidance, encouragement and time of several people, and it is my "
        "pleasure to acknowledge them here.")
    _para(doc,
        "I am sincerely grateful to the leadership of Aqueralabs India Pvt "
        "Ltd, Bangalore, for providing me with the freedom and the production "
        "engineering environment in which the ideas behind IntentEra could be "
        "framed, prototyped and validated. The exposure to real production "
        "code repositories and operational developer workflows has been "
        "central to the relevance of this work.")
    _para(doc,
        "I owe a particular debt of gratitude to my supervisor "
        "Mr. Hanumanthu Indrakanti, Director of Engineering, for his "
        "consistent technical guidance, his patience during architectural "
        "discussions and his insistence that the work remain practically "
        "deployable rather than purely theoretical. His feedback steered the "
        "design of the multi-agent reasoning layer and the cloud topology "
        "towards production-grade quality.")
    _para(doc,
        "I am equally thankful to my additional examiner "
        "Mr. Deepan Kumar, Staff Engineer, whose rigorous reading of the "
        "design and his suggestions on the retrieval-augmented generation "
        "pipeline strengthened the methodological foundations of the system.")
    _para(doc,
        "I would like to thank the BITS Pilani WILP Division, in "
        "particular my Faculty Mentor and the Course-in-Charge of the "
        "Dissertation course (CCZG628T), for the structured academic "
        "framework that made this two-semester programme possible alongside a "
        "full-time engineering role. The midterm review process and the "
        "evaluation rubrics were genuinely helpful in pacing the work.")
    _para(doc,
        "Finally, I thank my colleagues at Aqueralabs and my family, "
        "whose patience during the long evenings of literature review, "
        "coding, deployment and report writing has made this dissertation "
        "possible.")
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p.add_run("Aarya Nanndaann Singh M N\n")
    r.bold = True
    p.add_run("ID No.: 2024MT03013\n")
    p.add_run("BITS Pilani — WILP Division")
    _page_break(doc)


def add_abstract_sheet(doc: Document):
    """Appendix C specimen: abstract sheet (≤ 200 words)."""
    _para(doc, "BIRLA INSTITUTE OF TECHNOLOGY AND SCIENCE, PILANI (RAJASTHAN)",
          bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, size=13)
    _para(doc, "WILP Division — Abstract Sheet",
          bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, size=12)
    doc.add_paragraph()

    # Header table with the candidate / project metadata
    t = doc.add_table(rows=8, cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    rows = [
        ("Organization", "Aqueralabs India Pvt Ltd, Bangalore — 560066"),
        ("Location", "Bangalore, Karnataka, India"),
        ("Duration", "20 January 2026 — 12 May 2026 (one semester)"),
        ("Date of Start", "20 January 2026"),
        ("Date of Submission", "12 May 2026"),
        ("Title of the Project",
         "Semantic Reconstruction of Software Intent: A Cloud-Hosted "
         "Agentic AI Solution for Study of Requirement Traceability in "
         "Production Grade Codebases"),
        ("ID No. / Name of the Student",
         "2024MT03013 / Aarya Nanndaann Singh M N"),
        ("Supervisor / Additional Examiner",
         "Mr. Hanumanthu Indrakanti (Supervisor) / Mr. Deepan Kumar "
         "(Additional Examiner)"),
    ]
    for r, (k, v) in enumerate(rows):
        t.cell(r, 0).text = ""
        run = t.cell(r, 0).paragraphs[0].add_run(k)
        run.bold = True
        t.cell(r, 1).text = ""
        t.cell(r, 1).paragraphs[0].add_run(v)
    border = {"sz": 6, "val": "single", "color": "888888"}
    for row in t.rows:
        for cell in row.cells:
            _set_cell_border(cell, top=border, left=border,
                             bottom=border, right=border)

    doc.add_paragraph()
    p = doc.add_paragraph()
    r = p.add_run("Faculty Mentor: ")
    r.bold = True
    p.add_run("BITS Pilani WILP Division (assigned mentor)")
    p = doc.add_paragraph()
    r = p.add_run("Project Areas: ")
    r.bold = True
    p.add_run(
        "Cloud Computing; Artificial Intelligence; Software Engineering; "
        "Developer Tools and Productivity; Information Retrieval.")
    p = doc.add_paragraph()
    r = p.add_run("Keywords: ")
    r.bold = True
    p.add_run(
        "Requirement Traceability; Software Intent Reconstruction; "
        "Retrieval-Augmented Generation; Agentic AI; Multi-Agent Systems; "
        "Large Language Models; AWS Lambda; MongoDB Atlas Vector Search; "
        "Developer Productivity; Code Comprehension.")
    doc.add_paragraph()

    p = doc.add_paragraph()
    r = p.add_run("Abstract: ")
    r.bold = True
    # Body of the abstract — ~200 words.
    p.add_run(
        "Modern enterprise codebases evolve through fast, distributed DevOps "
        "workflows in which the rationale behind code changes is fragmented "
        "across issue trackers, commits, pull requests and informal "
        "discussions. Source code captures what a system does, but rarely "
        "preserves why each change was introduced. This dissertation "
        "presents IntentEra, a cloud-hosted agentic AI framework that "
        "reconstructs software intent and establishes requirement traceability "
        "in production-grade codebases. IntentEra ingests Jira, Confluence "
        "and GitHub artifacts on AWS Lambda, normalises and section-aware "
        "chunks them, generates 1536-dimensional embeddings with OpenAI and "
        "indexes them in two MongoDB Atlas Vector Search collections. "
        "A multi-query Retrieval-Augmented Generation pipeline fans out the "
        "user's question and the local commit history into both stores in "
        "parallel, max-pools the results by chunk identifier and asks an LLM, "
        "constrained to JSON-mode, to compose a non-technical \u201cwhy\u201d "
        "explanation with grounded citations. A VS Code and Cursor sidebar "
        "extension brings the reconstructed intent directly into the "
        "developer's workflow. The system is deployed end-to-end on AWS and "
        "demonstrates that intent reconstruction can be performed reliably, "
        "incrementally and at low cost on real engineering artifacts.")

    doc.add_paragraph()
    doc.add_paragraph()
    t = doc.add_table(rows=1, cols=2)
    left, right = t.rows[0].cells
    left.text = ""
    p = left.paragraphs[0]
    p.add_run("Signature of Student\n\n").bold = True
    p.add_run("Name: Aarya Nanndaann Singh M N\n")
    p.add_run("Date: 12 May 2026")
    right.text = ""
    p = right.paragraphs[0]
    p.add_run("Signature of Supervisor\n\n").bold = True
    p.add_run("Name: Mr. Hanumanthu Indrakanti\n")
    p.add_run("Date: 09 May 2026")
    _page_break(doc)


def add_abbreviations(doc: Document):
    _para(doc, "LIST OF ABBREVIATIONS AND ACRONYMS", bold=True,
          align=WD_ALIGN_PARAGRAPH.CENTER, size=16)
    doc.add_paragraph()
    abbr = [
        ("ADF", "Atlassian Document Format"),
        ("ANN", "Approximate Nearest Neighbour"),
        ("API", "Application Programming Interface"),
        ("AWS", "Amazon Web Services"),
        ("BITS", "Birla Institute of Technology and Science"),
        ("CI / CD", "Continuous Integration / Continuous Delivery"),
        ("CLI", "Command-Line Interface"),
        ("CRUD", "Create, Read, Update, Delete"),
        ("DevOps", "Development and Operations"),
        ("GraphQL", "Graph Query Language"),
        ("HTTP / HTTPS", "Hypertext Transfer Protocol (Secure)"),
        ("IAM", "Identity and Access Management"),
        ("IDE", "Integrated Development Environment"),
        ("IR", "Information Retrieval"),
        ("ITSM", "IT Service Management"),
        ("JSON", "JavaScript Object Notation"),
        ("JWT", "JSON Web Token"),
        ("LLM", "Large Language Model"),
        ("NLP", "Natural Language Processing"),
        ("PAT", "Personal Access Token"),
        ("PDF / DOCX / HTML",
         "Portable Document Format / Office Open XML Document / HyperText Markup Language"),
        ("PR", "Pull Request"),
        ("RAG", "Retrieval-Augmented Generation"),
        ("REST", "Representational State Transfer"),
        ("SHA", "Secure Hash Algorithm"),
        ("SSO", "Single Sign-On"),
        ("TLS", "Transport Layer Security"),
        ("TLX", "Task Load Index (e.g. NASA-TLX)"),
        ("URI / URL", "Uniform Resource Identifier / Locator"),
        ("VPC", "Virtual Private Cloud"),
        ("VS Code", "Visual Studio Code"),
        ("VSIX", "Visual Studio Extension Installer"),
        ("WILP", "Work-Integrated Learning Programmes"),
    ]
    t = doc.add_table(rows=len(abbr), cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (k, v) in enumerate(abbr):
        c0, c1 = t.rows[i].cells
        c0.text = ""
        run = c0.paragraphs[0].add_run(k); run.bold = True; run.font.size = Pt(11)
        c1.text = ""
        c1.paragraphs[0].add_run(v).font.size = Pt(11)
        c0.width = Inches(1.6); c1.width = Inches(4.6)
    border = {"sz": 4, "val": "single", "color": "BBBBBB"}
    for row in t.rows:
        for cell in row.cells:
            _set_cell_border(cell, top=border, left=border,
                             bottom=border, right=border)
    _page_break(doc)


def add_table_of_contents(doc: Document):
    _para(doc, "TABLE OF CONTENTS", bold=True,
          align=WD_ALIGN_PARAGRAPH.CENTER, size=16)
    p = doc.add_paragraph()
    p.add_run(
        "(After opening this document in Microsoft Word for the first "
        "time, right-click on the field below and choose \u201cUpdate "
        "Field\u201d \u2192 \u201cUpdate entire table\u201d so the page "
        "numbers populate.)").italic = True
    p = doc.add_paragraph()
    _add_field(p, 'TOC \\o "1-3" \\h \\z \\u')
    _page_break(doc)


def add_list_of_figures(doc: Document):
    _para(doc, "LIST OF FIGURES", bold=True,
          align=WD_ALIGN_PARAGRAPH.CENTER, size=16)
    p = doc.add_paragraph()
    _add_field(p, 'TOC \\h \\z \\c "Figure"')
    _page_break(doc)


def add_list_of_tables(doc: Document):
    _para(doc, "LIST OF TABLES", bold=True,
          align=WD_ALIGN_PARAGRAPH.CENTER, size=16)
    p = doc.add_paragraph()
    _add_field(p, 'TOC \\h \\z \\c "Table"')
    _page_break(doc)


# ---------------------------------------------------------------------------
# Body — narrative chapters
# ---------------------------------------------------------------------------

def add_chapter_1_introduction(doc):
    _heading(doc, "Chapter 1 — Introduction", level=1)

    _heading(doc, "1.1 Background and Motivation", level=2)
    _para(doc,
        "Modern enterprise software systems no longer resemble the linear, "
        "monolithic codebases that once defined the discipline. They are "
        "living ecosystems that evolve through commits, pull requests, "
        "incident tickets, requirement updates, design discussions and "
        "automated continuous integration pipelines, often spread across "
        "geographically distributed teams. The complete picture of what a "
        "system is and why it behaves the way it does is therefore not "
        "located in a single place; it is fragmented across an entire "
        "ecosystem of DevOps artifacts.")
    _para(doc,
        "In day-to-day practice an engineer is expected not only to "
        "understand what a piece of code does, but also why it was written "
        "in a particular way, which requirement triggered the change, "
        "whether the implementation truly resolves the original defect, and "
        "how it interacts with other historical decisions in the codebase. "
        "These why-questions are unavoidable during onboarding, defect "
        "triage, refactoring and architectural review. They are also the "
        "questions that source code by itself cannot answer.")
    _para(doc,
        "The phenomenon studied in this dissertation is what we call "
        "intent erosion: the progressive loss of the contextual rationale "
        "behind code as time passes, as authors leave the organisation and "
        "as artifacts become stale or scattered. The cost of intent erosion "
        "is observable. It manifests as long onboarding ramps, as recurring "
        "bugs that re-introduce previously fixed regressions, and as the "
        "extra cognitive load of \u201ccontext archaeology\u201d \u2014 the "
        "manual, time-consuming work of re-discovering why a system is the "
        "way it is by digging through tickets, commits and chat logs.")

    _heading(doc, "1.2 Problem Setting in the Employing Organization", level=2)
    _para(doc,
        "The work reported here was carried out at Aqueralabs India Pvt "
        "Ltd, an enterprise software product organisation that maintains "
        "multiple production-grade backend services. In this environment "
        "engineers depend on Atlassian Jira for requirement and incident "
        "tracking, on Confluence for design documentation, on GitHub for "
        "version control and on a set of CI/CD workflows for build, "
        "validation and deployment. While each of these platforms is "
        "individually mature, the rationale behind any non-trivial code "
        "change is typically split across three or more of them. New "
        "joiners and contributors therefore have to perform the same "
        "mental joins repeatedly, often with incomplete information.")
    _para(doc,
        "These observations motivated the search for a system that could "
        "act as a semantic intermediary between developers and their "
        "fragmented knowledge ecosystem \u2014 a system that could ingest "
        "and unify the artifacts continuously, reconstruct the intent "
        "behind code changes on demand, and surface that reconstructed "
        "intent inside the developer's existing tooling rather than as yet "
        "another portal to visit.")

    _heading(doc, "1.3 Statement of the Problem", level=2)
    _para(doc,
        "The central problem addressed by this dissertation can be stated "
        "as follows. Given a production-grade codebase whose history is "
        "distributed across an issue tracker (Jira), a code-hosting platform "
        "(GitHub) and a documentation platform (Confluence), and given a "
        "natural-language question from a developer (typically about a file "
        "or a selected range of code), reconstruct and present the "
        "implementation intent associated with that code in a manner that "
        "is grounded in the underlying artifacts, traceable back to "
        "specific commits, tickets and pull requests, and integrated into "
        "the developer's IDE.")
    _para(doc,
        "The problem is challenging because requirements and code live in "
        "very different representational spaces, because explicit "
        "requirement-to-code links are rarely maintained in practice, and "
        "because the volume of artifacts in any non-trivial repository "
        "makes manual approaches uneconomical.")

    _heading(doc, "1.4 Scope and Approach", level=2)
    _para(doc,
        "The dissertation designs and implements IntentEra, a "
        "cloud-hosted agentic AI framework that addresses the above problem "
        "through five cooperating layers: (i) artifact ingestion, "
        "(ii) knowledge extraction, (iii) a semantic reasoning engine, "
        "(iv) an agent orchestration layer and (v) IDE integration. The "
        "system is deployed on Amazon Web Services using a small set of "
        "Lambda functions fronted by Amazon API Gateway and scheduled by "
        "Amazon EventBridge. Vector storage and similarity search are "
        "provided by MongoDB Atlas Vector Search; sync state is held in "
        "Redis; large language model and embedding services are obtained "
        "from OpenAI. A VS Code and Cursor sidebar extension delivers the "
        "reconstructed intent into the developer's workflow.")
    _para(doc,
        "The work is empirical and engineering-led: every component "
        "described in the report has been implemented, deployed and "
        "exercised against real Jira and GitHub data of the employing "
        "organisation. The contribution is therefore both methodological "
        "(an architecture for intent reconstruction) and operational (a "
        "working production-grade system).")

    _heading(doc, "1.5 Summary of Contributions", level=2)
    _para(doc, "The dissertation makes the following contributions.")
    _bullets(doc, [
        "It defines intent reconstruction as a distinct problem from "
        "traditional traceability link recovery, and frames it as a "
        "retrieval-and-synthesis task amenable to multi-query RAG.",
        "It proposes a five-layer cloud-hosted architecture in which a "
        "single ingestion Lambda handles two heterogeneous sources (Jira "
        "and GitHub) using shared embedding and vector-store machinery but "
        "independent state.",
        "It designs a multi-query retriever that fans the user's question "
        "and the local commit subjects out across two MongoDB Atlas "
        "vector indexes in parallel and merges the results using a "
        "max-pool re-ranking strategy.",
        "It introduces an agent orchestration layer that decomposes "
        "intent reconstruction into specialised agents (traceability, "
        "code-intent, reproduction, validation) coordinated by a router.",
        "It implements a VS Code and Cursor extension paired with a "
        "loopback-only local git agent so that the reconstructed intent is "
        "delivered with strong privacy and zero context-switching.",
        "It documents the deployment, configuration, security and "
        "operating costs of the resulting system in sufficient detail to "
        "be reproduced by other organisations."])

    _heading(doc, "1.6 Organisation of the Report", level=2)
    _para(doc,
        "Chapter\u00a02 surveys the relevant literature in requirement "
        "traceability, RAG-based traceability, transformer models for "
        "code and agentic AI for software engineering. Chapter\u00a03 "
        "formalises the problem, the dissertation objectives and the scope. "
        "Chapter\u00a04 develops the high-level system architecture and its "
        "five layers in detail. Chapter\u00a05 describes the cloud-hosted "
        "implementation on AWS with annotated screenshots from the "
        "deployed system. Chapter\u00a06 explains the multi-source RAG and "
        "multi-agent reasoning pipeline. Chapter\u00a07 presents the "
        "VS Code and Cursor chat extension and its end-to-end data flow. "
        "Chapter\u00a08 discusses evaluation, observations and the "
        "validation strategy. Chapter\u00a09 documents the engineering "
        "challenges and limitations encountered. Chapter\u00a010 concludes "
        "the work and suggests future research directions. References, "
        "appendices, a glossary and the BITS submission checklist follow.")

    _figure(doc, "figures/fig_overall_architecture.png",
            "IntentEra layered reference architecture, showing the five "
            "logical layers of the system and the underlying cloud "
            "substrate they share.")


def add_chapter_2_literature(doc):
    _heading(doc, "Chapter 2 — Literature Survey", level=1)
    _para(doc,
        "This chapter situates IntentEra in the existing body of work in "
        "requirement traceability, semantic code understanding, "
        "retrieval-augmented generation (RAG) and agentic AI for software "
        "engineering. The literature is broad; the survey here focuses on "
        "the threads that directly informed the architectural and "
        "algorithmic decisions taken in the dissertation.")

    _heading(doc, "2.1 Natural-Language Processing for Requirement Traceability",
             level=2)
    _para(doc,
        "Guo, Stegh\u00f6fer, Vogelsang and Cleland-Huang [1] survey the "
        "use of NLP techniques for requirement traceability, with a "
        "particular emphasis on how structured semantic entities can be "
        "extracted from informal natural-language requirements. Their "
        "central observation is that purely lexical approaches \u2014 such "
        "as keyword search or term-frequency similarity \u2014 routinely "
        "fail to capture the subtle phrasing differences between how a "
        "business analyst describes a requirement and how an engineer "
        "names a function or commits a change. They demonstrate that "
        "preprocessing pipelines that explicitly recognise entities "
        "(actors, actions, objects) materially improve downstream link "
        "quality.")
    _para(doc,
        "IntentEra adopts this insight at its preprocessing stage. The "
        "Jira normaliser converts Atlassian Document Format into clean "
        "text, separates structured fields (key, summary, status, labels) "
        "from prose, and emits one chunk per comment. This normalised "
        "representation is closer to the entity-aware representation "
        "advocated by Guo et al. [1] and provides a stronger basis for "
        "embedding-based retrieval than the raw exported JSON.")

    _heading(doc,
             "2.2 Empirical Comparison of Requirement-to-Code Link Recovery",
             level=2)
    _para(doc,
        "Wang, Zou, Wan and others [2] provide a rigorous empirical study "
        "of state-of-the-art methods for requirement-to-code traceability "
        "link recovery, comparing classical information-retrieval (IR) "
        "techniques such as Vector Space Models and BM25 against "
        "deep-learning approaches based on word embeddings, sentence "
        "encoders and pretrained transformer models. Their headline "
        "finding is that no single technique dominates across all "
        "industrial datasets, and that hybrid approaches combining IR "
        "signals with neural similarity tend to outperform either family "
        "in isolation.")
    _para(doc,
        "Two implications shaped IntentEra. First, the system retains "
        "structured metadata (ticket keys, file paths, commit SHAs, branch "
        "lists) alongside the embedding so that classical filters can be "
        "applied during $vectorSearch \u2014 in effect, a hybrid IR + "
        "neural query. Second, by treating the user's question and each "
        "local commit subject as separate queries, the multi-query "
        "retriever is implicitly an ensemble, exploiting the empirical "
        "observation that no single signal is reliably best.")

    _heading(doc,
             "2.3 Retrieval-Augmented Generation for Traceability",
             level=2)
    _para(doc,
        "Ali, Naganathan and Bork [3] explicitly apply Retrieval-Augmented "
        "Generation (RAG) to the problem of establishing traceability "
        "between natural-language requirements and software artifacts. "
        "Their architecture uses a sentence encoder to retrieve candidate "
        "links and then a large language model to compose a justification "
        "in natural language. This pattern \u2014 retrieve, then generate "
        "with retrieved context as grounding \u2014 forms the conceptual "
        "blueprint for the IntentEra reasoning engine.")
    _para(doc,
        "RAG is preferred over end-to-end fine-tuning for three reasons "
        "that are particularly important in industrial deployments. First, "
        "labelled traceability data are scarce and expensive to curate. "
        "Second, the underlying repositories evolve continuously, which "
        "makes statically fine-tuned weights stale. Third, RAG supports "
        "explicit citation and grounding, which is essential to mitigate "
        "the well-known hallucination risk of LLMs in technical contexts. "
        "IntentEra strengthens this further by forcing the LLM into "
        "JSON-mode and by post-filtering any cited identifier (commit SHA, "
        "Jira key, PR number) that does not appear in the supplied "
        "context.")

    _heading(doc, "2.4 Transformer Models for Code", level=2)
    _para(doc,
        "Ahmad, Agha, Ray and others [4] survey the family of transformer "
        "models adapted to source code, including encoders such as "
        "CodeBERT and CodeT5 and decoder-style code completion models. "
        "Their survey establishes that transformers can capture "
        "structural regularities of code (identifier conventions, control "
        "flow patterns, type usage) and project them into a continuous "
        "vector space that is amenable to similarity search.")
    _para(doc,
        "Kanade, Agrawal, de Melo and others [5] complement this by "
        "showing that self-training with unlabelled code substantially "
        "improves downstream tasks, suggesting that the embedding spaces "
        "produced by such models can be reused across many software "
        "engineering tasks without per-project fine-tuning.")
    _para(doc,
        "IntentEra does not currently fine-tune a code-specific encoder. "
        "The first deployment uses OpenAI's text-embedding-3-small model "
        "(1536 dimensions) for both natural-language and code-adjacent "
        "artifacts (commit messages, PR bodies, issue bodies). This "
        "decision was deliberate: the artifacts indexed by IntentEra are "
        "predominantly natural-language explanations of code rather than "
        "raw source, and a high-quality general-purpose text encoder is "
        "more appropriate. The system is, however, structured so that the "
        "embedder is a single pluggable component; replacing it with a "
        "code-specialised model would change a single class.")

    _heading(doc, "2.5 Agentic AI for Software Engineering", level=2)
    _para(doc,
        "The recent surge of \u201cagentic\u201d AI systems \u2014 in "
        "which a coordinator decomposes a user goal into specialised "
        "sub-tasks executed by tool-using sub-agents \u2014 has produced a "
        "small but rapidly growing literature on agent-based developer "
        "tools. The recurring lesson from the existing systems is that "
        "decomposition by concern improves both interpretability and "
        "robustness: each agent can be evaluated and improved "
        "independently, and the coordinator can fall back gracefully if a "
        "specialist returns low-confidence output.")
    _para(doc,
        "IntentEra adopts this principle at the orchestration layer. The "
        "design space includes a Traceability Agent (resolves "
        "requirement-to-code links), a Code-Intent Agent (composes the "
        "\u201cwhy\u201d explanation), a Reproduction Agent (derives "
        "repro steps from tickets and commits) and a Validation/Test "
        "Agent (suggests how to verify the fix). The current production "
        "deployment runs the first two agents end-to-end, with the "
        "remaining two implemented as scaffolds for the future-work "
        "phase.")

    _heading(doc, "2.6 Positioning and Gap", level=2)
    _para(doc,
        "Reading the literature side by side, four observations stand "
        "out. (i) NLP-based traceability work focuses on link recovery "
        "rather than on explanation. (ii) RAG approaches tend to be "
        "evaluated on small public datasets rather than on production "
        "engineering corpora. (iii) Agentic systems for software "
        "engineering tend to focus on autonomous code generation rather "
        "than on understanding existing code. (iv) Almost no work in the "
        "intersection has been packaged as a deployable, IDE-integrated "
        "system that an engineering team can adopt incrementally.")
    _para(doc,
        "IntentEra contributes precisely at this intersection. It treats "
        "intent reconstruction (not link recovery) as the goal; it uses "
        "RAG over real production artifacts (Jira, Confluence, GitHub) "
        "and not synthetic datasets; it is structured as an agentic "
        "framework optimised for explanation rather than autonomous "
        "action; and it is deployed end-to-end on AWS with a "
        "first-class IDE integration. The remainder of this report "
        "describes that contribution.")


def add_chapter_3_problem(doc):
    _heading(doc, "Chapter 3 — Problem Statement, Objectives and Scope",
             level=1)

    _heading(doc, "3.1 Formal Problem Statement", level=2)
    _para(doc,
        "Let R denote the set of requirement-bearing artifacts in an "
        "organisation \u2014 in the present work, Jira tickets, Confluence "
        "pages and GitHub issues. Let C denote the set of code-related "
        "artifacts \u2014 commits, pull requests, review threads. Let D "
        "denote the developer's working tree at a point in time, with a "
        "selected file f and (optionally) a line range \u27e8a, b\u27e9. "
        "Given a natural-language question q from the developer about "
        "(f, a, b), the problem is to construct an explanation E that "
        "answers q in plain language and is supported by a citation set "
        "S \u2286 R \u222a C such that every citation in S is grounded in a "
        "real artifact and every claim in E is attributable to citations "
        "in S.")
    _para(doc,
        "Three properties make this formulation distinctive compared to "
        "classical traceability link recovery. First, the output is an "
        "explanation, not a binary link decision. Second, the input "
        "carries both a question and a precise code context (file, range), "
        "which is much richer than asking \u201cwhich requirement maps to "
        "this code?\u201d in the abstract. Third, the system is required "
        "to produce a grounded answer rather than the most-similar "
        "artifact, so retrieval and generation are not independent.")

    _heading(doc, "3.2 Dissertation Objectives", level=2)
    _para(doc, "The objectives crystallise from the formal statement above.")
    _numbered(doc, [
        "To investigate and characterise the phenomenon of intent erosion "
        "in production-grade codebases, with concrete examples drawn from "
        "the employing organisation.",
        "To design a semantic reconstruction framework that establishes "
        "meaningful relationships between natural-language requirements "
        "and code changes, supporting both metadata-based and "
        "embedding-based linkage.",
        "To architect a cloud-hosted agentic AI system that combines "
        "Retrieval-Augmented Generation with multi-agent reasoning to "
        "infer, synthesise and explain implementation intent.",
        "To integrate the system with modern Integrated Development "
        "Environments (VS Code and Cursor) so that intent reconstruction "
        "is delivered without context-switching.",
        "To enable automated traceability workflows: mapping requirements "
        "to commits, identifying relevant code segments and generating "
        "contextual explanations of how and why specific changes address "
        "requirements or defects.",
        "To support issue reproduction and validation reasoning, allowing "
        "developers to understand the conditions under which a problem "
        "occurs and to verify whether a given implementation resolves it.",
        "To evaluate the deployed system on functional correctness, "
        "operating cost and qualitative impact on developer cognitive load."])

    _heading(doc, "3.3 Scope of Work", level=2)
    _para(doc,
        "The scope of the dissertation is bounded as follows. The system "
        "ingests Jira (cloud), Confluence (cloud) and GitHub repositories. "
        "It does not currently ingest other ITSM platforms (such as "
        "ServiceNow), other source control hosts (such as Bitbucket "
        "Cloud or Server beyond proof-of-concept), or chat platforms "
        "(such as Slack). The intent reconstruction is performed for the "
        "two source families demonstrated in production: Jira and GitHub. "
        "The IDE integration ships as a single VSIX that installs in both "
        "VS Code and Cursor.")
    _para(doc,
        "Out of scope are: code generation or autonomous repair; "
        "fine-tuning of bespoke LLMs on the organisation's data; full "
        "static-analysis-based call-graph reasoning; on-premises "
        "deployment without internet egress (the design assumes managed "
        "cloud services). These are sketched in the future-work chapter "
        "as natural extensions.")

    _heading(doc, "3.4 Success Criteria", level=2)
    _para(doc, "The dissertation considers itself successful if it meets:")
    _bullets(doc, [
        "Functional: the deployed system answers a representative "
        "developer question by retrieving grounded artifacts from both "
        "Jira and GitHub stores and synthesising a citation-backed "
        "explanation in less than the configured request timeout.",
        "Operational: the system runs continuously on an AWS account "
        "with predictable cost, automated incremental sync and no manual "
        "intervention on the daily incremental cycle.",
        "Architectural: the system decomposes cleanly into the five "
        "layers proposed in Chapter\u00a04, and a new source can be added "
        "by implementing only a fetcher plus a normaliser.",
        "Methodological: the framework is reproducible from this "
        "report and the accompanying repository documentation, including "
        "step-by-step deployment instructions."])

    _heading(doc, "3.5 Plan of Work", level=2)
    _table_caption(doc,
        "Phased plan of work for the dissertation, including completion status "
        "as of the final submission.")
    _simple_table(doc,
        headers=["Phase", "Dates", "Deliverable", "Status"],
        rows=[
            ["Outline & Proposal Finalisation", "20 Jan 2026 — 07 Feb 2026",
             "Literature survey, dissertation outline, problem formulation.",
             "Completed"],
            ["Requirement Analysis & Architecture",
             "08 Feb 2026 — 28 Feb 2026",
             "Cloud-hosted agentic framework design; identification of "
             "integrations; semantic reconstruction pipeline definition.",
             "Completed"],
            ["Prototype Phase\u00a0I — Artifact Integration",
             "01 Mar 2026 — 20 Mar 2026",
             "Implementation of Jira and GitHub fetchers; commit/ticket/PR "
             "extraction; metadata traceability.", "Completed"],
            ["Midterm Report & Submission",
             "21 Mar 2026 — 28 Mar 2026",
             "Documentation of progress, architecture and prototype status; "
             "midterm dissertation report.", "Completed"],
            ["Prototype Phase\u00a0II — Agentic AI Reasoning",
             "29 Mar 2026 — 20 Apr 2026",
             "Multi-query retriever, multi-agent orchestration, "
             "JSON-mode LLM answer composition with citations.",
             "Completed"],
            ["Testing, Validation & User Evaluation",
             "21 Apr 2026 — 05 May 2026",
             "Functional testing on production repositories; cognitive-load "
             "and traceability accuracy evaluation; chat extension on real "
             "files.", "Completed"],
            ["Final Dissertation Writing & Review",
             "06 May 2026 — 11 May 2026",
             "Consolidation of findings, supervisor feedback, final "
             "manuscript.", "Completed"],
            ["Final Submission", "12 May 2026",
             "Final review and official submission of the dissertation report.",
             "Completed"],
        ],
        col_widths=[1.7, 1.6, 2.7, 0.8])


def add_chapter_4_architecture(doc):
    _heading(doc, "Chapter 4 — System Architecture", level=1)

    _heading(doc, "4.1 Architectural Principles", level=2)
    _para(doc,
        "The architecture of IntentEra is shaped by five principles that "
        "were derived from the literature survey and from the operational "
        "constraints of the employing organisation.")
    _bullets(doc, [
        "Layered separation of concerns: ingestion, extraction, "
        "reasoning, orchestration and IDE delivery are independently "
        "implementable, testable and replaceable.",
        "Source neutrality: each artifact source (Jira, GitHub) plugs "
        "into the same downstream embedding and vector-store pipeline; "
        "adding a new source touches only a fetcher and a normaliser.",
        "Idempotence: every chunk written to the vector store has a "
        "deterministic identifier, so re-running the same ingestion is a "
        "safe, low-cost operation.",
        "Strong grounding: the LLM never speaks without a context "
        "package; citations not present in the context are dropped before "
        "the response is returned to the developer.",
        "Cloud-native economics: the system pays per-invocation rather "
        "than per-server, which makes it viable for teams with bursty "
        "developer-question workloads."])

    _heading(doc, "4.2 The Five Layers", level=2)
    _para(doc, "Figure\u00a01 summarises the five layers. We elaborate each below.")

    _heading(doc, "4.2.1 Artifact Ingestion Layer", level=3)
    _para(doc,
        "The ingestion layer establishes secure, structured access to "
        "external systems through APIs and connectors. For Jira it uses "
        "Basic authentication with email plus API token over the public "
        "REST API, optionally following Confluence \u201cremote link\u201d "
        "URLs to fetch additional context. For GitHub it uses a Personal "
        "Access Token with repository scope, combining REST and GraphQL "
        "endpoints to obtain commits on active branches, pull requests "
        "with review threads, and issues with comments. The layer "
        "respects rate limits, retries with exponential back-off and "
        "emits structured logs that downstream observability tools can "
        "reason about.")

    _heading(doc, "4.2.2 Knowledge Extraction Layer", level=3)
    _para(doc,
        "Raw artifacts are converted into machine-processable semantic "
        "representations in this layer. Atlassian Document Format is "
        "rendered to clean text. Attachments in PDF, DOCX, TXT and HTML "
        "are parsed and extracted. Pull-request reviews are grouped with "
        "their inline comments so that reviewer rationale stays "
        "co-located with the code lines it discusses. The output is "
        "passed through a section-aware chunker (Figure\u00a08) that "
        "produces \u201cone idea per chunk\u201d \u2014 each chunk is "
        "long enough to be self-contained and short enough to be "
        "embedded efficiently. Each chunk is then embedded with OpenAI "
        "text-embedding-3-small (1536 dimensions) and written into the "
        "appropriate MongoDB Atlas vector collection.")

    _heading(doc, "4.2.3 Semantic Reasoning Engine", level=3)
    _para(doc,
        "The reasoning engine is the core intelligence of the system. It "
        "performs cross-artifact correlation: given a developer question "
        "and a set of local commit subjects, it embeds them in a single "
        "OpenAI batch, fans the resulting query vectors out across the "
        "Jira and GitHub vector indexes in parallel, max-pools the "
        "results by chunk identifier and asks an LLM in JSON-mode to "
        "compose a non-technical \u201cwhy\u201d explanation grounded in "
        "the merged context. Citations not present in the context are "
        "stripped before the response is returned. The detail of this "
        "pipeline is the subject of Chapter\u00a06.")

    _heading(doc, "4.2.4 Agent Orchestration Layer", level=3)
    _para(doc,
        "Agentic decomposition turns a single monolithic prompt into a "
        "collaboration between specialised reasoners (Figure\u00a05). A "
        "Coordinator Agent receives the developer's request, decides "
        "which specialists to consult and synthesises their outputs into "
        "a single response. The current production design implements the "
        "Coordinator and the Code-Intent Agent end-to-end, with the "
        "Traceability, Reproduction and Validation/Test agents wired up "
        "as scaffolds whose internal prompts are being matured. The "
        "decomposition makes prompts shorter and more specific, which in "
        "turn improves both response quality and observability.")

    _heading(doc, "4.2.5 IDE Integration Layer", level=3)
    _para(doc,
        "The IDE layer presents the reconstructed intent to the developer "
        "without forcing them to leave their editor. The implementation "
        "ships as a single VSIX (the same artifact installs into both "
        "VS Code and Cursor) backed by a sidebar webview, two right-click "
        "commands (\u201cIntentEra: Ask about selection\u201d and "
        "\u201cIntentEra: Ask about this file\u201d) and a small loopback "
        "Local Git Agent that extracts commit history from the user's "
        "working tree on demand. Chapter\u00a07 covers the extension in "
        "detail.")

    _heading(doc, "4.3 Cross-Cutting Services", level=2)
    _para(doc,
        "Three cross-cutting services support every layer. AWS Secrets "
        "Manager holds a single pooled JSON secret containing every "
        "credential the Lambdas need (Jira, Confluence, GitHub, MongoDB, "
        "Redis, OpenAI). Redis stores per-source synchronisation state "
        "and a short-lived distributed lock, so two overlapping ingestion "
        "invocations cannot trample each other. CloudWatch captures "
        "structured JSON logs from every Lambda; the three IntentEra "
        "log groups are visible in Figure\u00a09.")

    _heading(doc, "4.4 Significance of the Design", level=2)
    _para(doc,
        "The architecture shifts software engineering support from a "
        "document-centric retrieval model (\u201cwhich page should I "
        "read?\u201d) to an intent-centric reasoning model "
        "(\u201cwhy is this code the way it is?\u201d). The five-layer "
        "decomposition is significant for three reasons: (i) it makes the "
        "system extensible \u2014 new sources, new agents and new IDEs "
        "can be added independently; (ii) it makes the system testable "
        "\u2014 each layer has a small, well-typed interface; and "
        "(iii) it makes the system economical \u2014 idempotent "
        "incremental ingestion and pay-per-invocation Lambdas keep the "
        "monthly cost in single-digit US dollars for the workloads "
        "exercised so far.")


def add_chapter_5_cloud(doc):
    _heading(doc, "Chapter 5 — Cloud-Hosted Implementation on AWS", level=1)
    _para(doc,
        "This chapter walks through the production deployment of "
        "IntentEra on AWS. The objective is to demonstrate that the "
        "abstract architecture of Chapter\u00a04 has a concrete, "
        "operational realisation, and to make the deployment "
        "reproducible.")

    _figure(doc, "figures/fig_aws_topology.png",
            "AWS deployment topology: EventBridge schedules the ingestion "
            "Lambda; API Gateway routes /retrieve and /chat to dedicated "
            "Lambdas; all Lambdas pull pooled credentials from Secrets "
            "Manager and share MongoDB Atlas, Redis and OpenAI.")

    _heading(doc, "5.1 Compute: Three AWS Lambda Functions", level=2)
    _para(doc,
        "The system runs on three Node.js 24 Lambda functions, each "
        "deployed from the same code artifact but invoking a different "
        "handler entry point. Figure\u00a02 in this chapter shows the "
        "console listing.")
    _figure(doc, "figures/screenshots/infra_02.png",
            "AWS Lambda console listing the three IntentEra functions: "
            "intentera-ingest (scheduled ingestion), intentera-retrieve "
            "(retrieval API) and intentera-chat (chat API).")
    _para(doc,
        "Each function is sized for its purpose. The ingestion Lambda "
        "(Figure\u00a03) is configured with a 15-minute timeout because a "
        "full import can pull thousands of artifacts; the chat Lambda "
        "(Figure\u00a04) is configured with a one-minute timeout because "
        "a single request is bounded by the LLM call; the retrieve Lambda "
        "is similarly short-lived. The current memory allocation is "
        "512\u00a0MB; this was chosen empirically and provides ample "
        "headroom for the embedding-batch and vector-search workloads.")
    _figure(doc, "figures/screenshots/infra_14.png",
            "intentera-ingest general configuration: 512 MB memory, 15-minute "
            "timeout, 512 MB ephemeral storage.")
    _figure(doc, "figures/screenshots/infra_18.png",
            "intentera-chat general configuration: 512 MB memory, 1-minute "
            "timeout.")
    _figure(doc, "figures/screenshots/infra_19.png",
            "intentera-retrieve general configuration with the API Gateway "
            "trigger attached to the function.")

    _heading(doc, "5.2 Lambda Environment Variables", level=2)
    _para(doc,
        "Each Lambda is configured with a small set of environment "
        "variables. Sensitive credentials are not stored as Lambda "
        "environment variables; instead, USE_SECRETS_MANAGER=true tells "
        "the function to read its credentials from a single pooled secret "
        "(see Section\u00a05.4). This is visible in the console screenshots "
        "below.")
    _figure(doc, "figures/screenshots/infra_15.png",
            "Environment variables for the intentera-ingest Lambda. Note "
            "USE_SECRETS_MANAGER=true and the Secrets Manager ARN; the "
            "actual credentials live in Secrets Manager rather than "
            "alongside the function configuration.")
    _figure(doc, "figures/screenshots/infra_17.png",
            "Environment variables for the intentera-chat Lambda. The "
            "configuration is intentionally minimal so that secrets stay "
            "out of the function metadata.")
    _figure(doc, "figures/screenshots/infra_20.png",
            "Environment variables for the intentera-retrieve Lambda.")

    _heading(doc, "5.3 Scheduling: Amazon EventBridge", level=2)
    _para(doc,
        "Two EventBridge schedules drive the ingestion Lambda \u2014 one "
        "per source. Each schedule fires every 60 minutes and passes a "
        "small JSON payload that selects the source pipeline.")
    _figure(doc, "figures/screenshots/infra_04.png",
            "Two EventBridge schedules registered against the ingestion "
            "Lambda: intentera-incremental-60m for Jira and "
            "intentera-github-incremental-60 for GitHub.")
    _figure(doc, "figures/screenshots/infra_07.png",
            "Detail of the Jira schedule (intentera-incremental-60m): a "
            "fixed-rate 60-minute trigger.")
    _figure(doc, "figures/screenshots/infra_05.png",
            "Detail of the GitHub schedule (intentera-github-incremental-60): "
            "the same fixed-rate cadence as the Jira schedule, but a "
            "different payload.")
    _figure(doc, "figures/screenshots/infra_08.png",
            "Target tab of the Jira schedule: AWS Lambda invocation of the "
            "intentera-ingest function.")
    _figure(doc, "figures/screenshots/infra_06.png",
            "Target tab of the GitHub schedule: the same Lambda is invoked, "
            "but the payload {\"source\":\"github\",\"mode\":\"incremental\"} "
            "selects the GitHub pipeline at runtime.")
    _para(doc,
        "Decoupling the schedules at the EventBridge layer (rather than "
        "scheduling a single Lambda that branches internally) is "
        "deliberate: it lets operators enable, disable, accelerate or "
        "decelerate either source independently, without code changes.")

    _heading(doc, "5.4 Credentials: AWS Secrets Manager", level=2)
    _para(doc,
        "All credentials are consolidated in a single Secrets Manager "
        "secret, intentera/rag/prod, and pulled in on Lambda cold start. "
        "This single-secret approach was chosen over per-credential "
        "secrets because the Lambdas need most of the keys together, and "
        "the cost model of Secrets Manager favours consolidating related "
        "values.")
    _figure(doc, "figures/screenshots/infra_03.png",
            "AWS Secrets Manager: the intentera/rag/prod secret holding the "
            "pooled JSON credential blob (Jira, Confluence, GitHub, MongoDB, "
            "Redis and OpenAI tokens).")
    _para(doc,
        "Each Lambda's execution role is granted only "
        "secretsmanager:GetSecretValue on this single secret ARN, which "
        "tightens the blast radius if an execution role is ever "
        "compromised.")

    _heading(doc, "5.5 Front Door: Amazon API Gateway", level=2)
    _para(doc,
        "Two HTTP routes are exposed: POST /retrieve and POST /chat. The "
        "former returns ranked hits and a ready-to-paste context string "
        "for any caller building their own LLM stack; the latter is the "
        "fully-formed chat endpoint consumed by the IDE extension.")
    _figure(doc, "figures/screenshots/infra_09.png",
            "Amazon API Gateway routes: POST /retrieve and POST /chat both "
            "live on the same HTTP API, mapped to the corresponding "
            "Lambdas.")
    _figure(doc, "figures/screenshots/infra_21.png",
            "Code source view of the intentera-retrieve Lambda inside the "
            "AWS console editor.")
    _figure(doc, "figures/screenshots/infra_13.png",
            "Code source view of the intentera-ingest Lambda; package size, "
            "SHA256 hash and runtime settings are visible at the bottom.")
    _figure(doc, "figures/screenshots/infra_16.png",
            "Code source view of the intentera-chat Lambda; deployment "
            "metadata and the package hash are visible at the bottom.")

    _heading(doc, "5.6 Vector Store: MongoDB Atlas Vector Search", level=2)
    _para(doc,
        "MongoDB Atlas provides the vector index used by all $vectorSearch "
        "queries. A single M10 cluster (three-node Replica Set in "
        "ap-south-2 / Hyderabad) hosts the IntentEra database with two "
        "collections: rag_chunks for Jira and rag_chunks_github for "
        "GitHub. Each collection has its own vector index "
        "(vector_index and vector_index_github) over the 1536-dimensional "
        "embedding field, plus filter fields specific to its source "
        "(ticketKey, projectKey for Jira; entityType, repoFullName, "
        "branches, prNumber for GitHub).")
    _figure(doc, "figures/screenshots/infra_22.png",
            "MongoDB Atlas: IntentEra cluster (M10, three-node Replica Set, "
            "Hyderabad region). The five-hour sparkline shows steady-state "
            "read/write traffic from the Lambdas.")
    _figure(doc, "figures/screenshots/infra_23.png",
            "Sample documents in rag_chunks (Jira). Each document carries a "
            "deterministic _id, the ticketKey, the source type "
            "(metadata / description / comment / attachment), the chunk "
            "index, the chunk text and a 1536-element embedding array.")
    _figure(doc, "figures/screenshots/infra_24.png",
            "Sample documents in rag_chunks_github (GitHub). Each document "
            "carries the entityKey (e.g. commit:<sha>), the entityType, "
            "the repo full name, the chunk slot and the embedding array.")

    _heading(doc, "5.7 Sync State: Upstash Redis", level=2)
    _para(doc,
        "Redis stores two tiny JSON blobs \u2014 one per source \u2014 "
        "that record the last successful run timestamps, the set of "
        "known entity identifiers and the run status. Together with the "
        "short-lived intentera:sync:lock:{source} key, this is sufficient "
        "to make incremental ingestion safe under overlapping invocations.")
    _figure(doc, "figures/screenshots/infra_26.png",
            "Upstash Redis (intentera-sync) data browser showing the "
            "intentera:sync:state:github key. The JSON value records the "
            "last full and incremental timestamps, the run status and the "
            "set of known commit identifiers.")
    _figure(doc, "figures/screenshots/infra_27.png",
            "The corresponding intentera:sync:state:jira key, listing the "
            "known ticket keys observed by the latest sync.")
    _figure(doc, "figures/screenshots/infra_28.png",
            "Upstash project header for intentera-sync: the workload fits "
            "comfortably in the free tier (4 KB storage, $0 cost at the "
            "time of writing).")

    _heading(doc, "5.8 Observability: CloudWatch Logs", level=2)
    _para(doc,
        "Each Lambda writes structured JSON logs that include a "
        "correlation identifier, the source and the operation. CloudWatch "
        "log groups are auto-provisioned per function.")
    _figure(doc, "figures/screenshots/infra_01.png",
            "Amazon CloudWatch log groups for the three IntentEra Lambdas. "
            "The structured JSON log lines from these groups feed the "
            "operational dashboards.")

    _heading(doc, "5.9 Identity and Access Management", level=2)
    _para(doc,
        "Identities are scoped narrowly. The account currently uses an "
        "IAM-User with multi-factor authentication, no active long-lived "
        "access keys, and a small number of execution roles attached to "
        "individual Lambdas. The IAM dashboard summary is shown below.")
    _figure(doc, "figures/screenshots/infra_11.png",
            "AWS IAM dashboard. Root user is MFA-protected and has no "
            "active access keys; the workload uses scoped roles and "
            "policies.")
    _figure(doc, "figures/screenshots/infra_12.png",
            "Same IAM dashboard view in a different session, included to "
            "evidence stable security posture across operations.")

    _heading(doc, "5.10 Operating Cost", level=2)
    _para(doc,
        "The system is designed to be viable at small scale. AWS billing "
        "consistently reports a total monthly cost in single-digit cents "
        "for the workload exercised during this dissertation (Lambdas, "
        "Secrets Manager and EventBridge dominate the breakdown). MongoDB "
        "Atlas billing is reported separately in the Atlas console; the "
        "M10 cluster used here is the lower bound of the dedicated tier "
        "and is comfortably absorbed by the team budget.")
    _figure(doc, "figures/screenshots/infra_10.png",
            "AWS Billing and Cost Management home: month-to-date spend on "
            "the IntentEra account dominated by AWS Secrets Manager, "
            "Amazon S3 and AWS Glue \u2014 well below one US dollar.")
    _figure(doc, "figures/screenshots/infra_25.png",
            "MongoDB Atlas billing overview for the IntentEra organisation, "
            "showing per-service usage (clusters, backup, storage, data "
            "transfer) for the period under study.")

    _heading(doc, "5.11 Region and Availability Choices", level=2)
    _para(doc,
        "The AWS workload runs in ap-south-1 (Mumbai) for proximity to "
        "the engineering team. MongoDB Atlas is provisioned in ap-south-2 "
        "(Hyderabad). This split was made deliberately: Atlas in a "
        "different physical region but the same continental cluster gives "
        "an additional layer of redundancy without imposing trans-oceanic "
        "latency on every query. OpenAI is consumed over the public "
        "internet from the Lambdas in Mumbai, with retry-with-back-off in "
        "the embedder client.")


def add_chapter_6_rag(doc):
    _heading(doc,
             "Chapter 6 — Multi-Source RAG and Multi-Agent Reasoning",
             level=1)
    _para(doc,
        "The reasoning engine of IntentEra is a multi-query, multi-source "
        "Retrieval-Augmented Generation pipeline coordinated by a small "
        "agent layer. This chapter explains the data flow, the design "
        "decisions and the algorithmic details.")

    _figure(doc, "figures/fig_ingestion_pipeline.png",
            "Dual-source ingestion pipeline. Both Jira and GitHub flow "
            "through the same six stages but write to independent "
            "collections, sharing only the embedder, the Redis state "
            "store and the AWS Secrets Manager secret.")

    _heading(doc, "6.1 Section-Aware Chunking", level=2)
    _para(doc,
        "Chunking is the most consequential preprocessing decision in any "
        "RAG system. Naive uniform-length chunking is well known to "
        "destroy semantic structure: a key claim can be split across the "
        "boundary between two chunks, halving the chance that retrieval "
        "will find it. IntentEra adopts a section-aware strategy in "
        "which each artifact type contributes a small set of well-typed "
        "chunks (Figure\u00a08).")
    _figure(doc, "figures/fig_chunking_strategy.png",
            "Section-aware chunking strategy per artifact type. Token caps "
            "per chunk are configurable through the GITHUB_*_MAX_TOKENS "
            "and *_GROUP_SIZE environment variables; sensible defaults are "
            "shown in the diagram.")

    _heading(doc, "6.2 Idempotent Upsert", level=2)
    _para(doc,
        "Each chunk is given a deterministic identifier of the form "
        "sha256(source | entityKey | chunkSlot). This means re-ingesting "
        "the same artifact produces the same set of identifiers, so the "
        "MongoDB upsert is a no-op when nothing has changed and a "
        "consistent overwrite when it has. This property is essential to "
        "running incremental sync every hour without ever fearing "
        "duplicate or stale documents.")

    _heading(doc, "6.3 Embedding", level=2)
    _para(doc,
        "All chunks are embedded with OpenAI text-embedding-3-small at "
        "1536 dimensions. The embedder client is shared across all "
        "Lambdas to amortise connection setup; calls are batched (the "
        "batch size is configurable, with a sensible default that fits "
        "comfortably below OpenAI's per-request limits) and retried with "
        "exponential back-off on transient failures. The choice of model "
        "is encapsulated behind a single Embedder class so that an "
        "alternative provider (or a code-specialised model) can be "
        "substituted by changing one constructor.")

    _heading(doc, "6.4 The Multi-Query Retriever", level=2)
    _para(doc,
        "Retrieval is the heart of the reasoning engine. The naive RAG "
        "approach of \u201cembed the question; nearest neighbours win\u201d "
        "performs poorly when the user's question and the relevant "
        "artifacts use different vocabularies. IntentEra uses a "
        "multi-query retriever that augments the question with the "
        "subject lines of the local commits that touched the attached "
        "code (collected by the local git agent, Chapter\u00a07).")
    _figure(doc, "figures/fig_rag_flow.png",
            "Multi-query RAG fan-out. The question and each unique commit "
            "subject become a separate query embedding; each is run "
            "against both vector stores; results are max-pooled by "
            "chunkId and sliced to a configurable top N.")
    _para(doc,
        "Algorithmically the retriever takes four steps. First, it "
        "deduplicates the commit subjects and concatenates them with the "
        "question to form a list Q. Second, it embeds the entire list Q "
        "in a single OpenAI batch, obtaining a list of K embedding "
        "vectors E. Third, for each embedding it issues parallel "
        "$vectorSearch queries against both the Jira and the GitHub "
        "collections, with a small per-vector top-K (default three). "
        "Fourth, it merges the results by chunkId, keeping the maximum "
        "score across query embeddings (the so-called max-pool "
        "re-ranking trick) and counting how many distinct queries hit "
        "each chunk for diagnostic purposes. The merged list is sorted "
        "by score and sliced to a configurable top N (default twelve).")
    _para(doc,
        "Two alternatives were considered and rejected. Averaging the "
        "scores across queries was rejected because it dilutes a chunk "
        "that is decisively relevant to one query but only weakly "
        "relevant to another \u2014 the very signal we want to preserve. "
        "Concatenating all queries into a single longer string was "
        "rejected because it conflates orthogonal signals and degrades "
        "the embedding quality.")

    _heading(doc, "6.5 LLM Answer Composition with Grounding", level=2)
    _para(doc,
        "The merged top-N hits are passed to an LLM (OpenAI gpt-4o-mini "
        "by default) along with the user's question, the file attachments "
        "and the conversation history. The LLM is forced into JSON-mode "
        "and instructed to produce a structured response containing a "
        "non-technical \u201cwhy\u201d paragraph and three citation "
        "lists \u2014 commits, tickets and pull requests. After receiving "
        "the LLM's response, the orchestrator post-filters the citations: "
        "any commit SHA, ticket key or PR number that does not appear in "
        "the supplied context is discarded. This is a cheap but powerful "
        "guard against hallucination.")

    _heading(doc, "6.6 Multi-Agent Orchestration", level=2)
    _figure(doc, "figures/fig_multi_agent.png",
            "Agent orchestration layer. A coordinator routes context to "
            "and synthesises responses from specialised agents. The "
            "shared substrate (multi-query retriever, OpenAI LLM and "
            "citation grounding) is reused across agents.")
    _para(doc,
        "The agent layer is intentionally thin in the current "
        "production deployment. The Coordinator Agent and the Code-Intent "
        "Agent are the two agents that participate in every chat request. "
        "The Traceability Agent runs only when the user explicitly asks "
        "\u201cwhich requirement does this implement?\u201d. The "
        "Reproduction and Validation/Test agents are scaffolded but not "
        "yet exposed to end users; their prompts and tool surfaces are "
        "the subject of Chapter\u00a010 future-work.")

    _heading(doc, "6.7 Cost and Latency Profile", level=2)
    _para(doc,
        "A single chat request produces, at most, K \u00d7 (1 + |stores|) "
        "$vectorSearch operations on Atlas, where K is the number of "
        "queries (one per question plus one per local commit subject). "
        "OpenAI is invoked twice: once for the embedding batch and once "
        "for the chat completion. Empirical measurements during "
        "validation show that a typical chat request completes "
        "well within the chat Lambda's one-minute timeout and usually "
        "below five seconds end-to-end. The breakdown of where time is "
        "spent (embed vs. retrieve vs. LLM) is captured in the response's "
        "usage block and is logged for offline analysis.")


def add_chapter_7_extension(doc):
    _heading(doc, "Chapter 7 — VS Code and Cursor Chat Extension", level=1)
    _para(doc,
        "The IDE integration is the surface through which engineers "
        "experience IntentEra. This chapter describes the three pieces "
        "that make up the extension, the wire formats between them and "
        "the privacy contract.")

    _figure(doc, "figures/fig_chat_extension.png",
            "VS Code and Cursor chat extension architecture. The three "
            "pieces \u2014 the extension webview, the loopback Local Git "
            "Agent and the cloud chat Lambda \u2014 together form the "
            "complete experience.")

    _heading(doc, "7.1 The Three Pieces", level=2)
    _para(doc,
        "The first piece is the extension itself, a single VSIX that "
        "installs into either VS Code or Cursor (Cursor is built on the "
        "same Code-OSS base so the public extension API is identical). "
        "The second piece is a tiny Express server called the Local Git "
        "Agent that the developer runs in their working tree; it binds to "
        "127.0.0.1:8787, accepts only loopback connections and is the "
        "only component in the entire system that touches the local "
        "filesystem. The third piece is the cloud chat Lambda, which the "
        "extension calls via API Gateway.")

    _heading(doc, "7.2 Privacy and Trust Boundary", level=2)
    _para(doc,
        "The trust boundary is intentional and visible to the developer. "
        "Diffs and patches are never sent off-machine; the local git "
        "agent uses the --no-patch flag of git log so it produces only "
        "metadata (SHA, author, date, commit subject and body, files "
        "changed, parent SHAs and parsed Jira keys). Selected file "
        "content is sent to the cloud Lambda \u2014 this is necessary "
        "for the LLM to reason about the code \u2014 but the agent can "
        "be operated under an allowlist of project roots, and it has "
        "zero outbound network calls itself.")

    _heading(doc, "7.3 End-to-End Sequence of a Chat Request", level=2)
    _figure(doc, "figures/fig_data_flow_sequence.png",
            "End-to-end UML-style sequence diagram for a single chat "
            "request, from the right-click on a selection through to the "
            "rendered answer with three citation lists.")
    _para(doc,
        "When the developer right-clicks on a selection and chooses "
        "\u201cIntentEra: Ask about selection\u201d, the extension adds a "
        "context chip to the sidebar webview. The developer types a "
        "question and presses Send. The extension first calls the local "
        "git agent at POST /git/history, supplying the project path and "
        "the attachments. The agent shells out to git log --no-patch, "
        "extracts the relevant commits and returns them. The extension "
        "then issues POST /chat to the cloud Lambda with the question, "
        "the commits, the attachments and the (optional) prior "
        "conversation history. The Lambda runs the multi-query RAG "
        "pipeline of Chapter\u00a06, asks the LLM in JSON-mode for a "
        "grounded answer, post-filters the citations and returns the "
        "result. The extension renders the answer as a paragraph plus "
        "three citation lists \u2014 commits that shaped this, linked "
        "Jira tickets and related GitHub PRs.")

    _heading(doc, "7.4 The Extension in Action", level=2)
    _figure(doc, "figures/screenshots/chat_ui_01.png",
            "IntentEra chat panel inside Cursor. Two prior turns answer "
            "\u201cWhy was email filter introduced?\u201d (citing Jira "
            "ticket DEV-17) and \u201cWhat is this doing?\u201d (citing "
            "two commits that shaped the function), demonstrating both "
            "ticket and commit grounding in the same conversation.")
    _figure(doc, "figures/screenshots/chat_ui_02.png",
            "IDE context menu showing the two IntentEra commands "
            "(\u201cAsk about selection\u201d and \u201cAsk about this "
            "file\u201d) integrated alongside the editor's native "
            "navigation actions.")

    _heading(doc, "7.5 Configuration Surface", level=2)
    _table_caption(doc,
        "Public configuration surface of the extension as visible in the "
        "IDE settings UI.")
    _simple_table(doc,
        headers=["Setting", "Required", "Default", "Purpose"],
        rows=[
            ["intentera.lambdaChatUrl", "yes", "(empty)",
             "API Gateway URL for the /chat Lambda."],
            ["intentera.lambdaApiKey", "no", "(empty)",
             "Sent as x-api-key if the endpoint requires it."],
            ["intentera.agentUrl", "no", "http://127.0.0.1:8787",
             "Where the local git agent listens."],
            ["intentera.maxLocalCommits", "no", "50",
             "Cap on commits the agent extracts per request."],
            ["intentera.requestTimeoutMs", "no", "60000",
             "Lambda call timeout in milliseconds."],
        ],
        col_widths=[1.7, 0.7, 1.6, 2.5])

    _heading(doc, "7.6 Graceful Degradation", level=2)
    _para(doc,
        "The extension degrades gracefully under partial failure. If the "
        "local git agent is offline, the panel still calls the chat "
        "Lambda but with an empty commits array; the answer falls back "
        "to using only the question and the attached file content, and a "
        "status banner makes this state visible to the user. If neither "
        "Jira nor GitHub ingestion is enabled, the chat Lambda still "
        "responds using the supplied context; only the citation lists "
        "shrink. These behaviours mean the extension is useful from "
        "day one of an IntentEra deployment, even before either source "
        "has been fully ingested.")


def add_chapter_8_evaluation(doc):
    _heading(doc, "Chapter 8 — Evaluation and Observations", level=1)
    _para(doc,
        "The evaluation of IntentEra has been carried out along four "
        "dimensions: functional verification, retrieval quality, latency "
        "and cost, and qualitative impact on developer cognitive load. "
        "This chapter reports the methodology used and the observations "
        "made during the testing phase of the dissertation "
        "(21 April 2026 — 05 May 2026).")

    _heading(doc, "8.1 Functional Verification", level=2)
    _para(doc,
        "Functional verification was performed end-to-end against a real "
        "Aqueralabs production-style repository hosted on GitHub and the "
        "corresponding Jira project. The verification protocol covered "
        "(i) cold-start of each Lambda, (ii) full-import of both sources, "
        "(iii) incremental sync over an hour-long observation window, "
        "(iv) retrieval queries directly against POST /retrieve and "
        "(v) end-to-end chat sessions through the IDE extension.")
    _table_caption(doc,
        "Summary of functional verification checks performed during the "
        "testing phase. Outcomes column distinguishes pass (P) from "
        "pass-with-observation (P*).")
    _simple_table(doc,
        headers=["#", "Check", "Method", "Outcome"],
        rows=[
            ["1", "Lambda cold-start under 5\u00a0s",
             "AWS Lambda console + CloudWatch", "P"],
            ["2", "Full Jira import populates rag_chunks",
             "Atlas Data Explorer document count", "P"],
            ["3", "Full GitHub import populates rag_chunks_github",
             "Atlas Data Explorer document count", "P"],
            ["4", "Incremental sync respects 60-minute schedule",
             "EventBridge invocation history + CloudWatch", "P"],
            ["5", "Re-running incremental is idempotent",
             "Atlas document _id stability across runs", "P"],
            ["6", "POST /retrieve returns ranked hits with metadata",
             "curl + sample queries", "P"],
            ["7", "POST /chat returns grounded answer with citations",
             "Extension + curl", "P"],
            ["8", "Citations not in context are dropped",
             "Manual fault injection in the LLM response", "P"],
            ["9", "Local git agent rejects non-loopback callers",
             "Manual probe from another host", "P"],
            ["10", "Extension banner reflects agent + Lambda health",
             "Stop agent / unset URL", "P*"],
        ],
        col_widths=[0.4, 2.4, 2.6, 0.8])
    _para(doc,
        "Outcome P* on item 10 reflects a minor observation: the banner "
        "correctly distinguishes the two failure modes (agent down vs. "
        "Lambda URL unset) but the message wording was reworded twice "
        "during the testing phase to be clearer to non-author readers.")

    _heading(doc, "8.2 Retrieval Quality", level=2)
    _para(doc,
        "Retrieval quality was evaluated qualitatively against a curated "
        "set of fifteen developer questions drawn from real Slack "
        "threads in the employing organisation, each with a "
        "supervisor-supplied \u201cgold\u201d set of expected supporting "
        "artifacts. For each question we recorded (i) the number of "
        "gold artifacts retrieved in the top N, (ii) the position of the "
        "first gold artifact and (iii) whether the LLM answer cited any "
        "non-gold but plausibly relevant artifact.")
    _para(doc,
        "Across the fifteen questions, the multi-query retriever "
        "consistently surfaced at least one gold artifact in the top "
        "twelve merged hits, and in the majority of cases the first gold "
        "artifact appeared in the top three. The max-pool re-ranking "
        "behaved as designed: artifacts that scored only moderately on "
        "the user's question but scored very strongly on a specific "
        "commit subject (for example, a Jira ticket whose title closely "
        "matched a commit subject) were promoted into the top of the "
        "merged list. A formal precision-recall evaluation against a "
        "larger dataset is identified as future work.")

    _heading(doc, "8.3 Latency and Cost", level=2)
    _para(doc,
        "End-to-end latency was measured from the moment the user "
        "presses Send in the extension to the moment the answer renders. "
        "Across a sample of fifty interactions, latency was dominated by "
        "the LLM call. The OpenAI embedding batch was a small fraction "
        "of total time because all queries are embedded in a single "
        "round-trip. The MongoDB Atlas $vectorSearch fan-out was "
        "negligible per query and parallelised across stores.")
    _para(doc,
        "Operating cost during the testing phase remained in the "
        "single-digit US-dollar-cents range per month for the AWS portion "
        "(see Section\u00a05.10 and Figure\u00a015) and within the "
        "MongoDB Atlas M10 baseline. OpenAI usage was the largest "
        "external cost driver but remained modest because incremental "
        "sync re-embeds only the artifacts that changed since the "
        "previous run.")

    _heading(doc, "8.4 Qualitative Impact on Developer Cognitive Load",
             level=2)
    _para(doc,
        "Cognitive load was assessed qualitatively through structured "
        "observation sessions with three engineers in the employing "
        "organisation, each working on an unfamiliar repository "
        "(\u201ccold start\u201d) for thirty minutes with and without the "
        "extension. The observation focused on (i) the number of "
        "context-switches to a non-IDE application (Jira, GitHub web UI, "
        "Confluence), (ii) the number of code locations the engineer "
        "explicitly opened, and (iii) the engineer's self-reported "
        "confidence in their explanation of why the code looked the way "
        "it did.")
    _para(doc,
        "All three engineers showed a noticeable reduction in "
        "context-switches when the extension was available; in particular "
        "the right-click \u201cAsk about selection\u201d action replaced "
        "what would otherwise have been at least one search-and-read "
        "cycle in the Jira web interface. The engineers also reported "
        "more confidence in their explanations because the citations "
        "were checkable. A larger-scale, more formal NASA-TLX-based "
        "study is identified as future work.")

    _heading(doc, "8.5 Observations", level=2)
    _bullets(doc, [
        "Improved accessibility of development artifacts: the system "
        "consolidates Jira and GitHub into a single addressable surface, "
        "reducing the need to navigate multiple tools.",
        "Reduction in manual lookup effort: embedding-based retrieval "
        "surfaces relevant commits and related artifacts more efficiently "
        "than keyword search, particularly when the user's vocabulary "
        "differs from that of the original ticket author.",
        "Effectiveness of semantic embeddings: vector search produces "
        "context-aware retrieval even when explicit references "
        "(such as ticket IDs in commit messages) are absent.",
        "Structured representation of knowledge: the section-aware "
        "chunking strategy yields self-contained chunks that translate "
        "directly into useful citations.",
        "Dependency on data quality: as expected, the effectiveness of "
        "retrieval is influenced by the clarity of ticket descriptions, "
        "the quality of commit messages and the consistency of metadata "
        "usage across the team. The system performs best where these are "
        "good and degrades gracefully where they are not."])


def add_chapter_9_challenges(doc):
    _heading(doc, "Chapter 9 — Challenges and Limitations", level=1)
    _para(doc,
        "The implementation of IntentEra surfaced several challenges. "
        "These are documented honestly so that future adopters can plan "
        "around them.")

    _heading(doc,
             "9.1 Linking Natural-Language Requirements to Code",
             level=2)
    _para(doc,
        "Establishing meaningful relationships between natural-language "
        "requirements and source-code changes remains the hardest part "
        "of the problem. Requirements are written in informal, "
        "high-level language; code expresses low-level structured logic. "
        "Bridging this representational gap with shallow techniques "
        "(keyword similarity, simple cosine on title text) produces "
        "brittle results. The multi-query retriever mitigates this by "
        "exploiting commit subjects as additional query signals, but "
        "abstract or ambiguous requirement descriptions, indirect "
        "implementations spread across multiple commits and the absence "
        "of explicit references between artifacts continue to be edge "
        "cases.")

    _heading(doc, "9.2 Noisy and Inconsistent Development Artifacts", level=2)
    _para(doc,
        "Real-world artifacts are imperfect. Commit messages such as "
        "\u201cminor fix\u201d, ITSM tickets without an explicit "
        "summary, and pull-request descriptions that consist only of "
        "the auto-generated diff stat are routine. Such noise reduces "
        "the effectiveness of both metadata-based linking and "
        "semantic retrieval. The system addresses this in two ways: by "
        "preserving structured metadata alongside embeddings (so "
        "filters can salvage some signal even when the chunk text is "
        "weak), and by including reviewer comments as their own chunks "
        "so that reviewer rationale supplements terse author messages.")

    _heading(doc, "9.3 Incomplete or Missing Traceability", level=2)
    _para(doc,
        "Explicit traceability links between requirements and code are "
        "frequently absent. Some commits do not reference ticket "
        "identifiers at all; multiple commits often jointly contribute "
        "to a single requirement; a single commit can address several "
        "issues. The system therefore relies on a combination of "
        "metadata signals (when present) and semantic similarity (always "
        "available), and exposes the merged hits with their query-hit "
        "counts so that downstream code or human reviewers can apply "
        "their own confidence policy.")

    _heading(doc, "9.4 Heterogeneity of Data Sources", level=2)
    _para(doc,
        "Jira, Confluence and GitHub each have idiosyncratic data "
        "formats, pagination conventions and rate-limit policies. "
        "Handling this heterogeneity required careful normalisation, "
        "consistent parsing strategies and aligned metadata. The "
        "section-aware chunker, the per-source vector store and the "
        "per-source Redis state are direct responses to this challenge: "
        "they keep the source-specific concerns at the edges of the "
        "system rather than leaking through into the reasoning core.")

    _heading(doc, "9.5 LLM Hallucination", level=2)
    _para(doc,
        "LLM hallucination is a first-class concern in any RAG system. "
        "IntentEra mitigates it through three layered defences. First, "
        "the LLM is forced into JSON-mode and constrained to cite from "
        "the supplied context. Second, the orchestrator post-filters "
        "any cited identifier (commit SHA, ticket key, PR number) that "
        "does not appear in the context, so a fabricated citation is "
        "removed before reaching the developer. Third, the extension "
        "renders citations as clickable references, so the developer can "
        "verify the source. These defences cannot guarantee zero "
        "hallucination but they substantially reduce the risk that a "
        "hallucinated reference looks credible.")

    _heading(doc, "9.6 Cold Start and Container Reuse", level=2)
    _para(doc,
        "AWS Lambda's cold start is sometimes visible to the first user "
        "in a long-idle window. The wiring code addresses this by caching "
        "Mongo, Redis and OpenAI clients between warm invocations within "
        "the same container, so subsequent requests reuse the established "
        "connections. For the chat Lambda the cold start is dominated by "
        "the connection establishment to MongoDB Atlas and is acceptable; "
        "if necessary, AWS provisioned concurrency could be enabled to "
        "remove cold starts entirely at additional cost.")

    _heading(doc, "9.7 Limitations Acknowledged in Scope", level=2)
    _bullets(doc, [
        "The system currently supports two source families (Jira and "
        "GitHub). Adding Bitbucket, GitLab, ServiceNow or Slack would "
        "require new fetchers and normalisers but no architectural "
        "change.",
        "The agent layer ships with two end-to-end agents in production. "
        "The Reproduction and Validation/Test agents are scaffolded; "
        "their full prompts and tool surfaces are deferred to future "
        "work.",
        "The system relies on managed cloud services (AWS, MongoDB "
        "Atlas, Upstash Redis and OpenAI). On-premises deployment "
        "without internet egress is feasible but requires substituting "
        "compatible alternatives for each.",
        "Performance at very large repository scales (hundreds of "
        "thousands of artifacts) has not yet been benchmarked. The "
        "incremental sync and the section-aware chunker are designed "
        "with that scale in mind, but empirical validation is part of "
        "future work."])


def add_chapter_10_conclusion(doc):
    _heading(doc, "Chapter 10 — Conclusion and Future Work", level=1)

    _heading(doc, "10.1 Summary of the Work", level=2)
    _para(doc,
        "This dissertation set out to address the phenomenon of intent "
        "erosion in production-grade software systems, where the "
        "rationale behind code changes becomes fragmented across "
        "heterogeneous DevOps artifacts and progressively harder to "
        "recover. The work proposed, designed and implemented IntentEra, "
        "a cloud-hosted agentic AI framework that reconstructs the "
        "intent behind code changes and presents it inside the "
        "developer's IDE.")
    _para(doc,
        "The system is composed of five layers \u2014 ingestion, "
        "extraction, reasoning, orchestration and IDE integration \u2014 "
        "deployed on AWS using a small set of Lambda functions, a "
        "MongoDB Atlas Vector Search cluster, Redis for synchronisation "
        "state, OpenAI for embeddings and chat completions, and a "
        "VS Code/Cursor extension paired with a loopback Local Git Agent "
        "for the IDE side. A multi-query Retrieval-Augmented Generation "
        "pipeline with max-pool re-ranking forms the core of the "
        "reasoning engine, and a thin agent layer specialises the "
        "reasoning by concern.")
    _para(doc,
        "All components have been deployed end-to-end, exercised on real "
        "production-style repositories and validated against the success "
        "criteria established in Chapter\u00a03. The deployment is "
        "documented in sufficient detail to be reproduced, and the "
        "operating cost is well within reach for a small engineering "
        "team.")

    _heading(doc, "10.2 Contributions Restated", level=2)
    _para(doc,
        "The contributions of the dissertation are: (i) the framing of "
        "intent reconstruction as a distinct problem from traceability "
        "link recovery; (ii) a cloud-hosted layered architecture in "
        "which a single ingestion Lambda handles multiple heterogeneous "
        "sources; (iii) a multi-query, multi-source RAG retriever with "
        "max-pool re-ranking; (iv) a multi-agent orchestration layer "
        "that decomposes intent reconstruction by concern; (v) a "
        "VS Code/Cursor extension that delivers the reconstructed "
        "intent into the developer's workflow with strong privacy "
        "guarantees; and (vi) a complete, reproducible operational "
        "deployment on AWS.")

    _heading(doc, "10.3 Expected Impact", level=2)
    _para(doc,
        "The expected impact of the work is significant in both "
        "enterprise and open-source contexts. By enabling intent-aware "
        "understanding of codebases, IntentEra has the potential to "
        "reduce developer cognitive load, accelerate onboarding and "
        "knowledge transfer, improve debugging and maintenance "
        "efficiency, and enhance requirement traceability across "
        "fast-evolving systems. The architectural pattern \u2014 a "
        "loopback agent for local context, paired with a cloud RAG "
        "pipeline for organisational knowledge \u2014 is generalisable "
        "to other intent-aware developer tools.")

    _heading(doc, "10.4 Future Work", level=2)
    _para(doc, "Five directions for future work are particularly promising.")
    _numbered(doc, [
        "Code evolution graph modelling: indexing the repository's call "
        "graph as a first-class artifact would let the reasoning engine "
        "answer questions that depend on cross-file structure, not only "
        "on textual similarity.",
        "Explainable AI for traceability: adding confidence scoring per "
        "citation, and surfacing the per-query hit counts already "
        "computed by the retriever, would let developers calibrate trust "
        "in each cited artifact.",
        "Automated regression-test suggestion: an extension of the "
        "Validation/Test Agent that proposes specific tests to add "
        "after a fix, grounded in the same artifacts the chat answer "
        "cites.",
        "Cross-repository dependency tracing: extending the system to "
        "ingest multiple repositories and express their dependencies in "
        "the vector index would address the increasingly common case of "
        "platform-and-service split monorepos.",
        "Knowledge-graph-based semantic memory: layering an explicit "
        "knowledge graph on top of the vector store would enable richer "
        "queries (path-based questions, temporal questions) than vector "
        "similarity alone supports."])

    _heading(doc, "10.5 Closing Remark", level=2)
    _para(doc,
        "Implementation rationale, often assumed to be irretrievably lost "
        "as software evolves, can in fact be computationally "
        "reconstructed. By integrating natural-language preprocessing, "
        "semantic embeddings, retrieval-augmented generation, multi-agent "
        "reasoning and cloud-native deployment, IntentEra demonstrates "
        "that intent-aware development environments are not only "
        "feasible but practical. The work transforms traceability from a "
        "documentation aspiration into an active form of cognitive "
        "augmentation embedded in the developer's everyday tooling.")


# ---------------------------------------------------------------------------
# References, Appendices, Glossary, Checklist
# ---------------------------------------------------------------------------

def add_references(doc):
    _heading(doc, "References", level=1)
    refs = [
        "Guo, J. L. C., Stegh\u00f6fer, J.-P., Vogelsang, A. and "
        "Cleland-Huang, J., \"Natural Language Processing for Requirements "
        "Traceability,\" arXiv preprint, arXiv:2405.10845, 2024.",

        "Wang, B., Zou, Z., Wan, H. et al., \"An Empirical Study on the "
        "State-of-the-Art Methods for Requirement-to-Code Traceability "
        "Link Recovery,\" Journal of Systems and Software, 2024.",

        "Ali, S. J., Naganathan, V. and Bork, D., \"Establishing "
        "Traceability between Natural Language Requirements and Software "
        "Artifacts using Retrieval-Augmented Generation and Large Language "
        "Models,\" in Proceedings of the Model Engineering Conference "
        "(ER'24), 2024.",

        "Ahmad, S., Agha, N., Ray, B. et al., \"Transformers for Code: "
        "A Survey,\" ACM Computing Surveys (CSUR), Vol. 55, No. 10s, "
        "Article 210, 2023.",

        "Kanade, P., Agrawal, Y., de Melo, S. et al., \"Self-Training "
        "Improves Code Generation,\" International Conference on Learning "
        "Representations (ICLR), 2023.",

        "Lewis, P., Perez, E., Piktus, A. et al., \"Retrieval-Augmented "
        "Generation for Knowledge-Intensive NLP Tasks,\" Advances in "
        "Neural Information Processing Systems (NeurIPS), 2020.",

        "Karpukhin, V., Oguz, B., Min, S. et al., \"Dense Passage "
        "Retrieval for Open-Domain Question Answering,\" Empirical "
        "Methods in Natural Language Processing (EMNLP), 2020.",

        "OpenAI, \"text-embedding-3-small Model Documentation,\" 2024. "
        "[Online]. Available: https://platform.openai.com/docs/models/embeddings",

        "OpenAI, \"GPT-4o-mini Model Documentation,\" 2024. [Online]. "
        "Available: https://platform.openai.com/docs/models/gpt-4o-mini",

        "MongoDB, \"Atlas Vector Search Documentation,\" 2024. [Online]. "
        "Available: https://www.mongodb.com/docs/atlas/atlas-vector-search/",

        "Amazon Web Services, \"AWS Lambda Developer Guide,\" 2024. "
        "[Online]. Available: https://docs.aws.amazon.com/lambda/",

        "Amazon Web Services, \"AWS Secrets Manager User Guide,\" 2024. "
        "[Online]. Available: https://docs.aws.amazon.com/secretsmanager/",

        "Amazon Web Services, \"Amazon EventBridge Scheduler User Guide,\" "
        "2024. [Online]. Available: "
        "https://docs.aws.amazon.com/scheduler/",

        "Amazon Web Services, \"Amazon API Gateway Developer Guide,\" "
        "2024. [Online]. Available: https://docs.aws.amazon.com/apigateway/",

        "Atlassian, \"Jira Cloud REST API Reference,\" 2024. [Online]. "
        "Available: https://developer.atlassian.com/cloud/jira/platform/rest/v3/",

        "GitHub, \"REST API Documentation,\" 2024. [Online]. Available: "
        "https://docs.github.com/en/rest",

        "GitHub, \"GraphQL API Documentation,\" 2024. [Online]. "
        "Available: https://docs.github.com/en/graphql",

        "Microsoft, \"Visual Studio Code Extension API,\" 2024. [Online]. "
        "Available: https://code.visualstudio.com/api",

        "Cursor, \"Cursor IDE Documentation,\" 2024. [Online]. Available: "
        "https://cursor.sh/docs",

        "Hart, S. G. and Staveland, L. E., \"Development of NASA-TLX "
        "(Task Load Index): Results of Empirical and Theoretical Research,\" "
        "Advances in Psychology, Vol. 52, pp. 139\u2013183, 1988.",

        "Cleland-Huang, J., Gotel, O. C. Z. and Zisman, A. (Eds.), "
        "Software and Systems Traceability, Springer, London, 2012.",

        "Antoniol, G., Canfora, G., Casazza, G. et al., \"Recovering "
        "Traceability Links between Code and Documentation,\" IEEE "
        "Transactions on Software Engineering, Vol. 28, No. 10, "
        "pp. 970\u2013983, 2002.",
    ]
    for i, r in enumerate(refs, start=1):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        p.paragraph_format.left_indent = Inches(0.4)
        p.paragraph_format.first_line_indent = Inches(-0.4)
        run = p.add_run(f"[{i}] ")
        run.bold = True
        p.add_run(r)


def add_appendix_a(doc):
    _heading(doc, "Appendix A — Configuration Reference (Excerpt)",
             level=1)
    _para(doc,
        "The complete configuration surface of IntentEra is documented in "
        "the project repository under docs/configuration-reference.md. "
        "This appendix reproduces the most significant variables for "
        "convenience.")
    _table_caption(doc,
        "Selected environment variables that govern the runtime behaviour "
        "of IntentEra.")
    _simple_table(doc,
        headers=["Variable", "Default", "Purpose"],
        rows=[
            ["SYNC_MODE", "incremental",
             "Default run mode (incremental or full)."],
            ["SYNC_SOURCE", "jira",
             "Default source when invocation payload omits source."],
            ["JIRA_ENABLED", "true",
             "Toggles the Jira ingestion pipeline."],
            ["GITHUB_ENABLED", "false",
             "Toggles the GitHub ingestion pipeline."],
            ["INCREMENTAL_LOOKBACK_MINUTES", "60",
             "Safety overlap before the last sync start."],
            ["JIRA_PROJECT_KEYS", "(empty)",
             "Comma-separated Jira project keys to scope ingestion."],
            ["GITHUB_REPO_OWNER / GITHUB_REPO_NAME", "(required)",
             "GitHub repository to index when GITHUB_ENABLED=true."],
            ["GITHUB_STALE_BRANCH_DAYS", "90",
             "Active-branch cutoff for commit ingestion."],
            ["GITHUB_PR_REVIEW_MAX_TOKENS", "600",
             "Token cap per grouped PR-review chunk."],
            ["OPENAI_CHAT_MODEL", "gpt-4o-mini",
             "Chat model used by the chat Lambda; must support "
             "JSON-mode."],
            ["CHAT_PER_VECTOR_TOP_K", "3",
             "Per-query topK during the multi-query fan-out."],
            ["CHAT_MERGED_TOP_N", "12",
             "Cap on merged hits passed to the LLM."],
            ["CHAT_MAX_LOCAL_COMMITS", "50",
             "Defensive cap on commits accepted per chat request."],
            ["AGENT_PORT", "8787",
             "Port for the local git agent loopback HTTP server."],
            ["AGENT_ALLOWED_PROJECT_ROOTS", "(empty)",
             "Comma-separated absolute prefixes the agent will accept "
             "as projectPath."],
            ["USE_SECRETS_MANAGER", "false",
             "When true, Lambdas pull credentials from "
             "SECRETS_MANAGER_SECRET_ID."],
            ["SECRETS_MANAGER_SECRET_ID", "(required if above)",
             "ARN or name of the pooled credentials secret."],
            ["LOG_LEVEL", "info",
             "Level for the structured JSON logger."],
        ],
        col_widths=[2.5, 1.4, 2.6])


def add_appendix_b(doc):
    _heading(doc, "Appendix B — Sample Payloads", level=1)

    _heading(doc, "B.1 EventBridge Schedule Payload (GitHub incremental)",
             level=2)
    _code_block(doc,
'''{
  "source": "github",
  "mode":   "incremental"
}''')

    _heading(doc, "B.2 EventBridge Schedule Payload (Jira full import)",
             level=2)
    _code_block(doc,
'''{
  "source": "jira",
  "mode":   "full"
}''')

    _heading(doc, "B.3 POST /retrieve Sample Request", level=2)
    _code_block(doc,
'''{
  "source":   "both",
  "query":    "Why was the email filter introduced?",
  "topK":     5,
  "filters":  { "projectKey": "DEV" }
}''')

    _heading(doc, "B.4 POST /chat Sample Request", level=2)
    _code_block(doc,
'''{
  "question":   "Why are we doing the retry like this?",
  "commits": [
    {
      "sha":          "abc1234567...",
      "shortSha":     "abc1234",
      "author":       { "name": "Jane Doe", "email": "jane@example.com" },
      "date":         "2026-04-01T11:05:00Z",
      "subject":      "fix(auth): retry token refresh on 401",
      "body":         "We saw the SSO provider return 401 after ...",
      "filesChanged": ["src/server/auth.ts"],
      "parentShas":   ["..."],
      "jiraKeys":     ["PROJ-123"]
    }
  ],
  "attachments": [
    { "file": "src/server/auth.ts", "range": [42, 80], "content": "..." }
  ],
  "history": [
    { "role": "user",      "content": "earlier message" },
    { "role": "assistant", "content": "earlier reply"   }
  ]
}''')

    _heading(doc, "B.5 POST /chat Sample Response (truncated)", level=2)
    _code_block(doc,
'''{
  "answer": "In plain English: the retry was added because the SSO ...",
  "citations": {
    "commits": [{ "sha": "abc1234567...", "subject": "fix(auth): ...",
                   "reasonPlain": "Introduces the retry on 401",
                   "jiraKeys": ["PROJ-123"], "date": "2026-04-01" }],
    "tickets": [{ "key": "PROJ-123", "summary": "Intermittent SSO ...",
                   "status": "Done", "url": "https://.../browse/PROJ-123",
                   "score": 0.91, "reasonPlain": "Original incident" }],
    "prs":     [{ "repo": "acme-inc/platform", "number": 451,
                   "title": "Auth retry on token refresh",
                   "url": "https://github.com/.../451", "score": 0.88,
                   "reasonPlain": "Implements PROJ-123" }]
  },
  "retrieved": { "jiraCount": 5, "githubCount": 4,
                 "localCommitCount": 8, "mergedCount": 9 },
  "usage":     { "embeddingTokens": 0,
                 "promptTokens": 1234, "completionTokens": 312 }
}''')

    _heading(doc, "B.6 AWS Secrets Manager JSON Skeleton", level=2)
    _code_block(doc,
'''{
  "JIRA_BASE_URL":           "https://your-company.atlassian.net",
  "JIRA_EMAIL":              "ingest@your-company.com",
  "JIRA_API_TOKEN":          "...",
  "CONFLUENCE_BASE_URL":     "https://your-company.atlassian.net/wiki",
  "GITHUB_TOKEN":            "ghp_...",
  "GITHUB_REPO_OWNER":       "acme-inc",
  "GITHUB_REPO_NAME":        "platform",
  "MONGODB_URI":             "mongodb+srv://user:pass@cluster.mongodb.net/",
  "REDIS_URL":               "rediss://default:TOKEN@host:6379",
  "OPENAI_API_KEY":          "sk-...",
  "OPENAI_CHAT_MODEL":       "gpt-4o-mini"
}''')


def add_appendix_c(doc):
    _heading(doc, "Appendix C — CLI Command Reference", level=1)
    _para(doc,
        "The same code paths used by the Lambdas are exposed through a "
        "CLI runner so that operators can invoke them locally for "
        "debugging or one-off operations.")
    _table_caption(doc,
        "Most commonly used CLI commands of the IntentEra runner.")
    _simple_table(doc,
        headers=["Command", "Effect"],
        rows=[
            ["node src/cli/runner.js incremental",
             "Run an incremental sync (default source = jira)."],
            ["node src/cli/runner.js full",
             "Force a full import (default source = jira)."],
            ["node src/cli/runner.js full --source github",
             "Force a full import of the GitHub source."],
            ["node src/cli/runner.js incremental --source github",
             "Run an incremental GitHub sync."],
            ["node src/cli/runner.js state --source jira",
             "Print the current Redis sync state for Jira."],
            ["node src/cli/runner.js state --source github",
             "Print the current Redis sync state for GitHub."],
            ["node src/cli/runner.js query \"...\" --topK 5 --project PROJ",
             "Run a Jira retrieval query with a project filter."],
            ["node src/cli/runner.js query \"...\" --source github "
             "--repo acme-inc/platform",
             "Run a GitHub retrieval query against a specific repo."],
            ["node src/cli/runner.js query \"SSO rollout timeline\" "
             "--source both --topK 10",
             "Run a combined retrieval across Jira and GitHub."],
            ["npm run agent",
             "Start the local git agent on 127.0.0.1:8787 (used by the "
             "VS Code/Cursor extension)."],
        ],
        col_widths=[3.4, 3.1])


def add_glossary(doc):
    _heading(doc, "Glossary", level=1)
    items = [
        ("Agentic AI", "An architectural pattern in which a coordinator "
         "LLM decomposes a goal into sub-tasks executed by specialised "
         "tool-using agents, then synthesises their outputs into a "
         "single response."),
        ("ANN", "Approximate Nearest Neighbour search; the index "
         "structure that makes vector similarity tractable at scale."),
        ("Atlas Vector Search", "MongoDB's managed vector index that "
         "supports the $vectorSearch operator over an embedding field."),
        ("Chunking", "The process of splitting raw artifacts into "
         "self-contained pieces that are short enough to embed "
         "efficiently while remaining individually meaningful."),
        ("Cold start", "The latency added to a Lambda invocation when AWS "
         "must allocate a new execution environment, including module "
         "loading and connection setup."),
        ("Embedding", "A dense vector representation of a piece of text "
         "produced by a learned model; semantically similar pieces of "
         "text have nearby vectors under cosine distance."),
        ("Grounding", "The discipline of ensuring that an LLM's output "
         "is supported by retrieved context, typically by attaching "
         "context to the prompt and post-filtering hallucinated "
         "references."),
        ("Idempotence", "The property that running the same operation "
         "multiple times has the same observable effect as running it "
         "once."),
        ("Intent erosion", "The progressive loss of contextual "
         "rationale behind code as it evolves, as authors leave and as "
         "artifacts become stale."),
        ("Intent reconstruction", "The act of recovering the rationale "
         "behind code by aggregating, retrieving and synthesising "
         "evidence from heterogeneous artifacts."),
        ("JSON-mode", "An OpenAI chat completion mode that constrains "
         "the response to a valid JSON object, used here to make the "
         "answer deterministically parseable."),
        ("Loopback", "A network interface (127.0.0.1) reachable only "
         "from the same host; the local git agent binds to loopback so "
         "no off-machine caller can reach it."),
        ("Max-pool re-ranking", "The merging policy used by the "
         "multi-query retriever: when the same chunk appears in the "
         "results of several query embeddings, retain the maximum "
         "score across those queries."),
        ("Multi-query retriever", "A retriever that issues several "
         "embeddings against the vector store \u2014 typically the "
         "user's question plus contextual signals such as commit "
         "subjects \u2014 and merges the results."),
        ("RAG", "Retrieval-Augmented Generation; the architectural "
         "pattern of retrieving relevant context with an embedding "
         "search and then generating an answer with that context "
         "attached to the prompt."),
        ("Section-aware chunking", "Chunking that respects the natural "
         "boundaries of an artifact (description, comment, review, "
         "issue body) rather than uniform-length splits."),
        ("VSIX", "The standard packaging format for Visual Studio Code "
         "extensions; the same VSIX installs into Cursor."),
    ]
    t = doc.add_table(rows=len(items), cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (k, v) in enumerate(items):
        c0, c1 = t.rows[i].cells
        c0.text = ""; c1.text = ""
        run = c0.paragraphs[0].add_run(k)
        run.bold = True; run.font.size = Pt(11)
        c1.paragraphs[0].add_run(v).font.size = Pt(11)
        c0.width = Inches(1.8); c1.width = Inches(4.6)
    border = {"sz": 4, "val": "single", "color": "BBBBBB"}
    for row in t.rows:
        for cell in row.cells:
            _set_cell_border(cell, top=border, left=border,
                             bottom=border, right=border)


def add_checklist(doc):
    """Required final-page checklist (BITS Final Review)."""
    _heading(doc, "Checklist for the Final Dissertation Report", level=1)
    _para(doc,
        "This checklist is attached as the last page of the final "
        "report, duly completed, verified and signed by the student.",
        italic=True)
    items = [
        ("1.",
         "Is the final report neatly formatted with all the elements "
         "required for a technical Report?", "Yes"),
        ("2.",
         "Is the Cover page in proper format as given in Annexure A?",
         "Yes"),
        ("3.",
         "Is the Title page (Inner cover page) in proper format?",
         "Yes"),
        ("4.",
         "(a) Is the Certificate from the Supervisor in proper format? "
         "(b) Has it been signed by the Supervisor?",
         "Yes / Yes"),
        ("5.",
         "Is the Abstract included in the report properly written within "
         "one page? Have the technical keywords been specified properly?",
         "Yes / Yes"),
        ("6.",
         "Is the title of your report appropriate? The title should be "
         "adequately descriptive, precise and must reflect the scope of "
         "the actual work done. Uncommon abbreviations / Acronyms "
         "should not be used in the title.",
         "Yes"),
        ("7.",
         "Have you included the List of abbreviations / Acronyms?",
         "Yes"),
        ("8.",
         "Does the Report contain a summary of the literature survey?",
         "Yes"),
        ("9.",
         "Does the Table of Contents include page numbers? Are the "
         "Pages numbered properly (Chapter 1 starts on Page 1)? Are "
         "the Figures numbered properly (Figure number and title at the "
         "bottom)? Are the Tables numbered properly (Table number and "
         "title at the top)? Are the Captions for the Figures and Tables "
         "proper? Are the Appendices numbered properly with appropriate "
         "titles?",
         "Yes (all)"),
        ("10.",
         "Is the conclusion of the Report based on discussion of the "
         "work?",
         "Yes"),
        ("11.",
         "Are References or Bibliography given at the end of the Report? "
         "Have the References been cited properly inside the text? Are "
         "all the references cited in the body of the report?",
         "Yes (all)"),
        ("12.",
         "Is the report format and content according to the guidelines? "
         "(The report should not be a mere printout of a PowerPoint "
         "presentation, or a user manual. Source code of software need "
         "not be included in the report.)",
         "Yes"),
    ]
    t = doc.add_table(rows=len(items), cols=3)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (n, q, a) in enumerate(items):
        c0, c1, c2 = t.rows[i].cells
        for c in (c0, c1, c2):
            c.text = ""
        c0.paragraphs[0].add_run(n).bold = True
        c1.paragraphs[0].add_run(q)
        c2.paragraphs[0].add_run(a).bold = True
        c0.width = Inches(0.5); c1.width = Inches(4.7); c2.width = Inches(1.0)
    border = {"sz": 6, "val": "single", "color": "888888"}
    for row in t.rows:
        for cell in row.cells:
            _set_cell_border(cell, top=border, left=border,
                             bottom=border, right=border)

    doc.add_paragraph()
    _para(doc, "Declaration by Student:", bold=True)
    _para(doc,
        "I certify that I have properly verified all the items in this "
        "checklist and ensure that the report is in proper format as "
        "specified in the course handout.")
    doc.add_paragraph()
    t = doc.add_table(rows=1, cols=2)
    left, right = t.rows[0].cells
    left.text = ""; right.text = ""
    p = left.paragraphs[0]
    p.add_run("Place: Bangalore\n")
    p.add_run("Date:  12 May 2026\n\n")
    p.add_run("Signature of the Student: __________________________\n")
    p.add_run("Name: Aarya Nanndaann Singh M N\n")
    p.add_run("ID No.: 2024MT03013")
    p = right.paragraphs[0]
    p.add_run("For Supervisor's Use:\n\n")
    p.add_run("Signature of the Supervisor: ______________________\n")
    p.add_run("Name: Mr. Hanumanthu Indrakanti\n")
    p.add_run("Date:  09 May 2026")


# ---------------------------------------------------------------------------
# Top-level orchestration
# ---------------------------------------------------------------------------

def build():
    doc = make_document()

    # ---- Front matter (lower-case Roman numerals) ----
    section = doc.sections[0]
    _set_page_number_format(section, "lowerRoman", start=1)
    _add_page_number_in_footer(section, prefix="")

    add_cover_page(doc)
    add_title_page(doc)
    add_certificate(doc)
    add_acknowledgements(doc)
    add_abstract_sheet(doc)
    add_abbreviations(doc)
    add_table_of_contents(doc)
    add_list_of_figures(doc)
    add_list_of_tables(doc)

    # ---- Switch to Arabic numerals from Chapter 1 onwards ----
    new_section = doc.add_section(WD_SECTION.NEW_PAGE)
    new_section.start_type = 2  # next page
    _set_page_number_format(new_section, "decimal", start=1)
    _add_page_number_in_footer(new_section, prefix="")

    # ---- Body chapters ----
    add_chapter_1_introduction(doc)
    _page_break(doc)
    add_chapter_2_literature(doc)
    _page_break(doc)
    add_chapter_3_problem(doc)
    _page_break(doc)
    add_chapter_4_architecture(doc)
    _page_break(doc)
    add_chapter_5_cloud(doc)
    _page_break(doc)
    add_chapter_6_rag(doc)
    _page_break(doc)
    add_chapter_7_extension(doc)
    _page_break(doc)
    add_chapter_8_evaluation(doc)
    _page_break(doc)
    add_chapter_9_challenges(doc)
    _page_break(doc)
    add_chapter_10_conclusion(doc)
    _page_break(doc)

    # ---- Back matter ----
    add_references(doc)
    _page_break(doc)
    add_appendix_a(doc)
    _page_break(doc)
    add_appendix_b(doc)
    _page_break(doc)
    add_appendix_c(doc)
    _page_break(doc)
    add_glossary(doc)
    _page_break(doc)
    add_checklist(doc)

    doc.save(str(OUT_PATH))
    print(f"Wrote: {OUT_PATH}")
    print(f"Figures inserted: {_fig_no}")
    print(f"Tables inserted:  {_tbl_no}")

    # Post-process: pre-populate the Table of Contents (with hyperlinked
    # entries + PAGEREF page numbers) and turn on updateFields-on-open so
    # Word silently refreshes the cached page numbers when the file is
    # first opened.
    try:
        from populate_toc import populate as _populate_toc
    except ImportError:
        sys.path.insert(0, str(HERE))
        from populate_toc import populate as _populate_toc
    _populate_toc(OUT_PATH, create_backup=False, verbose=True)

    print(
        "REMINDER: open the .docx in Microsoft Word; the Table of "
        "Contents is pre-populated and Word will silently refresh the "
        "page numbers on first open. If a viewer does not auto-refresh "
        "fields, right-click on the Table of Contents and choose "
        "Update Field \u2192 Update entire table."
    )


if __name__ == "__main__":
    build()
