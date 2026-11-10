"""Build Agent workspace and workbench API: real tmp filesystem, real git, the real router and real Strands events."""

from __future__ import annotations

import asyncio
import hashlib
import itertools
import json
import shutil
import stat
import subprocess
from datetime import datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from strands import Agent
from strands.hooks.events import BeforeToolCallEvent
from strands.models.model import Model
from strands_tools.editor import editor as editor_tool
from strands_tools.shell import shell as shell_tool

from agent.api.core import build_workspace as bw
from agent.api.core import config as app_config
from agent.api.endpoints import build as endpoint

PARAMS = {"user_id": "alice", "session_id": "build-1"}


@pytest.fixture
def build_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    root = tmp_path / "build-root"
    monkeypatch.setattr(app_config, "RON_BUILD_ROOT", root)
    return root


@pytest.fixture
def client(build_root: Path) -> TestClient:
    app = FastAPI()
    app.include_router(endpoint.router)
    return TestClient(app)


def write(root: Path, files: dict[str, str | bytes]) -> None:
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content)


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.name=Ren Test", "-c", "user.email=ren@example.com", "-c", "commit.gpgsign=false",
                    "-c", "core.hooksPath=/dev/null", *args], cwd=cwd, check=True, capture_output=True)


# --- Workspace identity and path confinement ----------------------------------------------------------------------

def test_workspace_id_is_stable_and_the_directory_is_private(build_root: Path) -> None:
    wid = bw.workspace_id("alice", "build-1")
    assert wid == hashlib.sha256(b"alice\nbuild-1").hexdigest()[:32]
    assert bw.workspace_id("alice", "build-2") != wid and bw.workspace_id("bob", "build-1") != wid
    root = bw.ensure_workspace("alice", "build-1")
    assert root == bw.workspace_root("alice", "build-1") == build_root.resolve() / wid
    assert stat.S_IMODE(root.stat().st_mode) == 0o700
    assert bw.ensure_workspace("alice", "build-1") == root


def test_paths_are_confined_to_the_workspace(tmp_path: Path) -> None:
    root = tmp_path / "ws"
    outside = tmp_path / "outside"
    write(root, {"src/app.js": "x"})
    write(outside, {"secret.txt": "s"})
    (root / "escape").symlink_to(outside)
    (root / "secret-link.txt").symlink_to(outside / "secret.txt")
    (root / "inner").symlink_to(root / "src")
    real = root.resolve()
    assert bw.resolve_workspace_path(root, "src/app.js") == real / "src" / "app.js"
    assert bw.resolve_workspace_path(root, "./src//app.js") == real / "src" / "app.js"
    assert bw.resolve_workspace_path(root, "") == real == bw.resolve_workspace_path(root, ".")
    assert bw.resolve_workspace_path(root, "new/dir/file.txt") == real / "new" / "dir" / "file.txt"
    assert bw.resolve_workspace_path(root, "inner/app.js") == real / "src" / "app.js"
    for bad in ("/etc/passwd", str(outside / "secret.txt"), "../outside/secret.txt", "src/../../outside",
                "src/../app.js", "escape/secret.txt", "escape", "secret-link.txt", "src/a\x00b.js"):
        with pytest.raises(bw.WorkspacePathError):
            bw.resolve_workspace_path(root, bad)


# --- Listing ------------------------------------------------------------------------------------------------------

