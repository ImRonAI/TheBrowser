"""OpenAPI Invoke - Execute OpenAPI operations with streaming support."""

import json
import re
from typing import Any, AsyncGenerator
from urllib.parse import urlencode, quote

import httpx


class SSRFError(Exception):
    """Raised when a URL is blocked by SSRF protection."""
    pass


def _is_private_ip(host: str) -> bool:
    """Check if host is a private IP address."""
    # Check for localhost variants
    if host in ("localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"):
        return True
    
    # IPv4 private ranges
    private_ranges = [
        ("10.0.0.0", "10.255.255.255"),
        ("172.16.0.0", "172.31.255.255"),
        ("192.168.0.0", "192.168.255.255"),
        ("127.0.0.0", "127.255.255.255"),
        ("169.254.0.0", "169.254.255.255"),  # Link-local
        ("0.0.0.0", "0.255.255.255"),
    ]
    
    try:
        # Simple IP check
        parts = host.split(".")
        if len(parts) == 4 and all(p.isdigit() for p in parts):
            ip_int = sum(int(p) << (8 * (3 - i)) for i, p in enumerate(parts))
            for start, end in private_ranges:
                start_int = sum(int(p) << (8 * (3 - i)) for i, p in enumerate(start.split(".")))
                end_int = sum(int(p) << (8 * (3 - i)) for i, p in enumerate(end.split(".")))
                if start_int <= ip_int <= end_int:
                    return True
    except (ValueError, IndexError):
        pass
    
    return False


def _check_url_allowed(url: str, allow_http: bool = False) -> None:
    """Check if URL is allowed (SSRF protection)."""
    # Parse URL
    match = re.match(r"^(https?)://([^/]+)(.*)$", url)
    if not match:
        raise SSRFError(f"Invalid URL: {url}")
    
    scheme, host, _ = match.groups()
    
    # Enforce HTTPS by default
    if scheme == "http" and not allow_http:
        raise SSRFError("HTTP URLs not allowed (use HTTPS)")
    
    # Remove port if present
    host = host.split(":")[0]
    
    # Check for private IPs
    if _is_private_ip(host):
        raise SSRFError(f"Private IP addresses not allowed: {host}")
    
    # Check for common internal hostnames
    blocked_hosts = {"localhost", "metadata.google.internal", "169.254.169.254"}
    if host.lower() in blocked_hosts:
        raise SSRFError(f"Blocked hostname: {host}")


def _resolve_ref(spec: dict[str, Any], ref: str) -> Any:
    """Resolve a $ref in the spec."""
    if not ref.startswith("#/"):
        return None
    
    parts = ref[2:].split("/")
    current: Any = spec
    
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    
    return current


def _get_operation(
    spec: dict[str, Any],
    operation_id: str,
) -> tuple[str, str, dict[str, Any], dict[str, Any]] | None:
    """Find operation by operationId. Returns (path, method, operation, path_item)."""
    for path, path_item in spec.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.startswith("x-") or not isinstance(operation, dict):
                continue
            if operation.get("operationId") == operation_id:
                return path, method.lower(), operation, path_item
    return None


