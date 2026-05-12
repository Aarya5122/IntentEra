"""Visual theme for the IntentEra final-defence deck.

All colours in sRGB hex. Geometry uses python-pptx Emu / Inches units.
Slides are 16:9 at 13.333" x 7.5" (1280 x 720 at 96dpi).

This module is a slight refinement of the midterm theme: brighter
gradient stops, larger title (30pt -> 32pt), denser footer line, and
new high-level helpers for section covers, metric cards, two-column
layouts, and image-with-caption blocks.
"""
from __future__ import annotations

from pathlib import Path

from lxml import etree
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).parent
FIGURES = ROOT.parent / "figures"


# ----------------------------------------------------------------------
# Slide geometry
# ----------------------------------------------------------------------

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)


# ----------------------------------------------------------------------
# Palette: deep indigo -> violet -> cyan, with teal/amber/green accents
# ----------------------------------------------------------------------

BG_DEEP = RGBColor(0x09, 0x0E, 0x24)        # near-black indigo
BG_MID = RGBColor(0x12, 0x1B, 0x42)         # indigo mid
BG_SOFT = RGBColor(0x10, 0x2D, 0x55)        # blueish accent end
BG_TITLE_END = RGBColor(0x07, 0x3F, 0x52)   # title slide gradient end
BG_SECTION_END = RGBColor(0x35, 0x29, 0x86) # section divider gradient end

PANEL = RGBColor(0x18, 0x24, 0x4D)
PANEL_ALT = RGBColor(0x1F, 0x2D, 0x5F)
PANEL_EDGE = RGBColor(0x33, 0x45, 0x80)
PANEL_EDGE_SOFT = RGBColor(0x29, 0x37, 0x6A)

INDIGO = RGBColor(0x6E, 0x70, 0xF6)
VIOLET = RGBColor(0xB1, 0x96, 0xFB)
CYAN = RGBColor(0x29, 0xDB, 0xF4)
TEAL = RGBColor(0x36, 0xDC, 0xC4)
AMBER = RGBColor(0xFB, 0xC0, 0x29)
GREEN = RGBColor(0x3D, 0xDA, 0x9F)
RED = RGBColor(0xF8, 0x71, 0x71)
ROSE = RGBColor(0xFB, 0x7B, 0xA8)

TEXT = RGBColor(0xF8, 0xFA, 0xFC)
TEXT_DIM = RGBColor(0xCC, 0xD6, 0xE3)
TEXT_MUTED = RGBColor(0x96, 0xA5, 0xBA)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)


# ----------------------------------------------------------------------
# Fonts (system fallbacks if missing)
# ----------------------------------------------------------------------

FONT_HEAD = "Montserrat"
FONT_BODY = "Inter"
FONT_MONO = "JetBrains Mono"


# ----------------------------------------------------------------------
# Footer / branding constants
# ----------------------------------------------------------------------

DECK_TITLE = "IntentEra"
DECK_SUBTITLE = "Final Defence"
DECK_AUTHOR = "Aarya Nanndaann Singh M N (2024MT03013)"


# ----------------------------------------------------------------------
# Low-level XML helpers (python-pptx doesn't expose gradient fills)
# ----------------------------------------------------------------------

_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
NSMAP = {"a": _A_NS}


def _qn(tag: str) -> str:
    _, local = tag.split(":")
    return f"{{{_A_NS}}}{local}"


def _hex(c: RGBColor) -> str:
    return "{:02X}{:02X}{:02X}".format(c[0], c[1], c[2])


def _get_spPr(shape):
    return shape._element.spPr


def fill_gradient(shape, stops, angle: int = 2700000):
    """Apply a linear gradient.

    stops: list of (position_0_1, RGBColor)
    angle: 1/60000 degree units (2700000 = 45 deg, 5400000 = vertical)
    """
    spPr = _get_spPr(shape)
    for tag in ("a:solidFill", "a:gradFill", "a:noFill",
                "a:pattFill", "a:blipFill"):
        el = spPr.find(_qn(tag))
        if el is not None:
            spPr.remove(el)

    grad = etree.Element(_qn("a:gradFill"),
                         {"flip": "none", "rotWithShape": "1"})
    gsLst = etree.SubElement(grad, _qn("a:gsLst"))
    for pos, color in stops:
        gs = etree.SubElement(gsLst, _qn("a:gs"),
                              {"pos": str(int(pos * 100000))})
        etree.SubElement(gs, _qn("a:srgbClr"), {"val": _hex(color)})
    etree.SubElement(grad, _qn("a:lin"),
                     {"ang": str(angle), "scaled": "0"})
    etree.SubElement(grad, _qn("a:tileRect"))

    ln = spPr.find(_qn("a:ln"))
    if ln is not None:
        spPr.insert(list(spPr).index(ln), grad)
    else:
        spPr.append(grad)
    return shape


