"""FastAPI application for Forge API."""

import json
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

from fastapi import Depends, FastAPI, HTTPException, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..core import (
    build_resource_endpoints,
    load_openapi,
    normalize_openapi,
    validate_openapi,
    validate_fhir_profile,
    validate_fhir_resource,
    validate_fhir_terminology,
    synthesize_fhir_r4_api,
    synthesize_openapi,
    synthesize_resource_api,
    splice_openapi,
    filter_openapi,
    export_mcp_tools,
    get_context_pack_store,
    resolve_invoke_inputs_with_context,
)
from ..core.invoke import invoke_openapi, SSRFError
from ..core.webhooks import (
    get_webhook_store,
    verify_webhook_signature,
    create_webhook_headers,
    DeliveryWorker,
)
from ..core.security import (
    PolicyEnforcer,
    SecretRedactor,
    get_internal_token,
    verify_internal_token,
)

# Security scheme
security = HTTPBearer(auto_error=False)


def get_settings() -> dict[str, Any]:
    """Get application settings from environment."""
    return {
        "internal_token": os.environ.get("FORGE_INTERNAL_TOKEN"),
        "cors_origins": os.environ.get("FORGE_CORS_ORIGINS", "").split(",") if os.environ.get("FORGE_CORS_ORIGINS") else [],
        "allow_policy_path": os.environ.get("FORGE_ALLOW_POLICY_PATH"),
        "log_redaction": os.environ.get("FORGE_LOG_REDACTION", "true").lower() == "true",
        "webhook_worker_enabled": os.environ.get("FORGE_WEBHOOK_WORKER_ENABLED", "true").lower() == "true",
        "webhook_worker_poll_interval_seconds": float(os.environ.get("FORGE_WEBHOOK_WORKER_POLL_INTERVAL", "1.0")),
        "webhook_worker_request_timeout_seconds": float(os.environ.get("FORGE_WEBHOOK_WORKER_REQUEST_TIMEOUT", "10.0")),
    }