def _resolve_params(
    operation: dict[str, Any],
    path_item: dict[str, Any],
    spec: dict[str, Any],
    args: dict[str, Any]
) -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, Any] | None]:
    """
    Resolve parameters from args.
    Returns (path_params, query_params, header_params, body).
    """
    path_params: dict[str, str] = {}
    query_params: dict[str, str] = {}
    header_params: dict[str, str] = {}
    body: dict[str, Any] | None = None
    
    # Process parameters
    parameters = _merge_parameters(
        path_item.get("parameters", []),
        operation.get("parameters", []),
    )
    for param in parameters:
        if isinstance(param, dict) and "$ref" in param:
            param = _resolve_ref(spec, param["$ref"]) or param
        
        if not isinstance(param, dict):
            continue
        
        param_name = param.get("name", "")
        param_in = param.get("in", "query")
        
        # Look for param in args
        key = f"{param_in}_{param_name}"
        if key in args:
            value = args[key]
        elif param_name in args:
            value = args[param_name]
        else:
            continue
        
        # Convert value to string
        if isinstance(value, (dict, list)):
            str_value = json.dumps(value)
        else:
            str_value = str(value) if value is not None else ""
        
        if param_in == "path":
            path_params[param_name] = str_value
        elif param_in == "query":
            query_params[param_name] = str_value
        elif param_in == "header":
            header_params[param_name] = str_value
    
    # Handle requestBody
    request_body = operation.get("requestBody", {})
    if isinstance(request_body, dict) and "$ref" in request_body:
        request_body = _resolve_ref(spec, request_body["$ref"]) or request_body
    
    if isinstance(request_body, dict) and "content" in request_body:
        content = request_body["content"]
        
        # Prefer application/json
        if "application/json" in content:
            if "body" in args:
                body = args["body"]
        elif "application/x-www-form-urlencoded" in content:
            if "body" in args:
                # Convert body dict to form params
                form_body = args["body"]
                if isinstance(form_body, dict):
                    for k, v in form_body.items():
                        query_params[k] = str(v)
    
    return path_params, query_params, header_params, body


def _apply_auth(
    headers: dict[str, str],
    query_params: dict[str, str],
    security: list[dict[str, list[str]]] | None,
    security_schemes: dict[str, Any],
    auth: dict[str, Any]
) -> None:
    """Apply authentication to headers."""
    if not security or not auth:
        return
    
    auth_type = auth.get("type", "")
    
    if auth_type == "bearer" or auth_type == "http":
        token = auth.get("token") or auth.get("password") or ""
        headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "basic":
        import base64
        username = auth.get("username", "")
        password = auth.get("password", "")
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {credentials}"
    elif auth_type == "apiKey":
        key = auth.get("key", "")
        scheme_defaults = _find_api_key_scheme(security, security_schemes)
        name = auth.get("name", scheme_defaults.get("name", "X-API-Key"))
        in_ = auth.get("in", scheme_defaults.get("in", "header"))
        
        if in_ == "header":
            headers[name] = key
        elif in_ == "query":
            query_params[name] = key
        elif in_ == "cookie":
            existing_cookie = headers.get("Cookie")
            cookie_pair = f"{name}={key}"
            headers["Cookie"] = f"{existing_cookie}; {cookie_pair}" if existing_cookie else cookie_pair


def _find_api_key_scheme(
    security: list[dict[str, list[str]]] | None,
    security_schemes: dict[str, Any],
) -> dict[str, str]:
    """Find first apiKey scheme defaults from security requirements."""
    if not security:
        return {}
    for requirement in security:
        if not isinstance(requirement, dict):
            continue
        for scheme_name in requirement.keys():
            scheme = security_schemes.get(scheme_name, {})
            if isinstance(scheme, dict) and scheme.get("type") == "apiKey":
                name = scheme.get("name")
                in_ = scheme.get("in")
                if isinstance(name, str) and isinstance(in_, str):
                    return {"name": name, "in": in_}
    return {}


def _merge_parameters(
    path_parameters: Any,
    operation_parameters: Any,
) -> list[Any]:
    """Merge path-level and operation-level parameters with operation-level override."""
    merged: list[Any] = []
    seen_indexes: dict[tuple[str, str], int] = {}

    for source in (path_parameters, operation_parameters):
        if not isinstance(source, list):
            continue
        for param in source:
            key = _parameter_identity(param)
            if key is None:
                merged.append(param)
                continue
            if key in seen_indexes:
                merged[seen_indexes[key]] = param
            else:
                seen_indexes[key] = len(merged)
                merged.append(param)

    return merged


def _parameter_identity(param: Any) -> tuple[str, str] | None:
    if not isinstance(param, dict):
        return None
    if "$ref" in param:
        ref = param.get("$ref")
        if isinstance(ref, str):
            return ("$ref", ref)
        return None
    name = param.get("name")
    in_ = param.get("in")
    if isinstance(name, str) and isinstance(in_, str):
        return (in_, name)
    return None