# ----------------------------------------------------------------------
# Text & panel utilities
# ----------------------------------------------------------------------

def add_text(slide, x, y, w, h, text: str, *,
             size: int = 14, color: RGBColor = TEXT,
             font: str = FONT_BODY, bold: bool = False,
             italic: bool = False, align=PP_ALIGN.LEFT,
             anchor=MSO_ANCHOR.TOP, spacing: int | None = None,
             line_spacing: float | None = None):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.margin_left = tf.margin_right = Inches(0)
    tf.margin_top = tf.margin_bottom = Inches(0)
    tf.word_wrap = True
    tf.vertical_anchor = anchor

    for i, line in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if line_spacing is not None:
            p.line_spacing = line_spacing
        run = p.add_run()
        run.text = line
        run.font.name = font
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.italic = italic
        run.font.color.rgb = color
        if spacing is not None:
            rPr = run._r.get_or_add_rPr()
            rPr.set("spc", str(spacing))
    return tb


def add_panel(slide, x, y, w, h, *,
              fill: RGBColor = PANEL, border: RGBColor = PANEL_EDGE,
              corner: float = 0.10, line_width: float = 0.75):
    """Rounded-rectangle card."""
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    try:
        shape.adjustments[0] = corner
    except Exception:
        pass
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.color.rgb = border
    shape.line.width = Pt(line_width)
    shape.shadow.inherit = False
    return shape


def add_chip(slide, x, y, label: str, *,
             color: RGBColor = CYAN,
             text_color: RGBColor | None = None,
             width: Emu | None = None,
             height: Emu | None = None,
             size: int = 10):
    """Small pill-shaped label."""
    w = width or Inches(1.3)
    h = height or Inches(0.32)
    chip = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    chip.adjustments[0] = 0.5
    chip.fill.solid()
    chip.fill.fore_color.rgb = color
    chip.line.fill.background()
    tf = chip.text_frame
    tf.margin_left = tf.margin_right = Inches(0.08)
    tf.margin_top = tf.margin_bottom = Inches(0)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.name = FONT_HEAD
    r.font.size = Pt(size)
    r.font.bold = True
    r.font.color.rgb = text_color or BG_DEEP
    return chip


def add_outline_chip(slide, x, y, label: str, *,
                     color: RGBColor = CYAN,
                     width: Emu | None = None,
                     size: int = 10):
    """Outlined pill (transparent fill, coloured border + text)."""
    w = width or Inches(1.5)
    h = Inches(0.34)
    chip = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    chip.adjustments[0] = 0.5
    chip.fill.background()
    chip.line.color.rgb = color
    chip.line.width = Pt(1.0)
    tf = chip.text_frame
    tf.margin_left = tf.margin_right = Inches(0.1)
    tf.margin_top = tf.margin_bottom = Inches(0)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.name = FONT_HEAD
    r.font.size = Pt(size)
    r.font.bold = True
    r.font.color.rgb = color
    return chip


def add_bullet(slide, x, y, w, h, items, *,
               size: int = 14, color: RGBColor = TEXT_DIM,
               bullet: str = "•", bullet_color: RGBColor | None = None,
               line_spacing: float = 1.35,
               bold_first_word: bool = False):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.margin_left = tf.margin_right = Inches(0)
    tf.margin_top = tf.margin_bottom = Inches(0)
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        p.line_spacing = line_spacing
        b = p.add_run()
        b.text = f"{bullet}  "
        b.font.name = FONT_BODY
        b.font.size = Pt(size)
        b.font.bold = True
        b.font.color.rgb = bullet_color or CYAN

        if bold_first_word and " " in item:
            head, rest = item.split(" ", 1)
            r1 = p.add_run()
            r1.text = head + " "
            r1.font.name = FONT_BODY
            r1.font.size = Pt(size)
            r1.font.bold = True
            r1.font.color.rgb = TEXT
            r2 = p.add_run()
            r2.text = rest
            r2.font.name = FONT_BODY
            r2.font.size = Pt(size)
            r2.font.color.rgb = color
        else:
            r = p.add_run()
            r.text = item
            r.font.name = FONT_BODY
            r.font.size = Pt(size)
            r.font.color.rgb = color
    return tb


# ----------------------------------------------------------------------
# Slide chrome
# ----------------------------------------------------------------------

