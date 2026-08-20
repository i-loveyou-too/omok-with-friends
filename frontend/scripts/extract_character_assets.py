"""Extract UI-ready character sprites from the four approved master sheets.

This script performs only deterministic crop, scale, and placement operations.
It never combines characters or generates new artwork.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "design" / "references" / "characters"
OUTPUT_DIR = ROOT / "frontend" / "src" / "assets" / "characters"
CANVAS_SIZE = 512
CONTENT_SIZE = 430
BASELINE = 472


SHEETS: dict[str, tuple[str, dict[str, tuple[int, int, int, int]]]] = {
    "chiikawa": (
        "chiikawa-final-master.png",
        {
            "idle": (270, 18, 520, 276),
            "selected": (520, 20, 770, 276),
            "my-turn": (760, 20, 1018, 276),
            "waiting": (18, 270, 270, 526),
            "thinking": (270, 270, 520, 526),
            "win": (8, 992, 270, 1254),
            "lose": (270, 755, 520, 1020),
            "disconnected": (995, 515, 1254, 780),
            "reconnected": (8, 755, 275, 1020),
            "reaction-laugh": (520, 20, 770, 276),
            "reaction-surprised": (8, 755, 275, 1020),
            "reaction-wait": (270, 270, 520, 526),
            "reaction-mistake": (270, 755, 520, 1020),
            "reaction-clap": (255, 990, 525, 1254),
            "reaction-angry": (500, 755, 775, 1020),
        },
    ),
    "hachiware": (
        "hachiware-final-master.png",
        {
            "idle": (305, 0, 555, 250),
            "selected": (545, 0, 790, 250),
            "my-turn": (0, 225, 280, 465),
            "waiting": (270, 225, 540, 465),
            "thinking": (500, 220, 800, 465),
            "win": (0, 805, 280, 1024),
            "lose": (1000, 0, 1270, 250),
            "disconnected": (0, 625, 275, 850),
            "reconnected": (1240, 625, 1536, 850),
            "reaction-laugh": (545, 0, 790, 250),
            "reaction-surprised": (760, 430, 1030, 675),
            "reaction-wait": (500, 220, 800, 465),
            "reaction-mistake": (1000, 0, 1270, 250),
            "reaction-clap": (500, 625, 800, 850),
            "reaction-angry": (990, 430, 1280, 675),
        },
    ),
    "usagi": (
        "usagi-final-master.png",
        {
            "idle": (330, 0, 570, 245),
            "selected": (510, 0, 760, 245),
            "my-turn": (710, 0, 985, 245),
            "waiting": (655, 205, 920, 430),
            "thinking": (880, 605, 1110, 835),
            "win": (0, 600, 260, 835),
            "lose": (430, 600, 675, 835),
            "disconnected": (1050, 600, 1300, 835),
            "reconnected": (430, 842, 675, 1024),
            "reaction-laugh": (510, 0, 760, 245),
            "reaction-surprised": (1090, 205, 1330, 430),
            "reaction-wait": (880, 605, 1110, 835),
            "reaction-mistake": (430, 600, 675, 835),
            "reaction-clap": (1090, 440, 1335, 640),
            "reaction-angry": (430, 600, 675, 835),
        },
    ),
    "momonga": (
        "momonga-final-master.png",
        {
            "idle": (285, 0, 545, 225),
            "selected": (510, 0, 785, 225),
            "my-turn": (745, 0, 1025, 225),
            "waiting": (985, 0, 1270, 225),
            "thinking": (625, 195, 900, 435),
            "win": (1230, 0, 1536, 225),
            "lose": (875, 785, 1145, 1024),
            "disconnected": (1120, 785, 1360, 1024),
            "reconnected": (230, 785, 520, 1024),
            "reaction-laugh": (510, 0, 785, 225),
            "reaction-surprised": (0, 405, 270, 650),
            "reaction-wait": (625, 195, 900, 435),
            "reaction-mistake": (875, 785, 1145, 1024),
            "reaction-clap": (230, 785, 520, 1024),
            "reaction-angry": (650, 785, 920, 1024),
        },
    ),
}


def isolate_sprite(sprite: Image.Image) -> Image.Image:
    """Discard fragments from neighboring grid cells without altering kept pixels."""
    alpha = sprite.getchannel("A")
    width, height = sprite.size
    pixels = alpha.load()
    visited = bytearray(width * height)
    components: list[tuple[int, tuple[int, int, int, int], list[tuple[int, int]]]] = []

    for y in range(height):
        for x in range(width):
            offset = y * width + x
            if visited[offset] or pixels[x, y] <= 4:
                continue
            visited[offset] = 1
            queue = deque([(x, y)])
            points: list[tuple[int, int]] = []
            min_x = max_x = x
            min_y = max_y = y
            while queue:
                cx, cy = queue.popleft()
                points.append((cx, cy))
                min_x, max_x = min(min_x, cx), max(max_x, cx)
                min_y, max_y = min(min_y, cy), max(max_y, cy)
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    neighbor = ny * width + nx
                    if visited[neighbor] or pixels[nx, ny] <= 4:
                        continue
                    visited[neighbor] = 1
                    queue.append((nx, ny))
            components.append((len(points), (min_x, min_y, max_x + 1, max_y + 1), points))

    if not components:
        return sprite

    main = max(components, key=lambda component: component[0])
    _, (main_left, main_top, main_right, main_bottom), _ = main

    def distance_to_main(bounds: tuple[int, int, int, int]) -> int:
        left, top, right, bottom = bounds
        horizontal = max(main_left - right, left - main_right, 0)
        vertical = max(main_top - bottom, top - main_bottom, 0)
        return max(horizontal, vertical)

    kept: list[tuple[int, tuple[int, int, int, int], list[tuple[int, int]]]] = []
    for component in components:
        area, bounds, _ = component
        left, top, right, bottom = bounds
        touches_edge = left <= 1 or top <= 1 or right >= width - 1 or bottom >= height - 1
        if component is main or (area >= 8 and not touches_edge and distance_to_main(bounds) <= 72):
            kept.append(component)

    isolated = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
    source_pixels = sprite.load()
    target_pixels = isolated.load()
    for _, _, points in kept:
        for x, y in points:
            target_pixels[x, y] = source_pixels[x, y]
    return isolated


def normalize_sprite(sheet: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    sprite = isolate_sprite(sheet.crop(box))
    alpha_box = sprite.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"Crop {box} contains no visible pixels")
    sprite = sprite.crop(alpha_box)
    scale = min(CONTENT_SIZE / sprite.width, CONTENT_SIZE / sprite.height)
    size = (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale)))
    sprite = sprite.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    x = (CANVAS_SIZE - sprite.width) // 2
    y = BASELINE - sprite.height
    canvas.alpha_composite(sprite, (x, y))
    return canvas


def main() -> None:
    for character, (source_name, crops) in SHEETS.items():
        sheet = Image.open(SOURCE_DIR / source_name).convert("RGBA")
        target_dir = OUTPUT_DIR / character
        target_dir.mkdir(parents=True, exist_ok=True)
        for state, box in crops.items():
            output = normalize_sprite(sheet, box)
            output.save(target_dir / f"{state}.webp", "WEBP", lossless=True, method=6)
            print(f"{character}/{state}.webp")


if __name__ == "__main__":
    main()
