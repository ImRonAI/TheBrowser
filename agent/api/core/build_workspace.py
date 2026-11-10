"""Build Agent workspaces: one private project directory per (user, session).

The Build destination (``ChatRequest.destination="build"``) works in ``<RON_BUILD_ROOT>/<workspace_id>``; the IDE
workbench reads the same directory through ``endpoints/build.py`` (file tree, file read/write, git history, static
preview). Contract: ``docs/build-agent.md``.

* Every path that arrives from a request goes through :func:`resolve_workspace_path`, which only ever returns a real
  path inside the workspace: no NUL bytes, no absolute paths, no ``..`` segment, no symlink that leads out
  (``os.path.realpath`` + ``os.path.commonpath``).
* :class:`BuildWorkspaceGuard` is a native ``BeforeToolCallEvent`` plugin (the ``ThinkToolsGuard`` pattern in
  ``panel_tools.py``). The installed ``strands_tools.shell`` runs in the process cwd when ``work_dir`` is omitted
  (``shell.py``: ``if work_dir is None: work_dir = os.getcwd()``) and ``strands_tools.editor`` only
  ``os.path.expanduser``s its ``path``, so a relative path resolves against the process cwd, which for the API is the
  Ron repository. The guard points both at the workspace. It is a default, not a sandbox: an absolute (or ``~``) path
  the model chose is left as it is, because the user may name files outside the workspace, and ``shell``/``editor``
  run on the host like every core tool.
"""

from __future__ import annotations

import asyncio
import codecs
import contextlib
import errno
import hashlib
import json
import logging
import os
import re
import stat
import tempfile
import threading
from collections.abc import Iterator
from pathlib import Path, PurePosixPath
from typing import IO, TYPE_CHECKING, Any

from strands.hooks.events import BeforeToolCallEvent
from strands.plugins import Plugin

from agent.api.core import config as app_config

if TYPE_CHECKING:
    from strands import Agent

logger = logging.getLogger(__name__)

