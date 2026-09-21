import hashlib
import io
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from PIL import Image

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScreenshotConfig:
    max_dimension: int
    jpeg_quality: int
    max_bytes: int
    cache_dir: Path
    cache_ttl_seconds: int
    cache_max_items: int
    min_dimension: int
    min_quality: int


def _clamp_int(value: Optional[str], minimum: int, maximum: int, default: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        return default
    return max(minimum, min(parsed, maximum))


def load_screenshot_config() -> ScreenshotConfig:
    max_dimension = _clamp_int(os.getenv("STRANDS_SCREENSHOT_MAX_DIMENSION"), 256, 2048, 640)
    jpeg_quality = _clamp_int(os.getenv("STRANDS_SCREENSHOT_JPEG_QUALITY"), 20, 95, 45)
    max_bytes = _clamp_int(os.getenv("STRANDS_SCREENSHOT_MAX_BYTES"), 50_000, 5_000_000, 450_000)
    cache_dir = Path(os.getenv("STRANDS_SCREENSHOT_CACHE_DIR", os.path.join("screenshots", "cache")))
    cache_ttl_seconds = _clamp_int(os.getenv("STRANDS_SCREENSHOT_CACHE_TTL_SECONDS"), 60, 86_400, 1_800)
    cache_max_items = _clamp_int(os.getenv("STRANDS_SCREENSHOT_CACHE_MAX_ITEMS"), 1, 500, 50)

    min_dimension = 256
    min_quality = 25

    return ScreenshotConfig(
        max_dimension=max_dimension,
        jpeg_quality=jpeg_quality,
        max_bytes=max_bytes,
        cache_dir=cache_dir,
        cache_ttl_seconds=cache_ttl_seconds,
        cache_max_items=cache_max_items,
        min_dimension=min_dimension,
        min_quality=min_quality,
    )


def _normalize_image(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        return background
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def _resize_to_max(img: Image.Image, max_dimension: int) -> Image.Image:
    if img.width <= max_dimension and img.height <= max_dimension:
        return img
    ratio = min(max_dimension / img.width, max_dimension / img.height)
    new_size = (max(1, int(img.width * ratio)), max(1, int(img.height * ratio)))
    return img.resize(new_size, Image.LANCZOS)


def compress_image_bytes(
    raw_bytes: bytes,
    config: ScreenshotConfig,
    max_dimension: Optional[int] = None,
    jpeg_quality: Optional[int] = None,
) -> Tuple[bytes, Dict[str, Any]]:
    if not raw_bytes:
        return b"", {"bytes": 0, "width": 0, "height": 0, "quality": config.jpeg_quality, "fits": True}

    dimension = max_dimension or config.max_dimension
    quality = jpeg_quality or config.jpeg_quality
    dimension = _clamp_int(str(dimension), config.min_dimension, config.max_dimension, config.max_dimension)
    quality = _clamp_int(str(quality), config.min_quality, 95, config.jpeg_quality)

    with Image.open(io.BytesIO(raw_bytes)) as img:
        base_img = _normalize_image(img).copy()

    resized = base_img
    for _ in range(5):
        resized = _resize_to_max(base_img, dimension)
        buffer = io.BytesIO()
        resized.save(buffer, format="JPEG", quality=quality, optimize=True)
        output_bytes = buffer.getvalue()
        fits = len(output_bytes) <= config.max_bytes
        if fits or (dimension <= config.min_dimension and quality <= config.min_quality):
            return output_bytes, {
                "bytes": len(output_bytes),
                "width": resized.width,
                "height": resized.height,
                "quality": quality,
                "fits": fits,
            }

        if dimension > config.min_dimension:
            dimension = max(config.min_dimension, int(dimension * 0.85))
        if quality > config.min_quality:
            quality = max(config.min_quality, quality - 10)

    return output_bytes, {
        "bytes": len(output_bytes),
        "width": resized.width,
        "height": resized.height,
        "quality": quality,
        "fits": len(output_bytes) <= config.max_bytes,
    }


def _cleanup_cache_dir(config: ScreenshotConfig) -> None:
    if not config.cache_dir.exists():
        return

    files = [p for p in config.cache_dir.iterdir() if p.is_file()]
    if not files:
        return

    now = time.time()
    if config.cache_ttl_seconds > 0:
        cutoff = now - config.cache_ttl_seconds
        for path in files:
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
            except OSError:
                continue

    files = [p for p in config.cache_dir.iterdir() if p.is_file()]
    if config.cache_max_items and len(files) > config.cache_max_items:
        files.sort(key=lambda p: p.stat().st_mtime)
        for path in files[: max(0, len(files) - config.cache_max_items)]:
            try:
                path.unlink()
            except OSError:
                continue


def cache_image_bytes(
    image_bytes: bytes,
    config: ScreenshotConfig,
    prefix: str = "screenshot",
) -> Optional[str]:
    if not image_bytes:
        return None

    try:
        config.cache_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha1(image_bytes).hexdigest()[:10]
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        filename = f"{prefix}_{timestamp}_{digest}.jpg"
        path = config.cache_dir / filename
        path.write_bytes(image_bytes)
        _cleanup_cache_dir(config)
        return str(path)
    except Exception as exc:
        logger.warning("Failed to cache screenshot bytes: %s", exc)
        return None
