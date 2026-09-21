"""OpenAPI Synthesize - Generate OpenAPI specs from endpoint manifests."""

import re
from typing import Any, Literal


def synthesize_openapi(
    endpoints: list[dict[str, Any]],
    info: dict[str, Any] | None = None,
    security_schemes: dict[str, Any] | None = None,
    security: list[dict[str, list[str]]] | None = None,
    tags: list[dict[str, Any]] | None = None,
    servers: list[dict[str, str]] | None = None
) -> dict[str, Any]:
    """
    Synthesize an OpenAPI 3.1 specification from an endpoint manifest.
    
    Args:
        endpoints: List of endpoint definitions with:
            - method: HTTP method (get, post, put, delete, patch, etc.)
            - path: URL path (e.g., /users/{id})
            - operationId: Unique operation identifier (required, must be unique)
            - summary: Short summary (optional)
            - description: Long description (optional)
            - tags: List of tag names (optional)
            - parameters: List of parameter objects (optional)
            - requestBody: Request body specification (optional)
            - responses: Response specifications (optional, defaults to 200)
            - security: Operation-level security (optional)
        info: API info (title, version, description, etc.)
        security_schemes: Security scheme definitions
        security: Global security requirements
        tags: Tag definitions with descriptions
        servers: Server URLs
        
    Returns:
        OpenAPI 3.1 specification
        
    Raises:
        ValueError: If duplicate operationIds are found or required fields missing
    """
    # Validate and normalize info
    info = info or {}
    if "title" not in info:
        info["title"] = "Generated API"
    if "version" not in info:
        info["version"] = "1.0.0"
    
    # Check for duplicate operationIds
    operation_ids: set[str] = set()
    for ep in endpoints:
        op_id = ep.get("operationId")
        if op_id:
            if op_id in operation_ids:
                raise ValueError(f"Duplicate operationId: {op_id}")
            operation_ids.add(op_id)
    
    # Build paths
    paths: dict[str, dict[str, Any]] = {}
    for ep in endpoints:
        method = ep.get("method", "get").lower()
        path = ep.get("path", "/")
        
        if path not in paths:
            paths[path] = {}
        
        operation: dict[str, Any] = {}
        
        # operationId (required)
        if ep.get("operationId"):
            operation["operationId"] = ep["operationId"]
        
        # summary
        if ep.get("summary"):
            operation["summary"] = ep["summary"]
        
        # description
        if ep.get("description"):
            operation["description"] = ep["description"]
        
        # tags
        if ep.get("tags"):
            operation["tags"] = ep["tags"]
        
        # parameters
        if ep.get("parameters"):
            operation["parameters"] = _normalize_parameters(ep["parameters"])
        
        # requestBody
        if ep.get("requestBody"):
            operation["requestBody"] = _normalize_request_body(ep["requestBody"])
        
        # responses
        if ep.get("responses"):
            operation["responses"] = ep["responses"]
        else:
            # Default response
            operation["responses"] = {
                "200": {
                    "description": "Successful response"
                }
            }
        
        # security
        if ep.get("security") is not None:
            operation["security"] = ep["security"]
        
        # deprecated
        if ep.get("deprecated"):
            operation["deprecated"] = True
        
        paths[path][method] = operation
    
    # Build the spec
    spec: dict[str, Any] = {
        "openapi": "3.1.0",
        "info": info,
        "paths": dict(sorted(paths.items()))
    }
    
    if servers:
        spec["servers"] = servers
    
    if tags:
        spec["tags"] = tags
    
    # Components
    components: dict[str, Any] = {}
    
    if security_schemes:
        components["securitySchemes"] = security_schemes
    
    if components:
        spec["components"] = components
    
    if security:
        spec["security"] = security
    
    return spec