#: Directories the workbench tree never descends into (dependencies, VCS data, caches, build output).
IGNORED_DIRS = frozenset({"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".cache", ".turbo"})
#: Files the tree never lists.
IGNORED_FILES = frozenset({".DS_Store"})
#: Tree entries returned at most; a listing with more says ``truncated``.
MAX_ENTRIES = 2000
#: File content is returned inline up to this size; larger files report ``too_large``.
MAX_INLINE_BYTES = 1024 * 1024
#: Largest content one workbench save may write (UTF-8 bytes).
MAX_WRITE_BYTES = 2 * 1024 * 1024
#: Leading bytes inspected for a NUL to call a file binary.
SNIFF_BYTES = 8192
#: ``.env*`` files larger than this are not scanned for variable names.
MAX_ENV_BYTES = 256 * 1024
#: Mode of a file the workbench creates (an overwrite keeps the file's own mode).
NEW_FILE_MODE = 0o644
#: Each git subprocess is killed after this many seconds.
GIT_TIMEOUT_SECONDS = 10.0
#: A workspace id: the first 32 hex digits of sha256(user_id \n session_id).
WORKSPACE_ID = re.compile(r"[0-9a-f]{32}")


# --- Workspace identity -------------------------------------------------------------------------------------------

def build_root() -> Path:
    """``RON_BUILD_ROOT`` with symlinks resolved (read per call, so it can be repointed)."""
    return Path(os.path.realpath(Path(app_config.RON_BUILD_ROOT).expanduser()))


def workspace_id(user_id: str, session_id: str) -> str:
    """The stable id of a (user, session) workspace; it reveals neither value."""
    return hashlib.sha256(f"{user_id}\n{session_id}".encode("utf-8")).hexdigest()[:32]


def workspace_root(user_id: str, session_id: str) -> Path:
    return build_root() / workspace_id(user_id, session_id)


def ensure_private_dir(root: Path) -> Path:
    """Create ``root`` (and the build root) owner-only, 0o700, if missing; an existing directory is left as it is."""
    root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        root.mkdir(mode=0o700)
    except FileExistsError:
        if not root.is_dir():
            raise
    else:
        os.chmod(root, 0o700)  # mkdir's mode is filtered through the umask
    return root


def ensure_workspace(user_id: str, session_id: str) -> Path:
    """The (user, session) workspace, created owner-only (0o700) on first use."""
    return ensure_private_dir(workspace_root(user_id, session_id))


# --- Path confinement ---------------------------------------------------------------------------------------------

class WorkspacePathError(ValueError):
    """A request path that does not name something inside the workspace."""


class WriteConflict(Exception):
    """A save based on a version of the file that is no longer current (``current`` is its sha256, or None)."""

    def __init__(self, message: str, current: str | None) -> None:
        super().__init__(message)
        self.current = current


class ContentTooLarge(ValueError):
    """A save larger than :data:`MAX_WRITE_BYTES`."""


def relative_path(relative: str) -> str:
    """The canonical POSIX form of a workspace-relative path (``""`` for the workspace itself)."""
    return "/".join(PurePosixPath(relative).parts)


def resolve_workspace_path(root: Path | str, relative: str) -> Path:
    """The real path ``relative`` names inside ``root``; raises :class:`WorkspacePathError` for anything else.

    Rejects NUL bytes, absolute paths and every ``..`` segment, then resolves symlinks and requires the result to stay
    under the real workspace root, so no symlink (at any depth) leads out. ``""`` and ``"."`` name the root itself.
    """
    if "\x00" in relative:
        raise WorkspacePathError("path contains a NUL byte")
    if os.path.isabs(relative):
        raise WorkspacePathError("path must be relative to the workspace")
    parts = PurePosixPath(relative).parts
    if ".." in parts:
        raise WorkspacePathError("path must not contain '..'")
    base = os.path.realpath(root)
    target = os.path.realpath(os.path.join(base, *parts))
    if os.path.commonpath([base, target]) != base:
        raise WorkspacePathError("path leads outside the workspace")
    return Path(target)


def _inside(base: str, target: str) -> bool:
    return os.path.commonpath([base, target]) == base


def _millis(info: os.stat_result) -> int:
    return int(info.st_mtime * 1000)


# --- Listing ------------------------------------------------------------------------------------------------------

#: One listable child: (name, relative path, "file" | "dir", stat, absolute path, expand into it).
_Child = tuple[str, str, str, os.stat_result, str, bool]


def _children(base: str, directory: str, rel: str, ignored: set[str]) -> list[_Child]:
    """One directory's listable children: sub-directories first, then files, each by name (case-insensitive).

    A symlink is listed as what it points to only when that stays inside the workspace, and is never expanded (so a
    link cannot loop); one that leads out or dangles is left out, so the tree never reveals metadata from outside.
    Sockets, FIFOs and devices are not listed.
    """
    try:
        with os.scandir(directory) as scan:
            found = list(scan)
    except OSError:
        return []
    dirs: list[_Child] = []
    files: list[_Child] = []
    for entry in found:
        try:
            if entry.is_symlink():
                target = os.path.realpath(entry.path)
                if not _inside(base, target):
                    continue
                info, expand = os.stat(target), False
            else:
                info, expand = entry.stat(follow_symlinks=False), True
        except OSError:
            continue
        child = f"{rel}/{entry.name}" if rel else entry.name
        if stat.S_ISDIR(info.st_mode):
            if entry.name in IGNORED_DIRS:
                ignored.add(entry.name)
            else:
                dirs.append((entry.name, child, "dir", info, entry.path, expand))
        elif stat.S_ISREG(info.st_mode) and entry.name not in IGNORED_FILES:
            files.append((entry.name, child, "file", info, entry.path, False))

    def key(item: _Child) -> tuple[str, str]:
        return item[0].casefold(), item[0]

    return sorted(dirs, key=key) + sorted(files, key=key)


def empty_listing() -> dict[str, Any]:
    return {"entries": [], "truncated": False, "ignored": [], "has_index": False, "package": None, "env": []}


def list_workspace(root: Path | str) -> dict[str, Any]:
    """The workbench's view of a workspace.

    ``entries`` is the tree in display order (each directory followed by its contents; within a directory,
    sub-directories first, then files), at most :data:`MAX_ENTRIES` (``truncated`` when more exist). ``ignored`` names
    the :data:`IGNORED_DIRS` met while listing. ``has_index``/``package``/``env`` describe the workspace root.
    """
    base = os.path.realpath(root)
    entries: list[dict[str, Any]] = []
    ignored: set[str] = set()
    stack = list(reversed(_children(base, base, "", ignored)))
    truncated = False
    while stack:
        if len(entries) >= MAX_ENTRIES:
            truncated = True
            break
        _name, rel, kind, info, path, expand = stack.pop()
        entries.append({"path": rel, "type": kind, "size": info.st_size if kind == "file" else 0,
                        "modified": _millis(info)})
        if expand:
            stack.extend(reversed(_children(base, path, rel, ignored)))
    return {"entries": entries, "truncated": truncated, "ignored": sorted(ignored),
            "has_index": _root_file(base, "index.html") is not None,
            "package": read_package(base), "env": env_names(base)}


def _root_file(base: str, name: str) -> Path | None:
    """``name`` at the workspace root, when it is a regular file inside the workspace."""
    try:
        path = resolve_workspace_path(base, name)
    except WorkspacePathError:
        return None
    return path if path.is_file() else None


def read_package(base: Path | str) -> dict[str, Any] | None:
    """The root ``package.json`` facts the workbench shows; ``None`` when it is absent or not a JSON object."""
    path = _root_file(os.path.realpath(base), "package.json")
    if path is None:
        return None
    try:
        if path.stat().st_size > MAX_INLINE_BYTES:
            return None
        raw = json.loads(path.read_bytes())
    except (OSError, ValueError, RecursionError):
        return None
    if not isinstance(raw, dict):
        return None

    def text(key: str) -> str | None:
        value = raw.get(key)
        return value if isinstance(value, str) else None

    def table(key: str) -> dict[str, str]:
        value = raw.get(key)
        return {name: spec for name, spec in value.items() if isinstance(spec, str)} if isinstance(value, dict) else {}

    return {"name": text("name"), "version": text("version"), "description": text("description"),
            "scripts": table("scripts"), "dependencies": table("dependencies"),
            "devDependencies": table("devDependencies")}


_ENV_ASSIGNMENT = re.compile(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=")


def env_names(base: Path | str) -> list[dict[str, str]]:
    """Variable names (never values) assigned in the root ``.env*`` files, file by file, each once per file."""
    base = os.path.realpath(base)
    try:
        filenames = sorted(name for name in os.listdir(base) if name.startswith(".env"))
    except OSError:
        return []
    found: list[dict[str, str]] = []
    for filename in filenames:
        path = _root_file(base, filename)
        if path is None:
            continue
        try:
            if path.stat().st_size > MAX_ENV_BYTES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        seen: set[str] = set()
        for name in _assigned_names(text):
            if name not in seen:
                seen.add(name)
                found.append({"name": name, "file": filename})
    return found


def _assigned_names(text: str) -> Iterator[str]:
    """Names assigned in dotenv text. Lines inside a quoted multi-line value are skipped, never read as names."""
    quote = ""
    for line in text.splitlines():
        if quote:
            if _closes(line, quote):
                quote = ""
            continue
        match = _ENV_ASSIGNMENT.match(line)
        if match is None:
            continue
        yield match.group(1)
        value = line[match.end():].lstrip()
        if value[:1] in ("'", '"', "`") and not _closes(value[1:], value[0]):
            quote = value[0]


def _closes(text: str, quote: str) -> bool:
    """Whether ``text`` holds the closing ``quote``; inside double quotes a backslash escapes it."""
    index = text.find(quote)
    while index != -1:
        backslashes = len(text[:index]) - len(text[:index].rstrip("\\"))
        if quote != '"' or backslashes % 2 == 0:
            return True
        index = text.find(quote, index + 1)
    return False


# --- Files --------------------------------------------------------------------------------------------------------

_WRITE_LOCK = threading.Lock()


def _open_regular(path: Path) -> tuple[IO[bytes], os.stat_result]:
    """Open a regular file for reading without ever blocking on a FIFO swapped in after a check."""
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    try:
        info = os.fstat(fd)
        if stat.S_ISDIR(info.st_mode):
            raise IsADirectoryError(errno.EISDIR, "path is a directory")
        if not stat.S_ISREG(info.st_mode):
            raise WorkspacePathError("path is not a regular file")
    except BaseException:
        os.close(fd)
        raise
    return os.fdopen(fd, "rb"), info


def _file_path(root: Path | str, relative: str) -> tuple[Path, str]:
    path = resolve_workspace_path(root, relative)
    rel = relative_path(relative)
    if not rel:
        raise IsADirectoryError(errno.EISDIR, "path is a directory")
    return path, rel


def read_file(root: Path | str, relative: str) -> dict[str, Any]:
    """A workspace file for the editor; ``content`` only when it is UTF-8 text of at most :data:`MAX_INLINE_BYTES`.

    ``binary`` means a NUL in the first :data:`SNIFF_BYTES` or bytes that are not UTF-8; ``sha256`` always covers the
    whole file and is the ``base_sha256`` a later save must send.
    """
    path, rel = _file_path(root, relative)
    handle, info = _open_regular(path)
    with handle:
        head = handle.read(MAX_INLINE_BYTES + 1)
        digest = hashlib.sha256(head)
        size = len(head)
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
            size += len(chunk)
    too_large = size > MAX_INLINE_BYTES
    binary = b"\x00" in head[:SNIFF_BYTES]
    content: str | None = None
    if not binary:
        try:
            if too_large:
                codecs.getincrementaldecoder("utf-8")().decode(head[:SNIFF_BYTES], final=False)
            else:
                content = head.decode("utf-8")
        except UnicodeDecodeError:
            binary = True
    return {"path": rel, "size": size, "modified": _millis(info), "sha256": digest.hexdigest(),
            "binary": binary, "too_large": too_large, "content": content}


def _current(path: Path) -> tuple[str | None, int]:
    """sha256 and mode of the file at ``path``; ``(None, NEW_FILE_MODE)`` when there is none."""
    try:
        handle, info = _open_regular(path)
    except FileNotFoundError:
        return None, NEW_FILE_MODE
    digest = hashlib.sha256()
    with handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest(), stat.S_IMODE(info.st_mode)


def write_file(root: Path | str, relative: str, content: str, base_sha256: str | None) -> dict[str, Any]:
    """Save ``content`` (UTF-8) at ``relative``, atomically, with optimistic concurrency.

    An empty ``base_sha256`` creates only (an existing file is a :class:`WriteConflict`); otherwise the file's current
    sha256 must equal it. The bytes go to a temporary file in the same directory that ``os.replace`` moves into place,
    so a reader never sees half a file; parent directories are created; an overwrite keeps the file's mode.
    """
    data = content.encode("utf-8")
    if len(data) > MAX_WRITE_BYTES:
        raise ContentTooLarge(f"content is {len(data)} bytes; the limit is {MAX_WRITE_BYTES}")
    path, rel = _file_path(root, relative)
    with _WRITE_LOCK:
        current, mode = _current(path)
        if not base_sha256:
            if current is not None:
                raise WriteConflict("The file already exists", current)
        elif current != base_sha256.lower():
            raise WriteConflict("The file changed since it was read" if current else "The file no longer exists",
                                current)
        ensure_private_dir(Path(root))
        path.parent.mkdir(parents=True, exist_ok=True)
        # Resolved again now that the parents exist: nothing created on the way may lead out of the workspace.
        path = resolve_workspace_path(root, relative)
        fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, mode)
            os.replace(temporary, path)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temporary)
            raise
        info = os.stat(path)
    return {"path": rel, "size": len(data), "modified": _millis(info), "sha256": hashlib.sha256(data).hexdigest()}


def delete_file(root: Path | str, relative: str) -> None:
    """Remove one file (a symlink inside the workspace is removed itself, not its target). Directories are refused."""
    path, rel = _file_path(root, relative)
    info = os.stat(path)
    if stat.S_ISDIR(info.st_mode):
        raise IsADirectoryError(errno.EISDIR, "path is a directory")
    if not stat.S_ISREG(info.st_mode):
        raise WorkspacePathError("path is not a regular file")
    with _WRITE_LOCK:
        os.unlink(os.path.join(os.path.realpath(root), *PurePosixPath(rel).parts))


# --- Preview ------------------------------------------------------------------------------------------------------

#: Types ``mimetypes`` gets wrong for a web project (``.ts`` is MPEG transport stream there) or does not know.
_PREVIEW_TYPES = {".ts": "text/plain", ".tsx": "text/plain", ".jsx": "text/plain", ".mts": "text/plain",
                  ".cts": "text/plain", ".map": "application/json"}


def preview_target(workspace: str, relative: str) -> tuple[Path | None, bool]:
    """``(file to serve, the path named a directory)`` for ``/build/preview/<workspace>/<relative>``.

    The file is ``None`` (404) for a malformed id, a missing workspace or file, a path that leaves the workspace, or
    any dot segment (``.env``, ``.git/…``, ``.ren-dev.log``: the preview is served with ``Access-Control-Allow-Origin:
    *``, so it never hands those to a page). A directory, or the empty path, serves its ``index.html``.
    """
    if not WORKSPACE_ID.fullmatch(workspace):
        return None, False
    root = build_root() / workspace
    parts = PurePosixPath(relative).parts
    if not root.is_dir() or any(part.startswith(".") for part in parts):
        return None, False
    try:
        target = resolve_workspace_path(root, relative)
        directory = target.is_dir()
        if directory:
            target = resolve_workspace_path(root, "/".join((*parts, "index.html")))
    except WorkspacePathError:
        return None, False
    return (target if target.is_file() else None), directory


def preview_media_type(path: Path) -> str | None:
    """The preview's Content-Type override for ``path``, or ``None`` for Starlette's ``mimetypes`` guess."""
    return _PREVIEW_TYPES.get(path.suffix.lower())


# --- Git ----------------------------------------------------------------------------------------------------------

class GitTimeout(RuntimeError):
    """A git subprocess outlived :data:`GIT_TIMEOUT_SECONDS` and was killed."""


#: Read-only queries never run repository-configured programs and keep machine-readable output.
_GIT_CONFIG = ("-c", "core.fsmonitor=false", "-c", "core.quotePath=false", "-c", "color.ui=never",
               "-c", "log.showSignature=false")
#: One commit: \x01 marks its start; fields are NUL-separated (``-z`` makes the record terminator NUL too).
_LOG_FORMAT = "%x01%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%b"
_NUMSTAT = re.compile(r"(\d+|-)\t(\d+|-)\t(.*)", re.S)
#: A ``--raw`` record header: ``:<old mode> <new mode> <old sha> <new sha> <status letter><score?>``.
_RAW = re.compile(r":\S+ \S+ \S+ \S+ ([A-Z])\d*")


def _git_env(base: str) -> dict[str, str]:
    """The caller's environment without GIT_* overrides; git never prompts, never takes optional locks (so a poll
    does not contend with the agent's own git), and never looks above the workspace for a repository."""
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0", GIT_CEILING_DIRECTORIES=os.path.dirname(base))
    return env


async def _git(base: str, *args: str) -> tuple[int, bytes]:
    """Run git in ``base`` (no shell, stdin closed); raises :class:`GitTimeout`, or FileNotFoundError without git."""
    process = await asyncio.create_subprocess_exec(
        "git", *_GIT_CONFIG, *args, cwd=base, env=_git_env(base),
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), GIT_TIMEOUT_SECONDS)
    except BaseException as exc:
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()
        if isinstance(exc, TimeoutError):
            raise GitTimeout(f"git {args[0]} did not finish within {GIT_TIMEOUT_SECONDS:g} seconds") from exc
        raise
    code = process.returncode if process.returncode is not None else -1
    if code != 0:
        logger.debug("workspace=<%s>, args=<%s>, code=<%s> | git: %s", os.path.basename(base), args[0], code,
                     stderr.decode("utf-8", "replace").strip())
    return code, stdout