def test_listing_skips_ignored_dirs_and_reads_package_and_env_names(tmp_path: Path) -> None:
    root = tmp_path / "ws"
    write(root, {
        "index.html": "<h1>hi</h1>",
        "README.md": "# demo",
        "src/app.js": "x",
        "src/components/Button.jsx": "y",
        "src/.DS_Store": "",
        ".DS_Store": "",
        "node_modules/react/index.js": "z",
        "pkg/node_modules/left-pad/index.js": "",
        "__pycache__/a.pyc": "",
        "dist/out.js": "",
        ".git/HEAD": "ref: refs/heads/main\n",
        "package.json": json.dumps({
            "name": "demo", "version": "1.0.0", "description": "A demo", "private": True,
            "scripts": {"dev": "vite", "broken": 1}, "dependencies": {"react": "^19.0.0"},
            "devDependencies": {"vite": "^7.0.0"},
        }),
        ".env": 'API_KEY=supersecret\n# COMMENTED=1\nexport TOKEN="abc"\nPEM="-----BEGIN-----\nNOT_A_NAME=inside\n"\nAFTER=1\n',
        ".env.local": "LOCAL_ONLY=yes\nAPI_KEY=override\n",
    })
    (root / "outside-link").symlink_to(tmp_path)
    (root / "dangling").symlink_to(root / "missing")
    listing = bw.list_workspace(root)
    assert [(entry["path"], entry["type"]) for entry in listing["entries"]] == [
        ("pkg", "dir"),
        ("src", "dir"), ("src/components", "dir"), ("src/components/Button.jsx", "file"), ("src/app.js", "file"),
        (".env", "file"), (".env.local", "file"), ("index.html", "file"), ("package.json", "file"),
        ("README.md", "file"),
    ]
    index = next(entry for entry in listing["entries"] if entry["path"] == "index.html")
    assert index["size"] == len("<h1>hi</h1>") and isinstance(index["modified"], int) and index["modified"] > 0
    assert next(entry for entry in listing["entries"] if entry["path"] == "src")["size"] == 0
    assert listing["ignored"] == [".git", "__pycache__", "dist", "node_modules"]
    assert listing["truncated"] is False and listing["has_index"] is True
    assert listing["package"] == {"name": "demo", "version": "1.0.0", "description": "A demo",
                                  "scripts": {"dev": "vite"}, "dependencies": {"react": "^19.0.0"},
                                  "devDependencies": {"vite": "^7.0.0"}}
    assert listing["env"] == [{"name": "API_KEY", "file": ".env"}, {"name": "TOKEN", "file": ".env"},
                              {"name": "PEM", "file": ".env"}, {"name": "AFTER", "file": ".env"},
                              {"name": "LOCAL_ONLY", "file": ".env.local"}, {"name": "API_KEY", "file": ".env.local"}]
    dumped = json.dumps(listing)
    assert "supersecret" not in dumped and "override" not in dumped and "NOT_A_NAME" not in dumped


def test_package_json_that_is_not_an_object_is_reported_as_absent(tmp_path: Path) -> None:
    for text in ("{not json", "[1, 2]", ""):
        write(tmp_path, {"package.json": text})
        assert bw.read_package(tmp_path) is None
    (tmp_path / "package.json").unlink()
    assert bw.read_package(tmp_path) is None


def test_listing_stops_at_the_entry_limit(tmp_path: Path) -> None:
    for number in range(bw.MAX_ENTRIES + 5):
        (tmp_path / f"f{number:05}.txt").touch()
    listing = bw.list_workspace(tmp_path)
    assert len(listing["entries"]) == bw.MAX_ENTRIES and listing["truncated"] is True
    assert listing["entries"][0]["path"] == "f00000.txt"
    for number in range(bw.MAX_ENTRIES, bw.MAX_ENTRIES + 5):
        (tmp_path / f"f{number:05}.txt").unlink()
    listing = bw.list_workspace(tmp_path)
    assert len(listing["entries"]) == bw.MAX_ENTRIES and listing["truncated"] is False


# --- Workbench API: workspace and files ---------------------------------------------------------------------------

def test_workspace_route_reports_a_missing_workspace_without_creating_it(client: TestClient, build_root: Path) -> None:
    root = bw.workspace_root("alice", "build-1")
    assert client.get("/build/workspace", params=PARAMS).json() == {
        "workspace_id": root.name, "root": str(root), "exists": False, "entries": [], "truncated": False,
        "ignored": [], "has_index": False, "package": None, "env": [], "preview_url": None,
    }
    assert not root.exists()
    assert client.put("/build/file", json={**PARAMS, "path": "index.html", "content": "<h1>hi</h1>\n"}).status_code == 200
    body = client.get("/build/workspace", params=PARAMS).json()
    assert body["exists"] is True and body["has_index"] is True
    assert body["preview_url"] == f"/build/preview/{root.name}/"
    assert [entry["path"] for entry in body["entries"]] == ["index.html"]
    assert stat.S_IMODE(root.stat().st_mode) == 0o700
    assert client.get("/build/workspace", params={"session_id": "bad id"}).status_code == 422


