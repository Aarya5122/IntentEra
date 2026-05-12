"""Build the midterm dissertation presentation.

Run:
    python build_ppt.py

Output:
    ../Midterm_Presentation_2024MT03013.pptx
"""
from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

from theme import (
    SLIDE_W, SLIDE_H,
    BG_DEEP, BG_MID, BG_SOFT, PANEL, PANEL_EDGE,
    INDIGO, VIOLET, CYAN, TEAL, AMBER, GREEN, RED,
    TEXT, TEXT_DIM, TEXT_MUTED, WHITE,
    FONT_HEAD, FONT_BODY, FONT_MONO,
    add_background, add_accent_bar, add_footer, add_title,
    add_text, add_panel, add_chip, add_bullet, fill_gradient,
    asset,
)
from diagrams import node, arrow, elbow, lane, layer_band, Node


# ---------------------------------------------------------
# Slide deck scaffolding
# ---------------------------------------------------------

TOTAL_SLIDES = 22
OUT = Path(__file__).parent.parent / "Midterm_Presentation_2024MT03013.pptx"


def new_deck() -> Presentation:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    return prs


def blank(prs) -> object:
    # layout 6 is "Blank" in the default template
    return prs.slides.add_slide(prs.slide_layouts[6])


def content_slide(prs, page: int, section: str = "") -> object:
    s = blank(prs)
    add_background(s, "content")
    add_accent_bar(s)
    add_footer(s, page, TOTAL_SLIDES, section)
    return s


# ---------------------------------------------------------
# Slide 1 — Title
# ---------------------------------------------------------

def slide_title(prs):
    s = blank(prs)
    add_background(s, "title")

    # Decorative glow rings
    for i, (size_in, color, alpha) in enumerate([
        (8.5, INDIGO, 0.25),
        (6.0, VIOLET, 0.28),
        (4.0, CYAN, 0.35),
    ]):
        r = Inches(size_in)
        ring = s.shapes.add_shape(
            MSO_SHAPE.OVAL,
            Inches(10.2) - r // 2, Inches(3.8) - r // 2, r, r,
        )
        ring.fill.background()
        ring.line.color.rgb = color
        ring.line.width = Pt(1.0)

    # Eyebrow
    add_text(s, Inches(0.8), Inches(0.7), Inches(7), Inches(0.35),
             "M.TECH CLOUD COMPUTING  ·  MIDTERM DISSERTATION REVIEW",
             size=12, color=CYAN, font=FONT_HEAD, bold=True, spacing=300)

    # Big title
    add_text(s, Inches(0.8), Inches(1.25), Inches(11.5), Inches(1.5),
             "Semantic Reconstruction\nof Software Intent",
             size=46, color=TEXT, font=FONT_HEAD, bold=True,
             line_spacing=1.05)

    # Subtitle
    add_text(s, Inches(0.8), Inches(3.35), Inches(11.5), Inches(1.0),
             "A Cloud-Hosted Agentic AI Solution for Study of\n"
             "Requirement Traceability in Production-Grade Codebases",
             size=19, color=TEXT_DIM, font=FONT_BODY, italic=True,
             line_spacing=1.2)

    # Gradient underline
    underline = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                   Inches(0.8), Inches(4.9),
                                   Inches(3.2), Emu(57150))  # ~6px
    underline.line.fill.background()
    fill_gradient(underline, [(0, CYAN), (0.6, INDIGO), (1, VIOLET)], angle=0)

    # Author block (left panel)
    panel = add_panel(s, Inches(0.8), Inches(5.2), Inches(6.0), Inches(1.7),
                      fill=RGBColor(0x10, 0x19, 0x3A), border=PANEL_EDGE, corner=0.08)
    add_text(s, Inches(1.0), Inches(5.35), Inches(5.6), Inches(0.3),
             "CANDIDATE",
             size=10, color=CYAN, font=FONT_HEAD, bold=True, spacing=300)
    add_text(s, Inches(1.0), Inches(5.65), Inches(5.6), Inches(0.4),
             "Aarya Nanndaann Singh M N",
             size=20, color=TEXT, font=FONT_HEAD, bold=True)
    add_text(s, Inches(1.0), Inches(6.05), Inches(5.6), Inches(0.3),
             "BITS ID  ·  2024MT03013",
             size=11, color=TEXT_DIM, font=FONT_MONO)
    add_text(s, Inches(1.0), Inches(6.35), Inches(5.6), Inches(0.3),
             "2024mt03013@wilp.bits-pilani.ac.in",
             size=11, color=TEXT_MUTED, font=FONT_MONO)

    # Supervisor / institution panel
    panel2 = add_panel(s, Inches(7.0), Inches(5.2), Inches(5.5), Inches(1.7),
                       fill=RGBColor(0x10, 0x19, 0x3A), border=PANEL_EDGE, corner=0.08)
    add_text(s, Inches(7.2), Inches(5.35), Inches(5.1), Inches(0.3),
             "SUPERVISOR",
             size=10, color=VIOLET, font=FONT_HEAD, bold=True, spacing=300)
    add_text(s, Inches(7.2), Inches(5.65), Inches(5.1), Inches(0.4),
             "Hanumanthu Indrakanti",
             size=16, color=TEXT, font=FONT_HEAD, bold=True)
    add_text(s, Inches(7.2), Inches(6.02), Inches(5.1), Inches(0.3),
             "Aqueralabs India Pvt Ltd, Bangalore",
             size=11, color=TEXT_DIM, font=FONT_BODY)
    add_text(s, Inches(7.2), Inches(6.35), Inches(5.1), Inches(0.3),
             "BITS Pilani  ·  WILP  ·  March 2026",
             size=11, color=TEXT_MUTED, font=FONT_MONO)


# ---------------------------------------------------------
# Slide 2 — Agenda
# ---------------------------------------------------------

def slide_agenda(prs):
    s = content_slide(prs, 2, "Agenda")
    add_title(s, "Agenda", eyebrow="What we'll cover today")

    items = [
        ("01", "The Problem", "Semantic intent loss in modern codebases"),
        ("02", "Objectives", "What this dissertation aims to achieve"),
        ("03", "System Architecture", "5-layer agentic AI framework"),
        ("04", "AWS Deployment", "Cloud topology with Lambdas + RAG"),
        ("05", "Ingestion Pipelines", "How Jira & GitHub artifacts flow in"),
        ("06", "Retrieval & RAG", "Vector search over unified knowledge"),
        ("07", "Progress so far", "Completed · In progress · Pending"),
        ("08", "Plan of Work", "Timeline, observations, challenges, next steps"),
    ]

    cols = 2
    card_w = Inches(5.9)
    card_h = Inches(0.95)
    x0 = Inches(0.7)
    y0 = Inches(2.05)
    gap_x = Inches(0.25)
    gap_y = Inches(0.2)

    for i, (num, title, desc) in enumerate(items):
        r, c = divmod(i, cols)
        x = x0 + c * (card_w + gap_x)
        y = y0 + r * (card_h + gap_y)

        add_panel(s, x, y, card_w, card_h, corner=0.12)

        # number
        add_text(s, x + Inches(0.25), y + Inches(0.15), Inches(0.9), Inches(0.6),
                 num, size=28, color=CYAN, font=FONT_HEAD, bold=True)
        # vertical divider
        div = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                 x + Inches(1.1), y + Inches(0.22),
                                 Emu(19050), Inches(0.55))
        div.line.fill.background()
        div.fill.solid()
        div.fill.fore_color.rgb = PANEL_EDGE
        # title
        add_text(s, x + Inches(1.3), y + Inches(0.14), card_w - Inches(1.4), Inches(0.4),
                 title, size=15, color=TEXT, font=FONT_HEAD, bold=True)
        # desc
        add_text(s, x + Inches(1.3), y + Inches(0.5), card_w - Inches(1.4), Inches(0.4),
                 desc, size=11, color=TEXT_DIM, font=FONT_BODY)


# ---------------------------------------------------------
# Slide 3 — The Context
# ---------------------------------------------------------

