"""Build multi-size PNG + Windows ICO from master app icon."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "lhb-app-icon-1024.png"
PNG_DIR = ROOT / "png"
ICO_PATH = ROOT / "LHBStockAnalyzer.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing source icon: {SRC}")

    img = Image.open(SRC).convert("RGBA")
    PNG_DIR.mkdir(parents=True, exist_ok=True)

    for s in SIZES:
        resized = img.resize((s, s), Image.Resampling.LANCZOS)
        out = PNG_DIR / f"icon-{s}x{s}.png"
        resized.save(out, format="PNG")
        print(f"wrote {out}")

    # Embed standard ICO sizes from a high-quality master
    base = img.resize((256, 256), Image.Resampling.LANCZOS)
    base.save(ICO_PATH, format="ICO", sizes=[(s, s) for s in SIZES])
    print(f"wrote {ICO_PATH}")


if __name__ == "__main__":
    main()