async def git_summary(root: Path | str, limit: int = 30) -> dict[str, Any]:
    """The workspace repository for the workbench: branch, the newest ``limit`` commits with their files, and the
    working-tree changes. ``repo`` is false when the workspace is not itself a repository or git is not installed."""
    summary: dict[str, Any] = {"repo": False, "branch": None, "commits": [], "dirty": []}
    base = os.path.realpath(root)
    if not os.path.isdir(base):
        return summary
    try:
        code, out = await _git(base, "rev-parse", "--show-toplevel")
    except FileNotFoundError:
        return summary
    if code != 0 or os.path.realpath(out.decode("utf-8", "replace").strip()) != base:
        return summary
    code, out = await _git(base, "branch", "--show-current")
    branch = out.decode("utf-8", "replace").strip() if code == 0 else ""
    commits: list[dict[str, Any]] = []
    code, _ = await _git(base, "rev-parse", "--verify", "--quiet", "HEAD")
    if code == 0:  # an unborn branch has no commits to log yet
        # --raw, not --name-status: git drops --numstat output whenever --name-status/--name-only is given.
        code, out = await _git(base, "log", f"--max-count={limit}", "-z", "--no-color", "--no-ext-diff",
                               "--no-textconv", f"--format={_LOG_FORMAT}", "--raw", "--numstat", "HEAD", "--")
        if code == 0:
            commits = parse_log(out)
    code, out = await _git(base, "status", "--porcelain=v1", "-z", "--untracked-files=normal")
    return {"repo": True, "branch": branch or None, "commits": commits, "dirty": parse_status(out) if code == 0 else []}