def slide_context(prs):
    s = content_slide(prs, 3, "Context")
    add_title(s, "Software today lives across many places",
              eyebrow="The modern dev stack")

    add_text(s, Inches(0.7), Inches(1.9), Inches(12), Inches(0.6),
             "A single production feature is rarely written in one place. Its story is spread across\n"
             "issue trackers, code repositories, pull-request discussions, and internal docs.",
             size=15, color=TEXT_DIM, font=FONT_BODY, line_spacing=1.3)

    # Logo strip
    logos = [
        ("logos/jira", "Jira",
         "Requirements &\nbug tickets"),
        ("logos/confluence", "Confluence",
         "Design &\ndocumentation"),
        ("logos/github", "GitHub",
         "Commits, PRs,\nissues"),
        ("logos/vscode", "IDE",
         "Where developers\nactually work"),
    ]
    card_w = Inches(2.75)
    card_h = Inches(2.4)
    gap = Inches(0.25)
    x0 = Inches(0.7)
    y0 = Inches(3.1)

    for i, (icon, name, desc) in enumerate(logos):
        x = x0 + i * (card_w + gap)
        add_panel(s, x, y0, card_w, card_h, corner=0.1)

        # top gradient strip
        strip = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y0, card_w, Emu(38100))
        strip.line.fill.background()
        fill_gradient(strip, [(0, CYAN), (1, INDIGO)], angle=0)

        # icon
        iw = Inches(0.9)
        s.shapes.add_picture(asset(*icon.split("/")),
                             x + (card_w - iw) // 2, y0 + Inches(0.35), iw, iw)

        add_text(s, x, y0 + Inches(1.35), card_w, Inches(0.4),
                 name, size=17, color=TEXT, font=FONT_HEAD, bold=True,
                 align=PP_ALIGN.CENTER)
        add_text(s, x + Inches(0.2), y0 + Inches(1.75), card_w - Inches(0.4), Inches(0.55),
                 desc, size=11, color=TEXT_DIM, font=FONT_BODY,
                 align=PP_ALIGN.CENTER, line_spacing=1.3)

    add_text(s, Inches(0.7), Inches(5.75), Inches(12), Inches(0.9),
             "Each artifact captures a different slice of truth. None of them alone explains\n"
             "why a particular line of code exists.",
             size=13, color=TEXT_MUTED, font=FONT_BODY, italic=True, line_spacing=1.3)


# ---------------------------------------------------------
# Slide 4 — The Problem
# ---------------------------------------------------------

def slide_problem(prs):
    s = content_slide(prs, 4, "The Problem")
    add_title(s, "Semantic Intent Loss",
              eyebrow="The what-vs-why gap")

    # Two opposing cards: code vs intent
    y = Inches(1.95)
    h = Inches(2.2)

    # Left: code
    left = add_panel(s, Inches(0.7), y, Inches(5.8), h, corner=0.1)
    add_text(s, Inches(0.95), y + Inches(0.18), Inches(5.3), Inches(0.4),
             "SOURCE CODE", size=11, color=CYAN, font=FONT_HEAD,
             bold=True, spacing=300)
    add_text(s, Inches(0.95), y + Inches(0.52), Inches(5.3), Inches(0.5),
             "What the system does", size=20, color=TEXT,
             font=FONT_HEAD, bold=True)
    add_text(s, Inches(0.95), y + Inches(1.05), Inches(5.3), Inches(1.0),
             "Precise, executable, versioned.\n"
             "Describes behaviour line-by-line.\n"
             "Easy to run — hard to interpret.",
             size=13, color=TEXT_DIM, font=FONT_BODY, line_spacing=1.4)

    # Right: intent
    right = add_panel(s, Inches(6.85), y, Inches(5.8), h, corner=0.1,
                      fill=RGBColor(0x1A, 0x16, 0x44),
                      border=VIOLET)
    add_text(s, Inches(7.1), y + Inches(0.18), Inches(5.3), Inches(0.4),
             "DEVELOPER INTENT", size=11, color=VIOLET, font=FONT_HEAD,
             bold=True, spacing=300)
    add_text(s, Inches(7.1), y + Inches(0.52), Inches(5.3), Inches(0.5),
             "Why it was written", size=20, color=TEXT,
             font=FONT_HEAD, bold=True)
    add_text(s, Inches(7.1), y + Inches(1.05), Inches(5.3), Inches(1.0),
             "Scattered across tickets, PRs, chats,\n"
             "commit messages — and often in people's heads.\n"
             "Fragments faster than the code.",
             size=13, color=TEXT_DIM, font=FONT_BODY, line_spacing=1.4)

    # Gap arrow
    gap = s.shapes.add_shape(MSO_SHAPE.LEFT_RIGHT_ARROW,
                             Inches(5.95), y + Inches(0.85),
                             Inches(1.45), Inches(0.5))
    gap.fill.solid()
    gap.fill.fore_color.rgb = AMBER
    gap.line.fill.background()
    add_text(s, Inches(5.95), y + Inches(1.45), Inches(1.45), Inches(0.3),
             "gap", size=10, color=AMBER, font=FONT_HEAD, bold=True,
             align=PP_ALIGN.CENTER, spacing=300)

    # Tagline under both
    add_text(s, Inches(0.7), Inches(4.45), Inches(12), Inches(0.9),
             "Over time the connection between the two erodes.",
             size=16, color=TEXT, font=FONT_HEAD, bold=True,
             align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.7), Inches(4.85), Inches(12), Inches(1.2),
             "New engineers inherit the code but not the reasoning.  Bugs get fixed without\n"
             "anyone remembering why the broken behaviour ever existed.  Requirement-to-code\n"
             "traceability quietly disappears.",
             size=13, color=TEXT_DIM, font=FONT_BODY, align=PP_ALIGN.CENTER,
             line_spacing=1.4)


# ---------------------------------------------------------
# Slide 5 — Why it hurts (four quadrants)
# ---------------------------------------------------------

