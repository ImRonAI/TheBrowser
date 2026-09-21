"""AWS SSM backend for the Ron virtual desktop container."""

from __future__ import annotations

import base64
import json
import os
import shlex
import subprocess
import time
from typing import Any


TERMINAL_STATUSES = {"Success", "Cancelled", "TimedOut", "Failed", "Cancelling"}


def enabled() -> bool:
    return bool(os.getenv("RON_AGENT_DESKTOP_INSTANCE_ID"))


def _aws_region() -> str:
    return os.getenv("RON_AGENT_DESKTOP_REGION") or os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"


def _container_name() -> str:
    return os.getenv("RON_AGENT_DESKTOP_CONTAINER", "ron-agent-desktop")


def _run_aws(args: list[str]) -> dict[str, Any]:
    completed = subprocess.run(
        ["aws", *args, "--region", _aws_region(), "--output", "json"],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "aws command failed")
    return json.loads(completed.stdout or "{}")


def run_shell(command: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    """Run a shell command on the AWS desktop host through SSM."""
    instance_id = os.getenv("RON_AGENT_DESKTOP_INSTANCE_ID")
    if not instance_id:
        raise RuntimeError("RON_AGENT_DESKTOP_INSTANCE_ID is not configured")

    response = _run_aws(
        [
            "ssm",
            "send-command",
            "--instance-ids",
            instance_id,
            "--document-name",
            "AWS-RunShellScript",
            "--parameters",
            json.dumps({"commands": [command], "executionTimeout": [str(timeout)]}),
            "--timeout-seconds",
            str(timeout),
        ]
    )
    command_id = response["Command"]["CommandId"]
    deadline = time.time() + timeout + 30
    last: dict[str, Any] | None = None

    while time.time() < deadline:
        time.sleep(2)
        try:
            last = _run_aws(
                [
                    "ssm",
                    "get-command-invocation",
                    "--command-id",
                    command_id,
                    "--instance-id",
                    instance_id,
                ]
            )
        except RuntimeError:
            continue
        if last.get("Status") in TERMINAL_STATUSES:
            break

    if not last:
        return subprocess.CompletedProcess(command, 1, "", "SSM command did not return an invocation result")

    return subprocess.CompletedProcess(
        command,
        int(last.get("ResponseCode", 1)),
        last.get("StandardOutputContent", ""),
        last.get("StandardErrorContent", ""),
    )


def run_container_command(
    cmd_args: list[str],
    *,
    cwd: str | None = None,
    input_text: str | None = None,
    timeout: int = 60,
) -> subprocess.CompletedProcess[str]:
    """Run a command inside the remote ron-agent-desktop container."""
    workdir = cwd or "/workspace"
    docker_cmd = [
        "docker",
        "exec",
        "-i",
        "-w",
        workdir,
        _container_name(),
        *cmd_args,
    ]
    command = shlex.join(docker_cmd)
    if input_text is not None:
        encoded = base64.b64encode(input_text.encode()).decode()
        command = f"printf %s {shlex.quote(encoded)} | base64 -d | {command}"
    return run_shell(command, timeout=timeout)
