"""
Sandboxed Tools - File and shell operations restricted to agent sandbox directory.

All file operations are confined to:
    ~/Library/Application Support/RonBrowser/agent-sandbox/

Path traversal attacks (../) are blocked.
"""

import logging
import os
import platform
from pathlib import Path
from typing import Any, Dict

from strands import tool

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# Sandbox Configuration
# ═══════════════════════════════════════════════════════════════════════════════

def _get_sandbox_root() -> str:
    """Get the sandbox root directory based on platform."""
    if platform.system() == "Darwin":  # macOS
        base = os.path.expanduser("~/Library/Application Support")
    elif platform.system() == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:  # Linux
        base = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    
    return os.path.join(base, "RonBrowser", "agent-sandbox")

SANDBOX_ROOT = _get_sandbox_root()


def _ensure_sandbox_exists() -> None:
    """Create sandbox directory if it doesn't exist."""
    os.makedirs(SANDBOX_ROOT, exist_ok=True)
    logger.info(f"Sandbox directory: {SANDBOX_ROOT}")


def _resolve_sandbox_path(relative_path: str) -> str:
    """
    Resolve a path within the sandbox, preventing traversal attacks.
    
    Args:
        relative_path: Path relative to sandbox root (e.g., "project/file.py")
        
    Returns:
        Absolute path within sandbox
        
    Raises:
        ValueError: If path attempts to escape sandbox
    """
    _ensure_sandbox_exists()
    
    clean_path = relative_path.lstrip("/").lstrip("\\")
    sandbox_root = Path(SANDBOX_ROOT).resolve()
    full_path = (sandbox_root / clean_path).resolve(strict=False)

    try:
        full_path.relative_to(sandbox_root)
    except ValueError as exc:
        raise ValueError(f"Path traversal blocked: '{relative_path}' resolves outside sandbox") from exc

    return str(full_path)


# ═══════════════════════════════════════════════════════════════════════════════
# Sandboxed File Tools
# ═══════════════════════════════════════════════════════════════════════════════

@tool
def sandboxed_file_read(path: str) -> Dict[str, Any]:
    """Read a file from the agent sandbox.
    
    All paths are relative to the sandbox directory. You cannot access
    files outside the sandbox.
    
    Args:
        path: Relative path within sandbox (e.g., "project/main.py")
        
    Returns:
        Dict with file content or error
    """
    try:
        full_path = _resolve_sandbox_path(path)
        
        if not os.path.exists(full_path):
            return {
                "status": "error",
                "content": [{"text": f"File not found: {path}"}]
            }
        
        if not os.path.isfile(full_path):
            return {
                "status": "error", 
                "content": [{"text": f"Not a file: {path}"}]
            }
        
        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return {
            "status": "success",
            "content": [{"text": content}]
        }
        
    except ValueError as e:
        return {"status": "error", "content": [{"text": str(e)}]}
    except Exception as e:
        logger.error(f"sandboxed_file_read error: {e}")
        return {"status": "error", "content": [{"text": f"Read failed: {str(e)}"}]}


@tool
def sandboxed_file_write(path: str, content: str) -> Dict[str, Any]:
    """Write a file to the agent sandbox.
    
    All paths are relative to the sandbox directory. Parent directories
    will be created automatically.
    
    Args:
        path: Relative path within sandbox (e.g., "project/main.py")
        content: File content to write
        
    Returns:
        Dict with success status or error
    """
    try:
        full_path = _resolve_sandbox_path(path)
        
        # Create parent directories
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return {
            "status": "success",
            "content": [{"text": f"Wrote {len(content)} bytes to {path}"}]
        }
        
    except ValueError as e:
        return {"status": "error", "content": [{"text": str(e)}]}
    except Exception as e:
        logger.error(f"sandboxed_file_write error: {e}")
        return {"status": "error", "content": [{"text": f"Write failed: {str(e)}"}]}


@tool
def sandboxed_list_files(path: str = "") -> Dict[str, Any]:
    """List files in a sandbox directory.
    
    Args:
        path: Relative path within sandbox (default: root)
        
    Returns:
        Dict with file listing or error
    """
    try:
        full_path = _resolve_sandbox_path(path) if path else SANDBOX_ROOT
        _ensure_sandbox_exists()
        
        if not os.path.exists(full_path):
            return {
                "status": "error",
                "content": [{"text": f"Directory not found: {path or '/'}"}]
            }
        
        if not os.path.isdir(full_path):
            return {
                "status": "error",
                "content": [{"text": f"Not a directory: {path}"}]
            }
        
        entries = []
        for entry in os.listdir(full_path):
            entry_path = os.path.join(full_path, entry)
            entry_type = "dir" if os.path.isdir(entry_path) else "file"
            size = os.path.getsize(entry_path) if os.path.isfile(entry_path) else None
            entries.append({
                "name": entry,
                "type": entry_type,
                "size": size
            })
        
        return {
            "status": "success",
            "content": [{"json": entries}]
        }
        
    except ValueError as e:
        return {"status": "error", "content": [{"text": str(e)}]}
    except Exception as e:
        logger.error(f"sandboxed_list_files error: {e}")
        return {"status": "error", "content": [{"text": f"List failed: {str(e)}"}]}


@tool
def sandboxed_delete_file(path: str) -> Dict[str, Any]:
    """Delete a file from the agent sandbox.
    
    Args:
        path: Relative path within sandbox
        
    Returns:
        Dict with success status or error
    """
    try:
        full_path = _resolve_sandbox_path(path)
        
        if not os.path.exists(full_path):
            return {
                "status": "error",
                "content": [{"text": f"File not found: {path}"}]
            }
        
        if os.path.isdir(full_path):
            import shutil
            shutil.rmtree(full_path)
        else:
            os.remove(full_path)
        
        return {
            "status": "success",
            "content": [{"text": f"Deleted: {path}"}]
        }
        
    except ValueError as e:
        return {"status": "error", "content": [{"text": str(e)}]}
    except Exception as e:
        logger.error(f"sandboxed_delete_file error: {e}")
        return {"status": "error", "content": [{"text": f"Delete failed: {str(e)}"}]}


@tool
def get_sandbox_info() -> Dict[str, Any]:
    """Get information about the agent sandbox.
    
    Returns:
        Dict with sandbox root path and usage info
    """
    _ensure_sandbox_exists()
    
    # Calculate total size
    total_size = 0
    file_count = 0
    for root, _dirs, files in os.walk(SANDBOX_ROOT):
        for f in files:
            total_size += os.path.getsize(os.path.join(root, f))
            file_count += 1
    
    return {
        "status": "success",
        "content": [{
            "json": {
                "root": SANDBOX_ROOT,
                "total_files": file_count,
                "total_size_bytes": total_size,
                "total_size_mb": round(total_size / (1024 * 1024), 2)
            }
        }]
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Exports
# ═══════════════════════════════════════════════════════════════════════════════

__all__ = [
    "sandboxed_file_read",
    "sandboxed_file_write", 
    "sandboxed_list_files",
    "sandboxed_delete_file",
    "get_sandbox_info",
    "SANDBOX_ROOT",
]