def _build_url(
    base_url: str,
    path: str,
    path_params: dict[str, str],
    query_params: dict[str, str]
) -> str:
    """Build final URL with parameter substitution."""
    # Substitute path params
    final_path = path
    for name, value in path_params.items():
        final_path = final_path.replace(f"{{{name}}}", quote(value, safe=""))
    
    # Build URL
    url = base_url.rstrip("/") + final_path
    
    # Add query params
    if query_params:
        separator = "&" if "?" in final_path else "?"
        url += separator + urlencode(query_params)
    
    return url


async def invoke_openapi(
    spec: dict[str, Any],
    operation_id: str,
    args: dict[str, Any],
    auth: dict[str, Any] | None = None,
    base_url_override: str | None = None,
    stream: bool = False,
    allow_http: bool = False,
    timeout: float = 60.0,
    extra_headers: dict[str, str] | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Invoke an OpenAPI operation.
    
    Yields chunks if streaming, or single response if not.
    """
    # Find operation
    result = _get_operation(spec, operation_id)
    if not result:
        yield {"error": f"Operation not found: {operation_id}"}
        return
    
    path, method, operation, path_item = result
    
    # Get base URL
    if base_url_override:
        base_url = base_url_override
    else:
        servers = spec.get("servers", [{}])
        base_url = servers[0].get("url", "") if servers else ""
    
    if not base_url:
        yield {"error": "No base URL available (spec missing servers, provide base_url_override)"}
        return
    
    # Resolve parameters
    path_params, query_params, header_params, body = _resolve_params(operation, path_item, spec, args)
    
    # Build headers
    headers: dict[str, str] = {
        "Accept": "application/json",
        "User-Agent": "API-Forge/1.0",
    }
    headers.update(header_params)
    if isinstance(extra_headers, dict):
        for header_name, header_value in extra_headers.items():
            if not isinstance(header_name, str):
                continue
            headers[header_name] = str(header_value)
    
    # Apply auth
    security = operation.get("security") or spec.get("security")
    security_schemes = spec.get("components", {}).get("securitySchemes", {})
    if auth:
        _apply_auth(headers, query_params, security, security_schemes, auth)
    
    # Build URL
    url = _build_url(base_url, path, path_params, query_params)
    
    # SSRF check
    try:
        _check_url_allowed(url, allow_http=allow_http)
    except SSRFError as e:
        yield {"error": str(e)}
        return
    
    # Make request
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            request_kwargs: dict[str, Any] = {
                "headers": headers,
            }
            
            if body is not None:
                request_kwargs["json"] = body
            
            if stream:
                # Streaming mode
                async with client.stream(method, url, **request_kwargs) as response:
                    status = response.status_code
                    content_type = response.headers.get("content-type", "")
                    
                    # Yield metadata first
                    yield {
                        "type": "metadata",
                        "status": status,
                        "headers": dict(response.headers),
                        "contentType": content_type,
                    }
                    
                    # Stream content
                    buffer = ""
                    async for chunk in response.aiter_text():
                        buffer += chunk
                        yield {
                            "type": "chunk",
                            "data": chunk,
                        }
                    
                    # Yield complete response at end
                    yield {
                        "type": "complete",
                        "status": status,
                        "body": buffer if not content_type.startswith("application/json") else None,
                    }
            else:
                # Sync mode
                response = await client.request(method, url, **request_kwargs)
                
                status = response.status_code
                content_type = response.headers.get("content-type", "")
                
                # Parse response
                try:
                    if content_type.startswith("application/json"):
                        response_body = response.json()
                    else:
                        response_body = response.text
                except Exception:
                    response_body = response.text
                
                yield {
                    "type": "complete",
                    "status": status,
                    "headers": dict(response.headers),
                    "contentType": content_type,
                    "body": response_body,
                }
    
    except httpx.TimeoutException:
        yield {"error": f"Request timeout after {timeout}s"}
    except httpx.ConnectError as e:
        yield {"error": f"Connection error: {e}"}
    except Exception as e:
        yield {"error": f"Request failed: {e}"}