def test_file_round_trip_with_optimistic_concurrency(client: TestClient, build_root: Path) -> None:
    first_text, second_text = "console.log(1)\n", "console.log(2)\n"
    first_sha, second_sha = (hashlib.sha256(text.encode()).hexdigest() for text in (first_text, second_text))
    created = client.put("/build/file", json={**PARAMS, "path": "src/app.js", "content": first_text, "base_sha256": None})
    assert created.status_code == 200
    assert created.json() == {"path": "src/app.js", "size": len(first_text), "modified": created.json()["modified"],
                              "sha256": first_sha}
    again = client.put("/build/file", json={**PARAMS, "path": "src/app.js", "content": "x", "base_sha256": ""})
    assert again.status_code == 409
    assert again.json()["detail"] == {"message": "The file already exists", "sha256": first_sha}
    stale = client.put("/build/file", json={**PARAMS, "path": "src/app.js", "content": "x", "base_sha256": "0" * 64})
    assert stale.status_code == 409 and stale.json()["detail"]["sha256"] == first_sha
    saved = client.put("/build/file", json={**PARAMS, "path": "./src//app.js", "content": second_text,
                                             "base_sha256": first_sha.upper()})
    assert saved.status_code == 200 and saved.json()["sha256"] == second_sha and saved.json()["path"] == "src/app.js"
    read = client.get("/build/file", params={**PARAMS, "path": "src/app.js"}).json()
    assert read == {"path": "src/app.js", "size": len(second_text), "modified": read["modified"],
                    "sha256": second_sha, "binary": False, "too_large": False, "content": second_text}
    root = bw.workspace_root("alice", "build-1")
    assert (root / "src" / "app.js").read_text() == second_text
    assert [p.name for p in (root / "src").iterdir()] == ["app.js"], "no temporary file is left behind"

    for path, status in (("missing.txt", 404), ("src", 400), ("../outside.txt", 400), ("/etc/passwd", 400),
                         ("src/app.js/inner", 400)):
        assert client.get("/build/file", params={**PARAMS, "path": path}).status_code == status, path

    assert client.delete("/build/file", params={**PARAMS, "path": "src"}).status_code == 400
    assert client.delete("/build/file", params={**PARAMS, "path": "src/app.js"}).status_code == 204
    assert client.get("/build/file", params={**PARAMS, "path": "src/app.js"}).status_code == 404
    assert client.delete("/build/file", params={**PARAMS, "path": "src/app.js"}).status_code == 404
    gone = client.put("/build/file", json={**PARAMS, "path": "src/app.js", "content": "x", "base_sha256": second_sha})
    assert gone.status_code == 409
    assert gone.json()["detail"] == {"message": "The file no longer exists", "sha256": None}


def test_writes_are_bounded_and_keep_the_file_mode(client: TestClient, build_root: Path) -> None:
    too_big = client.put("/build/file", json={**PARAMS, "path": "big.txt", "content": "x" * (bw.MAX_WRITE_BYTES + 1)})
    assert too_big.status_code == 413
    assert not bw.workspace_root("alice", "build-1").exists(), "a refused write creates nothing"
    for path in ("../escape.txt", "/tmp/escape.txt", ""):
        assert client.put("/build/file", json={**PARAMS, "path": path, "content": "x"}).status_code in (400, 422), path
    created = client.put("/build/file", json={**PARAMS, "path": "run.sh", "content": "#!/bin/sh\necho hi\n"})
    script = bw.workspace_root("alice", "build-1") / "run.sh"
    assert stat.S_IMODE(script.stat().st_mode) == bw.NEW_FILE_MODE
    script.chmod(0o755)
    updated = client.put("/build/file", json={**PARAMS, "path": "run.sh", "content": "#!/bin/sh\necho bye\n",
                                               "base_sha256": created.json()["sha256"]})
    assert updated.status_code == 200 and stat.S_IMODE(script.stat().st_mode) == 0o755
    assert client.put("/build/file", json={**PARAMS, "path": "run.sh/inner.txt", "content": "x"}).status_code == 400


