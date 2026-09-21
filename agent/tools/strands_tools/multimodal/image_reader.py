"""
Image processing tool for Strands Agent.

This module provides functionality to read image files from disk and convert them
into the required format for use with the Converse API in Strands Agent. It supports
various image formats including PNG, JPEG, GIF, and WebP, with automatic format detection.

Key Features:
1. Image Processing:
   • Automatic format detection (PNG, JPEG/JPG, GIF, WebP)
   • Binary file handling
   • Error handling for invalid files

2. File Path Handling:
   • Support for absolute paths
   • User directory expansion (~/path/to/image.png)
   • Path validation and error reporting

3. Response Format:
   • Properly formatted image content for Converse API
   • Format-specific processing
   • Binary data conversion

Usage with Strands Agent:
```python
from strands import Agent
from strands_tools import image_reader

agent = Agent(tools=[image_reader])

# Basic usage - read an image file
result = agent.tool.image_reader(image_path="/path/to/image.jpg")

# With user directory path
result = agent.tool.image_reader(image_path="~/Documents/images/photo.png")
```

See the image_reader function docstring for more details on parameters and return format.
"""

import os
from os.path import expanduser
from typing import Any, Dict

from strands import tool

from strands_tools.utils.image_processing import cache_image_bytes, compress_image_bytes, load_screenshot_config


@tool
def image_reader(image_path: str) -> Dict[str, Any]:
    """
    Read an image file from disk and prepare it for use with Converse API.

    This function reads image files from the specified path, compresses them to JPEG
    at 60% quality to reduce token usage, and converts the content into the proper
    format required by the Converse API.

    Args:
        image_path: Path to the image file to read. Can be absolute or user-relative (with ~/)

    Returns:
        A dictionary containing the status and content:
        - On success: Returns image data formatted for the Converse API
          {
              "status": "success",
              "content": [{"image": {"format": "jpeg", "source": {"bytes": <binary_data>}}}]
          }
        - On failure: Returns an error message
          {
              "status": "error",
              "content": [{"text": "Error message"}]
          }

    Notes:
        - Images are converted to JPEG with size limits from STRANDS_SCREENSHOT_* env vars
        - Large images are resized to a max dimension before compression
        - The function validates file existence before attempting to read
        - User paths with tilde (~) are automatically expanded
        - Relative paths are resolved from current working directory
    """
    try:
        # Expand user paths (~) and resolve relative paths to absolute
        file_path = expanduser(image_path)
        if not os.path.isabs(file_path):
            file_path = os.path.abspath(file_path)

        if not os.path.exists(file_path):
            return {
                "status": "error",
                "content": [{"text": f"File not found at path: {file_path}"}],
            }

        config = load_screenshot_config()
        with open(file_path, "rb") as handle:
            raw_bytes = handle.read()

        compressed_bytes, info = compress_image_bytes(raw_bytes, config)
        cache_path = cache_image_bytes(compressed_bytes, config, prefix="image_reader")

        if not info["fits"]:
            note = (
                "Image cached but omitted from context "
                f"({round(info['bytes'] / 1024, 1)} KB > {round(config.max_bytes / 1024, 1)} KB)"
            )
            if cache_path:
                note = f"{note}. Cache: {cache_path}"
            return {"status": "success", "content": [{"text": note}]}

        image_block = {"image": {"format": "jpeg", "source": {"bytes": compressed_bytes}}}
        if cache_path:
            image_block["cache_path"] = cache_path

        return {"status": "success", "content": [image_block]}
    except Exception as e:
        return {
            "status": "error",
            "content": [{"text": f"Error reading file: {str(e)}"}],
        }