def add_background(slide, variant: str = "content"):
    """Full-bleed gradient background at z-index 0."""
    rect = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SLIDE_W, SLIDE_H)
    rect.line.fill.background()
    if variant == "title":
        stops = [(0, BG_DEEP), (0.55, RGBColor(0x1A, 0x18, 0x68)),
                 (1, BG_TITLE_END)]
    elif variant == "section":
        stops = [(0, BG_DEEP), (0.5, RGBColor(0x1B, 0x14, 0x55)),
                 (1, BG_SECTION_END)]
    else:
        stops = [(0, BG_DEEP), (1, BG_MID)]
    fill_gradient(rect, stops, angle=2700000)
    spTree = rect._element.getparent()
    spTree.remove(rect._element)
    spTree.insert(2, rect._element)


def add_accent_bar(slide):
    """Thin gradient bar on the left edge."""
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.08), SLIDE_H)
    bar.line.fill.background()
    fill_gradient(bar, [(0, CYAN), (1, INDIGO)], angle=5400000)


def add_footer(slide, page_no: int, total: int, section: str = ""):
    hair = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                  Inches(0.6), Inches(7.10),
                                  Inches(12.1), Emu(9525))
    hair.line.fill.background()
    hair.fill.solid()
    hair.fill.fore_color.rgb = PANEL_EDGE_SOFT

    # left meta
    left_label = (
        f"{DECK_TITLE}  ·  {DECK_SUBTITLE}  ·  {DECK_AUTHOR}"
        if not section
        else f"{DECK_TITLE}  ·  {DECK_SUBTITLE}  ·  {section}"
    )
    add_text(slide, Inches(0.6), Inches(7.18), Inches(10), Inches(0.3),
             left_label,
             size=10, color=TEXT_MUTED, font=FONT_BODY)

    add_text(slide, Inches(11.6), Inches(7.18), Inches(1.7), Inches(0.3),
             f"{page_no:02d} / {total:02d}",
             size=10, color=TEXT_MUTED, font=FONT_MONO,
             align=PP_ALIGN.RIGHT)


def add_title(slide, text: str, eyebrow: str | None = None):
    """Big page title with optional small eyebrow label above."""
    y = Inches(0.45)
    if eyebrow:
        add_text(slide, Inches(0.6), y, Inches(12.2), Inches(0.32),
                 eyebrow.upper(),
                 size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)
        y = Inches(0.80)
    add_text(slide, Inches(0.6), y, Inches(12.2), Inches(0.85),
             text,
             size=32, color=TEXT, font=FONT_HEAD, bold=True)

    underline = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                       Inches(0.6), Inches(1.65),
                                       Inches(2.4), Emu(38100))
    underline.line.fill.background()
    fill_gradient(underline, [(0, CYAN), (1, INDIGO)], angle=0)


# ----------------------------------------------------------------------
# High-level composition helpers
# ----------------------------------------------------------------------

def add_section_cover(slide, eyebrow: str, title: str,
                      subtitle: str | None = None):
    """Full-bleed section divider slide."""
    add_background(slide, "section")
    # decorative diagonal stripe
    stripe = slide.shapes.add_shape(MSO_SHAPE.PARALLELOGRAM,
                                    Inches(-1.5), Inches(5.5),
                                    Inches(16.5), Inches(0.6))
    stripe.line.fill.background()
    fill_gradient(stripe, [(0, CYAN), (0.5, INDIGO), (1, VIOLET)], angle=0)
    try:
        stripe.adjustments[0] = 0.4
    except Exception:
        pass

    # eyebrow
    add_text(slide, Inches(0.9), Inches(2.3), Inches(11.5), Inches(0.45),
             eyebrow.upper(),
             size=14, color=CYAN, font=FONT_HEAD, bold=True, spacing=300)

    # big title
    add_text(slide, Inches(0.9), Inches(2.85), Inches(11.5), Inches(2.0),
             title,
             size=58, color=TEXT, font=FONT_HEAD, bold=True,
             line_spacing=1.05)

    if subtitle:
        add_text(slide, Inches(0.9), Inches(4.65), Inches(11.5), Inches(0.6),
                 subtitle,
                 size=18, color=TEXT_DIM, font=FONT_BODY, italic=True,
                 line_spacing=1.25)


