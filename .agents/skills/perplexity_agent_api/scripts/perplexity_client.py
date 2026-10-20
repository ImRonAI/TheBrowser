#!/usr/bin/env python3
"""
Perplexity Agent API & Skills Client Toolkit
Robust, flexible, and zero-dependency Python client for Perplexity's Agent API.
Supports:
- Model fallback chains (up to 5 models)
- Presets with step/model overrides
- Web Search, Sandbox, URL Fetching, Finance Search, People Search, MCP, Connectors
- Background asynchronous runs with automatic polling
- Skills lifecycle (create, list, get, update revision, download, delete)
- Sandbox file generation, listing, and downloading
- Listing available models
"""

import os
import sys
import json
import time
import zipfile
import tempfile
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Union

API_BASE_URL = "https://api.perplexity.ai"


def find_api_key() -> str:
    """Find Perplexity API key from environment or .env files."""
    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if api_key:
        return api_key

    # Check .env in current and parent directories
    curr = os.path.abspath(os.getcwd())
    while curr:
        env_file = os.path.join(curr, ".env")
        if os.path.exists(env_file):
            try:
                with open(env_file, "r") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("PERPLEXITY_API_KEY="):
                            val = line.split("=", 1)[1].strip().strip("\"'")
                            if val:
                                return val
            except Exception:
                pass
        parent = os.path.dirname(curr)
        if parent == curr:
            break
        curr = parent
    return ""


