"""OpenAPI Filter - Filter specs with $ref dependency closure."""

import re
from copy import deepcopy
from typing import Any


def filter_openapi(
    spec: dict[str, Any],
    allow_operation_ids: list[str] | None = None,
    allow_tags: list[str] | None = None,
    allow_paths: list[dict[str, Any]] | None = None,
    deny_operation_ids: list[str] | None = None,
    include_security_schemes: bool = True
) -> dict[str, Any]:
    """
    Filter an OpenAPI spec with transitive $ref closure.
    
    Args:
        spec: OpenAPI specification to filter
        allow_operation_ids: Allowlist of operationIds to include
        allow_tags: Allowlist of tags - operations with any of these tags are included
        allow_paths: Allowlist of paths with optional methods filter.
            Each item: {path: string, methods?: string[]}
        deny_operation_ids: Denylist of operationIds (deny wins over allow)
        include_security_schemes: Whether to include security schemes
        
    Returns:
        Filtered spec with before/after counts
    """
    spec = deepcopy(spec)
    
    # Build deny set for quick lookup
    deny_set = set(deny_operation_ids or [])
    
    # Track allowed operations
    allowed_operations: list[tuple[str, str, dict[str, Any]]] = []  # (path, method, operation)
    
    # Count before
    before_count = 0
    for path, path_item in spec.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.startswith("x-") or not isinstance(operation, dict):
                continue
            before_count += 1
    
    # Filter by operationIds
    if allow_operation_ids:
        for path, path_item in spec.get("paths", {}).items():
            if not isinstance(path_item, dict):
                continue
            for method, operation in path_item.items():
                if method.startswith("x-") or not isinstance(operation, dict):
                    continue
                op_id = operation.get("operationId")
                if op_id and op_id in allow_operation_ids and op_id not in deny_set:
                    allowed_operations.append((path, method, operation))
    
    # Filter by tags
    if allow_tags:
        tag_set = set(allow_tags)
        for path, path_item in spec.get("paths", {}).items():
            if not isinstance(path_item, dict):
                continue
            for method, operation in path_item.items():
                if method.startswith("x-") or not isinstance(operation, dict):
                    continue
                op_id = operation.get("operationId")
                if op_id in deny_set:
                    continue
                op_tags = operation.get("tags", [])
                if any(tag in tag_set for tag in op_tags):
                    # Avoid duplicates
                    if not any(op[2].get("operationId") == op_id for op in allowed_operations if op_id):
                        allowed_operations.append((path, method, operation))
    
    # Filter by paths
    if allow_paths:
        for allowed_path in allow_paths:
            path_pattern = allowed_path.get("path", "")
            allowed_methods = [m.lower() for m in (allowed_path.get("methods") or [])]
            
            for path, path_item in spec.get("paths", {}).items():
                if not isinstance(path_item, dict):
                    continue
                if not _path_matches(path, path_pattern):
                    continue
                    
                for method, operation in path_item.items():
                    if method.startswith("x-") or not isinstance(operation, dict):
                        continue
                    
                    if allowed_methods and method.lower() not in allowed_methods:
                        continue
                    
                    op_id = operation.get("operationId")
                    if op_id in deny_set:
                        continue
                    
                    # Avoid duplicates
                    if not any(
                        op[0] == path and op[1] == method 
                        for op in allowed_operations
                    ):
                        allowed_operations.append((path, method, operation))
    
    # If no filters specified, include all (except deny)
    if not allow_operation_ids and not allow_tags and not allow_paths:
        for path, path_item in spec.get("paths", {}).items():
            if not isinstance(path_item, dict):
                continue
            for method, operation in path_item.items():
                if method.startswith("x-") or not isinstance(operation, dict):
                    continue
                op_id = operation.get("operationId")
                if op_id not in deny_set:
                    allowed_operations.append((path, method, operation))
    
    # Collect all $refs from allowed operations
    refs = _collect_refs_from_operations(allowed_operations)
    
    # Transitively resolve refs
    all_refs = _resolve_refs_transitively(refs, spec)
    
    # Build filtered components
    filtered_components = _extract_components(spec, all_refs, include_security_schemes)
    
    # Build filtered paths
    filtered_paths: dict[str, dict[str, Any]] = {}
    for path, method, operation in allowed_operations:
        if path not in filtered_paths:
            filtered_paths[path] = {}
        filtered_paths[path][method] = operation
    
    # Sort for deterministic output
    filtered_paths = dict(sorted(filtered_paths.items()))
    
    # Build result spec
    result = {
        "openapi": spec.get("openapi", "3.1.0"),
        "info": spec.get("info", {}),
        "paths": filtered_paths
    }
    
    if filtered_components:
        result["components"] = filtered_components
    
    if "servers" in spec:
        result["servers"] = spec["servers"]
    
    if "security" in spec:
        result["security"] = spec["security"]
    
    if "tags" in spec:
        result["tags"] = spec["tags"]
    
    after_count = len(allowed_operations)
    
    return {
        "spec": result,
        "stats": {
            "before_operations": before_count,
            "after_operations": after_count,
            "removed_operations": before_count - after_count,
            "preserved_refs": len(all_refs)
        }
    }


