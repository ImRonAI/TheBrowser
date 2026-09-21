"""OpenAPI Splice - Merge multiple OpenAPI specs with collision handling."""

import re
from copy import deepcopy
from typing import Any


def splice_openapi(
    specs: list[dict[str, Any]],
    namespace_prefixes: list[str] | None = None,
    on_path_collision: str = "error",
    on_operationId_collision: str = "error",
    on_component_collision: str = "error"
) -> dict[str, Any]:
    """
    Splice (merge) multiple OpenAPI specifications.
    
    Args:
        specs: List of OpenAPI specs to merge
        namespace_prefixes: Optional prefix for each spec (for namespacing)
        on_path_collision: How to handle path+method collisions:
            - "error": Raise error (default)
            - "skip": Skip duplicate
            - "overwrite": Last wins
            - "prefix": Prefix paths with namespace
        on_operationId_collision: How to handle operationId collisions:
            - "error": Raise error (default)
            - "skip": Skip duplicate
            - "overwrite": Last wins
            - "prefix": Auto-prefix with namespace
        on_component_collision: How to handle component collisions:
            - "error": Raise error (default)
            - "skip": Skip duplicate
            - "overwrite": Last wins
            - "rename": Rename and rewrite refs
            
    Returns:
        Merged OpenAPI specification with merge report
        
    Raises:
        ValueError: On collision when policy is "error"
    """
    if not specs:
        raise ValueError("At least one spec is required")
    
    if namespace_prefixes and len(namespace_prefixes) != len(specs):
        raise ValueError("namespace_prefixes must match specs length")
    
    # Initialize merge result
    merged: dict[str, Any] = {
        "openapi": "3.1.0",
        "info": {"title": "Merged API", "version": "1.0.0"},
        "paths": {},
        "components": {}
    }
    
    report = {
        "sources": [],
        "paths_added": 0,
        "paths_skipped": 0,
        "operations_added": 0,
        "components_added": {},
        "components_renamed": [],
        "warnings": []
    }
    
    seen_paths: dict[tuple[str, str], str] = {}  # (path, method) -> source
    seen_operation_ids: dict[str, str] = {}  # operationId -> source
    component_registry: dict[str, dict[str, Any]] = {}  # type -> {name -> definition}
    
    for idx, spec in enumerate(specs):
        prefix = namespace_prefixes[idx] if namespace_prefixes else None
        source_name = prefix or f"spec_{idx}"
        report["sources"].append(source_name)
        
        # Deep copy spec for modification
        spec = deepcopy(spec)
        
        # Collect component renames for this spec
        renames: dict[str, str] = {}  # old ref -> new ref
        
        # Merge components first (to establish renames)
        spec_components = spec.get("components", {})
        for comp_type, comp_defs in spec_components.items():
            if comp_type not in component_registry:
                component_registry[comp_type] = {}
            if comp_type not in merged["components"]:
                merged["components"][comp_type] = {}
            if comp_type not in report["components_added"]:
                report["components_added"][comp_type] = 0
            
            for comp_name, comp_def in comp_defs.items():
                full_name = f"{comp_type}/{comp_name}"
                existing = component_registry[comp_type].get(comp_name)
                
                if existing is not None:
                    # Collision
                    if _definitions_equal(existing, comp_def):
                        # Identical - use existing
                        continue
                    
                    if on_component_collision == "error":
                        raise ValueError(
                            f"Component collision: {full_name} differs between specs"
                        )
                    elif on_component_collision == "skip":
                        report["warnings"].append(
                            f"Skipped component {full_name} from {source_name}"
                        )
                        continue
                    elif on_component_collision == "overwrite":
                        merged["components"][comp_type][comp_name] = comp_def
                        component_registry[comp_type][comp_name] = comp_def
                        report["components_added"][comp_type] += 1
                    elif on_component_collision == "rename":
                        # Generate unique name
                        new_name = _generate_unique_name(
                            comp_name,
                            set(component_registry[comp_type].keys())
                        )
                        merged["components"][comp_type][new_name] = comp_def
                        component_registry[comp_type][new_name] = comp_def
                        renames[f"#/components/{comp_type}/{comp_name}"] = \
                            f"#/components/{comp_type}/{new_name}"
                        report["components_renamed"].append({
                            "type": comp_type,
                            "old": comp_name,
                            "new": new_name,
                            "source": source_name
                        })
                        report["components_added"][comp_type] += 1
                else:
                    merged["components"][comp_type][comp_name] = comp_def
                    component_registry[comp_type][comp_name] = comp_def
                    report["components_added"][comp_type] += 1
        
        # Rewrite refs in the spec
        if renames:
            spec = _rewrite_refs(spec, renames)
        
        # Merge paths
        spec_paths = spec.get("paths", {})
        for path, path_item in spec_paths.items():
            if not isinstance(path_item, dict):
                continue
            
            # Apply path prefix if requested
            actual_path = path
            if on_path_collision == "prefix" and prefix:
                actual_path = f"/{prefix}{path}"
                if not path.startswith("/"):
                    actual_path = f"/{prefix}/{path.lstrip('/')}"
            
            for method, operation in path_item.items():
                if method.startswith("x-") or not isinstance(operation, dict):
                    continue
                
                method_lower = method.lower()
                path_key = (actual_path, method_lower)
                
                # Check path collision
                if path_key in seen_paths:
                    if on_path_collision == "error":
                        raise ValueError(
                            f"Path collision: {method_lower.upper()} {actual_path} "
                            f"(from {seen_paths[path_key]} and {source_name})"
                        )
                    elif on_path_collision == "skip":
                        report["paths_skipped"] += 1
                        report["warnings"].append(
                            f"Skipped {method_lower.upper()} {actual_path} from {source_name}"
                        )
                        continue
                    elif on_path_collision == "overwrite":
                        pass  # Will overwrite below
                    # "prefix" handled above by modifying actual_path
                
                # Check operationId collision
                op_id = operation.get("operationId")
                if op_id:
                    new_op_id = op_id
                    
                    if op_id in seen_operation_ids:
                        if on_operationId_collision == "error":
                            raise ValueError(
                                f"operationId collision: {op_id} "
                                f"(from {seen_operation_ids[op_id]} and {source_name})"
                            )
                        elif on_operationId_collision == "skip":
                            continue
                        elif on_operationId_collision == "overwrite":
                            pass
                        elif on_operationId_collision == "prefix":
                            new_op_id = f"{source_name}_{op_id}"
                            operation["operationId"] = new_op_id
                    
                    if new_op_id not in seen_operation_ids:
                        seen_operation_ids[new_op_id] = source_name
                
                # Add to merged spec
                if actual_path not in merged["paths"]:
                    merged["paths"][actual_path] = {}
                merged["paths"][actual_path][method_lower] = operation
                seen_paths[path_key] = source_name
                report["paths_added"] += 1
                report["operations_added"] += 1
    
    # Sort for deterministic output
    merged["paths"] = dict(sorted(merged["paths"].items()))
    for comp_type in merged.get("components", {}):
        merged["components"][comp_type] = dict(
            sorted(merged["components"][comp_type].items())
        )
    
    return {
        "spec": merged,
        "report": report
    }


def _definitions_equal(a: Any, b: Any) -> bool:
    """Deep equality check for definitions (ignoring key order)."""
    if type(a) != type(b):
        return False
    if isinstance(a, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        return all(_definitions_equal(a[k], b[k]) for k in a)
    if isinstance(a, list):
        if len(a) != len(b):
            return False
        return all(_definitions_equal(x, y) for x, y in zip(a, b))
    return a == b


def _generate_unique_name(base: str, existing: set[str]) -> str:
    """Generate a unique name by appending a number."""
    if base not in existing:
        return base
    
    counter = 1
    while f"{base}_{counter}" in existing:
        counter += 1
    return f"{base}_{counter}"


def _rewrite_refs(obj: Any, renames: dict[str, str]) -> Any:
    """Rewrite $ref values in an object according to renames map."""
    if isinstance(obj, dict):
        result = {}
        for key, value in obj.items():
            if key == "$ref" and isinstance(value, str) and value in renames:
                result[key] = renames[value]
            else:
                result[key] = _rewrite_refs(value, renames)
        return result
    elif isinstance(obj, list):
        return [_rewrite_refs(item, renames) for item in obj]
    return obj