class PerplexityAgentClient:
    """Perplexity Agent API and Skills client."""

    def __init__(self, api_key: Optional[str] = None, base_url: str = API_BASE_URL):
        self.api_key = api_key or find_api_key()
        self.base_url = base_url.rstrip("/")

    def _headers(self, content_type: str = "application/json") -> Dict[str, str]:
        if not self.api_key:
            raise ValueError(
                "PERPLEXITY_API_KEY is not set. Please set it in your environment or .env file."
            )
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "AntigravityPerplexityClient/1.0",
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _request(
        self,
        method: str,
        path: str,
        data: Optional[Union[Dict[str, Any], bytes]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        req_headers = headers if headers is not None else self._headers()

        req_body = None
        if data is not None:
            if isinstance(data, (dict, list)):
                req_body = json.dumps(data).encode("utf-8")
            elif isinstance(data, bytes):
                req_body = data

        req = urllib.request.Request(url, data=req_body, headers=req_headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:
                resp_content = resp.read()
                content_type = resp.headers.get("Content-Type", "")
                if "application/json" in content_type:
                    return json.loads(resp_content.decode("utf-8"))
                return resp_content
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            try:
                err_json = json.loads(err_body)
                raise RuntimeError(
                    f"Perplexity API Error [{e.code}]: {err_json.get('error', err_body)}"
                )
            except Exception:
                raise RuntimeError(f"Perplexity API Error [{e.code}]: {err_body}")
        except Exception as e:
            raise RuntimeError(f"Request failed to {url}: {e}")

    # =========================================================================
    # Models API
    # =========================================================================

    def list_models(self) -> List[Dict[str, Any]]:
        """List all models available for the Agent API."""
        resp = self._request("GET", "/v1/models")
        return resp.get("data", [])

    # =========================================================================
    # Agent API Execution
    # =========================================================================

    def create_agent(
        self,
        input_data: Union[str, List[Dict[str, Any]]],
        preset: Optional[str] = None,
        model: Optional[str] = None,
        fallback_models: Optional[List[str]] = None,
        max_steps: Optional[int] = None,
        max_output_tokens: Optional[int] = None,
        background: bool = False,
        stream: bool = False,
        instructions: Optional[str] = None,
        # Convenient Tool Toggles & Configs
        tools: Optional[List[Dict[str, Any]]] = None,
        enable_web_search: Union[bool, Dict[str, Any]] = False,
        enable_sandbox: bool = False,
        enable_fetch_url: Union[bool, Dict[str, Any]] = False,
        enable_finance_search: bool = False,
        enable_people_search: bool = False,
        mcp_servers: Optional[List[Dict[str, Any]]] = None,
        connectors: Optional[List[str]] = None,
        custom_functions: Optional[List[Dict[str, Any]]] = None,
        # Skills Configuration
        skills: Optional[List[Union[str, Dict[str, Any]]]] = None,
        # Additional Options
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        previous_response_id: Optional[str] = None,
        # Polling & File auto-handling helpers
        poll_until_complete: bool = False,
        poll_timeout_sec: int = 300,
        poll_interval_sec: int = 2,
        download_files_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create an Agent API run with maximum flexibility.

        Args:
            input_data: Prompt string or list of message objects.
            preset: Preset name (e.g. 'fast', 'low', 'medium', 'high', 'xhigh').
            model: Model identifier override (e.g. 'anthropic/claude-3-7-sonnet').
            fallback_models: List of 1-5 models for fallback chain. Takes precedence over `model`.
            max_steps: Maximum reasoning/research steps (1-100). Overrides preset default.
            max_output_tokens: Max tokens to generate (required for Anthropic models).
            background: If True, executes asynchronously. Returns immediately with status 'queued'.
            stream: SSE stream mode (False by default for JSON responses).
            instructions: System instructions.
            tools: Full custom list of tool schemas, or use the helper toggles below.
            enable_web_search: True or dict with filters/search_type ('web' or 'fast').
            enable_sandbox: Enable code sandbox (allows file generation with share_file).
            enable_fetch_url: True or dict with max_urls.
            enable_finance_search: True to enable financial market data retrieval.
            enable_people_search: True to search professionals and people.
            mcp_servers: List of MCP configs: [{server_label, server_url, authorization...}].
            connectors: List of connector IDs.
            custom_functions: List of custom tool functions.
            skills: List of skills. Can be string names (e.g. 'office', 'office/pdf', 'skill_id')
                    or skill dicts (builtin, custom, or inline).
            response_format: Structured output JSON schema.
            poll_until_complete: If background=True, automatically poll until terminal state.
            download_files_dir: If set, automatically downloads files produced by the response.
        """
        payload: Dict[str, Any] = {}

        # 1. Input formatting
        if isinstance(input_data, str):
            payload["input"] = input_data
        elif isinstance(input_data, list):
            payload["input"] = input_data
        else:
            raise ValueError("input_data must be a string or list of message objects.")

        # 2. Preset & Models / Fallback Chain
        if preset:
            payload["preset"] = preset

        if fallback_models:
            if not isinstance(fallback_models, list) or len(fallback_models) == 0:
                raise ValueError("fallback_models must be a non-empty list of model strings.")
            payload["models"] = fallback_models[:5]
        elif model:
            payload["model"] = model
        elif not preset:
            payload["preset"] = "medium"

        # 3. Steps override
        if max_steps is not None:
            payload["max_steps"] = max(1, min(100, int(max_steps)))

        # 4. Token limit
        selected_model = model or (fallback_models[0] if fallback_models else "")
        if max_output_tokens is not None:
            payload["max_output_tokens"] = int(max_output_tokens)
        elif selected_model and "anthropic" in selected_model:
            payload["max_output_tokens"] = 4096

        # 5. System instructions
        if instructions:
            payload["instructions"] = instructions

        # 6. Background & Stream
        payload["background"] = background
        payload["stream"] = stream

        # 7. Tools Assembly
        assembled_tools: List[Dict[str, Any]] = []
        if tools is not None:
            assembled_tools.extend(tools)
        else:
            if enable_web_search:
                if isinstance(enable_web_search, dict):
                    tool_cfg = {"type": "web_search"}
                    tool_cfg.update(enable_web_search)
                    assembled_tools.append(tool_cfg)
                else:
                    assembled_tools.append({"type": "web_search"})

            if enable_sandbox:
                assembled_tools.append({"type": "sandbox"})

            if enable_fetch_url:
                if isinstance(enable_fetch_url, dict):
                    tool_cfg = {"type": "fetch_url"}
                    tool_cfg.update(enable_fetch_url)
                    assembled_tools.append(tool_cfg)
                else:
                    assembled_tools.append({"type": "fetch_url"})

            if enable_finance_search:
                assembled_tools.append({"type": "finance_search"})

            if enable_people_search:
                assembled_tools.append({"type": "people_search"})

            if mcp_servers:
                for mcp in mcp_servers:
                    mcp_tool = {"type": "mcp"}
                    mcp_tool.update(mcp)
                    assembled_tools.append(mcp_tool)

            if connectors:
                for conn_id in connectors:
                    assembled_tools.append({"type": "connector", "id": conn_id})

            if custom_functions:
                for fn in custom_functions:
                    fn_tool = {"type": "function"}
                    fn_tool.update(fn)
                    assembled_tools.append(fn_tool)

        if assembled_tools:
            payload["tools"] = assembled_tools

        # 8. Skills Assembly
        if skills:
            assembled_skills: List[Dict[str, Any]] = []
            builtin_names = {
                "office",
                "office/docx",
                "office/pdf",
                "office/pptx",
                "office/xlsx",
            }
            for sk in skills:
                if isinstance(sk, str):
                    if sk in builtin_names:
                        assembled_skills.append({"type": "builtin", "name": sk})
                    elif sk.startswith("skill_"):
                        assembled_skills.append({"type": "custom", "id": sk})
                    else:
                        assembled_skills.append({"type": "builtin", "name": sk})
                elif isinstance(sk, dict):
                    assembled_skills.append(sk)
            if assembled_skills:
                payload["skills"] = assembled_skills[:16]

        # 9. Additional options
        if response_format:
            payload["response_format"] = response_format
        if temperature is not None:
            payload["temperature"] = float(temperature)
        if top_p is not None:
            payload["top_p"] = float(top_p)
        if previous_response_id:
            payload["previous_response_id"] = previous_response_id

        # Send request
        response = self._request("POST", "/v1/agent", data=payload)

        # Polling if requested for background tasks
        response_id = response.get("id")
        if background and poll_until_complete and response_id:
            response = self.poll_response(
                response_id, timeout_sec=poll_timeout_sec, poll_interval_sec=poll_interval_sec
            )

        # Download generated files if folder specified
        if download_files_dir and response_id and response.get("status") == "completed":
            self.download_all_response_files(response_id, download_files_dir)

        return response

    # =========================================================================
    # Response Status, Polling, Cancellation, and Files
    # =========================================================================

    def retrieve_response(self, response_id: str) -> Dict[str, Any]:
        """Retrieve response snapshot by ID."""
        return self._request("GET", f"/v1/agent/{response_id}")

    def poll_response(
        self,
        response_id: str,
        timeout_sec: int = 300,
        poll_interval_sec: int = 2,
        verbose: bool = True,
    ) -> Dict[str, Any]:
        """Poll a background response until completion, failure, or timeout."""
        start_time = time.time()
        if verbose:
            sys.stderr.write(f"[*] Polling response {response_id}...\n")

        terminal_statuses = {"completed", "failed", "cancelled", "incomplete"}

        while time.time() - start_time < timeout_sec:
            res = self.retrieve_response(response_id)
            status = res.get("status")
            if verbose:
                sys.stderr.write(
                    f"    Status: {status} (elapsed: {int(time.time() - start_time)}s)\n"
                )

            if status in terminal_statuses:
                return res

            time.sleep(poll_interval_sec)

        raise TimeoutError(
            f"Timed out after {timeout_sec}s waiting for response {response_id} to complete."
        )

    def cancel_response(self, response_id: str) -> Dict[str, Any]:
        """Cancel a running response."""
        return self._request("POST", f"/v1/agent/{response_id}/cancel")

    def list_response_files(self, response_id: str) -> List[Dict[str, Any]]:
        """List files generated in sandbox for the response."""
        resp = self._request("GET", f"/v1/agent/{response_id}/files")
        return resp.get("data", [])

    def download_response_file(
        self, response_id: str, file_id: str, destination_path: str
    ) -> str:
        """Download raw bytes of a file created during an agent run."""
        raw_bytes = self._request(
            "GET",
            f"/v1/agent/{response_id}/files/{file_id}/content",
            headers=self._headers(content_type=""),
        )
        os.makedirs(os.path.dirname(os.path.abspath(destination_path)), exist_ok=True)
        with open(destination_path, "wb") as f:
            f.write(raw_bytes)
        return destination_path

    def download_all_response_files(self, response_id: str, output_dir: str) -> List[str]:
        """Download all files generated by a response to output_dir."""
        files = self.list_response_files(response_id)
        downloaded = []
        os.makedirs(output_dir, exist_ok=True)
        for f in files:
            file_id = f.get("id")
            filename = f.get("filename") or f"file_{file_id}"
            dest = os.path.join(output_dir, filename)
            self.download_response_file(response_id, file_id, dest)
            downloaded.append(dest)
        return downloaded

    # =========================================================================
    # Skills Lifecycle Management
    # =========================================================================

    def _zip_directory(self, dir_path: str) -> bytes:
        """Zip a directory containing SKILL.md into memory bytes."""
        skill_file = os.path.join(dir_path, "SKILL.md")
        if not os.path.exists(skill_file):
            raise FileNotFoundError(f"SKILL.md not found in directory: {dir_path}")

        temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        temp_zip_name = temp_zip.name
        temp_zip.close()

        try:
            with zipfile.ZipFile(temp_zip_name, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, _, files in os.walk(dir_path):
                    for file in files:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, dir_path)
                        zf.write(full_path, rel_path)
            with open(temp_zip_name, "rb") as f:
                return f.read()
        finally:
            if os.path.exists(temp_zip_name):
                os.remove(temp_zip_name)

    def create_skill(
        self,
        zip_path: Optional[str] = None,
        dir_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a new custom skill by uploading a ZIP bundle containing SKILL.md.
        Accepts either an existing zip_path or a dir_path to auto-compress.
        """
        if dir_path:
            zip_bytes = self._zip_directory(dir_path)
        elif zip_path:
            with open(zip_path, "rb") as f:
                zip_bytes = f.read()
        else:
            raise ValueError("Must provide either zip_path or dir_path.")

        boundary = "----AntigravityBoundary" + hex(int(time.time() * 1000))[2:]
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="skill.zip"\r\n'
            f"Content-Type: application/zip\r\n\r\n"
        ).encode("utf-8") + zip_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        headers = self._headers(content_type=f"multipart/form-data; boundary={boundary}")
        return self._request("POST", "/v1/skills", data=body, headers=headers)

    def list_skills(
        self, limit: int = 50, starting_after: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List all skills in the project."""
        url = f"/v1/skills?limit={limit}"
        if starting_after:
            url += f"&starting_after={starting_after}"
        resp = self._request("GET", url)
        return resp.get("data", [])

    def get_skill(self, skill_id: str, revision: Optional[int] = None) -> Dict[str, Any]:
        """Get skill metadata for active or specific revision."""
        url = f"/v1/skills/{skill_id}"
        if revision is not None:
            url += f"?revision={revision}"
        return self._request("GET", url)

    def update_skill_revision(
        self,
        skill_id: str,
        expected_revision: int,
        zip_path: Optional[str] = None,
        dir_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add a new revision to an existing skill."""
        if dir_path:
            zip_bytes = self._zip_directory(dir_path)
        elif zip_path:
            with open(zip_path, "rb") as f:
                zip_bytes = f.read()
        else:
            raise ValueError("Must provide either zip_path or dir_path.")

        boundary = "----AntigravityBoundary" + hex(int(time.time() * 1000))[2:]
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="expected_revision"\r\n\r\n'
            f"{expected_revision}\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="skill.zip"\r\n'
            f"Content-Type: application/zip\r\n\r\n"
        ).encode("utf-8") + zip_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        headers = self._headers(content_type=f"multipart/form-data; boundary={boundary}")
        return self._request("PUT", f"/v1/skills/{skill_id}", data=body, headers=headers)

    def list_skill_revisions(self, skill_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """List revisions of a skill."""
        resp = self._request("GET", f"/v1/skills/{skill_id}/revisions?limit={limit}")
        return resp.get("data", [])

    def download_skill(
        self, skill_id: str, save_path: str, revision: Optional[int] = None
    ) -> str:
        """Download skill zip bundle via its download URL."""
        url = f"/v1/skills/{skill_id}/download"
        if revision is not None:
            url += f"?revision={revision}"
        resp = self._request("GET", url)
        download_url = resp.get("download_url")
        if not download_url:
            raise RuntimeError(f"No download_url returned for skill {skill_id}: {resp}")

        req = urllib.request.Request(
            download_url, headers={"User-Agent": "AntigravityPerplexityClient/1.0"}
        )
        with urllib.request.urlopen(req) as r:
            content = r.read()
            os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
            with open(save_path, "wb") as f:
                f.write(content)
        return save_path

    def delete_skill(self, skill_id: str, expected_revision: int) -> Dict[str, Any]:
        """Delete a skill."""
        headers = self._headers()
        return self._request(
            "DELETE",
            f"/v1/skills/{skill_id}?expected_revision={expected_revision}",
            headers=headers,
        )
