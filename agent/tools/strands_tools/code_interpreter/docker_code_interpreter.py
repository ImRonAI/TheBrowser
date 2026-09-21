import logging
import subprocess
import shutil
import json
import time
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from strands import tool
from .code_interpreter import CodeInterpreter
from .models import (
    CodeInterpreterInput,
    ExecuteCodeAction,
    ExecuteCommandAction,
    InitSessionAction,
    LanguageType,
    ListFilesAction,
    ListLocalSessionsAction,
    ReadFilesAction,
    RemoveFilesAction,
    WriteFilesAction,
)

logger = logging.getLogger(__name__)

class DockerCodeInterpreter(CodeInterpreter):
    """
    A persistent, secure Docker-based implementation of CodeInterpreter.
    
    Architecture:
    - Uses a single persistent Docker container (python:3.10-slim) as the sandbox.
    - Mounts a local workspace directory to /workspace in the container.
    - Executes code via 'docker exec'.
    - Provides isolation from host process and environment secrets.
    """
    
    def __init__(self, workspace_dir: Optional[str] = None):
        super().__init__()
        # Use a fixed container name for persistence across agent restarts, 
        # or uuid for unique per-run session. Let's use fixed to allow re-attaching.
        self.container_name = "ron-sandbox-executor"
        self.image = "python:3.10-slim"
        
        self.workspace_dir = Path(workspace_dir) if workspace_dir else Path(os.getcwd()) / "workspace"
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        
        # Ensure we have a default session
        self._default_session = "default"
        self._sessions = {self._default_session: {"cwd": "/workspace"}}

    def start_platform(self) -> None:
        """Ensure Docker container is running."""
        if self._is_container_running():
            logger.info(f"Container {self.container_name} already running.")
            return

        # Remove if exists but stopped
        subprocess.run(["docker", "rm", "-f", self.container_name], capture_output=True)
        
        logger.info(f"Starting sandbox container {self.container_name}...")
        try:
            # Run container detached, keep it alive with tail -f /dev/null
            subprocess.run([
                "docker", "run", "-d",
                "--name", self.container_name,
                "-v", f"{self.workspace_dir.absolute()}:/workspace",
                "-w", "/workspace",
                self.image,
                "tail", "-f", "/dev/null"
            ], check=True, capture_output=True)
            
            # Install some basic utils if needed (optional)
            # subprocess.run(["docker", "exec", self.container_name, "pip", "install", "numpy", "pandas"], capture_output=True)
            
            logger.info("Sandbox container started.")
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to start docker container: {e.stderr.decode()}")
            raise RuntimeError("Docker is required but failed to start container. Is Docker running?")

    def cleanup_platform(self) -> None:
        """Stop the container (optional - maybe we want it persistent?)."""
        # For a "browser OS", we might want to keep it running. 
        # But to be clean, let's leave it. The user can kill it.
        # pass
        pass

    def _is_container_running(self) -> bool:
        """Check if container is running."""
        res = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", self.container_name],
            capture_output=True, text=True
        )
        return res.returncode == 0 and "true" in res.stdout.strip()

    def get_supported_languages(self) -> List[LanguageType]:
        return [LanguageType.PYTHON]

    def init_session(self, action: InitSessionAction) -> Dict[str, Any]:
        """Sessions in this implementation are just logical CWD trackings."""
        session_name = action.session_name or self._default_session
        self._sessions[session_name] = {"cwd": "/workspace"}
        self.start_platform() # Ensure running
        return {"status": "success", "content": [{"text": f"Session '{session_name}' initialized in Docker container."}]}

    def list_local_sessions(self) -> Dict[str, Any]:
        return {"status": "success", "content": [{"json": list(self._sessions.keys())}]}

    def execute_code(self, action: ExecuteCodeAction) -> Dict[str, Any]:
        session_name = action.session_name or self._default_session
        if session_name not in self._sessions:
             self.init_session(InitSessionAction(description="Auto", session_name=session_name))
        
        self.start_platform()

        # We wrap the user's code to capture stdout/stderr properly inside the container
        # escaping quotes is tricky. Easiest is to write a temp file to workspace and exec it.
        
        code_filename = f"_exec_{uuid4().hex}.py"
        code_path = self.workspace_dir / code_filename
        
        with open(code_path, "w") as f:
            f.write(action.code)
            
        # Execute in container
        # Note: file is mounted at /workspace/<filename>
        cmd = ["docker", "exec", "-w", "/workspace", self.container_name, "python3", code_filename]
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            
            output = ""
            if res.stdout: output += f"STDOUT:\n{res.stdout}\n"
            if res.stderr: output += f"STDERR:\n{res.stderr}\n"
            if not output: output = "Code executed (no output)."
            
            status = "success" if res.returncode == 0 else "error"
            
        except subprocess.TimeoutExpired:
            status = "error"
            output = "Execution timed out (120s limit)."
        except Exception as e:
            status = "error"
            output = str(e)
        finally:
            # Cleanup temp file
            if code_path.exists():
                code_path.unlink()

        return {"status": status, "content": [{"text": output}]}

    def execute_command(self, action: ExecuteCommandAction) -> Dict[str, Any]:
        self.start_platform()
        
        # Execute via shell in docker
        cmd = ["docker", "exec", "-w", "/workspace", self.container_name, "sh", "-c", action.command]
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            output = ""
            if res.stdout: output += f"STDOUT:\n{res.stdout}\n"
            if res.stderr: output += f"STDERR:\n{res.stderr}\n"
            
            return {
                "status": "success" if res.returncode == 0 else "error",
                "content": [{"text": output or "Command executed."}]
            }
        except Exception as e:
            return {"status": "error", "content": [{"text": str(e)}]}

    def list_files(self, action: ListFilesAction) -> Dict[str, Any]:
        # We can list files locally since the volume is mounted!
        return self._local_list_files(action)

    def read_files(self, action: ReadFilesAction) -> Dict[str, Any]:
        # Read locally
        return self._local_read_files(action)

    def write_files(self, action: WriteFilesAction) -> Dict[str, Any]:
        # Write locally
        return self._local_write_files(action)
        
    def remove_files(self, action: RemoveFilesAction) -> Dict[str, Any]:
        # Remove locally
        return self._local_remove_files(action)

    # --- Local File Ops Helper Methods (reused from LocalCodeInterpreter somewhat) ---
    # Since workspace is mounted, we perform file ops directly on host for speed/simplicity
    # This assumes the user (agent) has permission to read/write the mounted dir.
    
    def _local_list_files(self, action):
        target = self.workspace_dir / (action.path or ".")
        if not target.exists(): return {"status": "error", "content": [{"text": "Path not found"}]}
        return {"status": "success", "content": [{"json": [f.name for f in target.iterdir()]}]}
        
    def _local_read_files(self, action):
        res = {}
        for p in action.paths:
            path = self.workspace_dir / p
            if path.exists() and path.is_file():
                with open(path, 'r') as f: res[p] = f.read()
        return {"status": "success", "content": [{"json": res}]}
        
    def _local_write_files(self, action):
        for item in action.content:
            path = self.workspace_dir / item.path
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w') as f: f.write(item.text)
        return {"status": "success", "content": [{"text": f"Written {len(action.content)} files"}]}
        
    def _local_remove_files(self, action):
        deleted = []
        for p in action.paths:
            path = self.workspace_dir / p
            if path.exists():
                if path.is_file(): path.unlink()
                else: shutil.rmtree(path)
                deleted.append(p)
        return {"status": "success", "content": [{"text": f"Deleted {deleted}"}]}
