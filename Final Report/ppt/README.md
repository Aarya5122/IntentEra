# IntentEra — Final Defence Presentation

Builds `Final Report/Final_Presentation_2024MT03013.pptx` from the
final dissertation PDF (`Final Report/2024MT03013 2.pdf`) and the
figures already generated under `Final Report/figures/`.

## Run

```bash
# from repo root
python "Final Report/ppt/build_ppt.py"
```

Or, if the existing midterm virtual-env should be reused:

```bash
"Reports/midterm/ppt/.venv/bin/python" "Final Report/ppt/build_ppt.py"
```

## Layout

- `theme.py`         palette, gradient backgrounds, slide chrome,
                     metric cards, section covers, image+caption helper
- `diagrams.py`      lightweight native-PPTX shapes (nodes, arrows,
                     lanes) for the few diagrams we draw on the slide
- `build_ppt.py`     one function per slide, called in order from `main()`

## Visual identity

- 16:9, 13.333" × 7.5"
- Deep indigo → violet → cyan gradient
- Montserrat / Inter / JetBrains Mono fonts (system fallbacks if missing)
- Section covers every ~5-6 slides
- Footer: `IntentEra · Final Defence · Aarya Nanndaann Singh M N (2024MT03013)`
