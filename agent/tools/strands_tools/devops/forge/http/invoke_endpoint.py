"""Invoke endpoint for FastAPI."""

from typing import Any
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
import json

from ..core.invoke import invoke_openapi

router = APIRouter()


@router.post("/forge/openapi/invoke")
async def openapi_invoke(request: Request):
    """
    Invoke an OpenAPI operation.
    
    Returns streaming response if stream=true, otherwise JSON.
    """
    data = await request.json()
    
    spec = data.get("spec")
    operation_id = data.get("operationId")
    args = data.get("args", {})
    auth = data.get("auth")
    base_url_override = data.get("baseUrl")
    stream = data.get("stream", False)
    allow_http = data.get("allowHttp", False)
    timeout = data.get("timeout", 60.0)
    
    if not spec:
        raise HTTPException(status_code=400, detail="spec is required")
    if not operation_id:
        raise HTTPException(status_code=400, detail="operationId is required")
    
    if stream:
        # Streaming response
        async def event_generator():
            async for chunk in invoke_openapi(
                spec=spec,
                operation_id=operation_id,
                args=args,
                auth=auth,
                base_url_override=base_url_override,
                stream=True,
                allow_http=allow_http,
                timeout=timeout
            ):
                yield f"data: {json.dumps(chunk)}\n\n"
        
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream"
        )
    else:
        # Sync response - collect all chunks
        result = None
        async for chunk in invoke_openapi(
            spec=spec,
            operation_id=operation_id,
            args=args,
            auth=auth,
            base_url_override=base_url_override,
            stream=False,
            allow_http=allow_http,
            timeout=timeout
        ):
            result = chunk
        
        if result and "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        
        return result


@router.post("/forge/openapi/invoke-stream")
async def openapi_invoke_stream(request: Request):
    """Explicit streaming endpoint."""
    data = await request.json()
    data["stream"] = True
    return await openapi_invoke(request)