def add_metric_card(slide, x, y, w, h, *,
                    value: str, label: str,
                    sublabel: str | None = None,
                    accent: RGBColor = CYAN):
    """Big numeric headline card.

    value: large headline (e.g. "1536")
    label: small label below (e.g. "embedding dimensions")
    sublabel: optional caption below the label
    """
    card = add_panel(slide, x, y, w, h, fill=PANEL, border=PANEL_EDGE,
                     corner=0.12)

    # top accent strip
    strip = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, x, y, w, Emu(45720)
    )
    strip.line.fill.background()
    fill_gradient(strip, [(0, accent), (1, INDIGO)], angle=0)

    pad_x = Inches(0.22)
    val_h = Inches(1.1) if h >= Inches(1.6) else Inches(0.85)
    val_size = 42 if h >= Inches(1.6) else 32
    add_text(slide, x + pad_x, y + Inches(0.18), w - 2 * pad_x, val_h,
             value, size=val_size, color=TEXT, font=FONT_HEAD,
             bold=True, align=PP_ALIGN.LEFT, line_spacing=1.0)

    add_text(slide, x + pad_x, y + Inches(0.18) + val_h - Inches(0.12),
             w - 2 * pad_x, Inches(0.34),
             label.upper(),
             size=10, color=accent, font=FONT_HEAD, bold=True, spacing=200)

    if sublabel:
        add_text(slide, x + pad_x,
                 y + Inches(0.18) + val_h + Inches(0.22),
                 w - 2 * pad_x, Inches(0.55),
                 sublabel,
                 size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.25)
    return card


def add_image_with_caption(slide, image_path: str, x, y, w, h, *,
                           caption: str | None = None,
                           caption_size: int = 11):
    """Centered, contained image with optional bottom caption.

    The image is fit-to-width or fit-to-height while preserving aspect
    ratio (we let python-pptx scale by passing both width and height to
    a max-fit calculation).
    """
    from PIL import Image  # optional, only if available
    image_path_str = str(image_path)
    use_pil = False
    try:
        with Image.open(image_path_str) as im:
            iw, ih = im.size
        use_pil = True
    except Exception:
        iw = ih = 0

    if caption:
        h_image = h - Inches(0.42)
    else:
        h_image = h

    if use_pil and iw and ih:
        target_w = w
        target_h = h_image
        # fit-contain
        ar_image = iw / ih
        ar_box = target_w / target_h
        if ar_image > ar_box:
            new_w = target_w
            new_h = int(new_w / ar_image)
        else:
            new_h = target_h
            new_w = int(new_h * ar_image)
        ix = x + (target_w - new_w) // 2
        iy = y + (target_h - new_h) // 2
        slide.shapes.add_picture(image_path_str, ix, iy, new_w, new_h)
    else:
        slide.shapes.add_picture(image_path_str, x, y, w, h_image)

    if caption:
        add_text(slide, x, y + h_image + Inches(0.08), w, Inches(0.34),
                 caption,
                 size=caption_size, color=TEXT_MUTED, font=FONT_BODY,
                 italic=True, align=PP_ALIGN.CENTER)


def add_two_col(slide, top, height,
                left_render, right_render, *,
                gutter: Emu = Inches(0.4),
                left_x: Emu = Inches(0.6),
                right_x: Emu | None = None,
                col_w: Emu | None = None):
    """Layout helper: render two columns of content.

    left_render and right_render are callables that take (slide, x, y, w, h)
    and draw their column.
    """
    inner_w = SLIDE_W - left_x - Inches(0.6)
    if col_w is None:
        col_w = (inner_w - gutter) // 2
    if right_x is None:
        right_x = left_x + col_w + gutter

    left_render(slide, left_x, top, col_w, height)
    right_render(slide, right_x, top, col_w, height)


def add_kicker(slide, x, y, w, h, kicker: str, body: str, *,
               kicker_color: RGBColor = CYAN, body_color: RGBColor = TEXT_DIM,
               kicker_size: int = 11, body_size: int = 13):
    """Small all-caps kicker followed by a body paragraph."""
    add_text(slide, x, y, w, Inches(0.28),
             kicker.upper(),
             size=kicker_size, color=kicker_color, font=FONT_HEAD,
             bold=True, spacing=200)
    add_text(slide, x, y + Inches(0.32), w, h - Inches(0.32),
             body,
             size=body_size, color=body_color, font=FONT_BODY,
             line_spacing=1.35)


# ----------------------------------------------------------------------
# Asset path helpers
# ----------------------------------------------------------------------

def figure(name: str) -> str:
    """Return string path to a figure under Final Report/figures/."""
    p = FIGURES / name
    if not p.exists():
        raise FileNotFoundError(p)
    return str(p)


def screenshot(name: str) -> str:
    """Return string path to a screenshot under Final Report/figures/screenshots/."""
    p = FIGURES / "screenshots" / name
    if not p.exists():
        raise FileNotFoundError(p)
    return str(p)
