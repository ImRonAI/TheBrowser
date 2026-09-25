"""Opt-in public ngrok endpoint for inbound webhooks (e.g. Telnyx).

Follows ngrok's own FastAPI guide (https://ngrok.com/docs/using-ngrok-with/fastAPI):
the endpoint is opened in the app lifespan and closed with ``ngrok.disconnect()``.
Options use the ngrok-python 1.7 ``forward`` names (``authtoken_from_env``,
``domain``, ``traffic_policy``).

The API behind the tunnel can run shell commands on this machine, so the tunnel
never exposes it wholesale. A Traffic Policy (evaluated at ngrok's edge, before
traffic reaches this machine) denies every path except ``RON_NGROK_ALLOW_PATHS``.
Telnyx is not a supported ``verify-webhook`` provider in ngrok
(https://ngrok.com/docs/traffic-policy/actions/verify-webhook), so each allowed
route must verify its own webhook signatures.

Environment:
    RON_NGROK=1                  turn the tunnel on (default: off)
    NGROK_AUTHTOKEN              read by ngrok itself via authtoken_from_env
    NGROK_URL                    optional domain, e.g. name.ngrok-free.dev
                                 (omit to use the account's assigned dev domain)
    RON_NGROK_ALLOW_PATHS        comma-separated exact paths (default /telnyx/webhook)
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Awaitable, cast

from agent.api.core.config import API_PORT

logger = logging.getLogger(__name__)

DEFAULT_ALLOW_PATHS = ("/telnyx/webhook",)


def enabled() -> bool:
    return os.getenv("RON_NGROK", "").strip().lower() in {"1", "true", "yes"}


def allowed_paths() -> list[str]:
    raw = os.getenv("RON_NGROK_ALLOW_PATHS")
    paths = [p.strip() for p in raw.split(",")] if raw is not None else list(DEFAULT_ALLOW_PATHS)
    paths = [p for p in paths if p]
    for path in paths:
        if not path.startswith("/") or "'" in path or "\\" in path:
            raise ValueError(f"RON_NGROK_ALLOW_PATHS entry must be an absolute path: {path!r}")
    return paths


def traffic_policy(paths: list[str]) -> str:
    """Deny (404) every request whose path is not exactly one of ``paths``."""
    if paths:
        allowed = " || ".join(f"req.url.path == '{path}'" for path in paths)
        rule: dict[str, Any] = {"expressions": [f"!({allowed})"]}
    else:
        rule = {}  # no expressions: the deny rule matches all traffic
    rule["actions"] = [{"type": "deny", "config": {"status_code": 404}}]
    return json.dumps({"on_http_request": [rule]})


async def start() -> str | None:
    """Open the endpoint if RON_NGROK is set. Returns its public URL, or None."""
    if not enabled():
        return None
    try:
        import ngrok  # optional: not in requirements.txt (absent on the VPS)
    except ImportError:
        logger.warning("RON_NGROK is set but the ngrok package is not installed (pip install ngrok)")
        return None
    options: dict[str, Any] = {
        "authtoken_from_env": True,
        "traffic_policy": traffic_policy(allowed_paths()),
    }
    domain = os.getenv("NGROK_URL", "").strip().removeprefix("https://").rstrip("/")
    if domain:
        options["domain"] = domain
    try:
        # Inside a running event loop ngrok.forward returns an awaitable (README:
        # "returns a promise"); ngrok.pyi types only the sync return.
        listener = await cast(Awaitable[Any], ngrok.forward(f"localhost:{API_PORT}", **options))
    except Exception as exc:  # the API must still start without a tunnel
        logger.error("ngrok endpoint failed to start: %s", exc)
        return None
    global _open
    _open = True
    url = listener.url()
    logger.info("ngrok endpoint %s -> localhost:%s (allowed paths: %s)", url, API_PORT, allowed_paths())
    return url


_open = False


async def stop() -> None:
    """Close every listener this process opened (ngrok.disconnect() with no url)."""
    global _open
    if not _open:
        return
    _open = False
    import ngrok

    try:
        await cast(Awaitable[None], ngrok.disconnect())
    except Exception as exc:
        logger.warning("ngrok disconnect failed: %s", exc)
