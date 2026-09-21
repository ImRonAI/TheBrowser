import sys
import json
import io
import contextlib
import traceback
import importlib.util

def code_interpreter(code: str = "") -> str:
    """
    Executes Python code and returns the result as a JSON string.
    This function is designed to be called by the Electron UtilityRunner.
    
    Args:
        code: The Python code to execute.
    
    Returns:
        JSON string containing the execution result {status, content, stdout, stderr}.
    """
    if not code:
        return json.dumps({"status": "error", "content": [{"text": "No code provided"}]})

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    
    # Execution context
    globals_dict = {"json": json, "sys": sys}
    
    try:
        with contextlib.redirect_stdout(stdout_capture), contextlib.redirect_stderr(stderr_capture):
            raise RuntimeError("Python code execution is disabled; use the isolated sandbox service")
            
        stdout = stdout_capture.getvalue()
        stderr = stderr_capture.getvalue()
        
        output = ""
        if stdout: output += f"STDOUT:\n{stdout}\n"
        if stderr: output += f"STDERR:\n{stderr}\n"
        
        if not output: output = "Code executed successfully (no output)."
        
        return json.dumps({
            "status": "success",
            "content": [{"text": output}]
        })
        
    except Exception:
        stderr = stderr_capture.getvalue()
        traceback_str = traceback.format_exc()
        return json.dumps({
            "status": "error",
            "content": [{"text": f"Error executing code:\n{stderr}\n{traceback_str}"}]
        })

if __name__ == "__main__":
    # If run directly (e.g. for testing), read code from stdin or args?
    # But UtilityRunner imports this module and calls code_interpreter().
    # This block is just for manual testing.
    pass