def _normalize_parameters(params: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize parameter definitions."""
    normalized = []
    for param in params:
        norm_param: dict[str, Any] = {
            "name": param.get("name", ""),
            "in": param.get("in", "query"),
        }
        
        if param.get("description"):
            norm_param["description"] = param["description"]
        
        if param.get("required"):
            norm_param["required"] = True
        
        if param.get("deprecated"):
            norm_param["deprecated"] = True
        
        if "schema" in param:
            norm_param["schema"] = param["schema"]
        elif "type" in param:
            # Convert simple type to schema
            norm_param["schema"] = {"type": param["type"]}
            if param.get("enum"):
                norm_param["schema"]["enum"] = param["enum"]
            if param.get("default") is not None:
                norm_param["schema"]["default"] = param["default"]
        
        normalized.append(norm_param)
    
    return normalized


def _normalize_request_body(body: dict[str, Any]) -> dict[str, Any]:
    """Normalize request body definition."""
    normalized: dict[str, Any] = {}
    
    if body.get("description"):
        normalized["description"] = body["description"]
    
    if body.get("required"):
        normalized["required"] = True
    
    content: dict[str, Any] = {}
    
    if "content" in body:
        content = body["content"]
    elif "schema" in body:
        # Simplified format - infer JSON
        content["application/json"] = {"schema": body["schema"]}
    elif "type" in body or "properties" in body:
        # Direct schema object
        content["application/json"] = {"schema": body}
    
    if content:
        normalized["content"] = content
    
    return normalized


def create_security_scheme(
    type_: Literal["http", "apiKey", "oauth2", "openIdConnect"],
    scheme: str | None = None,
    bearer_format: str | None = None,
    name: str | None = None,
    in_: Literal["query", "header", "cookie"] | None = None,
    flows: dict[str, Any] | None = None,
    openid_connect_url: str | None = None,
    description: str | None = None
) -> dict[str, Any]:
    """
    Create a security scheme definition.
    
    Args:
        type_: Security scheme type
        scheme: HTTP scheme (basic, bearer) for http type
        bearer_format: Bearer token format (e.g., JWT)
        name: Parameter name for apiKey type
        in_: Parameter location for apiKey type
        flows: OAuth2 flows definition
        openid_connect_url: OpenID Connect URL
        description: Description of the security scheme
        
    Returns:
        Security scheme object
    """
    result: dict[str, Any] = {"type": type_}
    
    if description:
        result["description"] = description
    
    if type_ == "http":
        if scheme:
            result["scheme"] = scheme
        if bearer_format:
            result["bearerFormat"] = bearer_format
    elif type_ == "apiKey":
        if name:
            result["name"] = name
        if in_:
            result["in"] = in_
    elif type_ == "oauth2":
        if flows:
            result["flows"] = flows
    elif type_ == "openIdConnect":
        if openid_connect_url:
            result["openIdConnectUrl"] = openid_connect_url
    
    return result


def build_resource_endpoints(
    resources: list[dict[str, Any]],
    default_operations: list[str] | None = None,
    id_param_name: str = "id",
    id_schema: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Build CRUD-style endpoint manifests for a list of resources.

    Args:
        resources: Resource configs. Each resource can define:
            - name: Resource singular name (required)
            - collectionPath: Collection path (default: "/<name>s")
            - itemPath: Item path (default: "<collectionPath>/{<id_param_name>}")
            - tag: Optional operation tag
            - operations: Optional list overriding default operations
            - schemaRef/createSchemaRef/updateSchemaRef/patchSchemaRef
        default_operations: Global default operations. Defaults to list/create/read/update/delete.
        id_param_name: Path identifier name to use when itemPath is not provided.
        id_schema: JSON schema for the identifier parameter.

    Returns:
        Endpoint manifest list suitable for ``synthesize_openapi``.
    """
    operations = default_operations or ["list", "create", "read", "update", "delete"]
    id_schema = id_schema or {"type": "string"}

    endpoints: list[dict[str, Any]] = []
    for resource in resources:
        name = str(resource.get("name", "")).strip()
        if not name:
            raise ValueError("Each resource requires a non-empty 'name'")

        pascal_name = _to_pascal(name)
        collection_path = resource.get("collectionPath") or _default_collection_path(name)
        item_path = resource.get("itemPath") or f"{collection_path}/{{{id_param_name}}}"
        tag = resource.get("tag") or name.lower()

        resource_ops = resource.get("operations", operations)
        if not isinstance(resource_ops, list):
            raise ValueError(f"operations must be a list for resource {name}")
        op_set = {str(op).lower() for op in resource_ops}

        schema_ref = resource.get("schemaRef")
        create_schema_ref = resource.get("createSchemaRef", schema_ref)
        update_schema_ref = resource.get("updateSchemaRef", schema_ref)
        patch_schema_ref = resource.get("patchSchemaRef", schema_ref)

        if "list" in op_set:
            endpoints.append(
                {
                    "method": "GET",
                    "path": collection_path,
                    "operationId": f"list{_pluralize_pascal(pascal_name)}",
                    "summary": f"List {name}",
                    "tags": [tag],
                    "responses": {
                        "200": {
                            "description": f"List of {name}",
                            **_json_response_schema(
                                {"type": "array", "items": {"$ref": schema_ref}}
                                if isinstance(schema_ref, str)
                                else {"type": "array", "items": {}}
                            ),
                        }
                    },
                }
            )

        if "create" in op_set:
            endpoints.append(
                {
                    "method": "POST",
                    "path": collection_path,
                    "operationId": f"create{pascal_name}",
                    "summary": f"Create {name}",
                    "tags": [tag],
                    **_request_body_from_ref(create_schema_ref),
                    "responses": {
                        "201": {
                            "description": f"Created {name}",
                            **_json_response_schema(
                                {"$ref": schema_ref} if isinstance(schema_ref, str) else {}
                            ),
                        }
                    },
                }
            )

        if "read" in op_set:
            endpoints.append(
                {
                    "method": "GET",
                    "path": item_path,
                    "operationId": f"get{pascal_name}",
                    "summary": f"Get {name}",
                    "tags": [tag],
                    "parameters": [_id_parameter(id_param_name, id_schema)],
                    "responses": {
                        "200": {
                            "description": f"{name} details",
                            **_json_response_schema(
                                {"$ref": schema_ref} if isinstance(schema_ref, str) else {}
                            ),
                        }
                    },
                }
            )

        if "update" in op_set:
            endpoints.append(
                {
                    "method": "PUT",
                    "path": item_path,
                    "operationId": f"update{pascal_name}",
                    "summary": f"Update {name}",
                    "tags": [tag],
                    "parameters": [_id_parameter(id_param_name, id_schema)],
                    **_request_body_from_ref(update_schema_ref),
                    "responses": {
                        "200": {
                            "description": f"Updated {name}",
                            **_json_response_schema(
                                {"$ref": schema_ref} if isinstance(schema_ref, str) else {}
                            ),
                        }
                    },
                }
            )

        if "patch" in op_set:
            endpoints.append(
                {
                    "method": "PATCH",
                    "path": item_path,
                    "operationId": f"patch{pascal_name}",
                    "summary": f"Patch {name}",
                    "tags": [tag],
                    "parameters": [_id_parameter(id_param_name, id_schema)],
                    **_request_body_from_ref(patch_schema_ref),
                    "responses": {
                        "200": {
                            "description": f"Patched {name}",
                            **_json_response_schema(
                                {"$ref": schema_ref} if isinstance(schema_ref, str) else {}
                            ),
                        }
                    },
                }
            )

        if "delete" in op_set:
            endpoints.append(
                {
                    "method": "DELETE",
                    "path": item_path,
                    "operationId": f"delete{pascal_name}",
                    "summary": f"Delete {name}",
                    "tags": [tag],
                    "parameters": [_id_parameter(id_param_name, id_schema)],
                    "responses": {"204": {"description": "Deleted"}},
                }
            )

    return endpoints


def synthesize_resource_api(
    resources: list[dict[str, Any]],
    info: dict[str, Any] | None = None,
    security_schemes: dict[str, Any] | None = None,
    security: list[dict[str, list[str]]] | None = None,
    tags: list[dict[str, Any]] | None = None,
    servers: list[dict[str, str]] | None = None,
    default_operations: list[str] | None = None,
    id_param_name: str = "id",
    id_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Synthesize an OpenAPI spec from high-level resource definitions."""
    endpoints = build_resource_endpoints(
        resources=resources,
        default_operations=default_operations,
        id_param_name=id_param_name,
        id_schema=id_schema,
    )
    return synthesize_openapi(
        endpoints=endpoints,
        info=info,
        security_schemes=security_schemes,
        security=security,
        tags=tags,
        servers=servers,
    )


def synthesize_fhir_r4_api(
    resources: list[str],
    info: dict[str, Any] | None = None,
    servers: list[dict[str, str]] | None = None,
    include_metadata: bool = True,
    include_patch: bool = True,
    smart_security: bool = True,
) -> dict[str, Any]:
    """
    Synthesize a FHIR R4-style API skeleton for selected resources.

    This generator focuses on FHIR REST interactions (search/create/read/update/delete, optional patch)
    and is intended to accelerate scaffolding, not replace conformance validation.
    """
    if not resources:
        raise ValueError("At least one FHIR resource is required")

    fhir_resources = [r.strip() for r in resources if isinstance(r, str) and r.strip()]
    if not fhir_resources:
        raise ValueError("At least one non-empty FHIR resource name is required")

    endpoints: list[dict[str, Any]] = []
    for resource in fhir_resources:
        tag_list = ["fhir", resource]
        resource_ref = f"#/components/schemas/{resource}"

        endpoints.append(
            {
                "method": "GET",
                "path": f"/fhir/{resource}",
                "operationId": f"fhirSearch{resource}",
                "summary": f"Search {resource}",
                "tags": tag_list,
                "parameters": [
                    {"name": "_id", "in": "query", "schema": {"type": "string"}},
                    {"name": "_lastUpdated", "in": "query", "schema": {"type": "string"}},
                    {"name": "_count", "in": "query", "schema": {"type": "integer", "minimum": 1}},
                ],
                "responses": {
                    "200": {
                        "description": "FHIR search bundle",
                        **_json_response_schema({"$ref": "#/components/schemas/Bundle"}),
                    },
                    "400": {
                        "description": "OperationOutcome",
                        **_json_response_schema({"$ref": "#/components/schemas/OperationOutcome"}),
                    },
                },
            }
        )
        endpoints.append(
            {
                "method": "POST",
                "path": f"/fhir/{resource}",
                "operationId": f"fhirCreate{resource}",
                "summary": f"Create {resource}",
                "tags": tag_list,
                "requestBody": {
                    "required": True,
                    "content": {"application/fhir+json": {"schema": {"$ref": resource_ref}}},
                },
                "responses": {
                    "201": {
                        "description": "Created",
                        **_json_response_schema({"$ref": resource_ref}),
                    },
                    "400": {
                        "description": "OperationOutcome",
                        **_json_response_schema({"$ref": "#/components/schemas/OperationOutcome"}),
                    },
                },
            }
        )
        endpoints.append(
            {
                "method": "GET",
                "path": f"/fhir/{resource}/{{id}}",
                "operationId": f"fhirRead{resource}",
                "summary": f"Read {resource}",
                "tags": tag_list,
                "parameters": [_id_parameter("id", {"type": "string"})],
                "responses": {
                    "200": {
                        "description": "FHIR resource",
                        **_json_response_schema({"$ref": resource_ref}),
                    },
                    "404": {
                        "description": "OperationOutcome",
                        **_json_response_schema({"$ref": "#/components/schemas/OperationOutcome"}),
                    },
                },
            }
        )
        endpoints.append(
            {
                "method": "PUT",
                "path": f"/fhir/{resource}/{{id}}",
                "operationId": f"fhirUpdate{resource}",
                "summary": f"Update {resource}",
                "tags": tag_list,
                "parameters": [_id_parameter("id", {"type": "string"})],
                "requestBody": {
                    "required": True,
                    "content": {"application/fhir+json": {"schema": {"$ref": resource_ref}}},
                },
                "responses": {
                    "200": {
                        "description": "Updated",
                        **_json_response_schema({"$ref": resource_ref}),
                    }
                },
            }
        )
        if include_patch:
            endpoints.append(
                {
                    "method": "PATCH",
                    "path": f"/fhir/{resource}/{{id}}",
                    "operationId": f"fhirPatch{resource}",
                    "summary": f"Patch {resource}",
                    "tags": tag_list,
                    "parameters": [_id_parameter("id", {"type": "string"})],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json-patch+json": {
                                "schema": {"type": "array", "items": {"type": "object"}}
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Patched",
                            **_json_response_schema({"$ref": resource_ref}),
                        }
                    },
                }
            )
        endpoints.append(
            {
                "method": "DELETE",
                "path": f"/fhir/{resource}/{{id}}",
                "operationId": f"fhirDelete{resource}",
                "summary": f"Delete {resource}",
                "tags": tag_list,
                "parameters": [_id_parameter("id", {"type": "string"})],
                "responses": {"204": {"description": "Deleted"}},
            }
        )

    if include_metadata:
        endpoints.append(
            {
                "method": "GET",
                "path": "/fhir/metadata",
                "operationId": "fhirCapabilityStatement",
                "summary": "FHIR capability statement",
                "tags": ["fhir"],
                "responses": {
                    "200": {
                        "description": "CapabilityStatement",
                        **_json_response_schema({"$ref": "#/components/schemas/CapabilityStatement"}),
                    }
                },
            }
        )

    spec_info = info or {"title": "FHIR R4 API", "version": "1.0.0"}
    security_schemes: dict[str, Any] | None = None
    security: list[dict[str, list[str]]] | None = None
    if smart_security:
        security_schemes = {
            "smartAuth": {
                "type": "oauth2",
                "flows": {
                    "authorizationCode": {
                        "authorizationUrl": "/oauth2/authorize",
                        "tokenUrl": "/oauth2/token",
                        "scopes": {
                            "api:fhir": "FHIR API scope",
                        },
                    }
                },
            }
        }
        security = [{"smartAuth": ["api:fhir"]}]

    spec = synthesize_openapi(
        endpoints=endpoints,
        info=spec_info,
        security_schemes=security_schemes,
        security=security,
        tags=[{"name": "fhir", "description": "FHIR R4 operations"}],
        servers=servers,
    )
    spec.setdefault("components", {}).setdefault("schemas", {})
    spec["components"]["schemas"].update(
        {
            "Resource": {"type": "object", "properties": {"resourceType": {"type": "string"}}},
            "Bundle": {"type": "object", "properties": {"resourceType": {"const": "Bundle"}}},
            "OperationOutcome": {
                "type": "object",
                "properties": {"resourceType": {"const": "OperationOutcome"}},
            },
            "CapabilityStatement": {
                "type": "object",
                "properties": {"resourceType": {"const": "CapabilityStatement"}},
            },
            **{
                r: {
                    "type": "object",
                    "allOf": [{"$ref": "#/components/schemas/Resource"}],
                    "properties": {"resourceType": {"const": r}},
                }
                for r in fhir_resources
            },
        }
    )
    return spec


def _default_collection_path(name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-")
    if not normalized:
        raise ValueError("Resource name must contain alphanumeric characters")
    return f"/{normalized}s"


def _to_pascal(value: str) -> str:
    parts = re.split(r"[^a-zA-Z0-9]+", value.strip())
    return "".join(part[:1].upper() + part[1:] for part in parts if part)


def _pluralize_pascal(value: str) -> str:
    if value.endswith("s"):
        return value
    return f"{value}s"


def _id_parameter(name: str, schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": name,
        "in": "path",
        "required": True,
        "schema": schema,
    }


def _request_body_from_ref(schema_ref: Any) -> dict[str, Any]:
    if isinstance(schema_ref, str):
        return {
            "requestBody": {
                "required": True,
                "content": {"application/json": {"schema": {"$ref": schema_ref}}},
            }
        }
    return {}


def _json_response_schema(schema: dict[str, Any]) -> dict[str, Any]:
    if not schema:
        return {}
    return {"content": {"application/json": {"schema": schema}}}
