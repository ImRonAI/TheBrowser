"""Live -> Chat takeover: finish a Live thread's pending work on the cloud browser.

When a Live socket ends while the agent still owes work -- the app quit, the window closed, the
user signed out, the tunnel dropped, or the Live session itself failed -- the thread does not die
with it. The Live ``BidiAgent`` wrote the thread natively (``SnapshotSessionManager``, every message),
so a Chat ``Agent`` constructed on the **same** ``session_id`` + ``thread_agent_id`` restores it
natively and continues. This module is only the trigger: it decides whether work is pending and
makes one call into the existing server-owned runtime (``PanelRuntimeManager.start``), pinned to the
cloud browser because the user's browser is, by definition, no longer reachable. Everything after
that is the normal Chat run: native session restore, ``ContextOffloader`` plus
``SummarizingConversationManager``, the
same tools, and the run is visible later in the thread like any other.

NOT NATIVE: only the decision + the ``start`` call. The SDK has no cross-agent handoff primitive;
sharing ``session_id``/``agent_id`` is its only mechanism, and it is the one used here.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: The user message the takeover run starts with. It is a durable message in the thread, so the
#: user sees exactly when and why the hand-off happened when they open the thread later.
TAKEOVER_PROMPT = (
    "[handoff] The Live session that was working on this thread ended before the work finished "
    "({reason}). You are the same assistant continuing the same thread on the cloud browser; the "
    "user's own browser is no longer reachable, so any page you need must be opened again here. "
    "Scope: ONLY the user's last request in this thread. Finish exactly that pending work, then stop "
    "with a short summary of what was completed and anything the user still needs to do. Do not "
    "start new research or tasks from memory or earlier threads; the user is not present to steer. "
    "This run is unattended: nobody can approve a request, so never call ask_user and never retry a "
    "tool that has failed -- report the failure in your summary instead (Ron's fixer investigates "
    "failures on its own and the user decides later in the panel)."
)


#: Tools that need a person present. On an unattended run they are cancelled natively
#: (``BeforeToolCallEvent.cancel_tool``) with a note the model can act on.
UNATTENDED_BLOCKED_TOOLS = frozenset({"ask_user"})
#: Ron's own fixer endpoint. Agents never message it (the investigation starts from the tool hook);
#: an unattended run that tries anyway is cancelled so it cannot park on an approval nobody answers.
FIXER_PATH = "/a2a/fixer"


class UnattendedRunGuard:
    """Native ``BeforeToolCallEvent`` cancel for tools that would pause an unattended (takeover) run.

    ``ask_user`` is a tool interrupt: with no client attached it would park the thread as
    ``interrupted`` forever. The SDK writes ``cancel_tool`` into the tool result, so the agent sees
    why and finishes with a summary instead. Registered as a hook on takeover agents only.
    """

    def register_hooks(self, registry: Any, **_: Any) -> None:
        from strands.hooks.events import BeforeToolCallEvent

        registry.add_callback(BeforeToolCallEvent, self.before_tool_call)

    def before_tool_call(self, event: Any) -> None:
        name = event.tool_use.get("name")
        inputs = event.tool_use.get("input") or {}
        if name in UNATTENDED_BLOCKED_TOOLS:
            event.cancel_tool = (f"{name} is unavailable: this run is unattended (the user's app disconnected). "
                                 "Finish what you can and report the open question in your summary.")
        elif name == "a2a_send_message" and FIXER_PATH in str(inputs.get("target_agent_url", "")):
            event.cancel_tool = ("The tool fixer is not a conversational peer: failures are investigated automatically "
                                 "and the user decides in the panel. Do not retry the failed tool; report it in your summary.")


def pending_work(messages: list[dict[str, Any]]) -> bool:
    """True when the thread's last recorded step is unfinished work.

    The bidi loop records tool work as ``toolUse``/``toolResult`` pairs (``tool_dispatch`` then
    ``tool_result``). If the thread ends on a tool exchange -- or on a user turn with no assistant
    reply -- the agent still owes the user an outcome.
    """
    if not messages:
        return False
    last = messages[-1]
    role, content = last.get("role"), last.get("content") or []
    if role == "user":
        # A user turn (typed/transcript) or a tool result with no assistant text after it.
        return True
    kinds = {next(iter(block), None) for block in content if isinstance(block, dict)}
    # Assistant ended on a tool call (results never came back) or on an unfinished stream.
    if "toolUse" in kinds and "text" not in kinds:
        return True
    status = (((last.get("metadata") or {}).get("custom") or {}).get("bidi") or {}).get("status")
    return status in ("pending", "incomplete")


def takeover_selection(destination: str, provider: str, model_id: str, browser: str = "cloud") -> dict[str, Any]:
    """The runtime selection for the takeover run: the thread's Chat defaults, pinned to ``browser``."""
    return {"destination": destination, "provider": provider, "model_id": model_id,
            "reasoning_effort": None, "browser": browser}


async def start_takeover(manager: Any, *, user_id: str, session_id: str, destination: str, provider: str,
                         model_id: str, reason: str, options: dict[str, Any] | None = None) -> Any:
    """Hand the thread to a server-owned Chat run on the cloud browser; returns the ``SessionRun``.

    Raises whatever ``PanelRuntimeManager.start`` raises (e.g. ``RuntimeConflict`` when the thread
    already has a reserved run); callers log and move on -- the thread is intact either way.
    """
    prompt = TAKEOVER_PROMPT.format(reason=reason)
    logger.info("session=<%s> | live takeover | reason=<%s>", session_id, reason)
    return await manager.start(
        user_id, session_id, prompt, action="message",
        selection=takeover_selection(destination, provider, model_id), options=options,
    )