async def verify_token(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
    settings: dict[str, Any] = Depends(get_settings)
) -> None:
    """Verify internal token for protected endpoints."""
    internal_token = settings.get("internal_token")
    
    # If no token configured, skip verification
    if not internal_token:
        return
    
    if not credentials:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    if credentials.credentials != internal_token:
        raise HTTPException(status_code=403, detail="Invalid token")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()
    
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        """Application lifespan handler."""
        # Startup
        policy_path = settings.get("allow_policy_path")
        if policy_path:
            app.state.policy_enforcer = PolicyEnforcer(policy_path)
        else:
            app.state.policy_enforcer = None
        
        app.state.secret_redactor = SecretRedactor(enabled=settings.get("log_redaction", True))
        app.state.context_pack_store = get_context_pack_store()
        app.state.webhook_store = get_webhook_store()
        app.state.delivery_worker = DeliveryWorker(
            app.state.webhook_store,
            poll_interval_seconds=settings.get("webhook_worker_poll_interval_seconds", 1.0),
            request_timeout_seconds=settings.get("webhook_worker_request_timeout_seconds", 10.0),
        )
        if settings.get("webhook_worker_enabled", True):
            app.state.delivery_worker.start_background()
        
        yield
        
        # Shutdown
        if hasattr(app.state, "delivery_worker"):
            app.state.delivery_worker.stop()
    
    app = FastAPI(
        title="API Forge",
        description="OpenAPI manipulation and MCP tools generation",
        version="1.0.0",
        lifespan=lifespan,
    )
    
    # CORS middleware
    cors_origins = settings.get("cors_origins", [])
    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    
    # Request logging middleware with secret redaction
    @app.middleware("http")
    async def log_requests(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        
        # Log without secrets
        if hasattr(request.app.state, "secret_redactor"):
            redactor = request.app.state.secret_redactor
            # This would log the request with secrets redacted
            # Implementation depends on logging framework
        
        return response
    
    # ==========================================================================
    # Health check
    # ==========================================================================
    
    @app.get("/forge/healthz")
    async def healthz() -> dict[str, str]:
        """Health check endpoint."""
        return {"status": "ok", "service": "api-forge"}

    # ==========================================================================
    # Context Packs
    # ==========================================================================

    @app.post("/forge/context-packs/upsert")
    async def context_pack_upsert(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Create or update a context pack."""
        data = await request.json()
        pack_id = data.get("id")
        pack = data.get("pack")
        merge = bool(data.get("merge", False))

        if not isinstance(pack_id, str) or not pack_id.strip():
            raise HTTPException(status_code=400, detail="id is required")
        if not isinstance(pack, dict):
            raise HTTPException(status_code=400, detail="pack object is required")

        store = app.state.context_pack_store
        saved = store.upsert_pack(pack_id.strip(), pack, merge=merge)
        return JSONResponse(content={"ok": True, "contextPack": saved})

    @app.get("/forge/context-packs")
    async def context_pack_list(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """List context packs."""
        query = request.query_params.get("query")
        limit_raw = request.query_params.get("limit", "200")
        try:
            limit = int(limit_raw)
        except ValueError:
            raise HTTPException(status_code=400, detail="limit must be an integer")

        store = app.state.context_pack_store
        items = store.list_packs(query=query, limit=limit)
        return JSONResponse(content={"ok": True, "count": len(items), "contextPacks": items})

    @app.get("/forge/context-packs/{pack_id}")
    async def context_pack_get(
        pack_id: str,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Get a context pack by ID."""
        store = app.state.context_pack_store
        item = store.get_pack(pack_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Context pack not found")
        return JSONResponse(content={"ok": True, "contextPack": item})

    @app.delete("/forge/context-packs/{pack_id}")
    async def context_pack_delete(
        pack_id: str,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Delete a context pack by ID."""
        store = app.state.context_pack_store
        deleted = store.delete_pack(pack_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Context pack not found")
        return JSONResponse(content={"ok": True, "deleted": True})
    
    # ==========================================================================
    # OpenAPI Load + Normalize
    # ==========================================================================
    
    class LoadRequest:
        """Request model for load endpoint."""
        def __init__(
            self,
            source: str,
            workdir: str | None = None
        ):
            self.source = source
            self.workdir = workdir
    
    @app.post("/forge/openapi/load")
    async def openapi_load(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Load and normalize an OpenAPI spec."""
        data = await request.json()
        source = data.get("source")
        workdir = data.get("workdir")
        
        if not source:
            raise HTTPException(status_code=400, detail="source is required")
        
        try:
            spec = load_openapi(source, workdir)
            normalized = normalize_openapi(spec)
            return JSONResponse(content={"ok": True, "spec": normalized})
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
    
    # ==========================================================================
    # OpenAPI Validate
    # ==========================================================================
    
    @app.post("/forge/openapi/validate")
    async def openapi_validate(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Validate an OpenAPI spec."""
        data = await request.json()
        spec = data.get("spec")
        
        if not spec:
            raise HTTPException(status_code=400, detail="spec is required")
        
        result = validate_openapi(spec)
        return JSONResponse(content=result)
    
    # ==========================================================================
    # OpenAPI Synthesize
    # ==========================================================================
    
    @app.post("/forge/openapi/synthesize")
    async def openapi_synthesize(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Synthesize an OpenAPI spec from an endpoint manifest."""
        data = await request.json()
        endpoints = data.get("endpoints", [])
        info = data.get("info")
        security_schemes = data.get("securitySchemes")
        security = data.get("security")
        tags = data.get("tags")
        servers = data.get("servers")
        
        # Check policy if configured
        if hasattr(app.state, "policy_enforcer") and app.state.policy_enforcer:
            allowed = app.state.policy_enforcer.check_operations(endpoints)
            if not allowed["allowed"]:
                raise HTTPException(
                    status_code=403,
                    detail=f"Policy violation: {allowed['reason']}"
                )
        
        try:
            spec = synthesize_openapi(
                endpoints=endpoints,
                info=info,
                security_schemes=security_schemes,
                security=security,
                tags=tags,
                servers=servers
            )
            return JSONResponse(content={"ok": True, "spec": spec})
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/forge/openapi/synthesize-resources")
    async def openapi_synthesize_resources(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Synthesize an OpenAPI spec from high-level resource definitions."""
        data = await request.json()
        resources = data.get("resources", [])
        info = data.get("info")
        security_schemes = data.get("securitySchemes")
        security = data.get("security")
        tags = data.get("tags")
        servers = data.get("servers")
        default_operations = data.get("defaultOperations")
        id_param_name = data.get("idParamName", "id")
        id_schema = data.get("idSchema")

        if not isinstance(resources, list) or not resources:
            raise HTTPException(status_code=400, detail="resources must be a non-empty list")

        try:
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
            return JSONResponse(content={"ok": True, "spec": spec})
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/forge/openapi/build-resource-endpoints")
    async def openapi_build_resource_endpoints(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Build endpoint manifests for resource-driven API synthesis."""
        data = await request.json()
        resources = data.get("resources", [])
        default_operations = data.get("defaultOperations")
        id_param_name = data.get("idParamName", "id")
        id_schema = data.get("idSchema")

        if not isinstance(resources, list) or not resources:
            raise HTTPException(status_code=400, detail="resources must be a non-empty list")

        try:
            endpoints = build_resource_endpoints(
                resources=resources,
                default_operations=default_operations,
                id_param_name=id_param_name,
                id_schema=id_schema,
            )
            return JSONResponse(content={"ok": True, "endpoints": endpoints, "count": len(endpoints)})
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/forge/fhir/synthesize-r4")
    async def fhir_synthesize_r4(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Synthesize a FHIR R4 API skeleton for selected resources."""
        data = await request.json()
        resources = data.get("resources", [])
        info = data.get("info")
        servers = data.get("servers")
        include_metadata = bool(data.get("includeMetadata", True))
        include_patch = bool(data.get("includePatch", True))
        smart_security = bool(data.get("smartSecurity", True))

        if not isinstance(resources, list) or not resources:
            raise HTTPException(status_code=400, detail="resources must be a non-empty list")

        try:
            spec = synthesize_fhir_r4_api(
                resources=resources,
                info=info,
                servers=servers,
                include_metadata=include_metadata,
                include_patch=include_patch,
                smart_security=smart_security,
            )
            return JSONResponse(content={"ok": True, "spec": spec})
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/forge/fhir/validate-profile")
    async def fhir_validate_profile(
        request: Request,
        token: None = Depends(verify_token),
    ) -> JSONResponse:
        """Validate FHIR profile constraints and required fields."""
        data = await request.json()
        resource = data.get("resource")
        required_profiles = data.get("requiredProfiles")
        required_fields_by_resource = data.get("requiredFieldsByResource")
        strict = bool(data.get("strict", False))

        if not isinstance(resource, dict):
            raise HTTPException(status_code=400, detail="resource object is required")

        result = validate_fhir_profile(
            resource=resource,
            required_profiles=required_profiles,
            required_fields_by_resource=required_fields_by_resource,
            strict=strict,
        )
        return JSONResponse(content=result)

    @app.post("/forge/fhir/validate-terminology")
    async def fhir_validate_terminology(
        request: Request,
        token: None = Depends(verify_token),
    ) -> JSONResponse:
        """Validate FHIR coding systems and terminology quality checks."""
        data = await request.json()
        resource = data.get("resource")
        allowed_systems = data.get("allowedSystems")
        strict = bool(data.get("strict", False))

        if not isinstance(resource, dict):
            raise HTTPException(status_code=400, detail="resource object is required")

        result = validate_fhir_terminology(
            resource=resource,
            allowed_systems=allowed_systems,
            strict=strict,
        )
        return JSONResponse(content=result)

    @app.post("/forge/fhir/validate-resource")
    async def fhir_validate_resource(
        request: Request,
        token: None = Depends(verify_token),
    ) -> JSONResponse:
        """Combined FHIR profile + terminology validation."""
        data = await request.json()
        resource = data.get("resource")
        required_profiles = data.get("requiredProfiles")
        allowed_systems = data.get("allowedSystems")
        required_fields_by_resource = data.get("requiredFieldsByResource")
        strict = bool(data.get("strict", False))

        if not isinstance(resource, dict):
            raise HTTPException(status_code=400, detail="resource object is required")

        result = validate_fhir_resource(
            resource=resource,
            required_profiles=required_profiles,
            allowed_systems=allowed_systems,
            required_fields_by_resource=required_fields_by_resource,
            strict=strict,
        )
        return JSONResponse(content=result)
    
    # ==========================================================================
    # OpenAPI Splice / Merge
    # ==========================================================================
    
    @app.post("/forge/openapi/splice")
    async def openapi_splice(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Splice (merge) multiple OpenAPI specs."""
        data = await request.json()
        specs = data.get("specs", [])
        namespace_prefixes = data.get("namespacePrefixes")
        on_path_collision = data.get("onPathCollision", "error")
        on_operationId_collision = data.get("onOperationIdCollision", "error")
        on_component_collision = data.get("onComponentCollision", "error")
        
        if len(specs) < 1:
            raise HTTPException(status_code=400, detail="At least one spec is required")
        
        try:
            result = splice_openapi(
                specs=specs,
                namespace_prefixes=namespace_prefixes,
                on_path_collision=on_path_collision,
                on_operationId_collision=on_operationId_collision,
                on_component_collision=on_component_collision
            )
            return JSONResponse(content={"ok": True, **result})
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    
    # ==========================================================================
    # OpenAPI Filter
    # ==========================================================================
    
    @app.post("/forge/openapi/filter")
    async def openapi_filter(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Filter an OpenAPI spec with dependency closure."""
        data = await request.json()
        spec = data.get("spec")
        allow_operation_ids = data.get("allowOperationIds")
        allow_tags = data.get("allowTags")
        allow_paths = data.get("allowPaths")
        deny_operation_ids = data.get("denyOperationIds")
        include_security_schemes = data.get("includeSecuritySchemes", True)
        
        if not spec:
            raise HTTPException(status_code=400, detail="spec is required")
        
        result = filter_openapi(
            spec=spec,
            allow_operation_ids=allow_operation_ids,
            allow_tags=allow_tags,
            allow_paths=allow_paths,
            deny_operation_ids=deny_operation_ids,
            include_security_schemes=include_security_schemes
        )
        return JSONResponse(content={"ok": True, **result})
    
    # ==========================================================================
    # MCP Tools Export
    # ==========================================================================
    
    @app.post("/forge/mcp/export")
    async def mcp_export(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Export OpenAPI spec as MCP tools manifest."""
        data = await request.json()
        spec = data.get("spec")
        
        if not spec:
            raise HTTPException(status_code=400, detail="spec is required")
        
        tools = export_mcp_tools(spec)
        return JSONResponse(content={
            "ok": True,
            "tools": tools,
            "count": len(tools)
        })

    # ==========================================================================
    # OpenAPI Invoke
    # ==========================================================================

    @app.post("/forge/openapi/invoke")
    async def openapi_invoke(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Invoke an OpenAPI operation."""
        data = await request.json()
        spec = data.get("spec")
        operation_id = data.get("operationId")
        args = data.get("args", {})
        auth = data.get("auth")
        extra_headers = data.get("extraHeaders")
        base_url_override = data.get("baseUrl")
        stream = data.get("stream", False)
        allow_http = data.get("allowHttp", False)
        timeout = data.get("timeout", 60.0)
        
        if not spec:
            raise HTTPException(status_code=400, detail="spec is required")
        if not operation_id:
            raise HTTPException(status_code=400, detail="operationId is required")
        
        if stream:
            # For streaming, we'd need StreamingResponse
            # For now, return error indicating streaming needs different endpoint
            raise HTTPException(status_code=400, detail="Streaming not supported on this endpoint, use /forge/openapi/invoke-stream")
        
        # Collect response
        result = None
        async for chunk in invoke_openapi(
            spec=spec,
            operation_id=operation_id,
            args=args,
            auth=auth,
            base_url_override=base_url_override,
            stream=False,
            allow_http=allow_http,
            timeout=timeout,
            extra_headers=extra_headers if isinstance(extra_headers, dict) else None,
        ):
            result = chunk
        
        if result is None:
            raise HTTPException(status_code=500, detail="No response from invocation")
        
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        
        return JSONResponse(content=result)

    @app.post("/forge/openapi/invoke-stream")
    async def openapi_invoke_stream(
        request: Request,
        token: None = Depends(verify_token)
    ) -> Any:
        """Invoke an OpenAPI operation with streaming response."""
        from fastapi.responses import StreamingResponse
        
        data = await request.json()
        spec = data.get("spec")
        operation_id = data.get("operationId")
        args = data.get("args", {})
        auth = data.get("auth")
        extra_headers = data.get("extraHeaders")
        base_url_override = data.get("baseUrl")
        allow_http = data.get("allowHttp", False)
        timeout = data.get("timeout", 60.0)
        
        if not spec:
            raise HTTPException(status_code=400, detail="spec is required")
        if not operation_id:
            raise HTTPException(status_code=400, detail="operationId is required")
        
        async def event_generator():
            async for chunk in invoke_openapi(
                spec=spec,
                operation_id=operation_id,
                args=args,
                    auth=auth,
                    base_url_override=base_url_override,
                    stream=True,
                    allow_http=allow_http,
                    timeout=timeout,
                    extra_headers=extra_headers if isinstance(extra_headers, dict) else None,
                ):
                    yield f"data: {json.dumps(chunk)}\n\n".encode()
        
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream"
        )

    @app.post("/forge/openapi/invoke-with-context")
    async def openapi_invoke_with_context(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Invoke an OpenAPI operation with context-pack policy resolution."""
        data = await request.json()
        spec = data.get("spec")
        operation_id = data.get("operationId")
        context_pack_id = data.get("contextPackId")
        context_pack = data.get("contextPack")
        args = data.get("args", {})
        auth = data.get("auth")
        extra_headers = data.get("extraHeaders")
        base_url_override = data.get("baseUrl")
        allow_http = data.get("allowHttp")
        timeout = data.get("timeout")
        enforce_required_scopes = bool(data.get("enforceRequiredScopes", False))

        if not spec:
            raise HTTPException(status_code=400, detail="spec is required")
        if not operation_id:
            raise HTTPException(status_code=400, detail="operationId is required")

        resolved_context_pack: dict[str, Any] | None = None
        if context_pack_id:
            store = app.state.context_pack_store
            item = store.get_pack(str(context_pack_id))
            if item is None:
                raise HTTPException(status_code=404, detail=f"Context pack not found: {context_pack_id}")
            resolved_context_pack = item.get("pack")
        elif context_pack is not None:
            if not isinstance(context_pack, dict):
                raise HTTPException(status_code=400, detail="contextPack must be an object")
            resolved_context_pack = context_pack

        resolved = resolve_invoke_inputs_with_context(
            operation_id=operation_id,
            args=args if isinstance(args, dict) else {},
            auth=auth if isinstance(auth, dict) else None,
            base_url=base_url_override if isinstance(base_url_override, str) else None,
            allow_http=allow_http if isinstance(allow_http, bool) else None,
            timeout=float(timeout) if isinstance(timeout, (int, float)) else None,
            extra_headers=extra_headers if isinstance(extra_headers, dict) else None,
            context_pack=resolved_context_pack,
        )

        if enforce_required_scopes and resolved["missingScopes"]:
            raise HTTPException(
                status_code=403,
                detail=f"Missing required scopes: {resolved['missingScopes']}",
            )

        result: dict[str, Any] | None = None
        async for chunk in invoke_openapi(
            spec=spec,
            operation_id=operation_id,
            args=resolved["args"],
            auth=resolved["auth"],
            base_url_override=resolved["baseUrl"],
            stream=False,
            allow_http=resolved["allowHttp"],
            timeout=resolved["timeout"],
            extra_headers=resolved["extraHeaders"],
        ):
            result = chunk

        if result is None:
            raise HTTPException(status_code=500, detail="No response from invocation")
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        result["context"] = {
            "contextPackId": context_pack_id,
            "requiredScopes": resolved["requiredScopes"],
            "missingScopes": resolved["missingScopes"],
            "appliedHeaders": sorted(list(resolved["extraHeaders"].keys())),
        }
        return JSONResponse(content=result)

    @app.post("/forge/openapi/invoke-with-context-stream")
    async def openapi_invoke_with_context_stream(
        request: Request,
        token: None = Depends(verify_token)
    ) -> Any:
        """Invoke with context pack and stream chunks."""
        from fastapi.responses import StreamingResponse

        data = await request.json()
        spec = data.get("spec")
        operation_id = data.get("operationId")
        context_pack_id = data.get("contextPackId")
        context_pack = data.get("contextPack")
        args = data.get("args", {})
        auth = data.get("auth")
        extra_headers = data.get("extraHeaders")
        base_url_override = data.get("baseUrl")
        allow_http = data.get("allowHttp")
        timeout = data.get("timeout")
        enforce_required_scopes = bool(data.get("enforceRequiredScopes", False))

        if not spec:
            raise HTTPException(status_code=400, detail="spec is required")
        if not operation_id:
            raise HTTPException(status_code=400, detail="operationId is required")

        resolved_context_pack: dict[str, Any] | None = None
        if context_pack_id:
            store = app.state.context_pack_store
            item = store.get_pack(str(context_pack_id))
            if item is None:
                raise HTTPException(status_code=404, detail=f"Context pack not found: {context_pack_id}")
            resolved_context_pack = item.get("pack")
        elif context_pack is not None:
            if not isinstance(context_pack, dict):
                raise HTTPException(status_code=400, detail="contextPack must be an object")
            resolved_context_pack = context_pack

        resolved = resolve_invoke_inputs_with_context(
            operation_id=operation_id,
            args=args if isinstance(args, dict) else {},
            auth=auth if isinstance(auth, dict) else None,
            base_url=base_url_override if isinstance(base_url_override, str) else None,
            allow_http=allow_http if isinstance(allow_http, bool) else None,
            timeout=float(timeout) if isinstance(timeout, (int, float)) else None,
            extra_headers=extra_headers if isinstance(extra_headers, dict) else None,
            context_pack=resolved_context_pack,
        )

        if enforce_required_scopes and resolved["missingScopes"]:
            raise HTTPException(
                status_code=403,
                detail=f"Missing required scopes: {resolved['missingScopes']}",
            )

        async def event_generator():
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "context",
                        "contextPackId": context_pack_id,
                        "requiredScopes": resolved["requiredScopes"],
                        "missingScopes": resolved["missingScopes"],
                        "appliedHeaders": sorted(list(resolved["extraHeaders"].keys())),
                    }
                )
                + "\n\n"
            ).encode()
            async for chunk in invoke_openapi(
                spec=spec,
                operation_id=operation_id,
                args=resolved["args"],
                auth=resolved["auth"],
                base_url_override=resolved["baseUrl"],
                stream=True,
                allow_http=resolved["allowHttp"],
                timeout=resolved["timeout"],
                extra_headers=resolved["extraHeaders"],
            ):
                yield f"data: {json.dumps(chunk)}\n\n".encode()

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream"
        )
    
    # ==========================================================================
    # Webhooks
    # ==========================================================================
    
    @app.post("/forge/webhooks/verify-signature")
    async def webhooks_verify(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Verify a webhook signature."""
        data = await request.json()
        secret = data.get("secret")
        payload = data.get("payload", {})
        headers = data.get("headers", {})
        max_age_seconds = data.get("maxAgeSeconds", 300.0)
        
        if not secret:
            raise HTTPException(status_code=400, detail="secret is required")
        
        result = verify_webhook_signature(secret, payload, headers, max_age_seconds)
        return JSONResponse(content=result)
    
    @app.post("/forge/webhooks/create-headers")
    async def webhooks_create_headers(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Create webhook headers with signature."""
        data = await request.json()
        secret = data.get("secret")
        payload = data.get("payload", {})
        
        if not secret:
            raise HTTPException(status_code=400, detail="secret is required")
        
        headers = create_webhook_headers(secret, payload)
        return JSONResponse(content={"ok": True, "headers": headers})
    
    @app.post("/forge/webhooks/subscriptions")
    async def webhooks_create_subscription(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Create a webhook subscription."""
        data = await request.json()
        subscription_id = data.get("id")
        url = data.get("url")
        event_types = data.get("eventTypes", [])
        secret = data.get("secret")
        max_retries = data.get("maxRetries", 3)
        retry_delay = data.get("retryDelay", 1.0)
        
        if not subscription_id or not url or not secret:
            raise HTTPException(status_code=400, detail="id, url, and secret are required")
        
        store = get_webhook_store()
        sub = store.create_subscription(
            subscription_id=subscription_id,
            url=url,
            event_types=event_types,
            secret=secret,
            max_retries=max_retries,
            retry_delay=retry_delay
        )
        return JSONResponse(content={
            "ok": True,
            "subscription": {
                "id": sub.id,
                "url": sub.url,
                "eventTypes": sub.event_types,
                "active": sub.active,
                "createdAt": sub.created_at
            }
        })
    
    @app.get("/forge/webhooks/subscriptions")
    async def webhooks_list_subscriptions(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """List webhook subscriptions."""
        active_only = request.query_params.get("activeOnly", "true").lower() == "true"
        event_type = request.query_params.get("eventType")
        
        store = get_webhook_store()
        subs = store.list_subscriptions(
            active_only=active_only,
            event_type=event_type
        )
        
        return JSONResponse(content={
            "ok": True,
            "subscriptions": [
                {
                    "id": s.id,
                    "url": s.url,
                    "eventTypes": s.event_types,
                    "active": s.active,
                    "createdAt": s.created_at
                }
                for s in subs
            ]
        })
    
    @app.delete("/forge/webhooks/subscriptions/{subscription_id}")
    async def webhooks_delete_subscription(
        subscription_id: str,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Delete a webhook subscription."""
        store = get_webhook_store()
        deleted = store.delete_subscription(subscription_id)
        
        if not deleted:
            raise HTTPException(status_code=404, detail="Subscription not found")
        
        return JSONResponse(content={"ok": True, "deleted": True})
    
    @app.post("/forge/webhooks/enqueue")
    async def webhooks_enqueue(
        request: Request,
        token: None = Depends(verify_token)
    ) -> JSONResponse:
        """Enqueue a webhook delivery."""
        data = await request.json()
        subscription_id = data.get("subscriptionId")
        event_type = data.get("eventType")
        payload = data.get("payload", {})
        
        if not subscription_id or not event_type:
            raise HTTPException(status_code=400, detail="subscriptionId and eventType are required")
        
        store = get_webhook_store()
        delivery_id = store.enqueue_delivery(subscription_id, event_type, payload)
        
        return JSONResponse(content={
            "ok": True,
            "deliveryId": delivery_id
        })
    
    return app


def main() -> None:
    """Run the application with uvicorn."""
    import uvicorn
    
    port = int(os.environ.get("FORGE_PORT", "8000"))
    host = os.environ.get("FORGE_HOST", "127.0.0.1")
    
    app = create_app()
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