def test_binary_and_large_files_are_described_not_inlined(client: TestClient, build_root: Path) -> None:
    root = bw.ensure_workspace("alice", "build-1")
    png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    large_text = b"a" * (bw.MAX_INLINE_BYTES + 10)
    write(root, {"logo.png": png, "latin1.txt": "café".encode("latin-1"), "big.log": large_text,
                 "big.bin": b"\x00" + large_text, "crlf.txt": b"one\r\ntwo\r\n"})
    logo = client.get("/build/file", params={**PARAMS, "path": "logo.png"}).json()
    assert logo["binary"] is True and logo["content"] is None and logo["too_large"] is False
    assert logo["sha256"] == hashlib.sha256(png).hexdigest() and logo["size"] == len(png)
    latin = client.get("/build/file", params={**PARAMS, "path": "latin1.txt"}).json()
    assert latin["binary"] is True and latin["content"] is None
    big = client.get("/build/file", params={**PARAMS, "path": "big.log"}).json()
    assert big["too_large"] is True and big["binary"] is False and big["content"] is None
    assert big["size"] == len(large_text) and big["sha256"] == hashlib.sha256(large_text).hexdigest()
    big_binary = client.get("/build/file", params={**PARAMS, "path": "big.bin"}).json()
    assert big_binary["too_large"] is True and big_binary["binary"] is True
    assert client.get("/build/file", params={**PARAMS, "path": "crlf.txt"}).json()["content"] == "one\r\ntwo\r\n"


# --- Workbench API: preview ---------------------------------------------------------------------------------------

def test_preview_serves_the_workspace_sandboxed(client: TestClient, build_root: Path, tmp_path: Path) -> None:
    root = bw.ensure_workspace("alice", "build-1")
    wid = root.name
    write(root, {"index.html": "<h1>home</h1>", "app.js": "console.log(1)", "main.ts": "let x: number = 1",
                 "docs/index.html": "<h1>docs</h1>", "notes/readme.txt": "no index here", ".env": "API_KEY=secret",
                 ".ren-dev.log": "log"})
    (root / "escape").symlink_to(tmp_path)
    home = client.get(f"/build/preview/{wid}/")
    assert home.status_code == 200 and home.text == "<h1>home</h1>"
    assert home.headers["content-type"] == "text/html; charset=utf-8"
    assert home.headers["content-security-policy"] == \
        "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads"
    assert home.headers["x-content-type-options"] == "nosniff"
    assert home.headers["cache-control"] == "no-store"
    assert home.headers["access-control-allow-origin"] == "*"
    assert client.get(f"/build/preview/{wid}/app.js").headers["content-type"] == "text/javascript; charset=utf-8"
    assert client.get(f"/build/preview/{wid}/main.ts").headers["content-type"] == "text/plain; charset=utf-8"
    bare = client.get(f"/build/preview/{wid}", follow_redirects=False)
    assert bare.status_code in (307, 308) and bare.headers["location"].endswith(f"/build/preview/{wid}/")
    folder = client.get(f"/build/preview/{wid}/docs", follow_redirects=False)
    assert folder.status_code == 307 and folder.headers["location"] == "docs/"
    assert client.get(f"/build/preview/{wid}/docs/").text == "<h1>docs</h1>"
    for path in ("notes/", "notes", "missing.js", ".env", ".ren-dev.log", "%2E%2E/%2E%2E/etc/passwd", "escape/",
                 "escape/build-root"):
        assert client.get(f"/build/preview/{wid}/{path}").status_code == 404, path
    for bad_id in (wid.upper(), wid[:-1], "x" * 32, "0" * 32):
        assert client.get(f"/build/preview/{bad_id}/").status_code == 404, bad_id


def test_every_build_route_is_loopback_only(build_root: Path) -> None:
    app = FastAPI()
    app.include_router(endpoint.router)
    remote = TestClient(app, client=("203.0.113.9", 50000))
    wid = bw.ensure_workspace("alice", "build-1").name
    responses = [remote.get("/build/workspace", params=PARAMS), remote.get("/build/file", params={**PARAMS, "path": "a"}),
                 remote.put("/build/file", json={**PARAMS, "path": "a", "content": "x"}),
                 remote.delete("/build/file", params={**PARAMS, "path": "a"}), remote.get("/build/git", params=PARAMS),
                 remote.get(f"/build/preview/{wid}/")]
    assert [response.status_code for response in responses] == [403] * len(responses)


