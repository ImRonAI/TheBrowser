"""Strands-native tool wrappers for Forge core capabilities.

These tools expose Forge functionality using the Strands ``@tool`` decorator so
they can be passed directly into ``Agent(tools=[...])``.
"""

from __future__ import annotations

from typing import Any, Callable

from .core import (
    build_resource_endpoints,
    export_mcp_tools,
    filter_openapi,
    load_openapi,
    normalize_openapi,
    splice_openapi,
    synthesize_fhir_r4_api,
    synthesize_openapi,
    synthesize_resource_api,
    get_context_pack_store,
    resolve_invoke_inputs_with_context,
    validate_fhir_profile,
    validate_fhir_resource,
    validate_fhir_terminology,
    validate_openapi,
)
from .core.invoke import invoke_openapi
from .core.webhooks import (
    create_webhook_headers,
    get_webhook_store,
    verify_webhook_signature,
)

try:
    from strands import tool as strands_tool
except ImportError:  # pragma: no cover - allows module import without strands installed
    def strands_tool(func: Callable[..., Any] | None = None, **kwargs: Any):
        """Fallback no-op decorator used when strands is unavailable."""

        def decorator(inner: Callable[..., Any]) -> Callable[..., Any]:
            setattr(
                inner,
                "__strands_tool__",
                {
                    "name": kwargs.get("name"),
                    "description": kwargs.get("description"),
                },
            )
            return inner

        if func is None:
            return decorator
        return decorator(func)


def _collision_policy(value: str, allowed: set[str], field: str) -> str:
    policy = value.strip().lower()
    if policy not in allowed:
        raise ValueError(f"Invalid {field}: {value}. Allowed values: {sorted(allowed)}")
    return policy


@strands_tool(
    name="forge.openapi.load",
    description="Load and normalize an OpenAPI spec from JSON/YAML text or file path.",
)
def forge_openapi_load(source: str, workdir: str | None = None) -> dict[str, Any]:
    spec = load_openapi(source, workdir)
    return {"ok": True, "spec": normalize_openapi(spec)}


@strands_tool(
    name="forge.openapi.validate",
    description="Validate an OpenAPI specification.",
)
def forge_openapi_validate(spec: dict[str, Any]) -> dict[str, Any]:
    return validate_openapi(spec)