def slide_why_hurts(prs):
    s = content_slide(prs, 5, "Why it hurts")
    add_title(s, "Why this matters in the real world",
              eyebrow="Impact of intent loss")

    quads = [
        ("⏱", "Slow onboarding",
         "New engineers spend weeks hopping between Jira, GitHub,\nand docs to piece together context.", CYAN),
        ("🐛", "Harder debugging",
         "Fixing a regression requires guessing why the original code\nwas structured the way it is.", AMBER),
        ("📦", "Risky maintenance",
         "Legacy modules are rewritten or removed blindly, because\nthe rationale behind them is lost.", VIOLET),
        ("🌐", "OSS friction",
         "External contributors can't see institutional knowledge and\nbounce off unfamiliar codebases.", TEAL),
    ]

    card_w = Inches(5.9)
    card_h = Inches(2.0)
    x0 = Inches(0.7)
    y0 = Inches(1.95)
    gap_x = Inches(0.25)
    gap_y = Inches(0.2)

    for i, (emoji, title, body, color) in enumerate(quads):
        r, c = divmod(i, 2)
        x = x0 + c * (card_w + gap_x)
        y = y0 + r * (card_h + gap_y)
        add_panel(s, x, y, card_w, card_h, corner=0.1)

        # Left accent block
        block = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                   x + Inches(0.3), y + Inches(0.35),
                                   Inches(1.05), Inches(1.3))
        block.adjustments[0] = 0.2
        block.fill.solid()
        block.fill.fore_color.rgb = color
        block.line.fill.background()

        add_text(s, x + Inches(0.3), y + Inches(0.45), Inches(1.05), Inches(1.1),
                 emoji, size=44, color=BG_DEEP, font=FONT_HEAD,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

        add_text(s, x + Inches(1.55), y + Inches(0.3), card_w - Inches(1.8), Inches(0.5),
                 title, size=17, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(1.55), y + Inches(0.8), card_w - Inches(1.8), Inches(1.1),
                 body, size=12, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.35)

    add_text(s, Inches(0.7), Inches(6.3), Inches(12), Inches(0.4),
             "In short: today the code shows what — but not why. This dissertation targets exactly that gap.",
             size=12, color=TEXT_MUTED, font=FONT_BODY, italic=True,
             align=PP_ALIGN.CENTER)


# ---------------------------------------------------------
# Slide 6 — Problem Statement
# ---------------------------------------------------------

def slide_problem_statement(prs):
    s = content_slide(prs, 6, "Problem Statement")
    add_title(s, "Problem Statement",
              eyebrow="The formal framing")

    stmts = [
        ("Fragmented knowledge",
         "Software knowledge is scattered across JIRA, GitHub, PR discussions and docs with "
         "no unified semantic representation, making it hard to reason across them."),
        ("Missing traceability",
         "Explicit, reliable mappings between natural-language requirements and the specific "
         "code changes that implement them are rarely maintained."),
        ("Cognitive overhead",
         "Developers end up manually navigating multiple tools to reconstruct context — "
         "slowing onboarding, debugging, and safe maintenance."),
    ]

    # Vertical stack
    x = Inches(0.8)
    y = Inches(2.0)
    w = Inches(11.7)
    h = Inches(1.35)
    gap = Inches(0.2)

    colors = [CYAN, VIOLET, AMBER]
    for i, (t, body) in enumerate(stmts):
        add_panel(s, x, y + i * (h + gap), w, h, corner=0.08)

        # Numeric badge
        badge = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                   x + Inches(0.25), y + i * (h + gap) + Inches(0.35),
                                   Inches(0.65), Inches(0.65))
        badge.fill.solid()
        badge.fill.fore_color.rgb = colors[i]
        badge.line.fill.background()
        add_text(s, x + Inches(0.25), y + i * (h + gap) + Inches(0.35),
                 Inches(0.65), Inches(0.65),
                 f"0{i+1}", size=18, color=BG_DEEP, font=FONT_HEAD, bold=True,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

        # Title + body
        add_text(s, x + Inches(1.15), y + i * (h + gap) + Inches(0.2),
                 w - Inches(1.4), Inches(0.4),
                 t, size=17, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(1.15), y + i * (h + gap) + Inches(0.62),
                 w - Inches(1.4), Inches(0.75),
                 body, size=12, color=TEXT_DIM, font=FONT_BODY, line_spacing=1.35)

    add_text(s, Inches(0.8), Inches(6.4), Inches(11.7), Inches(0.5),
             "We need an intelligent, scalable system that bridges requirements ↔ code and makes "
             "intent discoverable automatically.",
             size=13, color=CYAN, font=FONT_HEAD, italic=True,
             align=PP_ALIGN.CENTER)


# ---------------------------------------------------------
# Slide 7 — Objectives
# ---------------------------------------------------------

def slide_objectives(prs):
    s = content_slide(prs, 7, "Objectives")
    add_title(s, "Dissertation Objectives",
              eyebrow="What we set out to build")

    items = [
        ("🔎", "Study intent loss",
         "Analyze how rationale fragments across tickets, commits, PRs."),
        ("🧩", "Reconstruct traceability",
         "Link natural-language requirements to concrete code changes."),
        ("🤖", "Cloud-hosted agentic AI",
         "Multi-agent LLM system that reasons over software artifacts."),
        ("🛠", "IDE integration",
         "Deliver context-aware help right inside the developer's editor."),
        ("🔁", "Automated workflows",
         "Map Jira → commits → code and explain each step."),
        ("🧪", "Issue reproduction & validation",
         "Help recreate problems and verify that fixes actually resolve them."),
        ("📉", "Measure the lift",
         "Evaluate reductions in cognitive load, onboarding time, and triage effort."),
    ]

    card_w = Inches(5.9)
    card_h = Inches(1.25)
    x0 = Inches(0.7)
    y0 = Inches(1.85)
    gap_x = Inches(0.25)
    gap_y = Inches(0.18)

    for i, (emoji, title, body) in enumerate(items):
        r, c = divmod(i, 2)
        if i == len(items) - 1:  # last item centered
            x = Inches(3.7)
        else:
            x = x0 + c * (card_w + gap_x)
        y = y0 + r * (card_h + gap_y)

        add_panel(s, x, y, card_w, card_h, corner=0.1)

        # Icon circle
        circle = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                    x + Inches(0.25), y + Inches(0.3),
                                    Inches(0.65), Inches(0.65))
        circle.fill.solid()
        circle.fill.fore_color.rgb = RGBColor(0x1A, 0x24, 0x55)
        circle.line.color.rgb = CYAN
        circle.line.width = Pt(1)
        add_text(s, x + Inches(0.25), y + Inches(0.3),
                 Inches(0.65), Inches(0.65),
                 emoji, size=22, color=CYAN, font=FONT_HEAD,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

        add_text(s, x + Inches(1.1), y + Inches(0.2),
                 card_w - Inches(1.3), Inches(0.4),
                 title, size=14, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(1.1), y + Inches(0.58),
                 card_w - Inches(1.3), Inches(0.6),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.3)


# ---------------------------------------------------------
# Slide 8 — Solution at a glance
# ---------------------------------------------------------

def slide_solution_glance(prs):
    s = content_slide(prs, 8, "Solution")
    add_title(s, "IntentEra  —  The Proposed Solution",
              eyebrow="One-line pitch")

    add_text(s, Inches(0.7), Inches(1.9), Inches(12), Inches(0.8),
             "A cloud-hosted agentic AI platform that ingests software artifacts, semantically "
             "indexes them, and answers \"why does this code exist?\" directly in the IDE.",
             size=15, color=TEXT_DIM, font=FONT_BODY, italic=True,
             line_spacing=1.3)

    # 5-layer stacked view
    layers = [
        ("01", "Artifact Ingestion",
         ["Jira", "Confluence", "GitHub"], CYAN),
        ("02", "Knowledge Extraction",
         ["Normalize", "Chunk", "Embed"], TEAL),
        ("03", "Semantic Reasoning",
         ["Vector search", "Cross-artifact", "LLM"], INDIGO),
        ("04", "Agent Orchestration",
         ["Traceability", "Code-Intent", "Reproduction", "Validation"], VIOLET),
        ("05", "IDE Integration",
         ["Inline context", "Explainers", "Trace links"], AMBER),
    ]

    x = Inches(0.7)
    y = Inches(3.1)
    w = Inches(11.9)
    h = Inches(0.62)
    gap = Inches(0.12)

    for i, (num, title, tags, color) in enumerate(layers):
        ly = y + i * (h + gap)
        add_panel(s, x, ly, w, h, corner=0.2)

        # number tile
        tile = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                  x + Inches(0.15), ly + Inches(0.09),
                                  Inches(0.55), Inches(0.44))
        tile.adjustments[0] = 0.2
        tile.fill.solid()
        tile.fill.fore_color.rgb = color
        tile.line.fill.background()
        add_text(s, x + Inches(0.15), ly + Inches(0.09),
                 Inches(0.55), Inches(0.44),
                 num, size=12, color=BG_DEEP, font=FONT_HEAD, bold=True,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

        add_text(s, x + Inches(0.85), ly + Inches(0.12),
                 Inches(3.3), Inches(0.4),
                 title, size=13, color=TEXT, font=FONT_HEAD, bold=True)

        # tag chips
        tx = x + Inches(4.3)
        for tag in tags:
            est_w = Inches(0.12 * len(tag) + 0.4)
            add_chip(s, tx, ly + Inches(0.14), tag,
                     color=RGBColor(0x1E, 0x29, 0x5D), text_color=TEXT_DIM,
                     width=est_w)
            tx += est_w + Inches(0.1)

        # right arrow indicator (except last)
        if i < len(layers) - 1:
            pass  # gap itself represents flow


# =========================================================
# ARCHITECTURE SLIDES  (9–15)
# =========================================================

def slide_highlevel_arch(prs):
    s = content_slide(prs, 9, "Architecture")
    add_title(s, "High-Level System Architecture",
              eyebrow="Five cooperating layers")

    # Left side: layered stack
    layers = [
        ("Artifact Ingestion", "Jira · Confluence · GitHub", CYAN),
        ("Knowledge Extraction", "Normalize · Chunk · Embed", TEAL),
        ("Semantic Reasoning", "Vector search · LLM inference", INDIGO),
        ("Agent Orchestration", "Multi-agent coordination", VIOLET),
        ("IDE Integration", "Developer experience surface", AMBER),
    ]
    x = Inches(0.7)
    y = Inches(1.95)
    w = Inches(6.8)
    h = Inches(0.85)
    gap = Inches(0.1)
    prev_node = None

    for i, (title, sub, col) in enumerate(layers):
        layer_band(s, x, y + i * (h + gap), w, h,
                   title=title, items=[sub], color=col)

    # Right side: flow example
    rx = Inches(7.95)
    ry = Inches(1.95)
    rw = Inches(4.85)
    rh = Inches(5.15)
    add_panel(s, rx, ry, rw, rh, corner=0.06,
              fill=RGBColor(0x13, 0x1D, 0x44))
    add_text(s, rx + Inches(0.25), ry + Inches(0.18), rw - Inches(0.5), Inches(0.4),
             "HOW A QUESTION FLOWS", size=11, color=VIOLET, font=FONT_HEAD,
             bold=True, spacing=300)

    flow_items = [
        ("Developer asks in IDE",
         "\"Why was this retry logic added?\""),
        ("Agent receives query",
         "Routes to Code-Intent + Traceability agents"),
        ("Retrieval over vector DB",
         "Pulls related Jira tickets, PRs, commits"),
        ("LLM synthesises answer",
         "Merges facts into a human explanation"),
        ("Answer appears inline",
         "With links back to original artifacts"),
    ]
    fy = ry + Inches(0.7)
    for i, (t, sub) in enumerate(flow_items):
        dot = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                 rx + Inches(0.3), fy + Inches(0.12),
                                 Inches(0.25), Inches(0.25))
        dot.fill.solid()
        dot.fill.fore_color.rgb = CYAN
        dot.line.fill.background()
        add_text(s, rx + Inches(0.3), fy + Inches(0.12),
                 Inches(0.25), Inches(0.25),
                 str(i + 1), size=10, color=BG_DEEP, font=FONT_HEAD, bold=True,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        add_text(s, rx + Inches(0.7), fy, rw - Inches(0.9), Inches(0.3),
                 t, size=12, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, rx + Inches(0.7), fy + Inches(0.28),
                 rw - Inches(0.9), Inches(0.35),
                 sub, size=10, color=TEXT_DIM, font=FONT_BODY)
        # connector line to next
        if i < len(flow_items) - 1:
            ln = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                    rx + Inches(0.422), fy + Inches(0.4),
                                    Emu(9525), Inches(0.55))
            ln.line.fill.background()
            ln.fill.solid()
            ln.fill.fore_color.rgb = PANEL_EDGE
        fy += Inches(0.85)


