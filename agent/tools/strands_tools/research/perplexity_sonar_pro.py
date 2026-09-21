"""
Perplexity Sonar Pro Tool
Search using Perplexity Sonar Pro for complex multi-criteria analysis with streaming support
"""

import os
import aiohttp
import json
import logging
from typing import Dict, Any, List, Optional
from strands import tool

logger = logging.getLogger(__name__)
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))


@tool
async def perplexity_sonar_pro(
    query: str,
    search_filter: Optional[str] = None,
    search_domain_filter: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Search using Perplexity Sonar Pro for complex multi-criteria analysis with streaming support

    Args:
        query: The search query
        search_filter: Optional search filter to refine results
        search_domain_filter: Optional list of domains to filter results

    Returns:
        Dictionary containing success status, result content, query, model name, and streaming status
    """
    api_key = os.getenv('PERPLEXITY_API_KEY')
    if not api_key:
        return {"error": "PERPLEXITY_API_KEY not configured"}

    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": "sonar-pro",
            "messages": [
                {"role": "user", "content": query}
            ],
            "stream": True  # Enable streaming for progressive responses
        }

        # Add optional search filters
        if search_filter:
            payload["search_filter"] = search_filter
        if search_domain_filter:
            payload["search_domain_filter"] = search_domain_filter

        timeout = aiohttp.ClientTimeout(total=API_TOOL_TIMEOUT_SECONDS)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                "https://api.perplexity.ai/chat/completions",
                headers=headers,
                json=payload,
                timeout=timeout,
            ) as response:
                if response.status == 200:
                    # Process streaming response
                    full_content = ""
                    async for line in response.content:
                        line = line.decode('utf-8').strip()
                        if line.startswith('data: '):
                            data = line[6:]  # Remove 'data: ' prefix
                            if data == '[DONE]':
                                break
                            if data:
                                try:
                                    chunk = json.loads(data)
                                    if chunk.get('choices') and chunk['choices'][0].get('delta', {}).get('content'):
                                        content = chunk['choices'][0]['delta']['content']
                                        full_content += content
                                except json.JSONDecodeError:
                                    continue

                    return {
                        "success": True,
                        "result": full_content,
                        "query": query,
                        "model": "sonar-pro",
                        "streamed": True
                    }
                else:
                    error_text = await response.text()
                    return {
                        "success": False,
                        "error": f"API error {response.status}: {error_text}",
                        "query": query,
                    }

    except Exception as e:
        logger.error(f"Perplexity Sonar Pro error: {str(e)}")
        return {"success": False, "error": str(e), "query": query}
