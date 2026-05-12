#!/usr/bin/env python3
"""populate_toc.py - Pre-populate the Table of Contents in the BITS WILP
final dissertation .docx so it is visible immediately without manually
running "Update Field" in Microsoft Word.

What this does to the file at
    Final Report/2024MT03013_Final_Dissertation.docx
(a .bak.docx backup is created on first run):

1. Walks the document body and collects every Heading 1 / Heading 2 /
   Heading 3 paragraph.
2. Wraps each heading's text with a unique bookmark (_Toc100000XXXX)
   so the TOC entries can hyperlink to it and use PAGEREF for the page
   number.
3. Replaces the single empty TOC-field paragraph with one paragraph per
   heading, formatted with TOC1/TOC2/TOC3 paragraph styles, a right-tab
   with dot-leader and a PAGEREF field for the page number. The TOC
   field's begin/instrText/separate/end markers are kept around the new
   paragraphs so the construct is still a real Word TOC field.
4. Marks the TOC begin-fldChar with w:dirty="true" so Word will refresh
   the cached page numbers automatically the first time the file opens.
5. Adds <w:updateFields w:val="true"/> to word/settings.xml so Word
   refreshes all fields silently on open (no "Update fields?" prompt).
6. Registers minimal TOC1/TOC2/TOC3 + Hyperlink styles in word/styles.xml
   if they are missing, so the pre-rendered TOC also looks reasonable
   in non-Word viewers (LibreOffice / Google Docs / Preview).

Run:
    python3 "Final Report/populate_toc.py"
"""
from __future__ import annotations

import shutil
import zipfile
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

HERE = Path(__file__).resolve().parent
DOCX_PATH = HERE / "2024MT03013_Final_Dissertation.docx"
BACKUP_PATH = HERE / "2024MT03013_Final_Dissertation.bak.docx"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
HEADING_STYLES = {"Heading1": 1, "Heading2": 2, "Heading3": 3}
TOC_INSTR = 'TOC \\o "1-3" \\h \\z \\u'
BOOKMARK_PREFIX = "_Toc100000"


# ---------------------------------------------------------------------------
# Small XML helpers
# ---------------------------------------------------------------------------

def _w(tag: str, attrs: dict | None = None):
    """Create a w:<tag> OxmlElement with the given w:<attr>=val pairs."""
    el = OxmlElement(f"w:{tag}")
    if attrs:
        for k, v in attrs.items():
            if ":" in k:
                el.set(qn(k), str(v))
            else:
                el.set(qn(f"w:{k}"), str(v))
    return el


def _t(text: str, *, preserve_space: bool = True):
    t = _w("t")
    if preserve_space:
        t.set(qn("xml:space"), "preserve")
    t.text = text
    return t


# ---------------------------------------------------------------------------
# Headings + bookmarks
# ---------------------------------------------------------------------------

def collect_headings(doc):
    """Return list of {p, level, text, name, id} for every Heading 1/2/3."""
    out = []
    for p in doc.paragraphs:
        if p.style is None:
            continue
        if p.style.style_id not in HEADING_STYLES:
            continue
        text = p.text.strip()
        if not text:
            continue
        out.append(
            {
                "p": p._p,
                "level": HEADING_STYLES[p.style.style_id],
                "text": text,
            }
        )
    for i, h in enumerate(out):
        h["id"] = 100000 + i
        h["name"] = f"{BOOKMARK_PREFIX}{i:04d}"
    return out


def add_bookmarks_to_headings(headings):
    """Insert <w:bookmarkStart/> and <w:bookmarkEnd/> around each heading."""
    for h in headings:
        p_el = h["p"]
        bm_start = _w("bookmarkStart", {"id": h["id"], "name": h["name"]})
        bm_end = _w("bookmarkEnd", {"id": h["id"]})

        pPr = p_el.find(qn("w:pPr"))
        if pPr is not None:
            pPr.addnext(bm_start)
        else:
            p_el.insert(0, bm_start)
        p_el.append(bm_end)


# ---------------------------------------------------------------------------
# Locate the existing TOC field paragraph
# ---------------------------------------------------------------------------

def find_toc_paragraph(doc):
    """Find the paragraph that holds the `TOC \\o "1-3" ...` field."""
    for p in doc.paragraphs:
        for instr in p._p.iter(qn("w:instrText")):
            if (instr.text or "").strip().startswith("TOC"):
                return p._p
    return None