def slide_aws_topology(prs):
    s = content_slide(prs, 10, "AWS Deployment")
    add_title(s, "AWS Deployment Topology",
              eyebrow="Where each piece actually runs")

    # Legend
    add_text(s, Inches(0.7), Inches(1.75), Inches(12), Inches(0.35),
             "EventBridge wakes the ingest Lambda on a schedule · API Gateway fronts retrieval · "
             "both Lambdas sit inside a VPC and exit through a NAT Gateway.",
             size=11, color=TEXT_DIM, font=FONT_BODY, italic=True)

    # External trigger nodes (top-left cluster)
    eb = node(s, Inches(0.55), Inches(2.25),
              label="EventBridge", sublabel="cron schedule",
              icon="aws/EventBridge", w=Inches(1.7), h=Inches(1.25), accent=CYAN)
    apigw = node(s, Inches(0.55), Inches(3.75),
                 label="API Gateway", sublabel="HTTP API",
                 icon="aws/APIGateway", w=Inches(1.7), h=Inches(1.25), accent=CYAN)
    sm = node(s, Inches(0.55), Inches(5.25),
              label="Secrets Mgr", sublabel="credentials JSON",
              icon="aws/SecretsManager", w=Inches(1.7), h=Inches(1.25), accent=VIOLET)

    # VPC container (center)
    vpc_x, vpc_y = Inches(2.75), Inches(2.1)
    vpc_w, vpc_h = Inches(5.2), Inches(4.9)
    lane(s, vpc_x, vpc_y, vpc_w, vpc_h,
         title="VPC (private)", subtitle="egress via NAT",
         color=INDIGO, alpha_fill=RGBColor(0x14, 0x1F, 0x4C))

    ing = node(s, vpc_x + Inches(0.35), vpc_y + Inches(0.45),
               label="Ingest Lambda", sublabel="handler/ingest.js",
               icon="aws/Lambda", w=Inches(2.0), h=Inches(1.35), accent=CYAN)
    ret = node(s, vpc_x + Inches(2.7), vpc_y + Inches(0.45),
               label="Retrieve Lambda", sublabel="handler/retrieve.js",
               icon="aws/Lambda", w=Inches(2.1), h=Inches(1.35), accent=TEAL)

    nat = node(s, vpc_x + Inches(1.5), vpc_y + Inches(2.1),
               label="NAT Gateway", sublabel="elastic IP",
               icon="aws/NATGateway", w=Inches(2.0), h=Inches(1.35), accent=VIOLET)

    cw = node(s, vpc_x + Inches(0.9), vpc_y + Inches(3.7),
              label="CloudWatch", sublabel="logs + metrics",
              icon="aws/CloudWatch", w=Inches(3.2), h=Inches(0.95), accent=AMBER)

    # External data stores & APIs (right cluster)
    mongo = node(s, Inches(8.4), Inches(2.1),
                 label="MongoDB Atlas", sublabel="vector search",
                 icon="logos/mongodb", w=Inches(2.0), h=Inches(1.25), accent=GREEN)
    redis = node(s, Inches(10.55), Inches(2.1),
                 label="Redis", sublabel="state + lock",
                 icon="logos/redis", w=Inches(2.0), h=Inches(1.25), accent=RED)
    openai = node(s, Inches(8.4), Inches(3.6),
                  label="OpenAI", sublabel="embeddings",
                  icon="logos/openai", w=Inches(2.0), h=Inches(1.25), accent=TEAL)
    jira = node(s, Inches(10.55), Inches(3.6),
                label="Jira / Conf.", sublabel="REST APIs",
                icon="logos/jira", w=Inches(2.0), h=Inches(1.25), accent=INDIGO)
    gh = node(s, Inches(9.45), Inches(5.1),
              label="GitHub", sublabel="REST + GraphQL",
              icon="logos/github", w=Inches(2.0), h=Inches(1.25), accent=VIOLET)

    # Arrows — triggers into VPC
    arrow(s, eb, ing, side_from="right", side_to="left", color=CYAN, dashed=True)
    arrow(s, apigw, ret, side_from="right", side_to="left", color=TEAL)
    arrow(s, sm, ing, side_from="right", side_to="left", color=VIOLET, dashed=True)
    arrow(s, sm, ret, side_from="right", side_to="left", color=VIOLET, dashed=True)

    # Lambdas -> NAT -> external
    arrow(s, ing, nat, side_from="bottom", side_to="top", color=CYAN)
    arrow(s, ret, nat, side_from="bottom", side_to="top", color=TEAL)

    # NAT -> each external service
    arrow(s, nat, mongo, side_from="right", side_to="left", color=GREEN)
    arrow(s, nat, redis, side_from="right", side_to="left", color=RED)
    arrow(s, nat, openai, side_from="right", side_to="left", color=TEAL)
    arrow(s, nat, jira, side_from="right", side_to="left", color=INDIGO)
    arrow(s, nat, gh, side_from="right", side_to="left", color=VIOLET)

    # Lambdas -> CloudWatch
    arrow(s, ing, cw, side_from="bottom", side_to="top", color=AMBER, dashed=True)
    arrow(s, ret, cw, side_from="bottom", side_to="top", color=AMBER, dashed=True)


def slide_jira_pipeline(prs):
    s = content_slide(prs, 11, "Ingestion")
    add_title(s, "Jira Ingestion Pipeline",
              eyebrow="From ticket to vector")

    # Linear flow of 6 nodes
    y = Inches(2.7)
    items = [
        ("Jira / Confluence", "issues · comments\nattachments · pages", "logos/jira"),
        ("Ingest Lambda", "handler/ingest.js", "aws/Lambda"),
        ("Normalizer", "unified ticket shape", "logos/nodejs"),
        ("Semantic Chunker", "structure-aware split", "logos/nodejs"),
        ("Embedder", "text-embedding-3-small\n1536 dims", "logos/openai"),
        ("MongoDB Atlas", "rag_chunks\nvector_index", "logos/mongodb"),
    ]
    nw = Inches(1.85)
    gap = Inches(0.15)
    total_w = len(items) * nw + (len(items) - 1) * gap
    x = (SLIDE_W - total_w) // 2

    nodes = []
    for i, (t, sub, ic) in enumerate(items):
        n = node(s, x + i * (nw + gap), y,
                 label=t, sublabel=sub,
                 icon=ic, w=nw, h=Inches(1.55), accent=CYAN)
        nodes.append(n)
        if i > 0:
            arrow(s, nodes[i-1], n, color=CYAN)

    # Redis state below
    redis = node(s, Inches(5.2), Inches(5.0),
                 label="Redis", sublabel="state + lock",
                 icon="logos/redis", w=Inches(2.0), h=Inches(1.25), accent=RED)
    arrow(s, nodes[1], redis, side_from="bottom", side_to="top",
          color=RED, dashed=True, label="checkpoint")

    # Bottom notes
    notes = [
        ("Per-ticket idempotency",
         "Each ticket is reprocessed as an atomic delete-then-insert."),
        ("Incremental lookback",
         "A 60-min window past the last checkpoint catches late updates."),
        ("Deterministic chunk IDs",
         "Re-running on the same content produces the same _id hashes."),
    ]
    nx = Inches(0.55)
    ny = Inches(6.55)
    for i, (t, body) in enumerate(notes):
        w = Inches(4.15)
        add_panel(s, nx + i * (w + Inches(0.15)), ny, w, Inches(0.55),
                  corner=0.22, fill=RGBColor(0x13, 0x1D, 0x44))
        add_text(s, nx + i * (w + Inches(0.15)) + Inches(0.2), ny + Inches(0.06),
                 w - Inches(0.4), Inches(0.25),
                 t, size=11, color=CYAN, font=FONT_HEAD, bold=True)
        add_text(s, nx + i * (w + Inches(0.15)) + Inches(0.2), ny + Inches(0.28),
                 w - Inches(0.4), Inches(0.25),
                 body, size=9, color=TEXT_DIM, font=FONT_BODY)


