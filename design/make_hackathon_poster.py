from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "design"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

GENERATED_HERO = Path(
    "/Users/unoxyrich/.codex/generated_images/01a02312-f8b5-7403-9fef-ee0f126b1f77/"
    "exec-a15b6f1f-de34-4f68-b1b5-da3d575441b1.png"
)
LOCKUP = ROOT / "apps/app/assets/brand/clipquest-lockup-on-dark.png"

WIDTH, HEIGHT = 2400, 5400  # exact 80:180 cm ratio, suitable as a large-format proof
CREAM = (244, 247, 240, 255)
MINT = (132, 221, 154, 255)
GREEN = (36, 125, 73, 255)
DEEP = (7, 35, 24, 235)
GOLD = (247, 196, 54, 255)


def font(size: int, index: int = 7) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype("/System/Library/Fonts/Avenir Next.ttc", size, index=index)


def tracked_text(draw: ImageDraw.ImageDraw, xy, text, fnt, fill, tracking: int) -> None:
    x, y = xy
    for character in text:
        draw.text((x, y), character, font=fnt, fill=fill)
        advance = draw.textlength(character, font=fnt)
        x += int(advance + tracking)


def paste_trimmed(base: Image.Image, source: Image.Image, box, anchor="lt") -> None:
    source = source.convert("RGBA")
    alpha = source.getchannel("A")
    bounds = alpha.getbbox()
    if bounds:
        source = source.crop(bounds)
    max_size = (box[2], box[3])
    source.thumbnail(max_size, Image.Resampling.LANCZOS)
    if anchor == "lt":
        position = (box[0], box[1])
    else:
        position = (box[0] - source.width // 2, box[1] - source.height // 2)
    base.alpha_composite(source, position)


def main() -> None:
    background = Image.open(GENERATED_HERO).convert("RGB").resize(
        (WIDTH, HEIGHT), Image.Resampling.LANCZOS
    )
    poster = background.convert("RGBA")

    # A restrained translucent panel keeps the copy legible without hiding the generated art.
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rounded_rectangle(
        (125, 125, 2190, 1760),
        radius=78,
        fill=(6, 34, 22, 155),
        outline=(132, 221, 154, 65),
        width=5,
    )
    poster = Image.alpha_composite(poster, overlay)
    draw = ImageDraw.Draw(poster)

    # Exact brand lockup from the repository, rather than generated lettering.
    paste_trimmed(poster, Image.open(LOCKUP), (225, 330, 1010, 260))

    tracked_text(
        draw,
        (235, 205),
        "HACKATHON ROADSHOW",
        font(72, index=2),
        MINT,
        7,
    )

    headline = font(164, index=8)
    draw.text((225, 835), "TURN WATCHING", font=headline, fill=CREAM)
    draw.text((225, 1030), "INTO", font=headline, fill=CREAM)
    draw.text((225, 1225), "MASTERY.", font=headline, fill=MINT)

    body = font(67, index=5)
    draw.multiline_text(
        (235, 1480),
        "Paste a public YouTube lesson.\nGet a grounded quiz. Build real mastery.",
        font=body,
        fill=CREAM,
        spacing=18,
    )

    # Footer band turns the image into a readable roadshow poster from a distance.
    footer_top = 4500
    draw.rectangle((0, footer_top, WIDTH, HEIGHT), fill=DEEP)
    draw.line((225, footer_top + 88, WIDTH - 225, footer_top + 88), fill=(132, 221, 154, 110), width=4)

    step_font = font(60, index=2)
    step_detail = font(48, index=5)
    steps = [(240, "01", "PASTE"), (920, "02", "QUIZ"), (1600, "03", "MASTER")]
    for x, number, label in steps:
        draw.text((x, footer_top + 160), number, font=font(54, index=8), fill=GOLD)
        draw.text((x + 112, footer_top + 158), label, font=step_font, fill=CREAM)
    draw.text((240, footer_top + 285), "one lesson at a time", font=step_detail, fill=MINT)
    draw.text((920, footer_top + 285), "answer with feedback", font=step_detail, fill=MINT)
    draw.text((1600, footer_top + 285), "learn what sticks", font=step_detail, fill=MINT)

    cta = (225, footer_top + 485, WIDTH - 225, footer_top + 795)
    draw.rounded_rectangle(cta, radius=42, fill=CREAM)
    draw.text((310, footer_top + 548), "TRY IT LIVE", font=font(98, index=8), fill=GREEN)
    draw.text((310, footer_top + 670), "clipquest.ccwu.cc", font=font(60, index=5), fill=(11, 36, 24, 255))

    # Export both the finished poster and the resized art layer for future variants.
    hero_path = OUTPUT_DIR / "clipquest-hackathon-roadshow-hero.png"
    poster_path = OUTPUT_DIR / "clipquest-hackathon-roadshow-poster.png"
    print_dpi = (76.2, 76.2)  # 2400x5400 px maps to exactly 80x180 cm
    background.save(hero_path, format="PNG", optimize=False, dpi=print_dpi)
    poster.convert("RGB").save(poster_path, format="PNG", optimize=False, dpi=print_dpi)
    print(poster_path)


if __name__ == "__main__":
    main()
