import logging
import sys
import io
import contextlib
import traceback
import re
from typing import Any, Dict, List, Optional
import os
import shutil
from pathlib import Path

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

class LocalCodeInterpreter(CodeInterpreter):
    """
    A simple local implementation of CodeInterpreter that runs Python code 
    in the current process (with no isolation - USE WITH CAUTION).
    """
    
    def __init__(self, workspace_dir: Optional[str] = None):
        super().__init__()
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.workspace_dir = Path(workspace_dir) if workspace_dir else Path(os.getcwd()) / "workspace"
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self._default_session = "default"
        
        # Initialize default session
        self.sessions[self._default_session] = {
            "globals": {},
            "locals": {},
            "cwd": self.workspace_dir
        }

    def start_platform(self) -> None:
        logger.info(f"Starting LocalCodeInterpreter in {self.workspace_dir}")
        pass

    def cleanup_platform(self) -> None:
        pass

    def get_supported_languages(self) -> List[LanguageType]:
        return [LanguageType.PYTHON]

    def _detect_localhost_url(self, text: str) -> Optional[str]:
        """Detect localhost/127.0.0.1 URLs in text."""
        match = re.search(r'http://(?:localhost|127\.0\.0\.1):(\d+)(?:/[\w\-\.]*)*', text)
        return match.group(0) if match else None

    def init_session(self, action: InitSessionAction) -> Dict[str, Any]:
        session_name = action.session_name or self._default_session
        if session_name in self.sessions:
            return {"status": "success", "content": [{"text": f"Session '{session_name}' already exists."}]}
        
        self.sessions[session_name] = {
            "globals": {},
            "locals": {},
            "cwd": self.workspace_dir
        }
        return {"status": "success", "content": [{"text": f"Session '{session_name}' initialized."}]}

    def list_local_sessions(self) -> Dict[str, Any]:
        return {
            "status": "success", 
            "content": [{"json": list(self.sessions.keys())}]
        }

    def execute_code(self, action: ExecuteCodeAction) -> Dict[str, Any]:
        session_name = action.session_name or self._default_session
        if session_name not in self.sessions:
            # Auto-create session if not exists
            self.init_session(InitSessionAction(description="Auto-created", session_name=session_name))
            
        session = self.sessions[session_name]
        
        if action.language != LanguageType.PYTHON:
            return {"status": "error", "content": [{"text": f"Language {action.language} not supported in local interpreter."}]}

        # Capture stdout/stderr
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        
        result_obj = None
        
        cwd_restore = os.getcwd()
        try:
            os.chdir(session["cwd"])
            with contextlib.redirect_stdout(stdout_capture), contextlib.redirect_stderr(stderr_capture):
                # We use exec for generic python code execution
                # Note: This is running in the same process!
                exec(action.code, session["globals"], session["locals"])
        except Exception:
            traceback.print_exc(file=stderr_capture)
        finally:
            os.chdir(cwd_restore)
            
        stdout = stdout_capture.getvalue()
        stderr = stderr_capture.getvalue()
        
        output = ""
        if stdout:
            output += f"STDOUT:\n{stdout}\n"
        if stderr:
             output += f"STDERR:\n{stderr}\n"
             
        if not output:
            output = "Code executed successfully (no output)."

        result = {
            "status": "success" if not stderr else "error",  # Or partial success
            "content": [{"text": output}]
        }

        # Check for localhost URLs for live preview
        url = self._detect_localhost_url(output)
        if url:
            result["__ui_data__"] = {
                "type": "project",
                "data": {
                    "url": url,
                    "action": "preview"
                }
            }

        return result

    def execute_command(self, action: ExecuteCommandAction) -> Dict[str, Any]:
        # Simple subprocess implementation
        import subprocess
        
        session_name = action.session_name or self._default_session
        cwd = self.sessions.get(session_name, {}).get("cwd", self.workspace_dir)
        
        try:
             result = subprocess.run(
                action.command, 
                shell=True, 
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=60
            )
             
             output = ""
             if result.stdout:
                 output += f"STDOUT:\n{result.stdout}\n"
             if result.stderr:
                 output += f"STDERR:\n{result.stderr}\n"
                 
             response = {
                 "status": "success" if result.returncode == 0 else "error",
                 "content": [{"text": output or "Command executed (no output)."}]
             }

             # Check for localhost URLs for live preview
             url = self._detect_localhost_url(output)
             if url:
                 response["__ui_data__"] = {
                     "type": "project",
                     "data": {
                         "url": url,
                         "action": "preview"
                     }
                 }
             
             return response

        except Exception as e:
             return {"status": "error", "content": [{"text": str(e)}]}

    def list_files(self, action: ListFilesAction) -> Dict[str, Any]:
        session_name = action.session_name or self._default_session
        cwd = self.sessions.get(session_name, {}).get("cwd", self.workspace_dir)
        target_path = cwd / (action.path or ".")
        
        if not target_path.exists():
             return {"status": "error", "content": [{"text": f"Path not found: {target_path}"}]}
             
        try:
            files = [f.name for f in target_path.iterdir()]
            return {"status": "success", "content": [{"json": files}]}
        except Exception as e:
            return {"status": "error", "content": [{"text": str(e)}]}

    def read_files(self, action: ReadFilesAction) -> Dict[str, Any]:
        session_name = action.session_name or self._default_session
        cwd = self.sessions.get(session_name, {}).get("cwd", self.workspace_dir)
        
        results = {}
        errors = []
        
        for p in action.paths:
            try:
                path = cwd / p
                if path.exists() and path.is_file():
                    with open(path, 'r') as f:
                        results[p] = f.read()
                else:
                    errors.append(f"File not found: {p}")
            except Exception as e:
                errors.append(f"Error reading {p}: {e}")
                
        content = []
        if results:
            content.append({"json": results})
        if errors:
            content.append({"text": "\n".join(errors)})
            
        return {"status": "success" if not errors else "error", "content": content}

    def write_files(self, action: WriteFilesAction) -> Dict[str, Any]:
        session_name = action.session_name or self._default_session
        cwd = self.sessions.get(session_name, {}).get("cwd", self.workspace_dir)
        
        for item in action.content:
            path = cwd / item.path
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w') as f:
                f.write(item.text)
                
        return {"status": "success", "content": [{"text": f"Written {len(action.content)} files."}]}
        
    def remove_files(self, action: RemoveFilesAction) -> Dict[str, Any]:
        session_name = action.session_name or self._default_session
        cwd = self.sessions.get(session_name, {}).get("cwd", self.workspace_dir)
        
        deleted = []
        errors = []
        
        for p in action.paths:
            path = cwd / p
            try:
                if path.is_file():
                    path.unlink()
                    deleted.append(p)
                elif path.is_dir():
                    shutil.rmtree(path)
                    deleted.append(p)
            except Exception as e:
                errors.append(f"Error removing {p}: {e}")
                
        return {
            "status": "success", 
            "content": [{"text": f"Deleted: {deleted}\nErrors: {errors}"}]
        }