# ---------------------------------------------------------------------------
# Build the TOC entry paragraphs
# ---------------------------------------------------------------------------

def _make_toc_entry_paragraph(h, *, is_first: bool, is_last: bool):
    """Build a single TOC entry <w:p>."""
    level = h["level"]

    p = _w("p")

    pPr = _w("pPr")
    pPr.append(_w("pStyle", {"val": f"TOC{level}"}))
    tabs = _w("tabs")
    tabs.append(_w("tab", {"val": "right", "leader": "dot", "pos": "9350"}))
    pPr.append(tabs)
    p.append(pPr)

    # If this is the first entry, embed the TOC field begin/instr/separate
    if is_first:
        r = _w("r")
        fld_begin = _w("fldChar", {"fldCharType": "begin"})
        fld_begin.set(qn("w:dirty"), "true")
        r.append(fld_begin)
        p.append(r)

        r = _w("r")
        instr = _w("instrText")
        instr.set(qn("xml:space"), "preserve")
        instr.text = TOC_INSTR
        r.append(instr)
        p.append(r)

        r = _w("r")
        r.append(_w("fldChar", {"fldCharType": "separate"}))
        p.append(r)

    # Hyperlink wrapping the entry text + tab + PAGEREF page number
    hyper = _w("hyperlink", {"anchor": h["name"], "history": "1"})

    r = _w("r")
    rPr = _w("rPr")
    rPr.append(_w("rStyle", {"val": "Hyperlink"}))
    r.append(rPr)
    r.append(_t(h["text"]))
    hyper.append(r)

    r = _w("r")
    r.append(_w("tab"))
    hyper.append(r)

    # PAGEREF field
    r = _w("r")
    r.append(_w("fldChar", {"fldCharType": "begin"}))
    hyper.append(r)

    r = _w("r")
    instr_p = _w("instrText")
    instr_p.set(qn("xml:space"), "preserve")
    instr_p.text = f' PAGEREF {h["name"]} \\h '
    r.append(instr_p)
    hyper.append(r)

    r = _w("r")
    r.append(_w("fldChar", {"fldCharType": "separate"}))
    hyper.append(r)

    r = _w("r")
    r.append(_t("1"))  # placeholder page number; Word will refresh it
    hyper.append(r)

    r = _w("r")
    r.append(_w("fldChar", {"fldCharType": "end"}))
    hyper.append(r)

    p.append(hyper)

    # If this is the last entry, embed the TOC field end
    if is_last:
        r = _w("r")
        r.append(_w("fldChar", {"fldCharType": "end"}))
        p.append(r)

    return p


def build_toc_paragraphs(headings):
    paragraphs = []
    n = len(headings)
    for i, h in enumerate(headings):
        paragraphs.append(
            _make_toc_entry_paragraph(
                h,
                is_first=(i == 0),
                is_last=(i == n - 1),
            )
        )
    return paragraphs


def replace_toc_paragraph(toc_para_el, new_para_elements):
    parent = toc_para_el.getparent()
    idx = list(parent).index(toc_para_el)
    parent.remove(toc_para_el)
    for i, p in enumerate(new_para_elements):
        parent.insert(idx + i, p)


# ---------------------------------------------------------------------------
# Register missing styles (TOC1/2/3 + Hyperlink) in word/styles.xml
# ---------------------------------------------------------------------------

def ensure_toc_styles(doc):
    """If TOC1/TOC2/TOC3/Hyperlink styles do not yet exist in styles.xml,
    add minimal style definitions so the pre-rendered TOC is presentable
    in viewers that do not refresh fields automatically."""
    styles_el = doc.styles.element

    existing = {
        s.get(qn("w:styleId"))
        for s in styles_el.findall(qn("w:style"))
    }

    def _make_toc_style(name: str, indent_twips: int):
        style = _w(
            "style",
            {"type": "paragraph", "styleId": name},
        )
        style.append(_w("name", {"val": f"toc {name[-1]}"}))
        style.append(_w("basedOn", {"val": "Normal"}))
        style.append(_w("next", {"val": "Normal"}))
        style.append(_w("uiPriority", {"val": "39"}))
        pPr = _w("pPr")
        pPr.append(_w("spacing", {"after": "100"}))
        pPr.append(_w("ind", {"left": str(indent_twips)}))
        style.append(pPr)
        return style

    def _make_hyperlink_style():
        style = _w(
            "style",
            {"type": "character", "styleId": "Hyperlink"},
        )
        style.append(_w("name", {"val": "Hyperlink"}))
        style.append(_w("basedOn", {"val": "DefaultParagraphFont"}))
        style.append(_w("uiPriority", {"val": "99"}))
        rPr = _w("rPr")
        rPr.append(_w("color", {"val": "0563C1", "themeColor": "hyperlink"}))
        rPr.append(_w("u", {"val": "single"}))
        style.append(rPr)
        return style

    added = []
    for sid, indent in (("TOC1", 0), ("TOC2", 220), ("TOC3", 440)):
        if sid not in existing:
            styles_el.append(_make_toc_style(sid, indent))
            added.append(sid)
    if "Hyperlink" not in existing:
        styles_el.append(_make_hyperlink_style())
        added.append("Hyperlink")
    return added


