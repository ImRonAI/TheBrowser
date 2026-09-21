
import json
import logging
import os
import asyncio
from typing import Any, Dict, List, Optional, Union

from strands import tool
from .browser.browser import Browser
from .browser.models import BrowserInput, EvaluateAction, InitSessionAction

logger = logging.getLogger(__name__)

class ElectronSandboxTools:
    """
    Wraps Electron's sandboxed IPC methods as Strands tools.
    Requires a connected Browser instance.
    """
    
    def __init__(self, browser: Browser):
        self.browser = browser

    async def _call_electron(self, method: str, args: List[Any], timeout_ms: int = 15000) -> Dict[str, Any]:
        """
        Calls window.electron.sandbox.<method>(...args) via browser.evaluate().
        Ensures a browser session exists before making the call.
        """
        # Ensure browser platform is started
        if not self.browser._started:
            await self.browser._start()

        # Ensure a browser session exists for Electron IPC
        session_name = self.browser.get_default_session_name()
        if not session_name:
            # Initialize a session for Electron sandbox operations
            try:
                init_result = await self.browser.init_session(InitSessionAction(
                    type="init_session",
                    description="Electron sandbox session for IPC",
                    session_name="electron-sandbox"
                ))
                if init_result.get("status") != "success":
                    error_msg = init_result.get("content", [{}])[0].get("text", "Unknown error")
                    return {"success": False, "error": f"Failed to initialize browser session: {error_msg}"}
                session_name = "electron-sandbox"
            except Exception as e:
                return {"success": False, "error": f"Failed to initialize browser session: {str(e)}"}

        # Build JavaScript to call window.electron.sandbox methods
        json_args = json.dumps(args)
        script_json = f"""
            (async () => {{
                const args = {json_args};
                const timeoutMs = {timeout_ms};
                if (!window.electron || !window.electron.sandbox || typeof window.electron.sandbox.{method} !== "function") {{
                    return JSON.stringify({{"success": false, "error": "Electron sandbox API unavailable for {method}"}});
                }}
                const call = window.electron.sandbox.{method}(...args);
                const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("IPC timeout")), timeoutMs));
                try {{
                    const res = await Promise.race([call, timeout]);
                    return JSON.stringify(res);
                }} catch (e) {{
                    return JSON.stringify({{"success": false, "error": String(e && e.message ? e.message : e)}});
                }}
            }})()
        """

        async def _evaluate_on_shell():
            if hasattr(self.browser, "_get_shell_page"):
                try:
                    page = await self.browser._get_shell_page()
                    if page:
                        return await page.evaluate(script_json)
                except Exception:
                    pass
            return await self.browser.evaluate(EvaluateAction(
                type="evaluate",
                script=script_json,
                session_name=session_name
            ))

        # Call browser.evaluate with timeout guard
        try:
            eval_result = await asyncio.wait_for(_evaluate_on_shell(), timeout=max(2, (timeout_ms / 1000) + 2))
        except asyncio.TimeoutError:
            return {"success": False, "error": f"Electron sandbox {method} timed out after {timeout_ms}ms"}
        except Exception as e:
            return {"success": False, "error": f"Failed to call Electron IPC: {str(e)}"}

        # If result came from Browser.evaluate (dict), unpack it
        if isinstance(eval_result, dict):
            if eval_result.get("status") == "error":
                error_msg = eval_result.get("content", [{}])[0].get("text", "Unknown error")
                return {"success": False, "error": error_msg}
            result_text = eval_result.get("content", [{}])[0].get("text", "{}")
        else:
            result_text = eval_result if isinstance(eval_result, str) else json.dumps(eval_result)

        # Parse JSON result
        try:
            return json.loads(result_text)
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Failed to parse result: {e}", "raw": result_text}

    @tool
    async def shell(
        self,
        command: Union[str, List[Union[str, Dict[str, Any]]]],
        parallel: bool = False,
        ignore_errors: bool = False,
        timeout: int = 15000,
        work_dir: str = None, # API signature match, but ignored/enforced by sandbox
        non_interactive: bool = False,
    ) -> Dict[str, Any]:
        """
        Execute shell commands in the secure agent sandbox.
        """
        # Normalize command
        cmds = command if isinstance(command, list) else [command]
        
        results = []
        for cmd_item in cmds:
            cmd_str = cmd_item if isinstance(cmd_item, str) else cmd_item.get("command")
            if not cmd_str: continue
            
            # Call Electron
            # signature: shell(command, args, options)
            # We treat the whole string as command + args for simplicity in this wrapper?
            # Or we let Electron spawn handle it with shell=True.
            
            resp = await self._call_electron(
                "shell",
                [cmd_str, [], {"timeout": timeout}],
                timeout_ms=timeout + 2000
            )

            results.append({
                "command": cmd_str,
                "status": "success" if resp.get("success") else "error",
                "output": resp.get("stdout", "") + resp.get("stderr", ""),
                "exit_code": resp.get("exitCode", -1),
                "error": resp.get("error")
            })

            if not ignore_errors and not resp.get("success"):
                break

        # Format output for Bedrock - must be valid JSON object or text
        success = all(r["status"] == "success" for r in results)
        return {
            "status": "success" if success else "error",
            "content": [{"text": json.dumps(results, indent=2)}]
        }

    @tool
    async def file_read(
        self,
        path: str,
        mode: str = "read", # Only "read" supported for now in sandbox
        start_line: int = 0,
        end_line: int = None
    ) -> Dict[str, Any]:
        """
        Read files from the secure agent sandbox.
        """
        resp = await self._call_electron("readFile", [path], timeout_ms=5000)
        
        if not resp.get("success"):
            return {
                "status": "error", 
                "content": [{"text": f"Error reading {path}: {resp.get('error')}"}]
            }
        
        content = resp.get("content", "")
        
        # Handle lines mode
        if start_line > 0 or end_line is not None:
            lines = content.split('\n')
            end = end_line if end_line is not None else len(lines)
            content = '\n'.join(lines[start_line:end])
             
        return {
            "status": "success",
            "content": [{"text": content}]
        }

    @tool
    async def file_write(
        self,
        path: str,
        content: str,
        mode: str = "write" # write vs append? Electron API implies overwrite currently
    ) -> Dict[str, Any]:
        """
        Write files to the secure agent sandbox.
        """
        # TODO: Implement append in Electron if needed. For now assume overwrite.
        
        resp = await self._call_electron("writeFile", [path, content], timeout_ms=8000)
        
        if not resp.get("success"):
            return {
                "status": "error", 
                "content": [{"text": f"Error writing {path}: {resp.get('error')}"}]
            }
            
        return {
            "status": "success",
            "content": [{"text": f"Successfully wrote to {path}"}]
        }
        
    @tool
    async def list_files(
        self,
        path: str = "."
    ) -> Dict[str, Any]:
        """
        List files in the secure agent sandbox.
        """
        resp = await self._call_electron("listFiles", [path], timeout_ms=5000)
        
        if not resp.get("success"):
            return {
                "status": "error", 
                "content": [{"text": f"Error listing {path}: {resp.get('error')}"}]
            }
            
        return {
            "status": "success",
            "content": [{"text": json.dumps(resp.get("files", []), indent=2)}]
        }

    @tool
    async def editor(
        self,
        command: str,
        path: str,
        file_text: str = None,
        view_range: List[int] = None,
        old_str: str = None,
        new_str: str = None,
        insert_line: int = None
    ) -> Dict[str, Any]:
        """
        Edit files in the secure agent sandbox.
        Commands:
        - view: Read file content
        - create: Create new file with content
        - str_replace: Replace string in file
        - insert: Insert line (not fully impl)
        """
        if command == "view":
            start = view_range[0] if view_range else 0
            end = view_range[1] if view_range and len(view_range) > 1 else None
            return await self.file_read(path, start_line=start, end_line=end)
            
        elif command == "create":
            return await self.file_write(path, file_text)
            
        elif command == "str_replace":
            # Read, replace, write
            read_res = await self.file_read(path)
            if read_res["status"] == "error": return read_res
            
            content = read_res["content"][0]["text"]
            if old_str not in content:
                return {"status": "error", "content": [{"text": f"String '{old_str}' not found in {path}"}]}
                
            new_content = content.replace(old_str, new_str)
            return await self.file_write(path, new_content)
            
        return {"status": "error", "content": [{"text": f"Command {command} not supported in sandbox"}]}
