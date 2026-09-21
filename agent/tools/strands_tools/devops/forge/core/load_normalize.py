"""OpenAPI Load and Normalize - Load specs from JSON/YAML and normalize to OpenAPI 3.1."""

import json
import os
import re
from copy import deepcopy
from typing import Any

import yaml


def _is_json_pointer(s: str) -> bool:
    """Check if string is a JSON pointer (starts with / or #/)."""
    return s.startswith("/") or s.startswith("#/")


def _resolve_json_pointer(obj: Any, pointer: str) -> Any:
    """Resolve a JSON pointer against an object."""
    if pointer.startswith("#"):
        pointer = pointer[1:]
    if not pointer or pointer == "/":
        return obj
    
    parts = pointer.lstrip("/").split("/")
    current = obj
    for part in parts:
        # Unescape JSON pointer tokens
        part = part.replace("~1", "/").replace("~0", "~")
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


def _stable_sort_dict(d: Any) -> Any:
    """Recursively sort dictionary keys for stable output."""
    if isinstance(d, dict):
        return {k: _stable_sort_dict(v) for k, v in sorted(d.items())}
    elif isinstance(d, list):
        return [_stable_sort_dict(item) for item in d]
    return d


def load_openapi(source: str, workdir: str | None = None) -> dict[str, Any]:
    """
    Load an OpenAPI spec from a string (JSON/YAML) or file path.
    
    Args:
        source: JSON/YAML string, file path, or JSON pointer to file
        workdir: Optional working directory for relative file paths
        
    Returns:
        Parsed OpenAPI specification as a dictionary
        
    Raises:
        ValueError: If the source cannot be parsed
        FileNotFoundError: If a file path is specified but not found
    """
    # Check if it's a file path first
    if workdir and not os.path.isabs(source):
        potential_path = os.path.join(workdir, source)
    else:
        potential_path = source
    
    if os.path.isfile(potential_path):
        with open(potential_path, "r", encoding="utf-8") as f:
            content = f.read()
        return _parse_content(content, potential_path)
    
    # Try parsing as direct content
    try:
        return _parse_content(source, "<inline>")
    except ValueError:
        pass
    
    raise ValueError(f"Could not load OpenAPI spec from: {source}")


def _parse_content(content: str, source_hint: str) -> dict[str, Any]:
    """Parse JSON or YAML content."""
    content = content.strip()
    
    if not content:
        raise ValueError("Empty content")
    
    # Try JSON first
    if content.startswith("{") or content.startswith("["):
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {e}")
    
    # Try YAML
    try:
        result = yaml.safe_load(content)
        if result is None:
            raise ValueError("Empty YAML content")
        if not isinstance(result, dict):
            raise ValueError(f"YAML content is not a mapping (got {type(result).__name__})")
        return result
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML: {e}")


