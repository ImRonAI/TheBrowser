import logging
import json
import ast
from typing import Any, Dict, List, Optional

from strands import tool
from .code_interpreter import CodeInterpreter
from .models import (
    CodeInterpreterInput,
    ExecuteCodeAction,
    InitSessionAction,
    LanguageType,
)
from ..browser.browser import Browser
from ..browser.models import BrowserInput, EvaluateAction

logger = logging.getLogger(__name__)

class ElectronCodeInterpreter(CodeInterpreter):
    """
    Code Interpreter implementation that bridges to Electron's UtilityProcess
    via the Browser connection (using window.electronAPI.tools.execute).
    """
    
    def __init__(self, browser: Browser):
        super().__init__()
        self.browser_tool = browser
        self._default_session = "default"

    def start_platform(self) -> None:
        pass

    def cleanup_platform(self) -> None:
        pass

    def get_supported_languages(self) -> List[LanguageType]:
        return [LanguageType.PYTHON]

    def init_session(self, action: InitSessionAction) -> Dict[str, Any]:
        return {"status": "success", "content": [{"text": "Session initialization delegated to Electron."}]}

    def list_local_sessions(self) -> Dict[str, Any]:
        return {"status": "success", "content": [{"json": ["default"]}]}

    def execute_code(self, action: ExecuteCodeAction) -> Dict[str, Any]:
        if action.language != LanguageType.PYTHON:
            return {"status": "error", "content": [{"text": f"Language {action.language} not supported."}]}

        # Construct the JavaScript call to execute the tool
        # tool name matches the function name in code_interpreter_wrapper.py
        tool_name = "code_interpreter"
        args = {"code": action.code}
        
        # Serialize args for JS
        args_json = json.dumps(args)
        
        script = f"window.electronAPI.tools.execute('{tool_name}', {args_json})"
        
        try:
            # Execute via Browser Tool
            # We assume the browser is connected to the Electron App (CDP 9222)
            result = self.browser_tool.evaluate(EvaluateAction(
                type="evaluate",
                script=script,
                session_name="main" # Assuming 'main' is the default session in browser
            ))
            
            # Result content[0].text is "Evaluation result: {JSON}"
            text_result = result["content"][0]["text"]
            prefix = "Evaluation result: "
            if text_result.startswith(prefix):
                raw_json = text_result[len(prefix):]
                
                # The raw_json is a string representation of the JS object returned by execute()
                # We need to parse it. 
                # If it's a Python dict string (single quotes), we might need literal_eval or json fix.
                # However, LocalChromiumBrowser.evaluate uses standard primitive returns.
                # If window.electronAPI returns an Object, Playwright returns a Dict.
                
                try:
                    # Attempt to parse as JSON first (if strictly JSON)
                    # But Python's str(dict) uses single quotes.
                    # Use ast.literal_eval for safety if it looks like a python dict string
                    if raw_json.startswith("{"):
                        execution_result = ast.literal_eval(raw_json)
                    else:
                         return {"status": "error", "content": [{"text": f"Unexpected result format: {raw_json}"}]}
                    
                    # ExecutionResult structure from Electron:
                    # { success, result: { status, content }, stdout, stderr, ... }
                    
                    if not execution_result.get("success"):
                        error_msg = execution_result.get("error", "Unknown Electron error")
                        return {"status": "error", "content": [{"text": f"Electron execution failed: {error_msg}"}]}
                        
                    inner_result = execution_result.get("result", {})
                    # Add stdout/stderr to content for visibility
                    stdout = execution_result.get("stdout", "")
                    stderr = execution_result.get("stderr", "")
                    
                    final_content = []
                    if inner_result.get("content"):
                         final_content.extend(inner_result["content"])
                    else:
                         final_content.append({"text": "No content returned."})
                         
                    if stdout: final_content.append({"text": f"\nSTDOUT:\n{stdout}"})
                    if stderr: final_content.append({"text": f"\nSTDERR:\n{stderr}"})
                    
                    return {
                        "status": inner_result.get("status", "success"),
                        "content": final_content
                    }

                except Exception as e:
                    return {"status": "error", "content": [{"text": f"Failed to parse Electron result: {e}\nRaw: {raw_json}"}]}
                    
            else:
                 return {"status": "error", "content": [{"text": f"Unexpected browser output: {text_result}"}]}
                 
        except Exception as e:
            logger.error(f"ElectronCodeInterpreter error: {e}")
            return {"status": "error", "content": [{"text": f"Bridge error: {str(e)}"}]}

    # Other methods (file ops) not strictly required if code execution can do it
    # But strictly adhering to interface:
    def execute_command(self, action):
        # We can run commands via Python subprocess inside the code capability
        code = f"import subprocess\nsubprocess.run('{action.command}', shell=True, check=True)"
        return self.execute_code(ExecuteCodeAction(code=code, language=LanguageType.PYTHON))

    def list_files(self, action):
        code = f"import os\nprint(os.listdir('{action.path or '.'}'))"
        return self.execute_code(ExecuteCodeAction(code=code, language=LanguageType.PYTHON))

    def read_files(self, action):
         # TODO: optimize
         code = "results={}\n"
         for p in action.paths:
             code += f"with open('{p}', 'r') as f: results['{p}']=f.read()\n"
         code += "print(results)"
         return self.execute_code(ExecuteCodeAction(code=code, language=LanguageType.PYTHON))

    def write_files(self, action):
        code = ""
        for item in action.content:
            text = item.text.replace("'", "\\'").replace("\n", "\\n") # naive escape
            code += f"with open('{item.path}', 'w') as f: f.write('{text}')\n"
        return self.execute_code(ExecuteCodeAction(code=code, language=LanguageType.PYTHON))
    
    def remove_files(self, action):
        code = "import os\n"
        for p in action.paths:
             code += f"os.remove('{p}')\n"
        return self.execute_code(ExecuteCodeAction(code=code, language=LanguageType.PYTHON))
