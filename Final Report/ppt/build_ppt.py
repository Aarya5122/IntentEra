"""Build the IntentEra final-defence dissertation presentation.

Run:
    python "Final Report/ppt/build_ppt.py"

Output:
    Final Report/Final_Presentation_2024MT03013.pptx

The slides are sourced 1:1 from "Final Report/2024MT03013 2.pdf".
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
    BG_DEEP, BG_MID, BG_SOFT, PANEL, PANEL_ALT, PANEL_EDGE, PANEL_EDGE_SOFT,
    INDIGO, VIOLET, CYAN, TEAL, AMBER, GREEN, RED, ROSE,
    TEXT, TEXT_DIM, TEXT_MUTED, WHITE,
    FONT_HEAD, FONT_BODY, FONT_MONO,
    add_background, add_accent_bar, add_footer, add_title,
    add_text, add_panel, add_chip, add_outline_chip, add_bullet,
    add_section_cover, add_metric_card, add_image_with_caption,
    add_two_col, add_kicker, fill_gradient,
    figure, screenshot,
)
from diagrams import node, arrow, lane, layer_band


# ---------------------------------------------------------
# Deck scaffolding
# ---------------------------------------------------------

TOTAL_SLIDES = 32
OUT = Path(__file__).parent.parent / "Final_Presentation_2024MT03013.pptx"


def new_deck() -> Presentation:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    return prs


def blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def content_slide(prs, page: int, section: str = ""):
    s = blank(prs)
    add_background(s, "content")
    add_accent_bar(s)
    add_footer(s, page, TOTAL_SLIDES, section)
    return s


# ---------------------------------------------------------
# 1 — Title
# ---------------------------------------------------------

def slide_title(prs):
    s = blank(prs)
    add_background(s, "title")

    # Decorative glow rings (top-right)
    for size_in, color in [(8.0, INDIGO), (5.6, VIOLET), (3.6, CYAN)]:
        r = Inches(size_in)
        ring = s.shapes.add_shape(
            MSO_SHAPE.OVAL,
            Inches(10.7) - r // 2, Inches(3.2) - r // 2, r, r,
        )
        ring.fill.background()
        ring.line.color.rgb = color
        ring.line.width = Pt(1.0)

    # Eyebrow
    add_text(s, Inches(0.8), Inches(0.7), Inches(11), Inches(0.4),
             "M.TECH CLOUD COMPUTING  ·  WILP DISSERTATION CCZG628T  ·  FINAL DEFENCE",
             size=12, color=CYAN, font=FONT_HEAD, bold=True, spacing=300)

    # Big title
    add_text(s, Inches(0.8), Inches(1.25), Inches(12), Inches(2.0),
             "Semantic Reconstruction\nof Software Intent",
             size=52, color=TEXT, font=FONT_HEAD, bold=True,
             line_spacing=1.05)

    # Subtitle
    add_text(s, Inches(0.8), Inches(3.65), Inches(11.5), Inches(1.1),
             "A Cloud-Hosted Agentic AI Solution for the Study of\n"
             "Requirement Traceability in Production-Grade Codebases",
             size=20, color=TEXT_DIM, font=FONT_BODY, italic=True,
             line_spacing=1.25)

    # Gradient underline
    underline = s.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(5.2),
        Inches(3.4), Emu(57150),
    )
    underline.line.fill.background()
    fill_gradient(underline, [(0, CYAN), (0.6, INDIGO), (1, VIOLET)], angle=0)

    # Author panel (left)
    add_panel(s, Inches(0.8), Inches(5.45), Inches(6.0), Inches(1.5),
              fill=RGBColor(0x10, 0x18, 0x3A), border=PANEL_EDGE, corner=0.10)
    add_text(s, Inches(1.0), Inches(5.55), Inches(5.6), Inches(0.3),
             "CANDIDATE",
             size=10, color=CYAN, font=FONT_HEAD, bold=True, spacing=300)
    add_text(s, Inches(1.0), Inches(5.85), Inches(5.6), Inches(0.4),
             "Aarya Nanndaann Singh M N",
             size=20, color=TEXT, font=FONT_HEAD, bold=True)
    add_text(s, Inches(1.0), Inches(6.25), Inches(5.6), Inches(0.3),
             "BITS ID  ·  2024MT03013   |   M.Tech Cloud Computing",
             size=11, color=TEXT_DIM, font=FONT_MONO)
    add_text(s, Inches(1.0), Inches(6.55), Inches(5.6), Inches(0.3),
             "Aqueralabs India Pvt Ltd, Bangalore",
             size=11, color=TEXT_MUTED, font=FONT_BODY, italic=True)

    # Supervisor / examiner panel (right)
    add_panel(s, Inches(7.0), Inches(5.45), Inches(5.5), Inches(1.5),
              fill=RGBColor(0x10, 0x18, 0x3A), border=PANEL_EDGE, corner=0.10)
    add_text(s, Inches(7.2), Inches(5.55), Inches(5.1), Inches(0.3),
             "SUPERVISOR  ·  EXAMINER  ·  MENTOR",
             size=10, color=VIOLET, font=FONT_HEAD, bold=True, spacing=300)
    add_text(s, Inches(7.2), Inches(5.85), Inches(5.1), Inches(0.34),
             "Mr. Hanumanthu Indrakanti — Director of Engineering",
             size=12, color=TEXT, font=FONT_BODY, bold=True)
    add_text(s, Inches(7.2), Inches(6.18), Inches(5.1), Inches(0.34),
             "Mr. Deepan Kumar — Staff Engineer",
             size=12, color=TEXT, font=FONT_BODY, bold=True)
    add_text(s, Inches(7.2), Inches(6.51), Inches(5.1), Inches(0.34),
             "Mr. Paresh Saxena — BITS Pilani Faculty Mentor",
             size=12, color=TEXT, font=FONT_BODY, bold=True)

    # Bottom strip — institute and date
    add_text(s, Inches(0.8), Inches(7.05), Inches(12), Inches(0.32),
             "Birla Institute of Technology and Science, Pilani  ·  WILP Division  ·  May 2026",
             size=10, color=TEXT_MUTED, font=FONT_BODY, spacing=150)


# ---------------------------------------------------------
# 2 — Agenda
# ---------------------------------------------------------

def slide_agenda(prs):
    s = content_slide(prs, 2, "Agenda")
    add_title(s, "What we will cover today",
              eyebrow="Roadmap  ·  6 sections  ·  ~28 minutes")

    sections = [
        ("01", "The Problem",
         "Intent erosion in production codebases\nWhy code-only is not enough",
         CYAN),
        ("02", "Architecture",
         "Five-layer reference architecture\nOn AWS + MongoDB Atlas + OpenAI",
         INDIGO),
        ("03", "Chunking, Embeddings, Retrieval",
         "Section-aware chunks · 1536-d embeddings\nMulti-query RAG with max-pool",
         VIOLET),
        ("04", "IDE Integration & Cloud",
         "VS Code / Cursor extension + loopback git agent\nAWS Lambdas, EventBridge, Secrets Manager",
         TEAL),
        ("05", "Evaluation & Metrics",
         "Functional checks · retrieval quality\nLatency, cost and cognitive-load study",
         AMBER),
        ("06", "What's Next",
         "Honest limitations · current improvements\nFive directions for future work",
         GREEN),
    ]
    cols = 3
    rows = 2
    cell_w = Inches(4.05)
    cell_h = Inches(2.45)
    gap_x = Inches(0.18)
    gap_y = Inches(0.30)
    grid_w = cols * cell_w + (cols - 1) * gap_x
    start_x = (SLIDE_W - grid_w) // 2
    start_y = Inches(2.0)

    for i, (num, title, body, color) in enumerate(sections):
        r = i // cols
        c = i % cols
        x = start_x + c * (cell_w + gap_x)
        y = start_y + r * (cell_h + gap_y)
        add_panel(s, x, y, cell_w, cell_h, fill=PANEL,
                  border=PANEL_EDGE, corner=0.08)
        # accent bar
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y,
                                 cell_w, Emu(45720))
        bar.line.fill.background()
        fill_gradient(bar, [(0, color), (1, INDIGO)], angle=0)
        # number
        add_text(s, x + Inches(0.25), y + Inches(0.22), Inches(1.5),
                 Inches(0.6),
                 num,
                 size=34, color=color, font=FONT_HEAD, bold=True,
                 line_spacing=1.0)
        add_text(s, x + Inches(0.25), y + Inches(0.92),
                 cell_w - Inches(0.5), Inches(0.45),
                 title,
                 size=16, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(0.25), y + Inches(1.45),
                 cell_w - Inches(0.5), Inches(1.0),
                 body,
                 size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.30)


# ---------------------------------------------------------
# 3 — Section: The Problem
# ---------------------------------------------------------

def slide_section_problem(prs):
    s = blank(prs)
    add_section_cover(s,
                      eyebrow="Section 01  ·  Chapters 1 & 3",
                      title="The Problem.",
                      subtitle="Source code answers what. The interesting question is why.")
    add_footer(s, 3, TOTAL_SLIDES, "The Problem")


# ---------------------------------------------------------
# 4 — Intent erosion
# ---------------------------------------------------------

def slide_intent_erosion(prs):
    s = content_slide(prs, 4, "The Problem · Ch 1.1")
    add_title(s, "Intent erosion: rationale gets lost over time",
              eyebrow="Phenomenon")

    # Left: definition card
    def_card = add_panel(s, Inches(0.6), Inches(2.0), Inches(6.0),
                         Inches(2.4), fill=PANEL_ALT, border=PANEL_EDGE,
                         corner=0.08)
    add_text(s, Inches(0.85), Inches(2.18), Inches(5.5), Inches(0.34),
             "DEFINITION",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, Inches(0.85), Inches(2.55), Inches(5.5), Inches(1.7),
             "The progressive loss of contextual rationale behind "
             "code as time passes — as authors leave the organisation "
             "and as artifacts become stale or scattered.",
             size=15, color=TEXT, font=FONT_BODY, italic=True,
             line_spacing=1.35)

    # Right: symptoms list
    add_text(s, Inches(7.0), Inches(2.0), Inches(5.8), Inches(0.34),
             "OBSERVABLE COST",
             size=11, color=AMBER, font=FONT_HEAD, bold=True, spacing=200)
    add_bullet(s, Inches(7.0), Inches(2.4), Inches(5.8), Inches(2.0),
               [
                   "Long onboarding ramps for new joiners",
                   "Recurring bugs that re-introduce previously fixed regressions",
                   "Cognitive load of \"context archaeology\" through tickets, commits and chat",
                   "Architectural decisions repeated because the why was never recorded",
               ],
               size=14, color=TEXT_DIM, bullet_color=AMBER,
               line_spacing=1.40)

    # Bottom strip — the why questions
    strip = add_panel(s, Inches(0.6), Inches(4.7), Inches(12.1),
                      Inches(2.0), fill=PANEL, border=PANEL_EDGE,
                      corner=0.06)
    add_text(s, Inches(0.85), Inches(4.85), Inches(11.6), Inches(0.34),
             "THE WHY QUESTIONS THAT SOURCE CODE ALONE CANNOT ANSWER",
             size=11, color=VIOLET, font=FONT_HEAD, bold=True, spacing=200)

    questions = [
        "Why was this written this way?",
        "Which requirement triggered this change?",
        "Does the fix actually resolve the original defect?",
        "How does this interact with previous decisions?",
    ]
    qx = Inches(0.85)
    qy = Inches(5.30)
    chip_w = (Inches(11.6) - Inches(0.45)) // 4
    for i, q in enumerate(questions):
        x = qx + i * (chip_w + Inches(0.15))
        add_panel(s, x, qy, chip_w, Inches(1.20),
                  fill=PANEL_ALT, border=PANEL_EDGE_SOFT, corner=0.10)
        add_text(s, x + Inches(0.18), qy + Inches(0.30),
                 chip_w - Inches(0.36), Inches(0.7),
                 q,
                 size=12, color=TEXT, font=FONT_BODY, italic=True,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
                 line_spacing=1.25)


# ---------------------------------------------------------
# 5 — Problem setting at Aqueralabs
# ---------------------------------------------------------

def slide_problem_setting(prs):
    s = content_slide(prs, 5, "The Problem · Ch 1.2")
    add_title(s, "The reality at Aqueralabs: knowledge lives in silos",
              eyebrow="Problem setting")

    # Four source cards across the top
    sources = [
        ("Atlassian Jira", "Requirements\n& incident tickets", CYAN),
        ("Confluence", "Design docs\n& meeting notes", INDIGO),
        ("GitHub", "Commits, PRs\n& review threads", VIOLET),
        ("CI / CD", "Build, validation\n& deployment", TEAL),
    ]
    card_w = Inches(2.85)
    card_h = Inches(1.65)
    gap = Inches(0.25)
    total_w = 4 * card_w + 3 * gap
    start_x = (SLIDE_W - total_w) // 2
    y_top = Inches(2.0)

    for i, (name, sub, color) in enumerate(sources):
        x = start_x + i * (card_w + gap)
        add_panel(s, x, y_top, card_w, card_h,
                  fill=PANEL, border=PANEL_EDGE, corner=0.10)
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y_top,
                                 card_w, Emu(38100))
        bar.line.fill.background()
        fill_gradient(bar, [(0, color), (1, INDIGO)], angle=0)
        add_text(s, x + Inches(0.15), y_top + Inches(0.18),
                 card_w - Inches(0.3), Inches(0.5),
                 name, size=16, color=TEXT, font=FONT_HEAD,
                 bold=True, align=PP_ALIGN.CENTER)
        add_text(s, x + Inches(0.15), y_top + Inches(0.78),
                 card_w - Inches(0.3), Inches(0.85),
                 sub, size=11, color=TEXT_DIM, font=FONT_BODY,
                 align=PP_ALIGN.CENTER, line_spacing=1.30)

    # Arrow / collapse panel
    add_panel(s, Inches(0.6), Inches(4.05), Inches(12.1), Inches(2.7),
              fill=PANEL_ALT, border=PANEL_EDGE, corner=0.08)
    add_text(s, Inches(0.85), Inches(4.20), Inches(11.6), Inches(0.34),
             "THE DAILY JOIN PROBLEM",
             size=11, color=AMBER, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, Inches(0.85), Inches(4.55), Inches(11.6), Inches(0.85),
             "The rationale behind any non-trivial code change is split "
             "across three or more of these platforms.",
             size=18, color=TEXT, font=FONT_HEAD, bold=True,
             line_spacing=1.25)
    add_text(s, Inches(0.85), Inches(5.45), Inches(11.6), Inches(1.2),
             "New joiners and contributors perform the same mental joins "
             "repeatedly, often with incomplete information. We needed a "
             "semantic intermediary that ingests once, reconstructs intent "
             "on demand, and surfaces it inside the developer's existing tooling.",
             size=14, color=TEXT_DIM, font=FONT_BODY,
             line_spacing=1.35, italic=True)


# ---------------------------------------------------------
# 6 — Formal problem & objectives
# ---------------------------------------------------------

def slide_formal_problem_objectives(prs):
    s = content_slide(prs, 6, "The Problem · Ch 3")
    add_title(s, "Formal statement and dissertation objectives",
              eyebrow="What we set out to do")

    # Left: formal statement card with the (R, C, D, q) -> (E, S) callout
    add_panel(s, Inches(0.6), Inches(2.0), Inches(5.7), Inches(4.7),
              fill=PANEL, border=PANEL_EDGE, corner=0.08)
    add_text(s, Inches(0.85), Inches(2.18), Inches(5.2), Inches(0.34),
             "FORMAL STATEMENT",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, Inches(0.85), Inches(2.55), Inches(5.2), Inches(0.5),
             "Given",
             size=14, color=TEXT_MUTED, font=FONT_BODY)
    # nice equation chip
    eq_card = add_panel(s, Inches(0.85), Inches(3.0), Inches(5.2),
                        Inches(1.0), fill=BG_DEEP, border=INDIGO,
                        corner=0.18)
    add_text(s, Inches(0.85), Inches(3.0), Inches(5.2), Inches(1.0),
             "(R, C, D, q)  →  (E, S)",
             size=22, color=CYAN, font=FONT_MONO, bold=True,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

    add_bullet(s, Inches(0.85), Inches(4.20), Inches(5.2), Inches(2.4),
               [
                   "R — requirement-bearing artifacts (Jira, Confluence)",
                   "C — code-related artifacts (commits, PRs, reviews)",
                   "D — developer's working tree, file f, range ⟨a, b⟩",
                   "q — natural-language question from the developer",
                   "E — explanation in plain language",
                   "S — citation set, every claim attributable to it",
               ],
               size=11, color=TEXT_DIM, bullet_color=VIOLET,
               line_spacing=1.30)

    # Right: 5 distilled objectives
    add_text(s, Inches(6.7), Inches(2.0), Inches(6.0), Inches(0.34),
             "OBJECTIVES",
             size=11, color=AMBER, font=FONT_HEAD, bold=True, spacing=200)

    objs = [
        ("Characterise", "intent erosion with concrete examples from production"),
        ("Design", "a semantic reconstruction framework — metadata + embeddings"),
        ("Architect", "a cloud-hosted agentic AI system combining RAG + multi-agent reasoning"),
        ("Integrate", "with VS Code and Cursor — no context-switching"),
        ("Evaluate", "functional correctness, operating cost and cognitive-load impact"),
    ]
    oy = Inches(2.4)
    for i, (head, body) in enumerate(objs):
        y = oy + i * Inches(0.86)
        # number bubble
        num = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                 Inches(6.7), y + Inches(0.08),
                                 Inches(0.55), Inches(0.55))
        num.fill.solid()
        num.fill.fore_color.rgb = INDIGO
        num.line.fill.background()
        tf = num.text_frame
        tf.margin_left = tf.margin_right = Inches(0)
        tf.margin_top = tf.margin_bottom = Inches(0)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = str(i + 1)
        r.font.name = FONT_HEAD
        r.font.size = Pt(14)
        r.font.bold = True
        r.font.color.rgb = TEXT
        # text
        add_text(s, Inches(7.40), y + Inches(0.04), Inches(5.3),
                 Inches(0.32),
                 head,
                 size=13, color=CYAN, font=FONT_HEAD, bold=True)
        add_text(s, Inches(7.40), y + Inches(0.36), Inches(5.3),
                 Inches(0.6),
                 body,
                 size=12, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.25)


# ---------------------------------------------------------
# 7 — Literature snapshot
# ---------------------------------------------------------

def slide_literature(prs):
    s = content_slide(prs, 7, "Literature · Ch 2")
    add_title(s, "Standing on four lines of prior work — and finding the gap",
              eyebrow="Literature snapshot")

    cards = [
        ("[1] Guo et al. (2024)",
         "NLP for Requirements Traceability",
         "Entity-aware preprocessing materially "
         "improves link quality vs. plain lexical search.",
         "Adopted in the Jira normaliser and section-aware chunker.",
         CYAN),
        ("[2] Wang, Zou, Wan et al. (2024)",
         "Empirical Study on Req-to-Code Link Recovery",
         "No single technique dominates; "
         "hybrid IR + neural approaches win.",
         "Drove the structured-metadata + vector hybrid query design.",
         INDIGO),
        ("[3] Ali, Naganathan, Bork (2024)",
         "RAG for Traceability",
         "Retrieve, then generate with retrieved "
         "context as grounding.",
         "Conceptual blueprint for the IntentEra reasoning engine.",
         VIOLET),
        ("[4][5] Ahmad et al. / Kanade et al.",
         "Transformers for Code",
         "Reusable embedding spaces for software "
         "engineering tasks without per-project tuning.",
         "Justifies pluggable embedder; OpenAI text-emb-3-small today.",
         TEAL),
    ]

    cw = Inches(5.95)
    ch = Inches(1.95)
    gap_x = Inches(0.20)
    gap_y = Inches(0.20)
    sx = (SLIDE_W - 2 * cw - gap_x) // 2
    sy = Inches(1.95)
    for i, (ref, title, finding, impact, color) in enumerate(cards):
        col = i % 2
        row = i // 2
        x = sx + col * (cw + gap_x)
        y = sy + row * (ch + gap_y)
        add_panel(s, x, y, cw, ch, fill=PANEL, border=PANEL_EDGE, corner=0.08)
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, cw, Emu(38100))
        bar.line.fill.background()
        fill_gradient(bar, [(0, color), (1, INDIGO)], angle=0)
        add_text(s, x + Inches(0.18), y + Inches(0.16),
                 cw - Inches(0.36), Inches(0.28),
                 ref,
                 size=10, color=color, font=FONT_MONO, bold=True, spacing=150)
        add_text(s, x + Inches(0.18), y + Inches(0.42),
                 cw - Inches(0.36), Inches(0.4),
                 title,
                 size=14, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(0.18), y + Inches(0.85),
                 cw - Inches(0.36), Inches(0.55),
                 finding,
                 size=11, color=TEXT_DIM, font=FONT_BODY, italic=True,
                 line_spacing=1.25)
        add_text(s, x + Inches(0.18), y + Inches(1.45),
                 cw - Inches(0.36), Inches(0.45),
                 "→  " + impact,
                 size=11, color=color, font=FONT_BODY, line_spacing=1.25)

    # The gap callout strip
    add_panel(s, Inches(0.6), Inches(6.10), Inches(12.1), Inches(0.8),
              fill=PANEL_ALT, border=AMBER, corner=0.18)
    add_text(s, Inches(0.85), Inches(6.18), Inches(11.6), Inches(0.30),
             "THE GAP",
             size=10, color=AMBER, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, Inches(0.85), Inches(6.45), Inches(11.6), Inches(0.42),
             "Almost no work in the intersection has been packaged as "
             "a deployable, IDE-integrated system that an engineering "
             "team can adopt incrementally.",
             size=12, color=TEXT, font=FONT_BODY, italic=True,
             line_spacing=1.25)


# ---------------------------------------------------------
# 8 — Section: Architecture
# ---------------------------------------------------------

def slide_section_architecture(prs):
    s = blank(prs)
    add_section_cover(s,
                      eyebrow="Section 02  ·  Chapter 4",
                      title="The Architecture.",
                      subtitle="Five layers, source-neutral, idempotent — built for a small team's economics.")
    add_footer(s, 8, TOTAL_SLIDES, "Architecture")


# ---------------------------------------------------------
# 9 — IntentEra at a glance
# ---------------------------------------------------------

def slide_intentera_glance(prs):
    s = content_slide(prs, 9, "Architecture · Ch 4")
    add_title(s, "IntentEra at a glance",
              eyebrow="The whole system on one slide")

    # Image — overall architecture
    add_image_with_caption(
        s, figure("fig_overall_architecture.png"),
        Inches(0.6), Inches(1.95), Inches(8.0), Inches(4.85),
        caption="Five-layer reference architecture (Fig. 1, dissertation).")

    # Right column: tech badges + 5 layer chips
    rx = Inches(8.85)
    add_text(s, rx, Inches(1.95), Inches(4.0), Inches(0.34),
             "TECHNOLOGY STACK",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)

    badges = [
        ("AWS Lambda", CYAN),
        ("API Gateway", CYAN),
        ("EventBridge", CYAN),
        ("Secrets Manager", CYAN),
        ("MongoDB Atlas", GREEN),
        ("Vector Search", GREEN),
        ("OpenAI GPT-4o-mini", VIOLET),
        ("text-embedding-3-small", VIOLET),
        ("Upstash Redis", AMBER),
        ("VS Code · Cursor", TEAL),
    ]
    bx = rx
    by = Inches(2.35)
    cur_x = bx
    cur_y = by
    row_h = Inches(0.40)
    for label, color in badges:
        chip_w = Inches(0.16) * len(label) + Inches(0.4)
        if chip_w > Inches(2.05):
            chip_w = Inches(2.05)
        if cur_x + chip_w > rx + Inches(4.0):
            cur_x = bx
            cur_y += row_h
        add_outline_chip(s, cur_x, cur_y, label, color=color,
                         width=chip_w, size=10)
        cur_x += chip_w + Inches(0.10)

    # 5 layers list
    add_text(s, rx, Inches(4.95), Inches(4.0), Inches(0.34),
             "FIVE LAYERS",
             size=11, color=AMBER, font=FONT_HEAD, bold=True, spacing=200)
    layers = [
        ("L1", "Artifact Ingestion"),
        ("L2", "Knowledge Extraction"),
        ("L3", "Semantic Reasoning"),
        ("L4", "Agent Orchestration"),
        ("L5", "IDE Integration"),
    ]
    ly = Inches(5.32)
    for i, (tag, name) in enumerate(layers):
        y = ly + i * Inches(0.30)
        add_text(s, rx, y, Inches(0.6), Inches(0.30),
                 tag, size=11, color=CYAN, font=FONT_MONO, bold=True)
        add_text(s, rx + Inches(0.6), y, Inches(3.4), Inches(0.30),
                 name, size=12, color=TEXT, font=FONT_BODY, bold=True)


# ---------------------------------------------------------
# 10 — Five-layer deep
# ---------------------------------------------------------

def slide_five_layers(prs):
    s = content_slide(prs, 10, "Architecture · Ch 4.2")
    add_title(s, "The five layers, in one screen",
              eyebrow="Layered separation of concerns")

    layers = [
        ("L1 — Artifact Ingestion", INDIGO,
         ["Jira REST + Confluence", "GitHub REST + GraphQL",
          "Rate-limit aware", "Exponential back-off"]),
        ("L2 — Knowledge Extraction", VIOLET,
         ["ADF → clean text", "PDF / DOCX / HTML parsers",
          "Section-aware chunker", "OpenAI embeddings (1536-d)"]),
        ("L3 — Semantic Reasoning", CYAN,
         ["Multi-query retriever", "Parallel $vectorSearch fan-out",
          "Max-pool re-ranking", "JSON-mode grounded answer"]),
        ("L4 — Agent Orchestration", TEAL,
         ["Coordinator + Code-Intent (live)", "Traceability (on demand)",
          "Reproduction + Validation (scaffolded)"]),
        ("L5 — IDE Integration", AMBER,
         ["Single VSIX (VS Code + Cursor)", "Sidebar webview",
          "Right-click commands", "Loopback Local Git Agent"]),
    ]

    band_h = Inches(0.92)
    gap = Inches(0.13)
    sy = Inches(1.95)
    for i, (title, color, items) in enumerate(layers):
        y = sy + i * (band_h + gap)
        layer_band(s, Inches(0.6), y, Inches(12.1), band_h,
                   title=title, items=items, color=color)


# ---------------------------------------------------------
# 11 — Architectural principles
# ---------------------------------------------------------

def slide_principles(prs):
    s = content_slide(prs, 11, "Architecture · Ch 4.1")
    add_title(s, "Five principles that shaped every decision",
              eyebrow="Architectural principles")

    principles = [
        ("Layered separation",
         "Ingestion, extraction, reasoning, orchestration and "
         "IDE are independently testable and replaceable.",
         CYAN, "L"),
        ("Source neutrality",
         "Jira, GitHub and future sources share the same "
         "embedding + vector-store pipeline. New source = "
         "fetcher + normaliser only.",
         INDIGO, "S"),
        ("Idempotence",
         "Every chunk has a deterministic id "
         "sha256(source|entityKey|chunkSlot) — re-runs are no-ops.",
         VIOLET, "I"),
        ("Strong grounding",
         "The LLM never speaks without a context package. "
         "Citations not present in context are dropped before "
         "they reach the developer.",
         AMBER, "G"),
        ("Cloud-native economics",
         "Pay-per-invocation Lambdas + free-tier Redis keep "
         "monthly cost in single-digit US-cents for "
         "bursty developer workloads.",
         GREEN, "$"),
    ]

    cw = Inches(2.40)
    ch = Inches(4.50)
    gap = Inches(0.18)
    total_w = 5 * cw + 4 * gap
    sx = (SLIDE_W - total_w) // 2
    sy = Inches(2.0)

    for i, (title, body, color, glyph) in enumerate(principles):
        x = sx + i * (cw + gap)
        add_panel(s, x, sy, cw, ch, fill=PANEL, border=PANEL_EDGE,
                  corner=0.10)
        # glyph circle
        glyph_size = Inches(1.15)
        gx = x + (cw - glyph_size) // 2
        gy = sy + Inches(0.45)
        circ = s.shapes.add_shape(MSO_SHAPE.OVAL, gx, gy, glyph_size,
                                  glyph_size)
        circ.line.fill.background()
        fill_gradient(circ, [(0, color), (1, INDIGO)], angle=2700000)
        tf = circ.text_frame
        tf.margin_left = tf.margin_right = Inches(0)
        tf.margin_top = tf.margin_bottom = Inches(0)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = glyph
        r.font.name = FONT_HEAD
        r.font.size = Pt(38)
        r.font.bold = True
        r.font.color.rgb = TEXT

        add_text(s, x + Inches(0.15), sy + Inches(1.85),
                 cw - Inches(0.3), Inches(0.7),
                 title,
                 size=15, color=TEXT, font=FONT_HEAD, bold=True,
                 align=PP_ALIGN.CENTER, line_spacing=1.20)
        add_text(s, x + Inches(0.18), sy + Inches(2.65),
                 cw - Inches(0.36), Inches(1.7),
                 body,
                 size=11, color=TEXT_DIM, font=FONT_BODY,
                 align=PP_ALIGN.CENTER, line_spacing=1.30)


# ---------------------------------------------------------
# 12 — Section: Chunking, Embeddings, Retrieval
# ---------------------------------------------------------

def slide_section_rag(prs):
    s = blank(prs)
    add_section_cover(s,
                      eyebrow="Section 03  ·  Chapter 6",
                      title="Chunking, Embeddings, Retrieval.",
                      subtitle="The reasoning engine, the heart of IntentEra.")
    add_footer(s, 12, TOTAL_SLIDES, "Reasoning Engine")


# ---------------------------------------------------------
# 13 — Section-aware chunking
# ---------------------------------------------------------

def slide_chunking(prs):
    s = content_slide(prs, 13, "Reasoning · Ch 6.1")
    add_title(s, "Section-aware chunking — one idea per chunk",
              eyebrow="Most consequential preprocessing decision")

    # Left: figure
    add_image_with_caption(
        s, figure("fig_chunking_strategy.png"),
        Inches(0.6), Inches(1.95), Inches(7.6), Inches(4.85),
        caption="Per-artifact section-aware chunking (Fig. 32, dissertation).")

    # Right: chunk types
    rx = Inches(8.55)
    add_text(s, rx, Inches(1.95), Inches(4.4), Inches(0.34),
             "WHY NOT UNIFORM-LENGTH?",
             size=11, color=AMBER, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, rx, Inches(2.30), Inches(4.4), Inches(1.0),
             "Naive splits destroy semantic structure — "
             "a key claim can land across two chunks, halving the "
             "chance retrieval ever finds it.",
             size=12, color=TEXT_DIM, font=FONT_BODY, italic=True,
             line_spacing=1.30)

    add_text(s, rx, Inches(3.65), Inches(4.4), Inches(0.34),
             "CHUNK TYPES",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)
    rows = [
        ("Jira", "metadata · description · comment · attachment", CYAN),
        ("GitHub commits", "commit message · diff summary", INDIGO),
        ("Pull requests", "PR body · review threads (grouped)", VIOLET),
        ("Issues", "body · comments", TEAL),
        ("Confluence", "page sections · attachments", AMBER),
    ]
    ry = Inches(4.0)
    for src, body, color in rows:
        add_text(s, rx, ry, Inches(1.5), Inches(0.30),
                 src, size=12, color=color, font=FONT_HEAD, bold=True)
        add_text(s, rx + Inches(1.5), ry, Inches(2.9), Inches(0.30),
                 body, size=11, color=TEXT_DIM, font=FONT_MONO,
                 line_spacing=1.20)
        ry += Inches(0.42)

    add_text(s, rx, Inches(6.15), Inches(4.4), Inches(0.6),
             "Token caps configurable via *_MAX_TOKENS\n"
             "and *_GROUP_SIZE environment variables.",
             size=10, color=TEXT_MUTED, font=FONT_MONO,
             line_spacing=1.30, italic=True)


# ---------------------------------------------------------
# 14 — Idempotent upsert + embeddings
# ---------------------------------------------------------

def slide_idempotent_embeddings(prs):
    s = content_slide(prs, 14, "Reasoning · Ch 6.2 – 6.3")
    add_title(s, "Idempotent ids + 1536-dim embeddings",
              eyebrow="Why incremental sync is safe and cheap")

    # Top: id formula card
    add_panel(s, Inches(0.6), Inches(1.95), Inches(12.1), Inches(1.55),
              fill=BG_DEEP, border=INDIGO, corner=0.08)
    add_text(s, Inches(0.85), Inches(2.10), Inches(11.6), Inches(0.32),
             "DETERMINISTIC CHUNK ID",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, Inches(0.85), Inches(2.50), Inches(11.6), Inches(0.7),
             "_id  =  sha256( source | entityKey | chunkSlot )",
             size=24, color=TEXT, font=FONT_MONO, bold=True,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, Inches(0.85), Inches(3.12), Inches(11.6), Inches(0.36),
             "Re-ingesting the same artifact produces the same "
             "ids — MongoDB upsert is a no-op when nothing has changed, "
             "a consistent overwrite when it has.",
             size=11, color=TEXT_MUTED, font=FONT_BODY, italic=True,
             align=PP_ALIGN.CENTER, line_spacing=1.25)

    # Three metric cards
    cw = Inches(3.85)
    ch = Inches(1.85)
    gap = Inches(0.27)
    sx = (SLIDE_W - 3 * cw - 2 * gap) // 2
    sy = Inches(3.85)

    add_metric_card(s, sx, sy, cw, ch,
                    value="1,536",
                    label="Embedding dimensions",
                    sublabel="OpenAI text-embedding-3-small — "
                             "shared across natural language and "
                             "code-adjacent artifacts.",
                    accent=CYAN)
    add_metric_card(s, sx + cw + gap, sy, cw, ch,
                    value="1× class",
                    label="Pluggable embedder",
                    sublabel="Swap to a code-specialised model "
                             "by changing one constructor — "
                             "no other code touches.",
                    accent=VIOLET)
    add_metric_card(s, sx + 2 * (cw + gap), sy, cw, ch,
                    value="Batched",
                    label="Single round-trip",
                    sublabel="All query embeddings batched in one "
                             "OpenAI call. Exponential back-off "
                             "on transient failures.",
                    accent=TEAL)

    # Bottom strip — small note
    add_text(s, Inches(0.6), Inches(6.05), Inches(12.1), Inches(0.55),
             "→  Hourly incremental sync re-embeds only what changed since "
             "the previous run — the dominant external cost lever, controlled by design.",
             size=12, color=TEXT_DIM, font=FONT_BODY, italic=True,
             align=PP_ALIGN.CENTER, line_spacing=1.30)


# ---------------------------------------------------------
# 15 — Multi-source vector storage
# ---------------------------------------------------------

def slide_vector_storage(prs):
    s = content_slide(prs, 15, "Reasoning · Ch 5.6")
    add_title(s, "Two collections, one cluster, hybrid filters",
              eyebrow="MongoDB Atlas Vector Search")

    # Left side: two collection cards stacked
    cards = [
        ("rag_chunks", "Jira", CYAN,
         "_id · ticketKey · projectKey · type\n"
         "(metadata / description / comment / attachment)\n"
         "chunkIndex · text · embedding[1536]"),
        ("rag_chunks_github", "GitHub", VIOLET,
         "_id · entityKey (e.g. commit:<sha>) · entityType\n"
         "repoFullName · branches · prNumber\n"
         "chunkSlot · text · embedding[1536]"),
    ]
    cx = Inches(0.6)
    cy = Inches(2.0)
    cw = Inches(6.6)
    ch = Inches(2.20)
    for i, (name, src, color, body) in enumerate(cards):
        y = cy + i * (ch + Inches(0.25))
        add_panel(s, cx, y, cw, ch, fill=PANEL, border=PANEL_EDGE, corner=0.08)
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, cx, y, cw, Emu(38100))
        bar.line.fill.background()
        fill_gradient(bar, [(0, color), (1, INDIGO)], angle=0)
        add_text(s, cx + Inches(0.20), y + Inches(0.18),
                 cw - Inches(0.4), Inches(0.4),
                 name, size=18, color=TEXT, font=FONT_MONO, bold=True)
        add_text(s, cx + Inches(0.20), y + Inches(0.62),
                 cw - Inches(0.4), Inches(0.34),
                 f"Source: {src}",
                 size=11, color=color, font=FONT_HEAD, bold=True, spacing=200)
        add_text(s, cx + Inches(0.20), y + Inches(1.0),
                 cw - Inches(0.4), Inches(1.15),
                 body,
                 size=11, color=TEXT_DIM, font=FONT_MONO,
                 line_spacing=1.35)

    # Right side: cluster summary panel + figure
    rx = Inches(7.4)
    add_panel(s, rx, Inches(2.0), Inches(5.3), Inches(2.20),
              fill=PANEL_ALT, border=PANEL_EDGE, corner=0.08)
    add_text(s, rx + Inches(0.2), Inches(2.15),
             Inches(5.0), Inches(0.34),
             "ATLAS CLUSTER",
             size=11, color=GREEN, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, rx + Inches(0.2), Inches(2.5),
             Inches(5.0), Inches(0.4),
             "M10  ·  Three-node Replica Set",
             size=18, color=TEXT, font=FONT_HEAD, bold=True)
    add_text(s, rx + Inches(0.2), Inches(2.95),
             Inches(5.0), Inches(0.34),
             "ap-south-2 (Hyderabad)",
             size=12, color=TEXT_DIM, font=FONT_MONO)
    add_text(s, rx + Inches(0.2), Inches(3.35),
             Inches(5.0), Inches(0.85),
             "Two vector indexes — vector_index and "
             "vector_index_github — over the 1536-dim embedding "
             "field, plus per-source filter fields for hybrid IR + neural queries.",
             size=11, color=TEXT_DIM, font=FONT_BODY,
             line_spacing=1.30, italic=True)

    # Bottom: split-region rationale
    add_panel(s, rx, Inches(4.45), Inches(5.3), Inches(2.30),
              fill=PANEL, border=PANEL_EDGE, corner=0.08)
    add_text(s, rx + Inches(0.2), Inches(4.6),
             Inches(5.0), Inches(0.34),
             "WHY THE REGION SPLIT",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, rx + Inches(0.2), Inches(4.95),
             Inches(5.0), Inches(1.7),
             "AWS workload in ap-south-1 (Mumbai) — proximity to the team.\n\n"
             "Atlas in ap-south-2 (Hyderabad) — additional redundancy "
             "without trans-oceanic latency on every query.",
             size=12, color=TEXT_DIM, font=FONT_BODY,
             line_spacing=1.40)


# ---------------------------------------------------------
# 16 — Multi-query retriever (the heart)
# ---------------------------------------------------------

def slide_multi_query_retriever(prs):
    s = content_slide(prs, 16, "Reasoning · Ch 6.4")
    add_title(s, "Multi-query retriever — the heart of the engine",
              eyebrow="Question + commit subjects → grounded context")

    # Image (left)
    add_image_with_caption(
        s, figure("fig_rag_flow.png"),
        Inches(0.6), Inches(1.95), Inches(7.4), Inches(4.85),
        caption="Multi-query RAG fan-out (Fig. 33, dissertation).")

    # Right: 4-step algorithm
    rx = Inches(8.30)
    add_text(s, rx, Inches(1.95), Inches(4.7), Inches(0.34),
             "ALGORITHM — FOUR STEPS",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)

    steps = [
        ("01", "Dedupe & batch",
         "Concatenate question + unique local commit subjects → list Q.",
         CYAN),
        ("02", "Embed once",
         "All K queries embedded in a single OpenAI call.",
         INDIGO),
        ("03", "Parallel $vectorSearch",
         "Each embedding → both Atlas collections, top-K = 3.",
         VIOLET),
        ("04", "Max-pool merge",
         "Group by chunkId, keep max score, sort, slice to top N (= 12).",
         AMBER),
    ]
    sy = Inches(2.4)
    for i, (num, title, body, color) in enumerate(steps):
        y = sy + i * Inches(1.05)
        # number
        num_box = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                     rx, y, Inches(0.7), Inches(0.7))
        num_box.adjustments[0] = 0.20
        num_box.fill.solid()
        num_box.fill.fore_color.rgb = color
        num_box.line.fill.background()
        tf = num_box.text_frame
        tf.margin_left = tf.margin_right = Inches(0)
        tf.margin_top = tf.margin_bottom = Inches(0)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = num
        r.font.name = FONT_MONO
        r.font.size = Pt(16)
        r.font.bold = True
        r.font.color.rgb = BG_DEEP
        # text
        add_text(s, rx + Inches(0.85), y + Inches(0.0),
                 Inches(3.85), Inches(0.36),
                 title, size=13, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, rx + Inches(0.85), y + Inches(0.36),
                 Inches(3.85), Inches(0.7),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.30)


# ---------------------------------------------------------
# 17 — Why max-pool over avg / concatenation
# ---------------------------------------------------------

def slide_max_pool_justification(prs):
    s = content_slide(prs, 17, "Reasoning · Ch 6.4 (rationale)")
    add_title(s, "Why max-pool — and why not the obvious alternatives",
              eyebrow="Re-ranking design choice")

    options = [
        ("Average score across queries", RED, "✗  Rejected",
         "Dilutes a chunk that is decisively relevant to one query "
         "but only weakly relevant to another — exactly the signal we "
         "want to preserve."),
        ("Concatenate queries into one string", RED, "✗  Rejected",
         "Conflates orthogonal signals into a single embedding, "
         "degrading retrieval quality for every individual query."),
        ("Max-pool by chunkId  ←  the choice", GREEN, "✓  Adopted",
         "Keep the maximum score across queries for each chunk. A "
         "ticket whose title closely matches one commit subject is "
         "promoted into the top of the merged list, even when its "
         "match against the user's question is moderate."),
    ]

    cw = Inches(12.1)
    ch = Inches(1.45)
    gap = Inches(0.18)
    sx = Inches(0.6)
    sy = Inches(2.0)
    for i, (title, color, verdict, body) in enumerate(options):
        y = sy + i * (ch + gap)
        add_panel(s, sx, y, cw, ch, fill=PANEL, border=color, corner=0.06,
                  line_width=1.5)
        # left strip
        strip = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, sx, y,
                                   Inches(0.18), ch)
        strip.line.fill.background()
        strip.fill.solid()
        strip.fill.fore_color.rgb = color
        # title
        add_text(s, sx + Inches(0.4), y + Inches(0.18),
                 Inches(8.5), Inches(0.4),
                 title, size=15, color=TEXT, font=FONT_HEAD, bold=True)
        # verdict chip
        add_text(s, sx + Inches(9.3), y + Inches(0.20),
                 Inches(2.6), Inches(0.4),
                 verdict, size=14, color=color, font=FONT_HEAD, bold=True,
                 align=PP_ALIGN.RIGHT)
        # body
        add_text(s, sx + Inches(0.4), y + Inches(0.65),
                 cw - Inches(0.6), Inches(0.75),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.30)

    # Bottom takeaway
    add_text(s, Inches(0.6), Inches(6.55), Inches(12.1), Inches(0.4),
             "→  Max-pool is essentially a soft ensemble — it lets the strongest "
             "evidence per chunk speak, regardless of which query found it.",
             size=12, color=CYAN, font=FONT_BODY, italic=True,
             align=PP_ALIGN.CENTER)


# ---------------------------------------------------------
# 18 — Grounded answer composition
# ---------------------------------------------------------

def slide_grounded_answer(prs):
    s = content_slide(prs, 18, "Reasoning · Ch 6.5 + 9.5")
    add_title(s, "Three-layer defence against hallucination",
              eyebrow="LLM answer composition")

    # Top: prompt → output flow as 3 steps
    cw = Inches(3.85)
    ch = Inches(2.5)
    gap = Inches(0.32)
    sx = (SLIDE_W - 3 * cw - 2 * gap) // 2
    sy = Inches(2.0)

    layers = [
        ("01", "JSON-Mode Prompt", CYAN,
         "LLM (OpenAI gpt-4o-mini) is forced into JSON-mode "
         "and instructed to emit a non-technical \"why\" paragraph "
         "plus three citation lists — commits, tickets, PRs."),
        ("02", "Post-Filter Citations", INDIGO,
         "Any commit SHA, ticket key or PR number that does NOT "
         "appear in the supplied context is silently dropped before "
         "the response leaves the Lambda."),
        ("03", "Clickable in the IDE", VIOLET,
         "Citations render as clickable references inside the chat "
         "panel — the developer can verify each source in one click."),
    ]
    for i, (num, title, color, body) in enumerate(layers):
        x = sx + i * (cw + gap)
        add_panel(s, x, sy, cw, ch, fill=PANEL, border=color, corner=0.10,
                  line_width=1.0)
        # number badge
        badge = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                   x + Inches(0.25), sy + Inches(0.20),
                                   Inches(0.65), Inches(0.65))
        badge.fill.solid()
        badge.fill.fore_color.rgb = color
        badge.line.fill.background()
        tf = badge.text_frame
        tf.margin_left = tf.margin_right = Inches(0)
        tf.margin_top = tf.margin_bottom = Inches(0)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = num
        r.font.name = FONT_MONO
        r.font.size = Pt(13)
        r.font.bold = True
        r.font.color.rgb = BG_DEEP
        # title
        add_text(s, x + Inches(1.05), sy + Inches(0.26),
                 cw - Inches(1.2), Inches(0.45),
                 title, size=15, color=TEXT, font=FONT_HEAD, bold=True)
        # body
        add_text(s, x + Inches(0.25), sy + Inches(1.05),
                 cw - Inches(0.5), Inches(1.4),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.35)

    # Bottom: example response shape (mock JSON snippet)
    add_panel(s, Inches(0.6), Inches(4.85), Inches(12.1), Inches(1.95),
              fill=BG_DEEP, border=PANEL_EDGE, corner=0.06)
    add_text(s, Inches(0.85), Inches(5.0), Inches(11.6), Inches(0.32),
             "RESPONSE SHAPE (TRUNCATED) — APPENDIX B.5",
             size=10, color=AMBER, font=FONT_HEAD, bold=True, spacing=200)
    json_snippet = (
        '{\n'
        '  "answer": "In plain English: the retry was added because the SSO ...",\n'
        '  "citations": {\n'
        '    "commits":  [ { "sha": "abc1234567...", "subject": "fix(auth): ..." } ],\n'
        '    "tickets":  [ { "key": "PROJ-123", "summary": "Intermittent SSO ..." } ],\n'
        '    "prs":      [ { "repo": "acme/platform", "number": 451 } ]\n'
        '  },\n'
        '  "retrieved": { "jiraCount": 5, "githubCount": 4, "mergedCount": 9 }\n'
        '}'
    )
    add_text(s, Inches(0.85), Inches(5.35), Inches(11.6), Inches(1.4),
             json_snippet,
             size=10, color=CYAN, font=FONT_MONO, line_spacing=1.20)


# ---------------------------------------------------------
# 19 — Multi-agent orchestration
# ---------------------------------------------------------

def slide_multi_agent(prs):
    s = content_slide(prs, 19, "Reasoning · Ch 6.6")
    add_title(s, "Specialised agents under one coordinator",
              eyebrow="Multi-agent orchestration")

    # Image (left)
    add_image_with_caption(
        s, figure("fig_multi_agent.png"),
        Inches(0.6), Inches(1.95), Inches(7.4), Inches(4.85),
        caption="Coordinator routes context to specialised agents (Fig. 34).")

    # Right: live vs scaffolded breakdown
    rx = Inches(8.30)
    add_text(s, rx, Inches(1.95), Inches(4.7), Inches(0.34),
             "AGENT ROSTER",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=200)

    live_agents = [
        ("Coordinator", "Routes context · synthesises responses"),
        ("Code-Intent", "Composes the \"why\" explanation"),
    ]
    on_demand = [
        ("Traceability", "Resolves \"which requirement does this implement?\""),
    ]
    scaffolded = [
        ("Reproduction", "Derives repro steps from tickets + commits"),
        ("Validation / Test", "Suggests how to verify the fix"),
    ]

    def section(y, title, color, items):
        add_text(s, rx, y, Inches(4.7), Inches(0.32),
                 title, size=11, color=color, font=FONT_HEAD,
                 bold=True, spacing=200)
        for i, (name, body) in enumerate(items):
            iy = y + Inches(0.4) + i * Inches(0.6)
            # status dot
            dot = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                     rx, iy + Inches(0.10),
                                     Inches(0.18), Inches(0.18))
            dot.fill.solid()
            dot.fill.fore_color.rgb = color
            dot.line.fill.background()
            add_text(s, rx + Inches(0.30), iy, Inches(4.4),
                     Inches(0.30),
                     name, size=13, color=TEXT, font=FONT_HEAD, bold=True)
            add_text(s, rx + Inches(0.30), iy + Inches(0.30),
                     Inches(4.4), Inches(0.30),
                     body, size=10, color=TEXT_DIM, font=FONT_BODY,
                     line_spacing=1.20)
        return y + Inches(0.4) + len(items) * Inches(0.6)

    y_cursor = Inches(2.30)
    y_cursor = section(y_cursor, "LIVE IN PRODUCTION", GREEN, live_agents)
    y_cursor += Inches(0.10)
    y_cursor = section(y_cursor, "ON DEMAND", AMBER, on_demand)
    y_cursor += Inches(0.10)
    y_cursor = section(y_cursor, "SCAFFOLDED — FUTURE WORK", VIOLET, scaffolded)


# ---------------------------------------------------------
# 20 — Section: IDE & Cloud
# ---------------------------------------------------------

def slide_section_ide_cloud(prs):
    s = blank(prs)
    add_section_cover(s,
                      eyebrow="Section 04  ·  Chapters 5 & 7",
                      title="IDE Integration & Cloud.",
                      subtitle="Where the developer experiences IntentEra — and how AWS makes it cheap.")
    add_footer(s, 20, TOTAL_SLIDES, "IDE & Cloud")


# ---------------------------------------------------------
# 21 — Extension: three pieces + privacy
# ---------------------------------------------------------

def slide_extension_pieces(prs):
    s = content_slide(prs, 21, "IDE · Ch 7.1 – 7.2")
    add_title(s, "Three pieces — and a deliberate trust boundary",
              eyebrow="VS Code & Cursor extension")

    # Image (left)
    add_image_with_caption(
        s, figure("fig_chat_extension.png"),
        Inches(0.6), Inches(1.95), Inches(7.4), Inches(4.85),
        caption="Three-piece chat extension architecture (Fig. 35).")

    # Right: three-piece breakdown
    rx = Inches(8.30)
    pieces = [
        ("01  ·  VSIX Extension",
         "Single artifact installs into both VS Code and Cursor "
         "(same Code-OSS extension API). Sidebar webview + "
         "right-click commands.",
         CYAN),
        ("02  ·  Local Git Agent",
         "Tiny Express server on 127.0.0.1:8787 — loopback only. "
         "Uses git log --no-patch → metadata only, "
         "never diffs. Allowlistable project roots.",
         VIOLET),
        ("03  ·  Cloud Chat Lambda",
         "Called via API Gateway. Runs the multi-query RAG pipeline + "
         "JSON-mode answer composition + citation post-filtering.",
         TEAL),
    ]
    sy = Inches(2.0)
    for i, (title, body, color) in enumerate(pieces):
        y = sy + i * Inches(1.55)
        add_panel(s, rx, y, Inches(4.7), Inches(1.40),
                  fill=PANEL, border=color, corner=0.10, line_width=1.0)
        add_text(s, rx + Inches(0.20), y + Inches(0.18),
                 Inches(4.3), Inches(0.36),
                 title, size=13, color=color, font=FONT_HEAD,
                 bold=True, spacing=150)
        add_text(s, rx + Inches(0.20), y + Inches(0.55),
                 Inches(4.3), Inches(0.85),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.30)


# ---------------------------------------------------------
# 22 — End-to-end sequence + UI
# ---------------------------------------------------------

def slide_e2e_sequence(prs):
    s = content_slide(prs, 22, "IDE · Ch 7.3 – 7.4")
    add_title(s, "From right-click to grounded answer",
              eyebrow="End-to-end chat request")

    # Left: sequence diagram
    add_image_with_caption(
        s, figure("fig_data_flow_sequence.png"),
        Inches(0.6), Inches(1.95), Inches(7.0), Inches(4.85),
        caption="UML-style sequence (Fig. 36).")

    # Right: live screenshot of the extension
    add_image_with_caption(
        s, screenshot("chat_ui_01.png"),
        Inches(7.85), Inches(1.95), Inches(5.0), Inches(4.85),
        caption="Cursor chat panel: \"Why was the email filter introduced?\"")


# ---------------------------------------------------------
# 23 — AWS deployment topology
# ---------------------------------------------------------

def slide_aws_topology(prs):
    s = content_slide(prs, 23, "Cloud · Ch 5")
    add_title(s, "Production deployment on AWS",
              eyebrow="Cloud-hosted, pay-per-invocation")

    # Left: topology figure
    add_image_with_caption(
        s, figure("fig_aws_topology.png"),
        Inches(0.6), Inches(1.95), Inches(7.0), Inches(4.85),
        caption="EventBridge → Ingest Lambda; API Gateway → Retrieve & Chat (Fig. 2).")

    # Right: 2x2 grid of infra screenshots
    rx = Inches(7.85)
    ry = Inches(1.95)
    cell_w = Inches(2.45)
    cell_h = Inches(2.30)
    gap = Inches(0.10)
    cells = [
        (screenshot("infra_03.png"), "Three Lambdas"),
        (screenshot("infra_10.png"), "EventBridge schedules"),
        (screenshot("infra_15.png"), "Secrets Manager"),
        (screenshot("infra_26.png"), "CloudWatch log groups"),
    ]
    for i, (path, cap) in enumerate(cells):
        col = i % 2
        row = i // 2
        x = rx + col * (cell_w + gap)
        y = ry + row * (cell_h + gap)
        add_panel(s, x, y, cell_w, cell_h, fill=PANEL,
                  border=PANEL_EDGE_SOFT, corner=0.06)
        add_image_with_caption(s, path,
                               x + Inches(0.08), y + Inches(0.10),
                               cell_w - Inches(0.16), cell_h - Inches(0.20),
                               caption=cap, caption_size=9)


# ---------------------------------------------------------
# 24 — Section: Evaluation
# ---------------------------------------------------------

def slide_section_eval(prs):
    s = blank(prs)
    add_section_cover(s,
                      eyebrow="Section 05  ·  Chapter 8",
                      title="Evaluation & Metrics.",
                      subtitle="Functional, retrieval, latency, cost — and what three engineers actually felt.")
    add_footer(s, 24, TOTAL_SLIDES, "Evaluation")


# ---------------------------------------------------------
# 25 — Functional verification (10 checks)
# ---------------------------------------------------------

def slide_functional_verification(prs):
    s = content_slide(prs, 25, "Evaluation · Ch 8.1")
    add_title(s, "10 of 10 functional checks pass",
              eyebrow="End-to-end verification on real production data")

    checks = [
        ("Lambda cold-start under 5 s",  "P"),
        ("Full Jira import populates rag_chunks",  "P"),
        ("Full GitHub import populates rag_chunks_github",  "P"),
        ("Incremental sync respects 60-min schedule",  "P"),
        ("Re-running incremental is idempotent",  "P"),
        ("POST /retrieve returns ranked hits + metadata",  "P"),
        ("POST /chat returns grounded answer with citations",  "P"),
        ("Citations not in context are dropped",  "P"),
        ("Local git agent rejects non-loopback callers",  "P"),
        ("Extension banner reflects agent + Lambda health",  "P*"),
    ]

    # 5 columns x 2 rows grid
    cols = 2
    rows = 5
    cw = Inches(6.0)
    ch = Inches(0.85)
    gap_x = Inches(0.20)
    gap_y = Inches(0.18)
    sx = (SLIDE_W - cols * cw - (cols - 1) * gap_x) // 2
    sy = Inches(1.95)

    for i, (text, status) in enumerate(checks):
        col = i // rows
        row = i % rows
        x = sx + col * (cw + gap_x)
        y = sy + row * (ch + gap_y)
        color = AMBER if status == "P*" else GREEN
        add_panel(s, x, y, cw, ch, fill=PANEL, border=PANEL_EDGE,
                  corner=0.08)
        # check icon
        circ = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                  x + Inches(0.18), y + Inches(0.20),
                                  Inches(0.45), Inches(0.45))
        circ.fill.solid()
        circ.fill.fore_color.rgb = color
        circ.line.fill.background()
        tf = circ.text_frame
        tf.margin_left = tf.margin_right = Inches(0)
        tf.margin_top = tf.margin_bottom = Inches(0)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = "✓"
        r.font.name = FONT_HEAD
        r.font.size = Pt(16)
        r.font.bold = True
        r.font.color.rgb = BG_DEEP
        # check number
        add_text(s, x + Inches(0.78), y + Inches(0.10),
                 Inches(0.5), Inches(0.30),
                 f"#{i + 1:02d}",
                 size=10, color=color, font=FONT_MONO, bold=True)
        # description
        add_text(s, x + Inches(0.78), y + Inches(0.36),
                 cw - Inches(1.6), Inches(0.50),
                 text, size=12, color=TEXT, font=FONT_BODY,
                 line_spacing=1.20)
        # status pill
        add_chip(s, x + cw - Inches(0.85), y + Inches(0.27),
                 status, color=color, width=Inches(0.65),
                 size=10)

    # bottom note
    add_text(s, Inches(0.6), Inches(6.55), Inches(12.1), Inches(0.4),
             "P* — minor observation: extension banner wording was reworded "
             "twice during testing for non-author readability.",
             size=11, color=TEXT_MUTED, font=FONT_BODY, italic=True,
             align=PP_ALIGN.CENTER)


# ---------------------------------------------------------
# 26 — Retrieval quality + cognitive load
# ---------------------------------------------------------

def slide_retrieval_quality(prs):
    s = content_slide(prs, 26, "Evaluation · Ch 8.2 + 8.4")
    add_title(s, "Retrieval quality and cognitive-load impact",
              eyebrow="Qualitative study on real Slack-sourced questions")

    # Top row: 3 metric cards
    cw = Inches(3.85)
    ch = Inches(1.85)
    gap = Inches(0.27)
    sx = (SLIDE_W - 3 * cw - 2 * gap) // 2
    sy = Inches(1.95)
    add_metric_card(s, sx, sy, cw, ch,
                    value="15 / 15",
                    label="Questions with ≥1 gold artifact in top-12",
                    sublabel="Curated from real Slack threads in the "
                             "employing organisation, supervisor-graded.",
                    accent=GREEN)
    add_metric_card(s, sx + cw + gap, sy, cw, ch,
                    value="≤ 3",
                    label="Position of the first gold artifact (median)",
                    sublabel="In the majority of cases the first gold "
                             "artifact appeared in the top three merged hits.",
                    accent=CYAN)
    add_metric_card(s, sx + 2 * (cw + gap), sy, cw, ch,
                    value="3 / 3",
                    label="Engineers showed reduced context-switches",
                    sublabel="30-min sessions on unfamiliar repos with "
                             "vs. without the extension. Self-reported "
                             "confidence rose because citations are checkable.",
                    accent=AMBER)

    # Bottom: max-pool promotion narrative panel
    add_panel(s, Inches(0.6), Inches(4.05), Inches(12.1), Inches(2.7),
              fill=PANEL, border=PANEL_EDGE, corner=0.08)
    add_text(s, Inches(0.85), Inches(4.20), Inches(11.6), Inches(0.34),
             "MAX-POOL RE-RANKING IN THE WILD",
             size=11, color=VIOLET, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, Inches(0.85), Inches(4.55), Inches(11.6), Inches(0.85),
             "Max-pool behaved as designed.",
             size=18, color=TEXT, font=FONT_HEAD, bold=True)
    add_text(s, Inches(0.85), Inches(5.20), Inches(11.6), Inches(1.5),
             "Artifacts that scored only moderately on the user's question "
             "but very strongly on a specific commit subject — for example "
             "a Jira ticket whose title closely matched a commit subject — "
             "were reliably promoted into the top of the merged list.\n\n"
             "A formal precision-recall evaluation against a larger dataset "
             "and a NASA-TLX cognitive-load study are identified as future work.",
             size=12, color=TEXT_DIM, font=FONT_BODY, italic=True,
             line_spacing=1.40)


# ---------------------------------------------------------
# 27 — Latency & cost dashboard
# ---------------------------------------------------------

def slide_latency_cost(prs):
    s = content_slide(prs, 27, "Evaluation · Ch 5.10 + 8.3")
    add_title(s, "Latency and cost — viable for a small team",
              eyebrow="Operational economics")

    # 4 metric cards in a 2x2 grid
    cw = Inches(5.95)
    ch = Inches(2.20)
    gap_x = Inches(0.20)
    gap_y = Inches(0.20)
    sx = (SLIDE_W - 2 * cw - gap_x) // 2
    sy = Inches(1.95)

    add_metric_card(s, sx, sy, cw, ch,
                    value="< 5 s",
                    label="Typical end-to-end chat request",
                    sublabel="Measured across 50 real interactions — "
                             "right-click to rendered answer. Well under "
                             "the 60 s Lambda timeout. LLM call dominates.",
                    accent=CYAN)
    add_metric_card(s, sx + cw + gap_x, sy, cw, ch,
                    value="single-digit ¢",
                    label="AWS spend per month",
                    sublabel="Lambdas + Secrets Manager + EventBridge. "
                             "Atlas M10 is the lower bound of the "
                             "dedicated tier.",
                    accent=GREEN)
    add_metric_card(s, sx, sy + ch + gap_y, cw, ch,
                    value="K × 2",
                    label="Atlas $vectorSearch ops per chat",
                    sublabel="K = #queries (1 + per local commit subject); "
                             "× #stores (Jira + GitHub). Negligible per "
                             "query, parallelised across stores.",
                    accent=VIOLET)
    add_metric_card(s, sx + cw + gap_x, sy + ch + gap_y, cw, ch,
                    value="2 × OpenAI",
                    label="External LLM calls per chat",
                    sublabel="One batched embedding round-trip + one "
                             "chat completion. Embeddings are amortised "
                             "across all queries in the request.",
                    accent=AMBER)

    # bottom note
    add_text(s, Inches(0.6), Inches(6.65), Inches(12.1), Inches(0.35),
             "Incremental sync re-embeds only what changed → OpenAI cost "
             "scales with delta, not corpus size.",
             size=12, color=TEXT_DIM, font=FONT_BODY, italic=True,
             align=PP_ALIGN.CENTER)


# ---------------------------------------------------------
# 28 — Section: What's next
# ---------------------------------------------------------

def slide_section_future(prs):
    s = blank(prs)
    add_section_cover(s,
                      eyebrow="Section 06  ·  Chapters 9 & 10",
                      title="What's Next.",
                      subtitle="Honest limitations, what we shipped, and where the framework goes from here.")
    add_footer(s, 28, TOTAL_SLIDES, "What's Next")


# ---------------------------------------------------------
# 29 — Challenges & limitations
# ---------------------------------------------------------

def slide_challenges(prs):
    s = content_slide(prs, 29, "Limitations · Ch 9")
    add_title(s, "Challenges and limitations — documented honestly",
              eyebrow="Where the system struggles, and how we mitigate")

    challenges = [
        ("NL → code gap",
         "Requirements are informal, code is structured. Multi-query "
         "retriever helps; abstract requirements remain edge cases.",
         CYAN),
        ("Noisy artifacts",
         "\"minor fix\" commits, empty PRs. Mitigated by preserving "
         "metadata + ingesting reviewer comments as their own chunks.",
         INDIGO),
        ("Missing traceability",
         "Many commits don't reference a ticket. Combination of "
         "metadata + semantic similarity, with hit counts exposed.",
         VIOLET),
        ("Source heterogeneity",
         "Each platform has its own format and rate-limits. Per-source "
         "normalisers and Redis state keep the reasoning core clean.",
         TEAL),
        ("LLM hallucination",
         "Three-layer defence: JSON-mode + post-filter + clickable "
         "citations. Cannot guarantee zero, substantially reduced.",
         AMBER),
        ("Cold start",
         "Mongo / Redis / OpenAI clients are cached across warm "
         "invocations. Provisioned concurrency is available if needed.",
         GREEN),
        ("Scale & scope",
         "2 source families today, managed-cloud only, no benchmarks at "
         "100k+ artifacts yet. Designed for incremental growth.",
         ROSE),
    ]

    cols = 4
    cw = Inches(2.95)
    ch = Inches(2.20)
    gap_x = Inches(0.18)
    gap_y = Inches(0.20)
    sx = (SLIDE_W - cols * cw - (cols - 1) * gap_x) // 2
    sy = Inches(1.95)
    for i, (title, body, color) in enumerate(challenges):
        col = i % cols
        row = i // cols
        x = sx + col * (cw + gap_x)
        y = sy + row * (ch + gap_y)
        add_panel(s, x, y, cw, ch, fill=PANEL, border=PANEL_EDGE,
                  corner=0.08)
        bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, cw, Emu(38100))
        bar.line.fill.background()
        fill_gradient(bar, [(0, color), (1, INDIGO)], angle=0)
        add_text(s, x + Inches(0.18), y + Inches(0.22),
                 cw - Inches(0.36), Inches(0.4),
                 title, size=14, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, x + Inches(0.18), y + Inches(0.70),
                 cw - Inches(0.36), Inches(1.45),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.35)


# ---------------------------------------------------------
# 30 — Current improvements (already shipped)
# ---------------------------------------------------------

def slide_current_improvements(prs):
    s = content_slide(prs, 30, "Improvements · already shipped")
    add_title(s, "What's improved since the midterm — already in production",
              eyebrow="Current improvements")

    items = [
        ("Section-aware chunker",
         "Replaces uniform-length splits with one-idea-per-chunk "
         "windows. Removed cross-boundary loss of key claims.",
         CYAN),
        ("JSON-mode + post-filter grounding",
         "LLM forced into JSON-mode; uncited identifiers stripped "
         "before reaching the developer. Eliminates fabricated SHAs.",
         INDIGO),
        ("Max-pool re-ranking",
         "Single-batch query embedding + parallel $vectorSearch + "
         "max-pool merge replaces single-query nearest-neighbour search.",
         VIOLET),
        ("Loopback Local Git Agent",
         "Replaces sending diffs/patches to the cloud. Only metadata "
         "leaves the machine; agent binds to 127.0.0.1.",
         TEAL),
        ("Single VSIX, two IDEs",
         "One artifact installs into both VS Code and Cursor. "
         "Same right-click commands, same sidebar everywhere.",
         AMBER),
    ]

    cw = Inches(2.40)
    ch = Inches(4.50)
    gap = Inches(0.18)
    sx = (SLIDE_W - 5 * cw - 4 * gap) // 2
    sy = Inches(2.0)

    for i, (title, body, color) in enumerate(items):
        x = sx + i * (cw + gap)
        add_panel(s, x, sy, cw, ch, fill=PANEL, border=PANEL_EDGE,
                  corner=0.10)
        # check stamp
        stamp = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                   x + (cw - Inches(1.0)) // 2,
                                   sy + Inches(0.35),
                                   Inches(1.0), Inches(1.0))
        stamp.line.fill.background()
        fill_gradient(stamp, [(0, color), (1, INDIGO)], angle=2700000)
        tf = stamp.text_frame
        tf.margin_left = tf.margin_right = Inches(0)
        tf.margin_top = tf.margin_bottom = Inches(0)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = "✓"
        r.font.name = FONT_HEAD
        r.font.size = Pt(36)
        r.font.bold = True
        r.font.color.rgb = TEXT
        # title
        add_text(s, x + Inches(0.15), sy + Inches(1.6),
                 cw - Inches(0.3), Inches(0.85),
                 title, size=14, color=TEXT, font=FONT_HEAD, bold=True,
                 align=PP_ALIGN.CENTER, line_spacing=1.20)
        # body
        add_text(s, x + Inches(0.18), sy + Inches(2.55),
                 cw - Inches(0.36), Inches(1.85),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY,
                 align=PP_ALIGN.CENTER, line_spacing=1.35)


# ---------------------------------------------------------
# 31 — Future work (5 directions)
# ---------------------------------------------------------

def slide_future_work(prs):
    s = content_slide(prs, 31, "Future Work · Ch 10.4")
    add_title(s, "Five directions worth pursuing next",
              eyebrow="Future work")

    items = [
        ("01", "Code Evolution Graph",
         "Index the repository's call graph as a first-class artifact — "
         "answer questions that depend on cross-file structure, not only "
         "textual similarity.",
         CYAN),
        ("02", "Explainable per-citation Confidence",
         "Surface the per-query hit counts already computed by the "
         "retriever — let developers calibrate trust per cited artifact.",
         INDIGO),
        ("03", "Regression-Test Suggestion Agent",
         "Extension of the Validation/Test agent — propose specific tests "
         "to add after a fix, grounded in the same artifacts the chat "
         "answer cites.",
         VIOLET),
        ("04", "Cross-Repository Dependency Tracing",
         "Ingest multiple repositories and express their dependencies in "
         "the vector index — addresses platform-and-service split monorepos.",
         TEAL),
        ("05", "Knowledge-Graph Semantic Memory",
         "Layer an explicit knowledge graph on top of the vector store — "
         "enables path-based and temporal questions that vector similarity "
         "alone cannot support.",
         AMBER),
    ]

    cw = Inches(12.1)
    ch = Inches(0.93)
    gap = Inches(0.10)
    sx = Inches(0.6)
    sy = Inches(1.95)

    for i, (num, title, body, color) in enumerate(items):
        y = sy + i * (ch + gap)
        add_panel(s, sx, y, cw, ch, fill=PANEL, border=PANEL_EDGE,
                  corner=0.08)
        # number badge
        badge_w = Inches(0.85)
        badge = s.shapes.add_shape(MSO_SHAPE.RECTANGLE,
                                   sx, y, badge_w, ch)
        badge.line.fill.background()
        fill_gradient(badge, [(0, color), (1, INDIGO)], angle=2700000)
        tf = badge.text_frame
        tf.margin_left = tf.margin_right = Inches(0)
        tf.margin_top = tf.margin_bottom = Inches(0)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = num
        r.font.name = FONT_MONO
        r.font.size = Pt(20)
        r.font.bold = True
        r.font.color.rgb = TEXT
        # title + body
        add_text(s, sx + badge_w + Inches(0.25), y + Inches(0.10),
                 Inches(4.5), Inches(0.4),
                 title, size=14, color=TEXT, font=FONT_HEAD, bold=True)
        add_text(s, sx + badge_w + Inches(0.25), y + Inches(0.45),
                 cw - badge_w - Inches(0.4), Inches(0.45),
                 body, size=11, color=TEXT_DIM, font=FONT_BODY,
                 line_spacing=1.30)


# ---------------------------------------------------------
# 32 — Conclusion + Q&A / Thank you
# ---------------------------------------------------------

def slide_conclusion(prs):
    s = blank(prs)
    add_background(s, "title")
    add_footer(s, 32, TOTAL_SLIDES, "Conclusion")

    # decorative rings (top-right)
    for size_in, color in [(7.0, INDIGO), (4.8, VIOLET), (3.0, CYAN)]:
        r = Inches(size_in)
        ring = s.shapes.add_shape(
            MSO_SHAPE.OVAL,
            Inches(11.0) - r // 2, Inches(2.6) - r // 2, r, r,
        )
        ring.fill.background()
        ring.line.color.rgb = color
        ring.line.width = Pt(1.0)

    # eyebrow
    add_text(s, Inches(0.8), Inches(0.65), Inches(11), Inches(0.4),
             "CHAPTER 10  ·  CLOSING REMARK",
             size=12, color=CYAN, font=FONT_HEAD, bold=True, spacing=300)

    # large quote
    add_text(s, Inches(0.8), Inches(1.25), Inches(11.5), Inches(2.6),
             "Implementation rationale,\noften assumed to be irretrievably lost\nas software evolves,\ncan in fact be computationally reconstructed.",
             size=30, color=TEXT, font=FONT_HEAD, bold=True,
             line_spacing=1.20)

    # gradient underline
    underline = s.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(4.0),
        Inches(3.4), Emu(57150),
    )
    underline.line.fill.background()
    fill_gradient(underline, [(0, CYAN), (0.6, INDIGO), (1, VIOLET)], angle=0)

    # contributions strip
    add_text(s, Inches(0.8), Inches(4.25), Inches(11.5), Inches(0.85),
             "IntentEra demonstrates that intent-aware development "
             "environments are not only feasible but practical — and that "
             "traceability can be an active form of cognitive augmentation, "
             "not a documentation aspiration.",
             size=14, color=TEXT_DIM, font=FONT_BODY, italic=True,
             line_spacing=1.40)

    # Thank-you / Q&A panel
    add_panel(s, Inches(0.8), Inches(5.55), Inches(7.0), Inches(1.40),
              fill=RGBColor(0x10, 0x18, 0x3A), border=PANEL_EDGE, corner=0.10)
    add_text(s, Inches(1.0), Inches(5.65), Inches(6.6), Inches(0.34),
             "THANK YOU",
             size=11, color=CYAN, font=FONT_HEAD, bold=True, spacing=300)
    add_text(s, Inches(1.0), Inches(6.0), Inches(6.6), Inches(0.5),
             "Questions & Discussion",
             size=22, color=TEXT, font=FONT_HEAD, bold=True)
    add_text(s, Inches(1.0), Inches(6.5), Inches(6.6), Inches(0.4),
             "With thanks to my supervisor, examiner and faculty mentor.",
             size=11, color=TEXT_DIM, font=FONT_BODY, italic=True)

    # Author / id panel
    add_panel(s, Inches(8.0), Inches(5.55), Inches(4.5), Inches(1.40),
              fill=RGBColor(0x10, 0x18, 0x3A), border=PANEL_EDGE, corner=0.10)
    add_text(s, Inches(8.2), Inches(5.65), Inches(4.1), Inches(0.34),
             "AARYA NANNDAANN SINGH M N",
             size=10, color=VIOLET, font=FONT_HEAD, bold=True, spacing=200)
    add_text(s, Inches(8.2), Inches(5.95), Inches(4.1), Inches(0.4),
             "BITS ID  ·  2024MT03013",
             size=14, color=TEXT, font=FONT_MONO, bold=True)
    add_text(s, Inches(8.2), Inches(6.30), Inches(4.1), Inches(0.5),
             "M.Tech Cloud Computing\nWILP Dissertation CCZG628T  ·  May 2026",
             size=11, color=TEXT_DIM, font=FONT_BODY, line_spacing=1.30)


# ---------------------------------------------------------
# Main
# ---------------------------------------------------------

def main():
    prs = new_deck()

    # 01 – 02
    slide_title(prs)
    slide_agenda(prs)

    # 03 – 07
    slide_section_problem(prs)
    slide_intent_erosion(prs)
    slide_problem_setting(prs)
    slide_formal_problem_objectives(prs)
    slide_literature(prs)

    # 08 – 11
    slide_section_architecture(prs)
    slide_intentera_glance(prs)
    slide_five_layers(prs)
    slide_principles(prs)

    # 12 – 19
    slide_section_rag(prs)
    slide_chunking(prs)
    slide_idempotent_embeddings(prs)
    slide_vector_storage(prs)
    slide_multi_query_retriever(prs)
    slide_max_pool_justification(prs)
    slide_grounded_answer(prs)
    slide_multi_agent(prs)

    # 20 – 23
    slide_section_ide_cloud(prs)
    slide_extension_pieces(prs)
    slide_e2e_sequence(prs)
    slide_aws_topology(prs)

    # 24 – 27
    slide_section_eval(prs)
    slide_functional_verification(prs)
    slide_retrieval_quality(prs)
    slide_latency_cost(prs)

    # 28 – 32
    slide_section_future(prs)
    slide_challenges(prs)
    slide_current_improvements(prs)
    slide_future_work(prs)
    slide_conclusion(prs)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    print(f"Wrote {OUT}  ·  slides = {len(prs.slides)}")


if __name__ == "__main__":
    main()