def _file_change(path: str) -> dict[str, Any]:
    return {"path": path, "status": "M", "additions": 0, "deletions": 0, "old_path": None}


def parse_log(raw: bytes) -> list[dict[str, Any]]:
    """Parse ``git log -z --format=<_LOG_FORMAT> --raw --numstat``.

    Per commit git writes the seven header fields, a newline, then its ``--raw`` records
    (``:<modes> <shas> X\\0path\\0``, or ``... R<score>\\0old\\0new\\0``) and its ``--numstat`` records
    (``added\\tdeleted\\tpath\\0``, or ``added\\tdeleted\\t\\0old\\0new\\0`` for a rename); merges and empty commits
    carry no records. Binary files count ``-`` (→ 0).
    """
    tokens = raw.decode("utf-8", "replace").split("\x00")
    count, index = len(tokens), 0
    commits: list[dict[str, Any]] = []
    while index < count:
        head = tokens[index].lstrip("\n")
        index += 1
        if not head.startswith("\x01") or index + 6 > count:
            continue
        short, author, email, date, subject, body = tokens[index:index + 6]
        index += 6
        files: dict[str, dict[str, Any]] = {}
        while index < count:
            token = tokens[index].lstrip("\n")
            if not token or token.startswith("\x01"):
                break
            numstat = _NUMSTAT.fullmatch(token)
            status = None if numstat else _RAW.fullmatch(token)
            if numstat is None and status is None:
                index += 1
                continue
            old: str | None = None
            # A rename/copy (numstat with an empty path, or an R/C status) is followed by its old and new paths.
            if (numstat is not None and not numstat.group(3)) or (status is not None and status.group(1) in "RC"):
                if index + 2 >= count:
                    break
                old, path, index = tokens[index + 1], tokens[index + 2], index + 3
            elif numstat is not None:
                path, index = numstat.group(3), index + 1
            else:
                if index + 1 >= count:
                    break
                path, index = tokens[index + 1], index + 2
            change = files.setdefault(path, _file_change(path))
            if old is not None:
                change["old_path"] = old
            if numstat is not None:
                added, deleted = numstat.group(1), numstat.group(2)
                change["additions"] = 0 if added == "-" else int(added)
                change["deletions"] = 0 if deleted == "-" else int(deleted)
            elif status is not None:
                change["status"] = status.group(1)
        commits.append({"hash": head[1:], "short": short, "author": author, "email": email, "date": date,
                        "message": subject, "body": body.strip(), "files": list(files.values())})
    return commits