def slide_github_pipeline(prs):
    s = content_slide(prs, 12, "Ingestion")
    add_title(s, "GitHub Ingestion Pipeline",
              eyebrow="Three parallel tracks into one store")

    # Left: GitHub client
    gh = node(s, Inches(0.55), Inches(3.4),
              label="GitHub", sublabel="REST + GraphQL",
              icon="logos/github", w=Inches(2.0), h=Inches(1.35), accent=VIOLET)
    orch = node(s, Inches(9.95), Inches(3.4),
                label="GitHub Orchestrator", sublabel="orchestrator.js",
                icon="aws/Lambda", w=Inches(2.4), h=Inches(1.35), accent=CYAN)
    mongo = node(s, Inches(11.25), Inches(5.3),
                 label="MongoDB", sublabel="rag_chunks_github",
                 icon="logos/mongodb", w=Inches(1.85), h=Inches(1.25), accent=GREEN)

    # Three parallel fetcher lanes
    tracks = [
        ("Commit Fetcher", "per-branch, SHA dedupe", CYAN, Inches(2.1)),
        ("PR Fetcher", "body · reviews · comments", INDIGO, Inches(3.5)),
        ("Issue Fetcher", "body · comments", VIOLET, Inches(4.9)),
    ]
    for title, sub, color, ty in tracks:
        fetcher = node(s, Inches(3.1), ty,
                       label=title, sublabel=sub,
                       icon="logos/nodejs", w=Inches(2.3), h=Inches(1.1),
                       accent=color)
        chunker = node(s, Inches(6.05), ty,
                       label="Chunk + Embed",
                       sublabel="per-entity",
                       icon="logos/openai", w=Inches(2.3), h=Inches(1.1),
                       accent=color)
        arrow(s, gh, fetcher, color=color)
        arrow(s, fetcher, chunker, color=color)
        arrow(s, chunker, orch, color=color)

    arrow(s, orch, mongo, side_from="bottom", side_to="top", color=GREEN)

    # Key points
    add_text(s, Inches(0.55), Inches(6.55), Inches(12.1), Inches(0.4),
             "All three entity types land in a single GitHub collection with "
             "entityKey partitioning (commit:<sha>, pr:<n>, issue:<n>).",
             size=11, color=TEXT_MUTED, font=FONT_BODY, italic=True,
             align=PP_ALIGN.CENTER)


def slide_chunking(prs):
    s = content_slide(prs, 13, "Extraction")
    add_title(s, "Chunking & Embeddings",
              eyebrow="Turning raw artifacts into searchable vectors")

    # Left: conceptual pipeline
    left_w = Inches(5.6)
    add_panel(s, Inches(0.55), Inches(1.95), left_w, Inches(5.1), corner=0.08,
              fill=RGBColor(0x13, 0x1D, 0x44))
    add_text(s, Inches(0.8), Inches(2.1), left_w - Inches(0.5), Inches(0.35),
             "FROM TEXT TO VECTOR", size=11, color=CYAN, font=FONT_HEAD,
             bold=True, spacing=300)

    steps = [
        ("1  ·  Collect",
         "Pull raw issues, commits, PRs, pages, attachments."),
        ("2  ·  Normalize",
         "Extract title, description, comments; drop markup; attach metadata."),
        ("3  ·  Chunk semantically",
         "Split on natural boundaries — paragraphs, sections, comments."),
        ("4  ·  Embed",
         "OpenAI text-embedding-3-small → 1536-dim vector per chunk."),
        ("5  ·  Store",
         "Insert into MongoDB Atlas with a vector index (cosine similarity)."),
    ]
    sy = Inches(2.6)
    for t, body in steps:
        add_text(s, Inches(0.85), sy, left_w - Inches(0.5), Inches(0.35),
                 t, size=13, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, Inches(0.85), sy + Inches(0.32), left_w - Inches(0.5), Inches(0.35),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY)
        sy += Inches(0.82)

    # Right: chunker table
    tx = Inches(6.4)
    tw = Inches(6.35)
    add_panel(s, tx, Inches(1.95), tw, Inches(5.1), corner=0.08,
              fill=RGBColor(0x13, 0x1D, 0x44))
    add_text(s, tx + Inches(0.25), Inches(2.1), tw - Inches(0.5), Inches(0.35),
             "SEMANTIC CHUNKERS (PER SOURCE)", size=11, color=VIOLET,
             font=FONT_HEAD, bold=True, spacing=300)

    rows = [
        ("Jira metadata",          "key + summary + labels",           "~200 tok"),
        ("Jira description",       "paragraph split + overlap",        "300–500 tok"),
        ("Jira comments",          "group of N or single long",        "200–400 tok"),
        ("Confluence pages",       "section-header aware",             "400–600 tok"),
        ("GitHub commit msg",      "one chunk",                        "≤ 400 tok"),
        ("GitHub commit files",    "bundled file list",                "≤ 400 tok"),
        ("GitHub PR body",         "paragraph split + overlap",        "500 tok"),
        ("GitHub PR reviews",      "grouped or single",                "600 / 200 tok"),
        ("GitHub issue body",      "same as Jira description",         "500 tok"),
    ]
    ry = Inches(2.55)
    header_color = CYAN
    # header
    add_text(s, tx + Inches(0.25), ry, Inches(2.6), Inches(0.3),
             "SOURCE",  size=10, color=TEXT_MUTED, font=FONT_MONO, bold=True)
    add_text(s, tx + Inches(2.85), ry, Inches(2.7), Inches(0.3),
             "STRATEGY", size=10, color=TEXT_MUTED, font=FONT_MONO, bold=True)
    add_text(s, tx + Inches(5.3), ry, Inches(1.0), Inches(0.3),
             "SIZE", size=10, color=TEXT_MUTED, font=FONT_MONO, bold=True,
             align=PP_ALIGN.RIGHT)
    ry += Inches(0.3)

    row_h = Inches(0.38)
    for i, (src, strat, size) in enumerate(rows):
        if i % 2 == 1:
            bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                    tx + Inches(0.2), ry, tw - Inches(0.4), row_h)
            bg.line.fill.background()
            bg.fill.solid()
            bg.fill.fore_color.rgb = RGBColor(0x17, 0x24, 0x53)
        add_text(s, tx + Inches(0.25), ry + Inches(0.07),
                 Inches(2.6), Inches(0.3),
                 src, size=10, color=TEXT, font=FONT_BODY, bold=True)
        add_text(s, tx + Inches(2.85), ry + Inches(0.07),
                 Inches(2.5), Inches(0.3),
                 strat, size=10, color=TEXT_DIM, font=FONT_BODY)
        add_text(s, tx + Inches(5.3), ry + Inches(0.07),
                 Inches(1.0), Inches(0.3),
                 size, size=10, color=CYAN, font=FONT_MONO,
                 align=PP_ALIGN.RIGHT)
        ry += row_h