def _path_matches(path: str, pattern: str) -> bool:
    """Check if a path matches a pattern (supports wildcards)."""
    # Convert pattern to regex
    regex_pattern = pattern.replace("*", ".*").replace("?", ".")
    regex_pattern = f"^{regex_pattern}$"
    return bool(re.match(regex_pattern, path))


def _collect_refs_from_operations(
    operations: list[tuple[str, str, dict[str, Any]]]
) -> set[str]:
    """Collect all $refs from a list of operations."""
    refs: set[str] = set()
    
    for path, method, operation in operations:
        # Parameters
        for param in operation.get("parameters", []):
            refs.update(_extract_refs(param))
        
        # Request body
        request_body = operation.get("requestBody", {})
        refs.update(_extract_refs(request_body))
        
        # Responses
        for response in operation.get("responses", {}).values():
            refs.update(_extract_refs(response))
        
        # Callbacks
        callbacks = operation.get("callbacks", {})
        refs.update(_extract_refs(callbacks))
        
        # Security
        for sec in operation.get("security", []):
            refs.update(_extract_refs(sec))
    
    return refs


def _extract_refs(obj: Any) -> set[str]:
    """Extract all $ref values from an object."""
    refs: set[str] = set()
    
    if isinstance(obj, dict):
        if "$ref" in obj and isinstance(obj["$ref"], str):
            refs.add(obj["$ref"])
        for value in obj.values():
            refs.update(_extract_refs(value))
    elif isinstance(obj, list):
        for item in obj:
            refs.update(_extract_refs(item))
    
    return refs


def _resolve_refs_transitively(initial_refs: set[str], spec: dict[str, Any]) -> set[str]:
    """Resolve all transitive refs."""
    all_refs: set[str] = set()
    to_process = list(initial_refs)
    
    while to_process:
        ref = to_process.pop()
        if ref in all_refs:
            continue
        
        all_refs.add(ref)
        
        # Resolve the ref
        target = _resolve_ref(spec, ref)
        if target is not None:
            # Find refs within this target
            nested_refs = _extract_refs(target)
            for nested in nested_refs:
                if nested not in all_refs:
                    to_process.append(nested)
    
    return all_refs


def _resolve_ref(spec: dict[str, Any], ref: str) -> Any:
    """Resolve a $ref against a spec."""
    if not ref.startswith("#/"):
        return None  # External refs not supported
    
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


def _extract_components(
    spec: dict[str, Any],
    refs: set[str],
    include_security_schemes: bool
) -> dict[str, Any]:
    """Extract only the referenced components."""
    components: dict[str, Any] = {}
    original_components = spec.get("components", {})
    
    # Parse refs to get required components
    required: dict[str, set[str]] = {}  # type -> set of names
    
    for ref in refs:
        if not ref.startswith("#/components/"):
            continue
        
        parts = ref[13:].split("/")
        if len(parts) >= 2:
            comp_type = parts[0]
            comp_name = parts[1]
            if comp_type not in required:
                required[comp_type] = set()
            required[comp_type].add(comp_name)
    
    # Extract components
    for comp_type, names in required.items():
        if comp_type not in original_components:
            continue
        
        if comp_type not in components:
            components[comp_type] = {}
        
        for name in names:
            if name in original_components[comp_type]:
                components[comp_type][name] = original_components[comp_type][name]
    
    # Include security schemes if requested
    if include_security_schemes and "securitySchemes" in original_components:
        components["securitySchemes"] = original_components["securitySchemes"]
    
    # Sort for deterministic output
    for comp_type in components:
        components[comp_type] = dict(sorted(components[comp_type].items()))
    
    return components