def parse_status(raw: bytes) -> list[dict[str, str]]:
    """Parse ``git status --porcelain=v1 -z``: ``XY path`` records; a rename or copy is followed by its old path."""
    tokens = raw.decode("utf-8", "replace").split("\x00")
    dirty: list[dict[str, str]] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if len(token) < 4:
            continue
        code = token[:2]
        dirty.append({"path": token[3:], "status": code})
        if "R" in code or "C" in code:
            index += 1
    return dirty


# --- Agent --------------------------------------------------------------------------------------------------------

def _chosen_location(value: str) -> bool:
    """An absolute or home-relative path: the model chose where it points (``editor`` expands ``~`` itself)."""
    return os.path.isabs(value) or value.startswith("~")


class BuildWorkspaceGuard(Plugin):
    """Default the Build Agent's ``shell`` and ``editor`` to its workspace (native ``BeforeToolCallEvent``).

    ``shell`` without ``work_dir`` gets the workspace; a relative ``work_dir`` or editor ``path`` is made absolute
    under it. Absolute and ``~`` paths are left untouched. The writable ``tool_use`` input is rewritten before the
    tool runs (the executor reads ``before_event.tool_use``), exactly as ``ThinkToolsGuard`` does.
    """

    def __init__(self, root: Path | str) -> None:
        self._root = os.path.realpath(root)
        super().__init__()

    @property
    def name(self) -> str:
        return "ron:build-workspace-guard"

    @property
    def root(self) -> str:
        return self._root

    def init_agent(self, agent: Agent) -> None:
        agent.add_hook(self.before_tool_call, BeforeToolCallEvent)

    def before_tool_call(self, event: BeforeToolCallEvent) -> None:
        name = event.tool_use.get("name")
        if name not in ("shell", "editor"):
            return
        raw = event.tool_use.get("input")
        if raw is None:
            raw = {}
        if not isinstance(raw, dict):
            return
        inputs = dict(raw)
        key = "work_dir" if name == "shell" else "path"
        value = inputs.get(key)
        if name == "shell" and (value is None or (isinstance(value, str) and not value.strip())):
            inputs[key] = self._root
        elif isinstance(value, str) and value.strip() and not _chosen_location(value):
            inputs[key] = os.path.normpath(os.path.join(self._root, value))
        else:
            return
        # The session may outlive a workspace someone removed by hand; the tools need the directory to exist.
        os.makedirs(self._root, mode=0o700, exist_ok=True)
        event.tool_use["input"] = inputs


