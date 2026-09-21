"""OpenAPI Validation - Validate specs using openapi-spec-validator."""

from typing import Any

try:
    from openapi_spec_validator import validate
    from openapi_spec_validator.validation.exceptions import OpenAPIValidationError
    HAS_VALIDATOR = True
except ImportError:
    HAS_VALIDATOR = False


def validate_openapi(spec: dict[str, Any]) -> dict[str, Any]:
    """
    Validate an OpenAPI specification.
    
    Args:
        spec: OpenAPI specification as dictionary
        
    Returns:
        Validation result with:
        - ok: bool - whether validation passed
        - errors: list of error objects with pointer and message
        - warnings: list of warning messages
    """
    if not HAS_VALIDATOR:
        # Fallback validation - check basic structure
        return _basic_validation(spec)
    
    errors = []
    warnings = []
    
    try:
        validate(spec)
        return {"ok": True, "errors": [], "warnings": []}
    except OpenAPIValidationError as e:
        # Parse nested validator errors when available; otherwise fall back to
        # the top-level exception payload.
        nested_errors = getattr(e, "errors", None)
        if nested_errors:
            for error in nested_errors:
                errors.append(_parse_validation_error(error))
        else:
            errors.append(_parse_validation_error(e))
        return {"ok": False, "errors": errors, "warnings": warnings}
    except Exception as e:
        # Generic error
        return {
            "ok": False,
            "errors": [{"pointer": "", "message": str(e)}],
            "warnings": []
        }


def _parse_validation_error(error: Any) -> dict[str, Any]:
    """Parse a validation error into a structured format."""
    result: dict[str, Any] = {"pointer": "", "message": ""}
    
    # Try to extract JSON pointer path
    if hasattr(error, "absolute_path"):
        path = error.absolute_path
        if path:
            result["pointer"] = "/" + "/".join(str(p) for p in path)
    
    # Try to extract message
    if hasattr(error, "message"):
        result["message"] = error.message
    elif hasattr(error, "__str__"):
        result["message"] = str(error)
    
    # Add validator info if available
    if hasattr(error, "validator"):
        result["validator"] = error.validator
    if hasattr(error, "validator_value"):
        result["expected"] = str(error.validator_value)
    
    return result


def _basic_validation(spec: dict[str, Any]) -> dict[str, Any]:
    """Basic validation when openapi-spec-validator is not available."""
    errors = []
    
    if not isinstance(spec, dict):
        errors.append({"pointer": "", "message": "Spec must be an object"})
        return {"ok": False, "errors": errors, "warnings": []}
    
    # Check required fields
    if "openapi" not in spec and "swagger" not in spec:
        errors.append({"pointer": "", "message": "Missing 'openapi' or 'swagger' version field"})
    
    if "info" not in spec:
        errors.append({"pointer": "", "message": "Missing 'info' section"})
    else:
        info = spec.get("info", {})
        if "title" not in info:
            errors.append({"pointer": "/info", "message": "Missing 'info.title'"})
        if "version" not in info:
            errors.append({"pointer": "/info", "message": "Missing 'info.version'"})
    
    if "paths" not in spec:
        errors.append({"pointer": "", "message": "Missing 'paths' section"})
    elif not isinstance(spec.get("paths"), dict):
        errors.append({"pointer": "/paths", "message": "'paths' must be an object"})
    
    # Check for broken $refs
    errors.extend(_check_refs(spec))
    
    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": ["openapi-spec-validator not installed, using basic validation only"]
    }


def _check_refs(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Check for broken $refs in the spec."""
    errors = []
    refs = _collect_refs(spec)
    definitions = _collect_definitions(spec)
    
    for ref in refs:
        if ref.startswith("#/"):
            # Internal ref - check if it exists
            path = ref[2:].split("/")
            current = spec
            for part in path:
                if isinstance(current, dict) and part in current:
                    current = current[part]
                else:
                    errors.append({"pointer": "", "message": f"Broken $ref: {ref}"})
                    break
    
    return errors


def _collect_refs(obj: Any, refs: set[str] | None = None) -> set[str]:
    """Collect all $ref values from a spec."""
    if refs is None:
        refs = set()
    
    if isinstance(obj, dict):
        if "$ref" in obj and isinstance(obj["$ref"], str):
            refs.add(obj["$ref"])
        for value in obj.values():
            _collect_refs(value, refs)
    elif isinstance(obj, list):
        for item in obj:
            _collect_refs(item, refs)
    
    return refs


def _collect_definitions(spec: dict[str, Any]) -> set[str]:
    """Collect all definable paths in the spec."""
    definitions = set()
    
    # Components/schemas
    components = spec.get("components", {})
    schemas = components.get("schemas", {})
    for name in schemas:
        definitions.add(f"#/components/schemas/{name}")
    
    # Components/responses
    responses = components.get("responses", {})
    for name in responses:
        definitions.add(f"#/components/responses/{name}")
    
    # Components/parameters
    parameters = components.get("parameters", {})
    for name in parameters:
        definitions.add(f"#/components/parameters/{name}")
    
    # Components/headers
    headers = components.get("headers", {})
    for name in headers:
        definitions.add(f"#/components/headers/{name}")
    
    # Components/requestBodies
    request_bodies = components.get("requestBodies", {})
    for name in request_bodies:
        definitions.add(f"#/components/requestBodies/{name}")
    
    # Components/examples
    examples = components.get("examples", {})
    for name in examples:
        definitions.add(f"#/components/examples/{name}")
    
    # Components/securitySchemes
    security_schemes = components.get("securitySchemes", {})
    for name in security_schemes:
        definitions.add(f"#/components/securitySchemes/{name}")
    
    return definitions
