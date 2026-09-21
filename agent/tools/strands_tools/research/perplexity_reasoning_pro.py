"""
Perplexity Reasoning Pro Tool
Use Perplexity Reasoning Pro for complex reasoning and multi-criteria analysis with streaming support.
Supports images, related questions, and rich filtering.
"""

import os
import logging
import base64
import mimetypes
from typing import Dict, Any, List, Optional, Union
try:
    from perplexity import AsyncPerplexity
except ImportError:
    AsyncPerplexity = None

logger = logging.getLogger(__name__)

async def perplexity_reasoning_pro(
    query: str,
    search_filter: Optional[str] = None,
    search_domain_filter: Optional[List[str]] = None,
    search_recency_filter: Optional[str] = None,
    return_images: bool = True,
    return_related_questions: bool = True,
    file_paths: Optional[List[str]] = None,
    model: str = "sonar-reasoning-pro"
) -> Dict[str, Any]:
    """
    Use Perplexity Reasoning Pro for complex reasoning and multi-criteria analysis with streaming support.
    
    Args:
        query: The search query
        search_filter: Optional search filter to refine results (e.g. "site:github.com")
        search_domain_filter: Optional list of domains to filter results (e.g. ["github.com", "stackoverflow.com"])
        search_recency_filter: Optional recency filter ("month", "week", "day", "hour")
        return_images: Whether to return related images (default: True)
        return_related_questions: Whether to return related questions (default: True)
        file_paths: Optional list of local file paths to attach (images only for now, unless API supports docs via same flow)
        model: Model to use ("sonar-reasoning-pro" or "sonar-pro")
        
    Returns:
        Dictionary containing success status, result content, reasoning content, images, related questions, etc.
    """
    api_key = os.getenv('PERPLEXITY_API_KEY')
    if not api_key:
        return {"error": "PERPLEXITY_API_KEY not configured"}

    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        # Build messages with optional attachments
        messages = []
        user_content = [{"type": "text", "text": query}]

        if file_paths:
            for path in file_paths:
                if os.path.exists(path):
                    mime_type, _ = mimetypes.guess_type(path)
                    if not mime_type:
                        mime_type = "application/octet-stream"
                    
                    try:
                        with open(path, "rb") as f:
                            encoded = base64.b64encode(f.read()).decode("utf-8")
                            # Perplexity/OpenAI compatible image format
                            if mime_type.startswith("image/"):
                                user_content.append({
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{encoded}"
                                    }
                                })
                            else:
                                # For non-images, we might need a text extraction or different format.
                                # Assuming Perplexity might handle text extraction if passed appropriately,
                                # but standard behavior is images. We'll append a note for now.
                                logger.warning(f"Skipping non-image attachment {path} (mime: {mime_type}) - only images supported directly in this tool version.")
                    except Exception as e:
                        logger.error(f"Failed to read attachment {path}: {e}")
                else:
                    logger.warning(f"Attachment not found: {path}")

        messages.append({"role": "user", "content": user_content})

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "return_images": return_images,
            "return_related_questions": return_related_questions
        }

        # Add filters
        if search_filter:
            payload["search_filter"] = search_filter
        if search_domain_filter:
            payload["search_domain_filter"] = search_domain_filter
        if search_recency_filter:
            payload["search_recency_filter"] = search_recency_filter

        async with AsyncPerplexity(api_key=api_key) as client:
            response = await client.search.create(
                model=model,
                messages=messages,
                stream=True,
                return_images=return_images,
                return_related_questions=return_related_questions,
                **{k: v for k, v in payload.items() if k in ["search_filter", "search_domain_filter", "search_recency_filter"]}
            )
            
            if response:
                # Process streaming response via SDK
                full_content = ""
                reasoning_content = ""
                citations = []
                images = []
                related_questions = []

                async for part in response:
                    # SDK handles chunk parsing
                    if hasattr(part, "choices") and part.choices:
                         delta = part.choices[0].delta
                         if delta.content:
                             full_content += delta.content
                             # Extract reasoning (if SDK exposes it in content directly)
                             if '<think>' in delta.content:
                                 pass
                    
                    if hasattr(part, "citations"):
                        citations = part.citations
                    if hasattr(part, "images"):
                        images = part.images
                    if hasattr(part, "related_questions"):
                        related_questions = part.related_questions
                    
                    # Also check for direct attributes on chunk for some SDK versions
                    if hasattr(part, "content"):
                        full_content += part.content

                # Post-process reasoning tags if present
                if '<think>' in full_content and '</think>' in full_content:
                    start = full_content.find('<think>') + 7
                    end = full_content.find('</think>')
                    reasoning_content = full_content[start:end]
                    full_content = full_content.replace(f"<think>{reasoning_content}</think>", "").strip()

                return {
                    "success": True,
                    "result": full_content,
                    "reasoning": reasoning_content.strip() if reasoning_content else None,
                    "citations": citations,
                    "images": images,
                    "related_questions": related_questions,
                    "query": query,
                    "model": model,
                }

    except Exception as e:
        logger.error(f"Perplexity Reasoning Pro error: {str(e)}")
        return {"success": False, "error": str(e), "query": query}