def build_agent_prompt(root: Path | str) -> str:
    """The Build destination's addendum to the panel system prompt; ``root`` is the project directory."""
    return (
        "\nYou are Ren's Build Agent. You turn the user's request and any reference material into working software. "
        f"Your project directory is {root} — every file of the project lives there, and the user watches its "
        "files, its live preview and its git history in the workbench beside this chat.\n"
        "- Plan first: for work with more than one step, call todo_write with the plan before you start, and keep "
        "it updated as each step is done.\n"
        "- Inspect before you edit: look at what is there (`ls -la`, `git status`, editor view) before you change "
        "anything.\n"
        "- Write and change files with editor, using paths inside the project directory (a relative path resolves "
        "there). Run commands with shell; they run in the project directory unless you pass work_dir.\n"
        "- For a quick UI, prefer one self-contained static index.html at the project root (inline CSS and "
        "JavaScript): it is served live in the user's preview pane.\n"
        "- When the project needs a dev server, bind it to 127.0.0.1 on a free port from 4100 to 4999 and start it "
        "in the background with its output in .ren-dev.log, for example "
        "`nohup npm run dev -- --host 127.0.0.1 --port 4321 > .ren-dev.log 2>&1 &`; check that it answers, then "
        "print its URL on its own line, for example:\nhttp://127.0.0.1:4321\n"
        "- Version the work: run `git init` before your first write when the directory is not a repository yet "
        "(with a .gitignore for dependencies, build output, .env files and .ren-dev.log), and commit at each "
        "milestone with a clear conventional message (feat:, fix:, refactor:, docs:, test:, chore:). Commits are "
        "the user's: use git's configured identity and never pass or set another author; only when git has none, "
        "set a repository-local `user.name` Ren and `user.email` ren@localhost.\n"
        "- Run the project's tests and build when it has them and report failures honestly, with what failed; never "
        "say something works unless you ran it.\n"
        "- Never touch files outside the project directory unless the user names them."
    )