def slide_vector_store(prs):
    s = content_slide(prs, 14, "Storage")
    add_title(s, "Vector Store Layout",
              eyebrow="MongoDB Atlas · isolated partitions per source")

    # Two-column collection cards
    def collection_card(x, y, w, h, *, title, index, color, sample):
        add_panel(s, x, y, w, h, corner=0.08,
                  fill=RGBColor(0x13, 0x1D, 0x44))
        # header strip
        strip = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, Inches(0.08))
        strip.line.fill.background()
        fill_gradient(strip, [(0, color), (1, INDIGO)], angle=0)

        add_text(s, x + Inches(0.25), y + Inches(0.2), w - Inches(0.5), Inches(0.4),
                 title, size=18, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(0.25), y + Inches(0.6), w - Inches(0.5), Inches(0.3),
                 index, size=11, color=color, font=FONT_MONO, bold=True)

        # Meta chips
        chips = [("cosine", color), ("1536d", color), ("ANN", color)]
        cx = x + Inches(0.25)
        cy = y + Inches(1.0)
        for lbl, cl in chips:
            add_chip(s, cx, cy, lbl, color=cl, text_color=BG_DEEP,
                     width=Inches(0.8))
            cx += Inches(0.9)

        # Sample document
        add_text(s, x + Inches(0.25), y + Inches(1.55), w - Inches(0.5), Inches(0.3),
                 "SAMPLE DOCUMENT",
                 size=9, color=TEXT_MUTED, font=FONT_HEAD, bold=True, spacing=200)
        code_bg = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                     x + Inches(0.25), y + Inches(1.85),
                                     w - Inches(0.5), h - Inches(2.1))
        code_bg.adjustments[0] = 0.05
        code_bg.fill.solid()
        code_bg.fill.fore_color.rgb = BG_DEEP
        code_bg.line.color.rgb = PANEL_EDGE
        code_bg.line.width = Pt(0.5)

        add_text(s, x + Inches(0.4), y + Inches(1.95),
                 w - Inches(0.8), h - Inches(2.3),
                 sample, size=10, color=TEXT_DIM, font=FONT_MONO, line_spacing=1.25)

    y = Inches(2.0)
    h = Inches(5.1)
    collection_card(
        Inches(0.55), y, Inches(6.1), h,
        title="rag_chunks  (Jira)",
        index="vector_index", color=CYAN,
        sample=(
            "{\n"
            "  _id:        <sha256 chunk id>,\n"
            "  ticketKey:  'PROJ-123',\n"
            "  sourceType: 'description',\n"
            "  text:       '…',\n"
            "  embedding:  [0.001, 0.024, …],\n"
            "  metadata: {\n"
            "    summary:  '…',\n"
            "    status:   'In Progress',\n"
            "    labels:   ['backend'],\n"
            "    updatedAt: '2026-04-21T…'\n"
            "  }\n"
            "}"
        ),
    )
    collection_card(
        Inches(6.8), y, Inches(6.1), h,
        title="rag_chunks_github",
        index="vector_index_github", color=VIOLET,
        sample=(
            "{\n"
            "  _id:         <sha256 chunk id>,\n"
            "  entityKey:   'pr:42',\n"
            "  entityType:  'pullRequest',\n"
            "  repoFullName:'owner/name',\n"
            "  sourceType:  'body',\n"
            "  text:        '…',\n"
            "  embedding:   [0.001, …],\n"
            "  metadata: {\n"
            "    branches:   ['main'],\n"
            "    filePaths:  ['src/auth.ts'],\n"
            "    prNumber:   42\n"
            "  }\n"
            "}"
        ),
    )


def slide_retrieval(prs):
    s = content_slide(prs, 15, "Retrieval")
    add_title(s, "Retrieval / RAG Lifecycle",
              eyebrow="Answering a developer's question")

    # Horizontal flow: Client -> APIGW -> Lambda -> Embedder -> Stores -> Merge -> Answer
    y = Inches(2.6)
    items = [
        ("Client / IDE",       "POST /retrieve",        "logos/vscode",   CYAN),
        ("API Gateway",        "HTTP API",              "aws/APIGateway", CYAN),
        ("Retrieve Lambda",    "handler/retrieve.js",   "aws/Lambda",     TEAL),
        ("Embedder",           "1536-dim query vector", "logos/openai",   TEAL),
    ]

    nw = Inches(2.15)
    gap = Inches(0.2)
    x = Inches(0.55)
    nodes = []
    for i, (t, sub, ic, col) in enumerate(items):
        n = node(s, x + i * (nw + gap), y,
                 label=t, sublabel=sub,
                 icon=ic, w=nw, h=Inches(1.55), accent=col)
        nodes.append(n)
        if i > 0:
            arrow(s, nodes[i-1], n, color=col)

    # Two vector stores branching below embedder
    jira = node(s, Inches(5.0), Inches(4.9),
                label="Jira vectors", sublabel="rag_chunks",
                icon="logos/mongodb", w=Inches(2.3), h=Inches(1.2), accent=CYAN)
    gh = node(s, Inches(7.7), Inches(4.9),
              label="GitHub vectors", sublabel="rag_chunks_github",
              icon="logos/mongodb", w=Inches(2.3), h=Inches(1.2), accent=VIOLET)

    arrow(s, nodes[3], jira, side_from="bottom", side_to="top", color=CYAN)
    arrow(s, nodes[3], gh, side_from="bottom", side_to="top", color=VIOLET)

    # Merge + response panel on the right
    merge = node(s, Inches(10.3), Inches(4.9),
                 label="Score merge", sublabel="sort · clamp topK",
                 icon="logos/nodejs", w=Inches(2.4), h=Inches(1.2), accent=AMBER)
    arrow(s, jira, merge, color=AMBER)
    arrow(s, gh, merge, color=AMBER)

    # Final answer node (top right)
    answer = add_panel(s, Inches(10.3), Inches(2.6), Inches(2.4), Inches(1.55),
                       corner=0.1, border=GREEN)
    add_text(s, Inches(10.4), Inches(2.7), Inches(2.2), Inches(0.3),
             "RESPONSE", size=10, color=GREEN, font=FONT_HEAD, bold=True, spacing=300)
    add_text(s, Inches(10.4), Inches(3.0), Inches(2.2), Inches(1.1),
             "Top-K ranked chunks\nwith scores,\ncross-source context,\nand source links.",
             size=11, color=TEXT_DIM, font=FONT_BODY, line_spacing=1.3)

    arrow(s, merge, (int(Inches(11.5)), int(Inches(4.15))),
          side_from="top", color=GREEN)

    # Bottom note
    add_text(s, Inches(0.55), Inches(6.55), Inches(12.2), Inches(0.4),
             "Source=both runs the two searches in parallel, merges by score, and returns the global top-K.",
             size=11, color=TEXT_MUTED, font=FONT_BODY, italic=True,
             align=PP_ALIGN.CENTER)


# =========================================================
# STATUS SLIDES (16–19)
# =========================================================

def _status_slide(prs, page, title, eyebrow, color, items, footer_note=None):
    s = content_slide(prs, page, title)
    add_title(s, title, eyebrow=eyebrow)

    # Status badge
    badge_w = Inches(2.5)
    badge = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                               Inches(10.2), Inches(0.55),
                               badge_w, Inches(0.45))
    badge.adjustments[0] = 0.5
    badge.fill.solid()
    badge.fill.fore_color.rgb = color
    badge.line.fill.background()
    add_text(s, Inches(10.2), Inches(0.55), badge_w, Inches(0.45),
             eyebrow.upper(), size=10, color=BG_DEEP, font=FONT_HEAD,
             bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
             spacing=300)

    # Items grid — adapt row density to item count.
    cols = 2
    n = len(items)
    rows = (n + cols - 1) // cols
    x0 = Inches(0.55)
    y0 = Inches(2.0)
    card_w = Inches(6.05)
    gap_x = Inches(0.2)
    gap_y = Inches(0.15)
    # Shrink cards if there are a lot of items so nothing runs off-slide.
    if rows >= 4:
        card_h = Inches(1.05)
    elif rows == 3:
        card_h = Inches(1.25)
    else:
        card_h = Inches(1.4)

    for i, (title_i, body_i) in enumerate(items):
        r, c = divmod(i, cols)
        x = x0 + c * (card_w + gap_x)
        y = y0 + r * (card_h + gap_y)
        add_panel(s, x, y, card_w, card_h, corner=0.08)
        # color marker
        marker = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                    x + Inches(0.15), y + Inches(0.3),
                                    Inches(0.18), Inches(0.65))
        marker.adjustments[0] = 0.5
        marker.fill.solid()
        marker.fill.fore_color.rgb = color
        marker.line.fill.background()

        title_size = 13 if rows >= 4 else 14
        body_size = 10 if rows >= 4 else 11
        add_text(s, x + Inches(0.55), y + Inches(0.14),
                 card_w - Inches(0.75), Inches(0.35),
                 title_i, size=title_size, color=TEXT,
                 font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(0.55), y + Inches(0.45),
                 card_w - Inches(0.75), card_h - Inches(0.5),
                 body_i, size=body_size, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.25)

    if footer_note:
        y_note = y0 + rows * (card_h + gap_y) + Inches(0.1)
        # Clamp to stay above footer bar (~7.1").
        if y_note > Inches(7.0):
            y_note = Inches(6.8)
        add_text(s, Inches(0.55), y_note, Inches(12.2), Inches(0.4),
                 footer_note, size=11, color=TEXT_MUTED, font=FONT_BODY,
                 italic=True, align=PP_ALIGN.CENTER)


