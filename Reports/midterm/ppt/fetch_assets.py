"""Download AWS icons and app/service logos used by the presentation.

Run once before build_ppt.py. Cached under assets/aws and assets/logos.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict

import requests

try:
    import resvg_py  # pure-python SVG -> PNG (no system deps)
except ImportError as e:  # pragma: no cover
    raise SystemExit("Install with: pip install resvg-py") from e


ROOT = Path(__file__).parent
AWS_DIR = ROOT / "assets" / "aws"
LOGO_DIR = ROOT / "assets" / "logos"
AWS_DIR.mkdir(parents=True, exist_ok=True)
LOGO_DIR.mkdir(parents=True, exist_ok=True)

AWS_BASE = "https://raw.githubusercontent.com/awslabs/aws-icons-for-plantuml/main/dist"

# AWS service icons we reference.
AWS_ICONS: Dict[str, str] = {
    "Lambda":         f"{AWS_BASE}/Compute/Lambda.png",
    "APIGateway":     f"{AWS_BASE}/NetworkingContentDelivery/APIGateway.png",
    "EventBridge":    f"{AWS_BASE}/ApplicationIntegration/EventBridge.png",
    "SecretsManager": f"{AWS_BASE}/SecurityIdentityCompliance/SecretsManager.png",
    "NATGateway":     f"{AWS_BASE}/NetworkingContentDelivery/VPCNATGateway.png",
    "VPC":            f"{AWS_BASE}/NetworkingContentDelivery/VirtualPrivateCloud.png",
    "CloudWatch":     f"{AWS_BASE}/ManagementGovernance/CloudWatch.png",
    "IAM":            f"{AWS_BASE}/SecurityIdentityCompliance/IdentityandAccessManagement.png",
}

# App/service logos from Iconify's logos pack (MIT/CC-BY, hosted SVG).
LOGO_SVGS: Dict[str, str] = {
    "mongodb":    "https://api.iconify.design/logos/mongodb-icon.svg",
    "redis":      "https://api.iconify.design/logos/redis.svg",
    "openai":     "https://api.iconify.design/simple-icons/openai.svg?color=%2310A37F",
    "jira":       "https://api.iconify.design/logos/jira.svg",
    "confluence": "https://api.iconify.design/logos/confluence.svg",
    "github":     "https://api.iconify.design/logos/github-icon.svg",
    "nodejs":     "https://api.iconify.design/logos/nodejs-icon.svg",
    "vscode":     "https://api.iconify.design/logos/visual-studio-code.svg",
    "python":     "https://api.iconify.design/logos/python.svg",
    "bitsPilani": "https://api.iconify.design/mdi/school.svg?color=%2322D3EE",
}


def _download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    dest.write_bytes(r.content)


def _svg_to_png(svg_path: Path, png_path: Path, width: int = 256) -> None:
    if png_path.exists() and png_path.stat().st_size > 0:
        return
    svg_bytes = svg_path.read_bytes()
    png = resvg_py.svg_to_bytes(
        svg_string=svg_bytes.decode("utf-8"),
        width=width,
    )
    png_path.write_bytes(bytes(png))


def fetch_all() -> None:
    print("Fetching AWS icons…")
    for name, url in AWS_ICONS.items():
        dest = AWS_DIR / f"{name}.png"
        _download(url, dest)
        print(f"  ✓ {dest.relative_to(ROOT)}")

    print("Fetching service logos…")
    for name, url in LOGO_SVGS.items():
        svg_dest = LOGO_DIR / f"{name}.svg"
        png_dest = LOGO_DIR / f"{name}.png"
        _download(url, svg_dest)
        _svg_to_png(svg_dest, png_dest, width=512)
        print(f"  ✓ {png_dest.relative_to(ROOT)}")

    print("Done.")


if __name__ == "__main__":
    fetch_all()
