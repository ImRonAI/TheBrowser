"""MCP Tools Export - Export filtered OpenAPI as MCP tools manifest."""

import re
from typing import Any


def export_mcp_tools(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Export an OpenAPI spec as a list of MCP tool definitions.
    
    Args:
        spec: Filtered OpenAPI specification
        
    Returns:
        List of MCP tool definitions with:
        - name: operationId
        - description: summary + description
        - method: HTTP method
        - path: API path
        - inputSchema: Derived from parameters + requestBody
        - outputSchema: From 2xx responses when present
        - security: Security requirements
    """
    tools: list[dict[str, Any]] = []
    
    for path, path_item in spec.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        
        for method, operation in path_item.items():
            if method.startswith("x-") or not isinstance(operation, dict):
                continue
            
            tool = _operation_to_tool(path, method, operation, path_item, spec)
            if tool:
                tools.append(tool)
    
    # Sort by name for deterministic output
    tools.sort(key=lambda t: t.get("name", ""))
    
    return tools


def _operation_to_tool(
    path: str,
    method: str,
    operation: dict[str, Any],
    path_item: dict[str, Any],
    spec: dict[str, Any]
) -> dict[str, Any] | None:
    """Convert an OpenAPI operation to an MCP tool definition."""
    
    # Get operationId or generate one
    name = operation.get("operationId")
    if not name:
        # Generate from path and method
        name = _slug_operation_name(method, path)
    
    # Build description
    parts = []
    if operation.get("summary"):
        parts.append(operation["summary"])
    if operation.get("description"):
        parts.append(operation["description"])
    description = "\n\n".join(parts) or f"{method.upper()} {path}"
    
    tool: dict[str, Any] = {
        "name": name,
        "description": description,
        "method": method.upper(),
        "path": path
    }
    
    # Build inputSchema
    input_schema = _build_input_schema(operation, path_item, spec)
    if input_schema:
        tool["inputSchema"] = input_schema
    
    # Build outputSchema
    output_schema = _build_output_schema(operation, spec)
    if output_schema:
        tool["outputSchema"] = output_schema
    
    # Security
    security = operation.get("security")
    if security is not None:
        tool["security"] = security
    elif "security" in spec:
        tool["security"] = spec["security"]
    
    return tool


def _build_input_schema(
    operation: dict[str, Any],
    path_item: dict[str, Any],
    spec: dict[str, Any]
) -> dict[str, Any] | None:
    """Build input schema from parameters and requestBody."""
    properties: dict[str, Any] = {}
    required: list[str] = []
    
    # Process parameters (path-level + operation-level, with operation-level override)
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
        param_schema = param.get("schema", {})

        # Resolve ref if needed
        if isinstance(param_schema, dict) and "$ref" in param_schema:
            param_schema = _resolve_ref(spec, param_schema["$ref"]) or param_schema

        # Add to properties with location prefix
        key = f"{param_in}_{param_name}"
        properties[key] = {
            **(param_schema if isinstance(param_schema, dict) else {}),
            "description": param.get("description", f"{param_in} parameter: {param_name}")
        }

        if param.get("required"):
            required.append(key)
    
    # Process requestBody
    request_body = operation.get("requestBody", {})
    if isinstance(request_body, dict) and "$ref" in request_body:
        request_body = _resolve_ref(spec, request_body["$ref"]) or request_body
    if isinstance(request_body, dict):
        content = request_body.get("content", {})
        
        # Prefer JSON content
        json_content = content.get("application/json")
        if json_content:
            schema = json_content.get("schema", {})
            if "$ref" in schema:
                schema = _resolve_ref(spec, schema["$ref"]) or schema
            
            if schema:
                properties["body"] = schema
                if request_body.get("required"):
                    required.append("body")
        elif content:
            # Use first available content type
            for content_type, media_type in content.items():
                schema = media_type.get("schema", {})
                if "$ref" in schema:
                    schema = _resolve_ref(spec, schema["$ref"]) or schema
                
                if schema:
                    properties["body"] = {
                        **schema,
                        "description": f"Request body ({content_type})"
                    }
                    if request_body.get("required"):
                        required.append("body")
                break
    
    if not properties:
        return None
    
    result: dict[str, Any] = {
        "type": "object",
        "properties": properties
    }
    
    if required:
        result["required"] = required
    
    return result


def _build_output_schema(
    operation: dict[str, Any],
    spec: dict[str, Any]
) -> dict[str, Any] | None:
    """Build output schema from 2xx responses."""
    responses = operation.get("responses", {})
    
    # Find first 2xx response with a schema
    for code, response in responses.items():
        if not isinstance(code, str) or not code.startswith("2"):
            continue
        
        if not isinstance(response, dict):
            continue
        
        content = response.get("content", {})
        
        # Prefer JSON content
        json_content = content.get("application/json")
        if json_content:
            schema = json_content.get("schema", {})
            if "$ref" in schema:
                schema = _resolve_ref(spec, schema["$ref"]) or schema
            return schema
        elif content:
            # Use first available content type
            for media_type in content.values():
                schema = media_type.get("schema", {})
                if "$ref" in schema:
                    schema = _resolve_ref(spec, schema["$ref"]) or schema
                return schema
    
    return None


def _resolve_ref(spec: dict[str, Any], ref: str) -> Any:
    """Resolve a $ref against a spec."""
    if not ref.startswith("#/"):
        return None
    
    parts = ref[2:].split("/")
    current: Any = spec
    
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                idx = int(part)
                current = current[idx]
            except (ValueError, IndexError):
                return None
        else:
            return None
        
        if current is None:
            return None
    
    return current


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
    """Return a stable identity tuple for parameter dedupe."""
    if not isinstance(param, dict):
        return None
    if "$ref" in param:
        ref = param.get("$ref")
        if isinstance(ref, str):
            # Keep refs stable by using the ref pointer as both components.
            return ("$ref", ref)
        return None
    name = param.get("name")
    in_ = param.get("in")
    if isinstance(name, str) and isinstance(in_, str):
        return (in_, name)
    return None


def _slug_operation_name(method: str, path: str) -> str:
    """Generate deterministic operation names from method+path."""
    raw = f"{method}_{path.replace('/', '_').replace('{', '').replace('}', '')}".strip("_")
    # Collapse accidental duplicate underscores from leading/trailing separators.
    return re.sub(r"_+", "_", raw)


def export_mcp_tools_json(spec: dict[str, Any]) -> dict[str, Any]:
    """
    Export with metadata wrapper.
    
    Returns:
        Object with tools array and metadata
    """
    tools = export_mcp_tools(spec)
    
    return {
        "tools": tools,
        "metadata": {
            "openapi_version": spec.get("openapi", "3.1.0"),
            "api_title": spec.get("info", {}).get("title", "Unknown"),
            "api_version": spec.get("info", {}).get("version", "1.0.0"),
            "tool_count": len(tools)
        }
    }
