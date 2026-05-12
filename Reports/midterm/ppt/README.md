# Midterm Dissertation — PPT Builder

Generates `Reports/midterm/Midterm_Presentation_2024MT03013.pptx` from Python.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`cairosvg` requires the Cairo system library. On macOS:

```bash
brew install cairo libffi
```

## Build

```bash
python fetch_assets.py   # one-time: downloads AWS icons + service logos into assets/
python build_ppt.py      # regenerates the .pptx
```

The output lands at `Reports/midterm/Midterm_Presentation_2024MT03013.pptx`.

## File map

| File               | Purpose                                                |
| ------------------ | ------------------------------------------------------ |
| `build_ppt.py`     | Main authoring script — all slide text lives here      |
| `theme.py`         | Colors, fonts, gradient backgrounds, accent helpers    |
| `diagrams.py`      | `node()`, `arrow()`, layered-band helpers              |
| `fetch_assets.py`  | Downloads AWS + app logos, converts SVG→PNG            |
| `assets/aws/`      | Cached AWS service icons (PNG)                         |
| `assets/logos/`    | Cached app/service logos (PNG)                         |

To tweak content, edit the slide functions in `build_ppt.py` and re-run it —
assets are cached so subsequent builds are fast.