def slide_completed(prs):
    _status_slide(
        prs, 16, "What is Completed", "Completed", GREEN,
        items=[
            ("System architecture designed",
             "Five-layer cloud-hosted agentic framework with ingestion, extraction, reasoning, orchestration and IDE layers."),
            ("Artifact ingestion — Jira / Confluence",
             "Streams issues, comments, attachments, remote-linked Confluence pages with retry + pagination."),
            ("Artifact ingestion — GitHub",
             "Pulls commits, pull requests and issues across active branches via REST + GraphQL."),
            ("Normalization pipeline",
             "Heterogeneous payloads → unified ticket / entity shape ready for downstream processing."),
            ("Semantic chunking",
             "Source-aware splitter with deterministic SHA chunk IDs — safe to re-run."),
            ("Embedding + vector store",
             "OpenAI text-embedding-3-small → MongoDB Atlas vector search, two isolated collections."),
            ("Ticket ↔ commit linkage (v1)",
             "Metadata + embedding similarity gives a working first-pass correlation."),
            ("Ops infra: locks, checkpoints, CLI",
             "Redis-backed per-source state, distributed lock, and a local CLI that reuses Lambda handlers."),
        ],
        footer_note=(
            "This covers the Requirement Analysis, Architecture Design, "
            "and Prototype Phase I milestones from the plan of work."
        ),
    )


def slide_in_progress(prs):
    _status_slide(
        prs, 17, "In Progress", "In progress", AMBER,
        items=[
            ("Semantic linking refinement",
             "Tuning how requirements and code changes are associated when no ticket ID is present."),
            ("Hybrid metadata + vector matching",
             "Combining explicit signals (ticket IDs, file paths) with embedding similarity for robustness."),
            ("Handling complex / indirect relationships",
             "Improving recall when multiple commits contribute to one requirement."),
            ("Retrieval quality tuning",
             "Adjusting topK, filters and cross-source merging to surface the most useful chunks."),
        ],
    )


def slide_pending(prs):
    _status_slide(
        prs, 18, "Pending / Next Phase", "Pending", RED,
        items=[
            ("Semantic reasoning pipeline",
             "LLM workflows that interpret requirements and generate 'why' explanations for code."),
            ("Deep intent inference",
             "Multi-artifact reasoning that handles indirect dependencies and chains of changes."),
            ("Full multi-agent orchestration",
             "Traceability, Code-Intent, Reproduction and Validation agents with task decomposition + synthesis."),
            ("IDE plugin / extension",
             "Inline UI for intent explanations, traceability links, and reproduction guidance."),
            ("Issue reproduction agent",
             "Automated generation of steps to recreate a reported defect from available artifacts."),
            ("Validation agent",
             "Reasoning over whether a proposed fix actually resolves the original requirement."),
        ],
    )


def slide_plan_of_work(prs):
    s = content_slide(prs, 19, "Plan of Work")
    add_title(s, "Plan of Work  ·  Jan – May 2026",
              eyebrow="Timeline and status")

    phases = [
        ("Dissertation Outline & Proposal",
         "20 Jan – 07 Feb", 0.00, 0.13, "DONE", GREEN),
        ("Requirement Analysis & Architecture",
         "08 Feb – 28 Feb", 0.13, 0.32, "DONE", GREEN),
        ("Prototype I — Artifact Integration",
         "01 Mar – 20 Mar", 0.32, 0.50, "DONE", GREEN),
        ("Midterm Report Preparation",
         "21 Mar – 28 Mar", 0.50, 0.58, "DONE", GREEN),
        ("Prototype II — Agentic Reasoning",
         "29 Mar – 20 Apr", 0.58, 0.76, "NOW", AMBER),
        ("Testing, Validation & Evaluation",
         "21 Apr – 05 May", 0.76, 0.88, "NEXT", RED),
        ("Final Dissertation Writing",
         "06 May – 11 May", 0.88, 0.98, "NEXT", RED),
        ("Final Submission",
         "12 May",          0.98, 1.00, "NEXT", RED),
    ]

    track_x = Inches(5.1)
    track_w = Inches(7.5)
    y0 = Inches(2.1)
    row_h = Inches(0.48)

    # Month ruler
    add_text(s, track_x, Inches(1.75), track_w, Inches(0.3),
             "JAN        FEB         MAR         APR          MAY",
             size=10, color=TEXT_MUTED, font=FONT_MONO, spacing=200)
    # divider line
    ln = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                            track_x, Inches(2.0),
                            track_w, Emu(9525))
    ln.line.fill.background()
    ln.fill.solid()
    ln.fill.fore_color.rgb = PANEL_EDGE

    # monthly grid ticks
    months = 5
    for i in range(months + 1):
        tx = track_x + Emu(int(track_w * (i / months)))
        tick = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                  tx, Inches(2.0), Emu(9525), Inches(4.2))
        tick.line.fill.background()
        tick.fill.solid()
        tick.fill.fore_color.rgb = RGBColor(0x1B, 0x26, 0x55)

    for i, (name, daterange, start, end, status, color) in enumerate(phases):
        y = y0 + i * row_h

        # Name + date (left column)
        add_text(s, Inches(0.55), y, Inches(3.9), Inches(0.28),
                 name, size=11, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, Inches(0.55), y + Inches(0.24), Inches(3.9), Inches(0.22),
                 daterange, size=9, color=TEXT_MUTED, font=FONT_MONO)

        # Status chip
        add_chip(s, Inches(4.45), y + Inches(0.04), status,
                 color=color, text_color=BG_DEEP, width=Inches(0.6))

        # Bar
        bar_x = track_x + Emu(int(track_w * start))
        bar_w = Emu(max(int(track_w * (end - start)), Inches(0.1)))
        bar_h = Inches(0.34)
        bar = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                 bar_x, y, bar_w, bar_h)
        bar.adjustments[0] = 0.3
        bar.fill.solid()
        bar.fill.fore_color.rgb = color
        bar.line.fill.background()

    # Today marker vertical line at ~Apr 21 (month idx 3 + 21/30)
    today_frac = (3 + 21 / 30) / months   # ~ 0.74
    tx = track_x + Emu(int(track_w * today_frac))
    tline = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                               tx, Inches(2.0), Emu(19050), Inches(4.2))
    tline.line.fill.background()
    tline.fill.solid()
    tline.fill.fore_color.rgb = CYAN
    add_text(s, tx - Inches(0.35), Inches(6.25), Inches(0.7), Inches(0.25),
             "TODAY", size=9, color=CYAN, font=FONT_HEAD, bold=True,
             align=PP_ALIGN.CENTER, spacing=200)

    # Legend
    leg_y = Inches(6.55)
    lx = Inches(0.55)
    for lbl, cl in [("Done", GREEN), ("In progress", AMBER), ("Pending", RED)]:
        dot = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                 lx, leg_y, Inches(0.22), Inches(0.22))
        dot.fill.solid()
        dot.fill.fore_color.rgb = cl
        dot.line.fill.background()
        add_text(s, lx + Inches(0.3), leg_y, Inches(1.5), Inches(0.25),
                 lbl, size=11, color=TEXT_DIM, font=FONT_BODY)
        lx += Inches(1.7)


# =========================================================
# OUTRO SLIDES (20–22)
# =========================================================