def test_the_api_app_serves_the_build_routes(build_root: Path) -> None:
    from agent.api.main import app

    api = TestClient(app)  # no lifespan: these routes need none
    assert api.put("/build/file", json={**PARAMS, "path": "index.html", "content": "<h1>hi</h1>"}).status_code == 200
    workspace = api.get("/build/workspace", params=PARAMS).json()
    assert workspace["exists"] is True and workspace["preview_url"] == f"/build/preview/{workspace['workspace_id']}/"
    assert api.get(workspace["preview_url"]).text == "<h1>hi</h1>"
    assert api.get("/build/git", params=PARAMS).json()["repo"] is False


# --- Workbench API: git -------------------------------------------------------------------------------------------

def test_git_history_and_working_tree_changes(client: TestClient, build_root: Path) -> None:
    empty = {"repo": False, "branch": None, "commits": [], "dirty": []}
    assert client.get("/build/git", params=PARAMS).json() == empty, "no workspace yet"
    root = bw.ensure_workspace("alice", "build-1")
    assert client.get("/build/git", params=PARAMS).json() == empty, "not a repository yet"
    git(root, "init", "-q", "-b", "main")
    assert client.get("/build/git", params=PARAMS).json() == {**empty, "repo": True, "branch": "main"}

    write(root, {"index.html": "<h1>hi</h1>\n", "logo.bin": b"\x89PNG\x00\x01\x02", "notes.txt": "one\ntwo\nthree\n"})
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "feat: first page", "-m", "Adds the landing page.")
    write(root, {"index.html": "<h1>hello</h1>\n<p>more</p>\n"})
    git(root, "mv", "notes.txt", "docs-notes.txt")
    git(root, "rm", "-q", "logo.bin")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "fix: greeting")
    write(root, {"index.html": "<h1>hello</h1>\n<p>more</p>\n<p>dirty</p>\n", "untracked.txt": "new\n"})

    summary = client.get("/build/git", params={**PARAMS, "limit": 5}).json()
    assert summary["repo"] is True and summary["branch"] == "main"
    newest, oldest = summary["commits"]
    assert (newest["message"], newest["body"]) == ("fix: greeting", "")
    assert (oldest["message"], oldest["body"]) == ("feat: first page", "Adds the landing page.")
    assert (oldest["author"], oldest["email"]) == ("Ren Test", "ren@example.com")
    assert len(oldest["hash"]) == 40 and oldest["hash"].startswith(oldest["short"])
    assert datetime.fromisoformat(oldest["date"]).tzinfo is not None

    def changes(commit: dict) -> dict:
        return {f["path"]: (f["status"], f["additions"], f["deletions"], f["old_path"]) for f in commit["files"]}

    assert changes(oldest) == {"index.html": ("A", 1, 0, None), "logo.bin": ("A", 0, 0, None),
                               "notes.txt": ("A", 3, 0, None)}
    assert changes(newest) == {"index.html": ("M", 2, 1, None), "logo.bin": ("D", 0, 0, None),
                               "docs-notes.txt": ("R", 0, 0, "notes.txt")}
    assert summary["dirty"] == [{"path": "index.html", "status": " M"}, {"path": "untracked.txt", "status": "??"}]

    assert len(client.get("/build/git", params={**PARAMS, "limit": 1}).json()["commits"]) == 1
    for limit in (0, 201):
        assert client.get("/build/git", params={**PARAMS, "limit": limit}).status_code == 422


def test_git_never_reports_a_repository_above_the_workspace(client: TestClient, build_root: Path,
                                                            tmp_path: Path) -> None:
    git(tmp_path, "init", "-q")
    root = bw.ensure_workspace("alice", "build-1")
    write(root, {"index.html": "<h1>hi</h1>"})
    assert client.get("/build/git", params=PARAMS).json() == {"repo": False, "branch": None, "commits": [], "dirty": []}


