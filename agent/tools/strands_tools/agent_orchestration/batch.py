"""
Batch Tool for Parallel Tool Invocation

This tool enables invoking multiple other tools in parallel from a single LLM message response.
It is designed for use with agents that support tool registration and invocation by name.

Example usage:
    import os
    import sys

    from strands import Agent, tool
    from strands_tools import batch, http_request, use_aws

    # Example usage of the batch with http_request and use_aws tools
    agent = Agent(tools=[batch, http_request, use_aws])
    result = agent.tool.batch(
        invocations=[
            {"name": "http_request", "arguments": {"method": "GET", "url": "https://api.ipify.org?format=json"}},
            {
                "name": "use_aws",
                "arguments": {
                    "service_name": "s3",
                    "operation_name": "list_buckets",
                    "parameters": {},
                    "region": "us-east-1",
                    "label": "List S3 Buckets"
                }
            },
        ]
    )
"""

import traceback
from typing import Any, Dict, List

from strands import tool, ToolContext

from strands_tools.utils import console_util


@tool(context=True)
def batch(invocations: List[Dict[str, Any]], tool_context: ToolContext) -> dict:
    """
    Invoke multiple other tool calls simultaneously.

    This tool enables invoking multiple other tools in parallel from a single LLM message response.
    It is designed for use with agents that support tool registration and invocation by name.

    Args:
        invocations: The tool calls to invoke, each containing 'name' and 'arguments'
        tool_context: Context containing the agent instance for tool invocation

    Returns:
        Dictionary with batch execution summary and separated results:
        - batch_status: "success" (all succeeded), "partial_success" (some failed), or "failed" (all failed)
        - successful_results: List of successful tool invocations with their results
        - failed_results: List of failed tool invocations with error details
        - all_results: Complete list of all results in original order

    Error Handling:
        Individual tool failures do not stop the batch execution.
        Each tool is executed independently, and errors are captured per-tool.
        The response clearly separates successful and failed invocations for easy identification.

    Notes:
        Each invocation should specify the tool name and its arguments.
        The tool will attempt to call each specified tool function with the provided arguments.
        If a tool function is not found or an error occurs, it will be captured in the results.
    """
    console = console_util.create()
    agent = tool_context.agent
    results = []

    try:
        if not hasattr(agent, "tool") or agent.tool is None:
            raise AttributeError("Agent does not have a valid 'tool' attribute.")

        for invocation in invocations:
            tool_name = invocation.get("name")
            arguments = invocation.get("arguments", {})
            tool_fn = getattr(agent.tool, tool_name, None)

            if callable(tool_fn):
                try:
                    # Call the tool function with the provided arguments
                    result = tool_fn(**arguments)

                    # Create a consistent result structure
                    batch_result = {"name": tool_name, "status": "success", "result": result}
                    results.append(batch_result)

                except Exception as e:
                    error_msg = f"Error executing tool '{tool_name}': {str(e)}"
                    console.print(error_msg)

                    batch_result = {
                        "name": tool_name,
                        "status": "error",
                        "error": str(e),
                        "traceback": traceback.format_exc(),
                    }
                    results.append(batch_result)
            else:
                error_msg = f"Tool '{tool_name}' not found in agent"
                console.print(error_msg)

                batch_result = {"name": tool_name, "status": "error", "error": error_msg}
                results.append(batch_result)

        # Separate successful and failed results for clarity
        successful_results = [r for r in results if r["status"] == "success"]
        failed_results = [r for r in results if r["status"] == "error"]

        # Determine overall batch status
        batch_status = "success" if len(failed_results) == 0 else "partial_success" if len(successful_results) > 0 else "failed"

        # Create a readable summary for the agent
        summary_lines = []
        summary_lines.append(f"Batch execution completed: {len(successful_results)}/{len(results)} succeeded")

        if successful_results:
            summary_lines.append("\n✅ Successful:")
            for result in successful_results:
                summary_lines.append(f"  • {result['name']}")

        if failed_results:
            summary_lines.append("\n❌ Failed:")
            for result in failed_results:
                error_msg = result['error']
                # Truncate long error messages for readability
                if len(error_msg) > 100:
                    error_msg = error_msg[:97] + "..."
                summary_lines.append(f"  • {result['name']}: {error_msg}")

        summary_text = "\n".join(summary_lines)

        return {
            "status": batch_status,
            "content": [
                {"text": summary_text},
                {
                    "json": {
                        "batch_summary": {
                            "total_tools": len(results),
                            "successful": len(successful_results),
                            "failed": len(failed_results),
                            "batch_status": batch_status
                        },
                        "successful_results": successful_results,
                        "failed_results": failed_results,
                        "all_results": results,
                    }
                },
            ],
        }

    except Exception as e:
        error_msg = f"Error in batch tool: {str(e)}\n{traceback.format_exc()}"
        console.print(f"Error in batch tool: {str(e)}")
        return {
            "status": "error",
            "content": [{"text": error_msg}],
        }