def slide_observations(prs):
    s = content_slide(prs, 20, "Observations")
    add_title(s, "Preliminary Observations",
              eyebrow="What the midterm prototype already shows")

    items = [
        ("Unified access",
         "Jira and GitHub artifacts now live in a single pipeline — no more\n"
         "multi-tool swivel-chair just to find context.", CYAN),
        ("Better than keyword search",
         "Vector embeddings retrieve related commits even when the ticket ID\n"
         "is not referenced in the commit message.", VIOLET),
        ("Structured knowledge substrate",
         "Raw artifacts become normalized, chunked, embedded documents —\n"
         "ready for downstream LLM reasoning.", TEAL),
        ("Idempotent, crash-safe runs",
         "Deterministic chunk IDs + delete-then-insert make ingestion\n"
         "safe to re-run without duplicating data.", GREEN),
        ("Quality is bounded by artifact quality",
         "Clear tickets + descriptive commit messages materially improve\n"
         "retrieval relevance. Noise hurts.", AMBER),
    ]

    # 2 rows: 3 + 2 layout
    x0 = Inches(0.55)
    y0 = Inches(1.9)
    card_w = Inches(4.12)
    card_h = Inches(2.35)
    gap_x = Inches(0.2)
    gap_y = Inches(0.15)

    for i, (title_i, body_i, color) in enumerate(items):
        if i < 3:
            x = x0 + i * (card_w + gap_x)
            y = y0
        else:
            # Second row center 2 cards
            idx = i - 3
            row_start = x0 + (card_w + gap_x) * 0.5
            x = row_start + idx * (card_w + gap_x)
            y = y0 + card_h + gap_y

        add_panel(s, x, y, card_w, card_h, corner=0.1)
        # top accent
        strip = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                   x, y, card_w, Emu(38100))
        strip.line.fill.background()
        fill_gradient(strip, [(0, color), (1, INDIGO)], angle=0)

        add_text(s, x + Inches(0.3), y + Inches(0.3), card_w - Inches(0.5), Inches(0.4),
                 title_i, size=15, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(0.3), y + Inches(0.85),
                 card_w - Inches(0.5), card_h - Inches(1.1),
                 body_i, size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.4)


def slide_challenges(prs):
    s = content_slide(prs, 21, "Challenges")
    add_title(s, "Challenges Encountered",
              eyebrow="The hard parts of reconstructing intent")

    items = [
        ("NL ↔ code semantic gap",
         "Requirements are high-level and informal; code is low-level and precise. "
         "Bridging the two needs more than keyword or shallow-similarity matching."),
        ("Noisy, inconsistent artifacts",
         "Commits with 'minor fix' messages, vague ticket descriptions and ad-hoc "
         "documentation practices reduce the signal our embeddings can capture."),
        ("Incomplete traceability",
         "Commits often don't reference ticket IDs. One requirement can span many "
         "commits; one commit can address many tickets. Explicit links are rare."),
        ("Heterogeneous data sources",
         "Each platform has its own schema, pagination quirks and rate limits. "
         "Normalising across them while preserving meaning is non-trivial."),
    ]

    x0 = Inches(0.55)
    y0 = Inches(1.95)
    card_w = Inches(6.05)
    card_h = Inches(2.35)
    gap_x = Inches(0.2)
    gap_y = Inches(0.18)
    colors = [AMBER, RED, VIOLET, CYAN]

    for i, ((title_i, body_i), color) in enumerate(zip(items, colors)):
        r, c = divmod(i, 2)
        x = x0 + c * (card_w + gap_x)
        y = y0 + r * (card_h + gap_y)
        add_panel(s, x, y, card_w, card_h, corner=0.08)

        # Warning-style number badge
        badge = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                   x + Inches(0.3), y + Inches(0.3),
                                   Inches(0.55), Inches(0.55))
        badge.fill.solid()
        badge.fill.fore_color.rgb = color
        badge.line.fill.background()
        add_text(s, x + Inches(0.3), y + Inches(0.3),
                 Inches(0.55), Inches(0.55),
                 f"!", size=22, color=BG_DEEP, font=FONT_HEAD, bold=True,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

        add_text(s, x + Inches(1.05), y + Inches(0.32),
                 card_w - Inches(1.25), Inches(0.5),
                 title_i, size=16, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(1.05), y + Inches(0.85),
                 card_w - Inches(1.25), card_h - Inches(1.0),
                 body_i, size=12, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.4)


def slide_conclusion(prs):
    s = content_slide(prs, 22, "Conclusion")
    add_title(s, "Conclusion & Next Steps",
              eyebrow="Where we are · where we go")

    # Left: conclusion summary
    add_panel(s, Inches(0.55), Inches(1.95), Inches(7.2), Inches(4.2), corner=0.08)
    add_text(s, Inches(0.85), Inches(2.1), Inches(6.6), Inches(0.4),
             "MIDTERM SUMMARY", size=11, color=CYAN, font=FONT_HEAD,
             bold=True, spacing=300)
    add_text(s, Inches(0.85), Inches(2.45), Inches(6.6), Inches(0.7),
             "We built the foundations of an intent-aware developer tool.",
             size=18, color=TEXT, font=FONT_HEAD, bold=True, line_spacing=1.25)

    add_bullet(s, Inches(0.85), Inches(3.4), Inches(6.6), Inches(2.6),
               [
                   "Ingestion pipelines for Jira, Confluence and GitHub are live.",
                   "Artifacts are normalized, chunked, embedded and stored.",
                   "A RAG-style retrieval API answers cross-source semantic queries.",
                   "Redis-backed state makes runs resumable, locked and crash-safe.",
                   "Architecture is cloud-native (AWS Lambda + VPC + Atlas).",
               ],
               size=13, color=TEXT_DIM, bullet="▸", bullet_color=CYAN,
               line_spacing=1.4)

    # Right: next steps + Q&A CTA
    add_panel(s, Inches(8.05), Inches(1.95), Inches(4.75), Inches(4.2),
              corner=0.08, fill=RGBColor(0x1A, 0x16, 0x44), border=VIOLET)
    add_text(s, Inches(8.3), Inches(2.1), Inches(4.3), Inches(0.4),
             "NEXT", size=11, color=VIOLET, font=FONT_HEAD, bold=True, spacing=300)
    add_text(s, Inches(8.3), Inches(2.45), Inches(4.3), Inches(0.7),
             "Reason · Orchestrate · Deliver",
             size=18, color=TEXT, font=FONT_HEAD, bold=True)

    add_bullet(s, Inches(8.3), Inches(3.25), Inches(4.3), Inches(2.9),
               [
                   "Semantic reasoning with LLMs",
                   "Traceability & Code-Intent agents",
                   "Reproduction + validation agents",
                   "IDE plugin delivering inline context",
                   "Evaluation on production repos",
               ],
               size=13, color=TEXT_DIM, bullet="▸", bullet_color=VIOLET,
               line_spacing=1.5)

    # Thank you + Q&A strip
    cta = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                             Inches(0.55), Inches(6.3),
                             Inches(12.25), Inches(0.75))
    cta.adjustments[0] = 0.3
    cta.line.fill.background()
    fill_gradient(cta, [(0, INDIGO), (0.5, VIOLET), (1, CYAN)], angle=0)
    add_text(s, Inches(0.55), Inches(6.3), Inches(12.25), Inches(0.75),
             "Thank you  ·  Questions welcome",
             size=20, color=WHITE, font=FONT_HEAD, bold=True,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


# ---------------------------------------------------------
# Main
# ---------------------------------------------------------

def build():
    prs = new_deck()
    slide_title(prs)
    slide_agenda(prs)
    slide_context(prs)
    slide_problem(prs)
    slide_why_hurts(prs)
    slide_problem_statement(prs)
    slide_objectives(prs)
    slide_solution_glance(prs)
    slide_highlevel_arch(prs)
    slide_aws_topology(prs)
    slide_jira_pipeline(prs)
    slide_github_pipeline(prs)
    slide_chunking(prs)
    slide_vector_store(prs)
    slide_retrieval(prs)
    slide_completed(prs)
    slide_in_progress(prs)
    slide_pending(prs)
    slide_plan_of_work(prs)
    slide_observations(prs)
    slide_challenges(prs)
    slide_conclusion(prs)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    size_kb = OUT.stat().st_size // 1024
    print(f"Wrote {OUT} ({size_kb} KB)")


if __name__ == "__main__":
    build()