@strands_tool(
    name="forge.openapi.synthesize",
    description="Synthesize an OpenAPI 3.1 spec from endpoint definitions.",
)
def forge_openapi_synthesize(
    endpoints: list[dict[str, Any]],
    info: dict[str, Any] | None = None,
    security_schemes: dict[str, Any] | None = None,
    security: list[dict[str, list[str]]] | None = None,
    tags: list[dict[str, Any]] | None = None,
    servers: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    spec = synthesize_openapi(
        endpoints=endpoints,
        info=info,
        security_schemes=security_schemes,
        security=security,
        tags=tags,
        servers=servers,
    )
    return {"ok": True, "spec": spec}


@strands_tool(
    name="forge.openapi.synthesize_resources",
    description="Synthesize an OpenAPI spec from high-level resource definitions.",
)
def forge_openapi_synthesize_resources(
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
    spec = synthesize_resource_api(
        resources=resources,
        info=info,
        security_schemes=security_schemes,
        security=security,
        tags=tags,
        servers=servers,
        default_operations=default_operations,
        id_param_name=id_param_name,
        id_schema=id_schema,
    )
    return {"ok": True, "spec": spec}


@strands_tool(
    name="forge.openapi.build_resource_endpoints",
    description="Generate endpoint manifests for resource CRUD/search APIs.",
)
def forge_openapi_build_resource_endpoints(
    resources: list[dict[str, Any]],
    default_operations: list[str] | None = None,
    id_param_name: str = "id",
    id_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    endpoints = build_resource_endpoints(
        resources=resources,
        default_operations=default_operations,
        id_param_name=id_param_name,
        id_schema=id_schema,
    )
    return {"ok": True, "endpoints": endpoints, "count": len(endpoints)}


@strands_tool(
    name="forge.fhir.synthesize_r4",
    description="Synthesize a FHIR R4 API skeleton for selected resources.",
)
def forge_fhir_synthesize_r4(
    resources: list[str],
    info: dict[str, Any] | None = None,
    servers: list[dict[str, str]] | None = None,
    include_metadata: bool = True,
    include_patch: bool = True,
    smart_security: bool = True,
) -> dict[str, Any]:
    spec = synthesize_fhir_r4_api(
        resources=resources,
        info=info,
        servers=servers,
        include_metadata=include_metadata,
        include_patch=include_patch,
        smart_security=smart_security,
    )
    return {"ok": True, "spec": spec}


@strands_tool(
    name="forge.fhir.validate_profile",
    description="Validate FHIR profile constraints and required resource fields.",
)
def forge_fhir_validate_profile(
    resource: dict[str, Any],
    required_profiles: list[str] | None = None,
    required_fields_by_resource: dict[str, list[str]] | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    return validate_fhir_profile(
        resource=resource,
        required_profiles=required_profiles,
        required_fields_by_resource=required_fields_by_resource,
        strict=strict,
    )


@strands_tool(
    name="forge.fhir.validate_terminology",
    description="Validate FHIR coding systems and terminology quality checks.",
)
def forge_fhir_validate_terminology(
    resource: dict[str, Any],
    allowed_systems: list[str] | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    return validate_fhir_terminology(
        resource=resource,
        allowed_systems=allowed_systems,
        strict=strict,
    )


@strands_tool(
    name="forge.fhir.validate_resource",
    description="Combined FHIR profile + terminology validation with OperationOutcome and compliance score.",
)
def forge_fhir_validate_resource(
    resource: dict[str, Any],
    required_profiles: list[str] | None = None,
    allowed_systems: list[str] | None = None,
    required_fields_by_resource: dict[str, list[str]] | None = None,
    strict: bool = False,
) -> dict[str, Any]:
    return validate_fhir_resource(
        resource=resource,
        required_profiles=required_profiles,
        allowed_systems=allowed_systems,
        required_fields_by_resource=required_fields_by_resource,
        strict=strict,
    )


@strands_tool(
    name="forge.openapi.splice",
    description="Merge multiple OpenAPI specs with collision policies.",
)
def forge_openapi_splice(
    specs: list[dict[str, Any]],
    namespace_prefixes: list[str] | None = None,
    on_path_collision: str = "error",
    on_operation_id_collision: str = "error",
    on_component_collision: str = "error",
) -> dict[str, Any]:
    result = splice_openapi(
        specs=specs,
        namespace_prefixes=namespace_prefixes,
        on_path_collision=_collision_policy(
            on_path_collision, {"error", "skip", "overwrite", "prefix"}, "on_path_collision"
        ),
        on_operationId_collision=_collision_policy(
            on_operation_id_collision,
            {"error", "skip", "overwrite", "prefix"},
            "on_operation_id_collision",
        ),
        on_component_collision=_collision_policy(
            on_component_collision,
            {"error", "skip", "overwrite", "rename"},
            "on_component_collision",
        ),
    )
    return {"ok": True, **result}


@strands_tool(
    name="forge.openapi.filter",
    description="Filter an OpenAPI spec by operations/tags/paths with transitive ref closure.",
)
def forge_openapi_filter(
    spec: dict[str, Any],
    allow_operation_ids: list[str] | None = None,
    allow_tags: list[str] | None = None,
    allow_paths: list[dict[str, Any]] | None = None,
    deny_operation_ids: list[str] | None = None,
    include_security_schemes: bool = True,
) -> dict[str, Any]:
    result = filter_openapi(
        spec=spec,
        allow_operation_ids=allow_operation_ids,
        allow_tags=allow_tags,
        allow_paths=allow_paths,
        deny_operation_ids=deny_operation_ids,
        include_security_schemes=include_security_schemes,
    )
    return {"ok": True, **result}


@strands_tool(
    name="forge.mcp.export_tools",
    description="Export an OpenAPI spec into MCP-compatible tool definitions.",
)
def forge_mcp_export_tools(spec: dict[str, Any]) -> dict[str, Any]:
    tools = export_mcp_tools(spec)
    return {"ok": True, "tools": tools, "count": len(tools)}


@strands_tool(
    name="forge.context_packs.upsert",
    description="Create or update a Forge context pack used for policy-aware invocations.",
)
def forge_context_packs_upsert(
    id: str,
    pack: dict[str, Any],
    merge: bool = False,
) -> dict[str, Any]:
    if not id.strip():
        raise ValueError("id is required")
    store = get_context_pack_store()
    saved = store.upsert_pack(id.strip(), pack, merge=merge)
    return {"ok": True, "contextPack": saved}


@strands_tool(
    name="forge.context_packs.get",
    description="Get a Forge context pack by ID.",
)
def forge_context_packs_get(id: str) -> dict[str, Any]:
    store = get_context_pack_store()
    item = store.get_pack(id)
    if item is None:
        raise ValueError(f"Context pack not found: {id}")
    return {"ok": True, "contextPack": item}


@strands_tool(
    name="forge.context_packs.list",
    description="List Forge context packs with optional query filtering.",
)
def forge_context_packs_list(
    query: str | None = None,
    limit: int = 200,
) -> dict[str, Any]:
    store = get_context_pack_store()
    items = store.list_packs(query=query, limit=limit)
    return {"ok": True, "count": len(items), "contextPacks": items}


@strands_tool(
    name="forge.context_packs.delete",
    description="Delete a Forge context pack by ID.",
)
def forge_context_packs_delete(id: str) -> dict[str, Any]:
    store = get_context_pack_store()
    deleted = store.delete_pack(id)
    if not deleted:
        raise ValueError(f"Context pack not found: {id}")
    return {"ok": True, "deleted": True}


@strands_tool(
    name="forge.webhooks.verify_signature",
    description="Verify a webhook signature with HMAC + anti-replay timestamp checks.",
)
def forge_webhooks_verify_signature(
    secret: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    max_age_seconds: float = 300.0,
) -> dict[str, Any]:
    return verify_webhook_signature(secret, payload, headers, max_age_seconds=max_age_seconds)


@strands_tool(
    name="forge.webhooks.create_headers",
    description="Create webhook signature headers for an outgoing payload.",
)
def forge_webhooks_create_headers(secret: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "headers": create_webhook_headers(secret, payload)}


@strands_tool(
    name="forge.webhooks.create_subscription",
    description="Create a persistent webhook subscription in Forge's store.",
)
def forge_webhooks_create_subscription(
    id: str,
    url: str,
    event_types: list[str],
    secret: str,
    max_retries: int = 3,
    retry_delay: float = 1.0,
) -> dict[str, Any]:
    store = get_webhook_store()
    sub = store.create_subscription(
        subscription_id=id,
        url=url,
        event_types=event_types,
        secret=secret,
        max_retries=max_retries,
        retry_delay=retry_delay,
    )
    return {
        "ok": True,
        "subscription": {
            "id": sub.id,
            "url": sub.url,
            "eventTypes": sub.event_types,
            "active": sub.active,
            "createdAt": sub.created_at,
        },
    }


@strands_tool(
    name="forge.webhooks.list_subscriptions",
    description="List webhook subscriptions with optional filters.",
)
def forge_webhooks_list_subscriptions(
    active_only: bool = True,
    event_type: str | None = None,
) -> dict[str, Any]:
    store = get_webhook_store()
    subs = store.list_subscriptions(active_only=active_only, event_type=event_type)
    return {
        "ok": True,
        "subscriptions": [
            {
                "id": sub.id,
                "url": sub.url,
                "eventTypes": sub.event_types,
                "active": sub.active,
                "createdAt": sub.created_at,
            }
            for sub in subs
        ],
    }


@strands_tool(
    name="forge.webhooks.delete_subscription",
    description="Delete a webhook subscription by ID.",
)
def forge_webhooks_delete_subscription(subscription_id: str) -> dict[str, Any]:
    store = get_webhook_store()
    deleted = store.delete_subscription(subscription_id)
    if not deleted:
        raise ValueError(f"Subscription not found: {subscription_id}")
    return {"ok": True, "deleted": True}


@strands_tool(
    name="forge.webhooks.enqueue_delivery",
    description="Enqueue a webhook delivery for asynchronous processing.",
)
def forge_webhooks_enqueue_delivery(
    subscription_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    store = get_webhook_store()
    delivery_id = store.enqueue_delivery(subscription_id, event_type, payload)
    return {"ok": True, "deliveryId": delivery_id}


async def _collect_invoke_result(
    *,
    spec: dict[str, Any],
    operation_id: str,
    args: dict[str, Any],
    auth: dict[str, Any] | None,
    base_url: str | None,
    extra_headers: dict[str, str] | None,
    stream: bool,
    allow_http: bool,
    timeout: float,
    max_chunks: int,
) -> dict[str, Any]:
    if max_chunks < 1:
        raise ValueError("max_chunks must be >= 1")

    if stream:
        chunks: list[dict[str, Any]] = []
        truncated = False
        async for chunk in invoke_openapi(
            spec=spec,
            operation_id=operation_id,
            args=args,
            auth=auth,
            base_url_override=base_url,
            stream=True,
            allow_http=allow_http,
            timeout=timeout,
            extra_headers=extra_headers,
        ):
            chunks.append(chunk)
            if len(chunks) >= max_chunks:
                truncated = True
                break
        return {
            "ok": True,
            "stream": True,
            "chunks": chunks,
            "count": len(chunks),
            "truncated": truncated,
            "maxChunks": max_chunks,
        }

    result: dict[str, Any] | None = None
    async for chunk in invoke_openapi(
        spec=spec,
        operation_id=operation_id,
        args=args,
        auth=auth,
        base_url_override=base_url,
        stream=False,
        allow_http=allow_http,
        timeout=timeout,
        extra_headers=extra_headers,
    ):
        result = chunk

    if result is None:
        raise ValueError("No response from invocation")
    if "error" in result:
        raise ValueError(str(result["error"]))
    return result


@strands_tool(
    name="forge.openapi.invoke",
    description="Invoke an OpenAPI operation using the supplied spec + operationId.",
)
async def forge_openapi_invoke(
    spec: dict[str, Any],
    operation_id: str,
    args: dict[str, Any] | None = None,
    auth: dict[str, Any] | None = None,
    base_url: str | None = None,
    extra_headers: dict[str, str] | None = None,
    stream: bool = False,
    allow_http: bool = False,
    max_chunks: int = 1000,
    timeout: float = 60.0,
) -> dict[str, Any]:
    return await _collect_invoke_result(
        spec=spec,
        operation_id=operation_id,
        args=args or {},
        auth=auth,
        base_url=base_url,
        extra_headers=extra_headers,
        stream=stream,
        allow_http=allow_http,
        timeout=timeout,
        max_chunks=max_chunks,
    )


@strands_tool(
    name="forge.openapi.invoke_stream",
    description="Invoke an OpenAPI operation and return streamed chunks (bounded by max_chunks).",
)
async def forge_openapi_invoke_stream(
    spec: dict[str, Any],
    operation_id: str,
    args: dict[str, Any] | None = None,
    auth: dict[str, Any] | None = None,
    base_url: str | None = None,
    extra_headers: dict[str, str] | None = None,
    allow_http: bool = False,
    max_chunks: int = 1000,
    timeout: float = 60.0,
) -> dict[str, Any]:
    return await _collect_invoke_result(
        spec=spec,
        operation_id=operation_id,
        args=args or {},
        auth=auth,
        base_url=base_url,
        extra_headers=extra_headers,
        stream=True,
        allow_http=allow_http,
        timeout=timeout,
        max_chunks=max_chunks,
    )


@strands_tool(
    name="forge.openapi.invoke_with_context",
    description="Invoke an OpenAPI operation with a context pack (policy-driven args/auth/headers/timeouts).",
)
async def forge_openapi_invoke_with_context(
    spec: dict[str, Any],
    operation_id: str,
    context_pack_id: str | None = None,
    context_pack: dict[str, Any] | None = None,
    args: dict[str, Any] | None = None,
    auth: dict[str, Any] | None = None,
    base_url: str | None = None,
    extra_headers: dict[str, str] | None = None,
    allow_http: bool | None = None,
    timeout: float | None = None,
    enforce_required_scopes: bool = False,
) -> dict[str, Any]:
    resolved_context_pack = context_pack
    if context_pack_id:
        store = get_context_pack_store()
        item = store.get_pack(context_pack_id)
        if item is None:
            raise ValueError(f"Context pack not found: {context_pack_id}")
        resolved_context_pack = item.get("pack")

    resolved = resolve_invoke_inputs_with_context(
        operation_id=operation_id,
        args=args or {},
        auth=auth,
        base_url=base_url,
        allow_http=allow_http,
        timeout=timeout,
        extra_headers=extra_headers,
        context_pack=resolved_context_pack,
    )
    if enforce_required_scopes and resolved["missingScopes"]:
        raise ValueError(f"Missing required scopes: {resolved['missingScopes']}")

    result = await _collect_invoke_result(
        spec=spec,
        operation_id=operation_id,
        args=resolved["args"],
        auth=resolved["auth"],
        base_url=resolved["baseUrl"],
        extra_headers=resolved["extraHeaders"],
        stream=False,
        allow_http=resolved["allowHttp"],
        timeout=resolved["timeout"],
        max_chunks=1000,
    )
    result["context"] = {
        "contextPackId": context_pack_id,
        "requiredScopes": resolved["requiredScopes"],
        "missingScopes": resolved["missingScopes"],
        "appliedHeaders": sorted(list(resolved["extraHeaders"].keys())),
    }
    return result


@strands_tool(
    name="forge.openapi.invoke_with_context_stream",
    description="Invoke an OpenAPI operation with context pack and return streaming chunks.",
)
async def forge_openapi_invoke_with_context_stream(
    spec: dict[str, Any],
    operation_id: str,
    context_pack_id: str | None = None,
    context_pack: dict[str, Any] | None = None,
    args: dict[str, Any] | None = None,
    auth: dict[str, Any] | None = None,
    base_url: str | None = None,
    extra_headers: dict[str, str] | None = None,
    allow_http: bool | None = None,
    timeout: float | None = None,
    max_chunks: int = 1000,
    enforce_required_scopes: bool = False,
) -> dict[str, Any]:
    resolved_context_pack = context_pack
    if context_pack_id:
        store = get_context_pack_store()
        item = store.get_pack(context_pack_id)
        if item is None:
            raise ValueError(f"Context pack not found: {context_pack_id}")
        resolved_context_pack = item.get("pack")

    resolved = resolve_invoke_inputs_with_context(
        operation_id=operation_id,
        args=args or {},
        auth=auth,
        base_url=base_url,
        allow_http=allow_http,
        timeout=timeout,
        extra_headers=extra_headers,
        context_pack=resolved_context_pack,
    )
    if enforce_required_scopes and resolved["missingScopes"]:
        raise ValueError(f"Missing required scopes: {resolved['missingScopes']}")

    result = await _collect_invoke_result(
        spec=spec,
        operation_id=operation_id,
        args=resolved["args"],
        auth=resolved["auth"],
        base_url=resolved["baseUrl"],
        extra_headers=resolved["extraHeaders"],
        stream=True,
        allow_http=resolved["allowHttp"],
        timeout=resolved["timeout"],
        max_chunks=max_chunks,
    )
    result["context"] = {
        "contextPackId": context_pack_id,
        "requiredScopes": resolved["requiredScopes"],
        "missingScopes": resolved["missingScopes"],
        "appliedHeaders": sorted(list(resolved["extraHeaders"].keys())),
    }
    return result


@strands_tool(
    name="forge.health",
    description="Health check for Python-native Forge tool availability.",
)
def forge_health() -> dict[str, Any]:
    return {
        "healthy": True,
        "service": "api-forge-python-tools",
        "capabilities": [
            "openapi.load",
            "openapi.validate",
            "openapi.synthesize",
            "openapi.synthesize_resources",
            "openapi.build_resource_endpoints",
            "openapi.splice",
            "openapi.filter",
            "mcp.export_tools",
            "fhir.synthesize_r4",
            "fhir.validate_profile",
            "fhir.validate_terminology",
            "fhir.validate_resource",
            "openapi.invoke",
            "openapi.invoke_stream",
            "openapi.invoke_with_context",
            "openapi.invoke_with_context_stream",
            "context_packs.upsert",
            "context_packs.get",
            "context_packs.list",
            "context_packs.delete",
            "webhooks.verify_signature",
            "webhooks.create_headers",
            "webhooks.create_subscription",
            "webhooks.list_subscriptions",
            "webhooks.delete_subscription",
            "webhooks.enqueue_delivery",
        ],
    }


FORGE_STRANDS_TOOLS = [
    forge_openapi_load,
    forge_openapi_validate,
    forge_openapi_synthesize,
    forge_openapi_synthesize_resources,
    forge_openapi_build_resource_endpoints,
    forge_fhir_synthesize_r4,
    forge_fhir_validate_profile,
    forge_fhir_validate_terminology,
    forge_fhir_validate_resource,
    forge_openapi_splice,
    forge_openapi_filter,
    forge_mcp_export_tools,
    forge_context_packs_upsert,
    forge_context_packs_get,
    forge_context_packs_list,
    forge_context_packs_delete,
    forge_webhooks_verify_signature,
    forge_webhooks_create_headers,
    forge_webhooks_create_subscription,
    forge_webhooks_list_subscriptions,
    forge_webhooks_delete_subscription,
    forge_webhooks_enqueue_delivery,
    forge_openapi_invoke,
    forge_openapi_invoke_stream,
    forge_openapi_invoke_with_context,
    forge_openapi_invoke_with_context_stream,
    forge_health,
]


def get_forge_strands_tools() -> list[Callable[..., Any]]:
    """Return all Forge Strands tools in a single list."""

    return FORGE_STRANDS_TOOLS.copy()


__all__ = [
    "FORGE_STRANDS_TOOLS",
    "forge_openapi_load",
    "forge_openapi_validate",
    "forge_openapi_synthesize",
    "forge_openapi_synthesize_resources",
    "forge_openapi_build_resource_endpoints",
    "forge_fhir_synthesize_r4",
    "forge_fhir_validate_profile",
    "forge_fhir_validate_terminology",
    "forge_fhir_validate_resource",
    "forge_openapi_splice",
    "forge_openapi_filter",
    "forge_mcp_export_tools",
    "forge_context_packs_upsert",
    "forge_context_packs_get",
    "forge_context_packs_list",
    "forge_context_packs_delete",
    "forge_webhooks_verify_signature",
    "forge_webhooks_create_headers",
    "forge_webhooks_create_subscription",
    "forge_webhooks_list_subscriptions",
    "forge_webhooks_delete_subscription",
    "forge_webhooks_enqueue_delivery",
    "forge_openapi_invoke",
    "forge_openapi_invoke_stream",
    "forge_openapi_invoke_with_context",
    "forge_openapi_invoke_with_context_stream",
    "forge_health",
    "get_forge_strands_tools",
]