# ---------------------------------------------------------------------------
# Patch settings.xml to add <w:updateFields w:val="true"/>
# ---------------------------------------------------------------------------

def enable_update_fields_on_open(docx_path: Path) -> bool:
    with zipfile.ZipFile(docx_path) as z:
        settings = z.read("word/settings.xml").decode("utf-8")

    if "w:updateFields" in settings:
        return False

    if "<w:zoom" in settings:
        new_settings = settings.replace(
            "<w:zoom",
            '<w:updateFields w:val="true"/><w:zoom',
            1,
        )
    else:
        new_settings = settings.replace(
            "<w:settings",
            '<w:settings',  # leave tag, then inject right after first ">"
        )
        # Inject right after the opening <w:settings ...> tag.
        i = new_settings.find(">", new_settings.find("<w:settings"))
        new_settings = (
            new_settings[: i + 1]
            + '<w:updateFields w:val="true"/>'
            + new_settings[i + 1 :]
        )

    tmp_path = docx_path.with_suffix(docx_path.suffix + ".tmp")
    with zipfile.ZipFile(docx_path, "r") as zin, zipfile.ZipFile(
        tmp_path, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/settings.xml":
                data = new_settings.encode("utf-8")
            zout.writestr(item, data)
    tmp_path.replace(docx_path)
    return True


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def populate(docx_path: Path, *, create_backup: bool = True,
             verbose: bool = True) -> int:
    """Populate the TOC inside ``docx_path`` in place.

    Returns the number of TOC entries written.
    """
    def _say(msg):
        if verbose:
            print(msg)

    docx_path = Path(docx_path)
    if not docx_path.exists():
        raise FileNotFoundError(f"Input not found: {docx_path}")

    if create_backup:
        backup = docx_path.with_name(
            docx_path.stem + ".bak" + docx_path.suffix
        )
        if not backup.exists():
            shutil.copy2(docx_path, backup)
            _say(f"Backup created at {backup.name}")
        else:
            _say(f"Backup already exists at {backup.name} (left untouched)")

    doc = Document(str(docx_path))

    headings = collect_headings(doc)
    _say(f"Discovered {len(headings)} headings (levels 1-3)")

    add_bookmarks_to_headings(headings)
    _say("Inserted bookmarks around every heading")

    added_styles = ensure_toc_styles(doc)
    if added_styles:
        _say("Registered missing styles: " + ", ".join(added_styles))
    else:
        _say("All TOC/Hyperlink styles already present")

    toc_para = find_toc_paragraph(doc)
    if toc_para is None:
        raise RuntimeError(
            "No TOC field found in the document; cannot populate it."
        )

    new_paras = build_toc_paragraphs(headings)
    replace_toc_paragraph(toc_para, new_paras)
    _say(f"Populated the TOC field with {len(new_paras)} entries")

    doc.save(str(docx_path))

    if enable_update_fields_on_open(docx_path):
        _say('Enabled <w:updateFields w:val="true"/> in word/settings.xml')
    else:
        _say('<w:updateFields/> already enabled')

    return len(new_paras)


def main():
    populate(DOCX_PATH, create_backup=True, verbose=True)
    print()
    print("Done.")
    print(
        "Open the .docx in Word; the TOC is already visible. Word will "
        "silently refresh the page numbers on first open (because of "
        "w:dirty=true + w:updateFields=true), so the page numbers match "
        "the actual rendered pagination."
    )


if __name__ == "__main__":
    main()