def normalize_openapi(spec: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize an OpenAPI spec to a consistent format.
    
    - Ensures openapi version is present
    - Normalizes paths to sorted order
    - Normalizes components/schemas to sorted order
    - Handles OpenAPI 3.0.x to 3.1 conversion where safe
    - Returns stable-ordered dict
    
    Args:
        spec: Raw OpenAPI specification
        
    Returns:
        Normalized OpenAPI 3.1-compatible specification
    """
    spec = deepcopy(spec)
    
    # Ensure openapi version field exists
    if "openapi" not in spec and "swagger" in spec:
        # Convert swagger 2.0 marker (full conversion not attempted, just version marker)
        spec["openapi"] = "3.1.0"
        spec["x-original-swagger"] = spec.pop("swagger")
    elif "openapi" not in spec:
        spec["openapi"] = "3.1.0"
    
    # Normalize to OpenAPI 3.1 if it's 3.0.x
    version = spec.get("openapi", "")
    if version.startswith("3.0."):
        spec = _convert_30_to_31(spec)
    
    # Ensure required top-level fields
    if "info" not in spec:
        spec["info"] = {"title": "Untitled API", "version": "1.0.0"}
    if "paths" not in spec:
        spec["paths"] = {}
    
    # Sort paths for deterministic output
    spec["paths"] = dict(sorted(spec.get("paths", {}).items()))
    
    # Sort components for deterministic output
    if "components" in spec:
        spec["components"] = _sort_components(spec["components"])
    
    return _stable_sort_dict(spec)


def _convert_30_to_31(spec: dict[str, Any]) -> dict[str, Any]:
    """
    Convert OpenAPI 3.0.x to 3.1.0 where safe.
    
    Safe conversions:
    - nullable: true -> type: ["null", <type>]
    - type: <type>, nullable: true -> type: ["null", <type>]
    """
    spec = deepcopy(spec)
    spec["openapi"] = "3.1.0"
    
    # Walk all schemas and convert nullable
    components = spec.get("components", {})
    schemas = components.get("schemas", {})
    for schema in _walk_schemas(schemas):
        _convert_nullable(schema)
    
    # Walk all inline schemas in paths
    for path_item in spec.get("paths", {}).values():
        if not isinstance(path_item, dict):
            continue
        for operation in path_item.values():
            if not isinstance(operation, dict):
                continue
            # Request body schemas
            request_body = operation.get("requestBody", {})
            if isinstance(request_body, dict):
                content = request_body.get("content", {})
                for media_type in content.values():
                    schema = media_type.get("schema", {})
                    if isinstance(schema, dict):
                        _convert_nullable(schema)
            # Response schemas
            responses = operation.get("responses", {})
            for response in responses.values():
                if isinstance(response, dict):
                    content = response.get("content", {})
                    for media_type in content.values():
                        schema = media_type.get("schema", {})
                        if isinstance(schema, dict):
                            _convert_nullable(schema)
            # Parameter schemas
            parameters = operation.get("parameters", [])
            for param in parameters:
                if isinstance(param, dict):
                    schema = param.get("schema", {})
                    if isinstance(schema, dict):
                        _convert_nullable(schema)
    
    return spec


def _walk_schemas(schemas: dict[str, Any]) -> Any:
    """Recursively yield all schema objects from components/schemas."""
    for schema in schemas.values():
        yield from _walk_schema(schema)


def _walk_schema(schema: Any) -> Any:
    """Recursively yield a schema and all nested schemas."""
    if not isinstance(schema, dict):
        return
    yield schema
    
    # Walk properties
    for prop in schema.get("properties", {}).values():
        yield from _walk_schema(prop)
    
    # Walk items
    items = schema.get("items")
    if items:
        yield from _walk_schema(items)
    
    # Walk allOf/oneOf/anyOf
    for key in ("allOf", "oneOf", "anyOf"):
        for subschema in schema.get(key, []):
            yield from _walk_schema(subschema)
    
    # Walk additionalProperties if it's a schema
    additional = schema.get("additionalProperties")
    if isinstance(additional, dict):
        yield from _walk_schema(additional)


def _convert_nullable(schema: dict[str, Any]) -> None:
    """Convert OpenAPI 3.0 nullable to OpenAPI 3.1 type array."""
    if not isinstance(schema, dict):
        return
    
    if schema.get("nullable") is True:
        original_type = schema.get("type")
        if original_type and isinstance(original_type, str):
            schema["type"] = ["null", original_type]
        elif original_type is None:
            # No type specified, add null to anyOf or create anyOf
            if "anyOf" in schema:
                schema["anyOf"] = [{"type": "null"}] + schema["anyOf"]
            else:
                schema["anyOf"] = [{"type": "null"}, {}]
        del schema["nullable"]
    
    # Recurse into nested schemas
    for prop in schema.get("properties", {}).values():
        if isinstance(prop, dict):
            _convert_nullable(prop)
    
    items = schema.get("items")
    if isinstance(items, dict):
        _convert_nullable(items)
    
    for key in ("allOf", "oneOf", "anyOf"):
        for subschema in schema.get(key, []):
            if isinstance(subschema, dict):
                _convert_nullable(subschema)


def _sort_components(components: dict[str, Any]) -> dict[str, Any]:
    """Sort components sections for deterministic output."""
    sorted_components = {}
    for key in sorted(components.keys()):
        value = components[key]
        if isinstance(value, dict):
            sorted_components[key] = dict(sorted(value.items()))
        else:
            sorted_components[key] = value
    return sorted_components