def test_staged_renames_consume_their_old_path() -> None:
    raw = b" M index.html\x00R  new name.txt\x00old name.txt\x00?? untracked.txt\x00"
    assert bw.parse_status(raw) == [{"path": "index.html", "status": " M"},
                                    {"path": "new name.txt", "status": "R "},
                                    {"path": "untracked.txt", "status": "??"}]


# --- The agent: workspace guard -----------------------------------------------------------------------------------

class ScriptedModel(Model):
    """The provider double: requests each scripted tool call in turn, then answers."""

    def __init__(self, *calls: tuple[str, dict]) -> None:
        self.calls = list(calls)
        self.ids = itertools.count()

    def get_config(self):
        return {"model_id": "scripted"}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
        if self.calls:
            name, inputs = self.calls.pop(0)
            yield {"contentBlockStart": {"contentBlockIndex": 0,
                   "start": {"toolUse": {"toolUseId": f"call-{next(self.ids)}", "name": name}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "tool_use"}}
        else:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "done"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}, "metrics": {"latencyMs": 1}}}


def test_guard_defaults_shell_and_editor_to_the_workspace(tmp_path: Path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    real = str(root.resolve())
    guard = bw.BuildWorkspaceGuard(root)
    assert guard.name == "ron:build-workspace-guard" and guard.root == real
    agent = Agent(model=ScriptedModel(), tools=[shell_tool, editor_tool], plugins=[guard], callback_handler=None,
                  load_tools_from_directory=False)

    def fire(name: str, inputs: dict) -> dict:
        event = BeforeToolCallEvent(agent=agent, selected_tool=agent.tool_registry.registry.get(name),
                                    tool_use={"toolUseId": "t", "name": name, "input": inputs}, invocation_state={})
        fired, _interrupts = asyncio.run(agent.hooks.invoke_callbacks_async(event))
        return fired.tool_use["input"]

    assert fire("shell", {"command": "ls"}) == {"command": "ls", "work_dir": real}
    assert fire("shell", {"command": "ls", "work_dir": None})["work_dir"] == real
    assert fire("shell", {"command": "ls", "work_dir": "  "})["work_dir"] == real
    assert fire("shell", {"command": "ls", "work_dir": "web"})["work_dir"] == f"{real}/web"
    assert fire("shell", {"command": "ls", "work_dir": "/srv/app"})["work_dir"] == "/srv/app"
    assert fire("shell", {"command": "ls", "work_dir": "~/code"})["work_dir"] == "~/code"
    assert fire("editor", {"command": "create", "path": "src/app.js", "file_text": "x"})["path"] == f"{real}/src/app.js"
    assert fire("editor", {"command": "view", "path": "./index.html"})["path"] == f"{real}/index.html"
    assert fire("editor", {"command": "view", "path": "/etc/hosts"})["path"] == "/etc/hosts"
    assert fire("editor", {"command": "view", "path": "~/notes.txt"})["path"] == "~/notes.txt"
    assert fire("file_read", {"path": "x.txt"}) == {"path": "x.txt"}, "only shell and editor are defaulted"
    shutil.rmtree(root)
    assert fire("shell", {"command": "ls"})["work_dir"] == real and root.is_dir(), "a removed workspace is recreated"


def test_guard_applies_inside_a_real_agent_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The native executor runs the rewritten input: the real editor and shell land in the workspace, not the cwd."""
    root, elsewhere = tmp_path / "ws", tmp_path / "process-cwd"
    root.mkdir()
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setenv("STRANDS_NON_INTERACTIVE", "true")
    model = ScriptedModel(("editor", {"command": "create", "path": "notes/hello.txt", "file_text": "hi from Ren"}),
                          ("shell", {"command": "pwd > where.txt", "timeout": 30}))
    agent = Agent(model=model, tools=[shell_tool, editor_tool], plugins=[bw.BuildWorkspaceGuard(root)],
                  callback_handler=None, load_tools_from_directory=False)
    agent("Write the note and record where commands run.")
    results = [block["toolResult"]["status"] for message in agent.messages for block in message["content"]
               if "toolResult" in block]
    assert results == ["success", "success"]
    assert (root / "notes" / "hello.txt").read_text() == "hi from Ren"
    assert Path((root / "where.txt").read_text().strip()).resolve() == root.resolve()
    assert list(elsewhere.iterdir()) == []
