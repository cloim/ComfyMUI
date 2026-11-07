"""Build the app icons. Run: uv run --with pillow python scripts/build-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "public"
for size in (192, 512):
    image = Image.new("RGB", (512, 512), "#242923")
    draw = ImageDraw.Draw(image)
    accent = "#d3f36a"
    draw.line([(164, 226), (260, 226), (260, 162), (348, 162)], fill=accent, width=26)
    draw.line([(260, 226), (260, 346), (348, 346)], fill=accent, width=26)
    for x, y in ((116, 178), (300, 114), (300, 298)):
        draw.rectangle((x, y, x+96, y+96), fill=accent)
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f"icon-{size}.png")
    print(f"Created icon-{size}.png")
