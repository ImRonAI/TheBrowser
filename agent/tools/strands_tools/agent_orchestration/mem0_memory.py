"""
Tool for managing memories using Mem0 (store, delete, list, get, and retrieve)

This module provides comprehensive memory management capabilities using
Mem0 as the backend. It handles all aspects of memory management with
a user-friendly interface and proper error handling.

Key Features:
------------
1. Memory Management:
   • store: Add new memories with automatic ID generation and metadata
   • delete: Remove existing memories using memory IDs
   • list: Retrieve all memories for a user or agent
   • get: Retrieve specific memories by memory ID
   • retrieve: Perform semantic search across all memories

2. Safety Features:
   • User confirmation for mutative operations
   • Content previews before storage
   • Warning messages before deletion
   • BYPASS_TOOL_CONSENT mode for bypassing confirmations in tests

3. Advanced Capabilities:
   • Automatic memory ID generation
   • Structured memory storage with metadata
   • Semantic search with relevance filtering
   • Rich output formatting
   • Support for both user and agent memories
   • Multiple vector database backends (OpenSearch, Mem0 Platform, FAISS)

4. Error Handling:
   • Memory ID validation
   • Parameter validation
   • Graceful API error handling
   • Clear error messages

Usage Examples:
--------------
```python
from strands import Agent
from strands_tools import mem0_memory

agent = Agent(tools=[mem0_memory])

# Store memory in Memory
agent.tool.mem0_memory(
    action="store",
    content="Important information to remember",
    user_id="alex",  # or agent_id="agent1"
    metadata={"category": "meeting_notes"}
)

# Retrieve content using semantic search
agent.tool.mem0_memory(
    action="retrieve",
    query="meeting information",
    user_id="alex"  # or agent_id="agent1"
)

# List all memories
agent.tool.mem0_memory(
    action="list",
    user_id="alex"  # or agent_id="agent1"
)
```
"""

# CRITICAL: Load environment variables BEFORE any imports that read them
# This fixes the timing issue where MEM0_API_KEY is set in .env but not
# available when Mem0ServiceClient initializes at module import time
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parents[4] / ".env")  # Load from project root

import json
import logging
import os
from typing import Any, Dict, List, Optional

import boto3
from mem0 import Memory as Mem0Memory
from mem0 import MemoryClient
from opensearchpy import AWSV4SignerAuth, RequestsHttpConnection
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from strands import tool
from strands.types.tools import ToolResult, ToolResultContent

# Set up logging
logger = logging.getLogger(__name__)

# Initialize Rich console
console = Console()


class Mem0ServiceClient:
    """Client for interacting with Mem0 service."""

    DEFAULT_CONFIG = {
        "embedder": {
            "provider": os.environ.get("MEM0_EMBEDDER_PROVIDER", "aws_bedrock"),
            "config": {"model": os.environ.get("MEM0_EMBEDDER_MODEL", "amazon.titan-embed-text-v2:0")},
        },
        "llm": {
            "provider": os.environ.get("MEM0_LLM_PROVIDER", "aws_bedrock"),
            "config": {
                "model": os.environ.get("MEM0_LLM_MODEL", "anthropic.claude-haiku-4-5-20251001-v1:0"),
                "temperature": float(os.environ.get("MEM0_LLM_TEMPERATURE", 0.1)),
                "max_tokens": int(os.environ.get("MEM0_LLM_MAX_TOKENS", 2000)),
            },
        },
    }

    def __init__(self, config: Optional[Dict] = None):
        """Initialize the Mem0 service client.

        Args:
            config: Optional configuration dictionary to override defaults.
                   If provided, it will be merged with DEFAULT_CONFIG.

        The client will use one of three backends based on environment variables:
        1. Mem0 Platform if MEM0_API_KEY is set
        2. OpenSearch if OPENSEARCH_HOST is set
        3. FAISS (default) if neither MEM0_API_KEY nor OPENSEARCH_HOST is set
        """
        self.mem0 = self._initialize_client(config)

    def _initialize_client(self, config: Optional[Dict] = None) -> Any:
        """Initialize the appropriate Mem0 client based on environment variables.

        Args:
            config: Optional configuration dictionary to override defaults.

        Returns:
            An initialized Mem0 client (MemoryClient or Mem0Memory instance).
        """
        if os.environ.get("MEM0_API_KEY"):
            logger.debug("Using Mem0 Platform backend (MemoryClient)")
            return MemoryClient()

        if os.environ.get("NEPTUNE_ANALYTICS_GRAPH_IDENTIFIER") and os.environ.get("OPENSEARCH_HOST"):
            raise RuntimeError("""Conflicting backend configurations:
            Only one environment variable of NEPTUNE_ANALYTICS_GRAPH_IDENTIFIER or OPENSEARCH_HOST can be set.""")

        # Vector search providers
        if os.environ.get("OPENSEARCH_HOST"):
            logger.debug("Using OpenSearch backend (Mem0Memory with OpenSearch)")
            merged_config = self._append_opensearch_config(config)

        elif os.environ.get("NEPTUNE_ANALYTICS_GRAPH_IDENTIFIER"):
            logger.debug("Using Neptune Analytics vector backend (Mem0Memory with Neptune Analytics)")
            merged_config = self._append_neptune_analytics_vector_config(config)

        else:
            logger.debug("Using FAISS backend (Mem0Memory with FAISS)")
            merged_config = self._append_faiss_config(config)

        # Graph backend providers

        # Graph backend providers
        if os.environ.get("NEPTUNE_ANALYTICS_GRAPH_IDENTIFIER") and os.environ.get("NEPTUNE_DATABASE_ENDPOINT"):
            raise RuntimeError("""Conflicting backend configurations:
                Both NEPTUNE_ANALYTICS_GRAPH_IDENTIFIER and NEPTUNE_DATABASE_ENDPOINT environment variables are set.
                Please specify only one graph backend.""")

        if os.environ.get("NEPTUNE_ANALYTICS_GRAPH_IDENTIFIER"):
            logger.debug("Using Neptune Analytics graph backend (Mem0Memory with Neptune Analytics)")
            merged_config = self._append_neptune_analytics_graph_config(merged_config)

        elif os.environ.get("NEPTUNE_DATABASE_ENDPOINT"):
            logger.debug("Using Neptune Database graph backend (Mem0Memory with Neptune Database)")
            merged_config = self._append_neptune_database_backend(merged_config)

        return Mem0Memory.from_config(config_dict=merged_config)

    def _append_neptune_analytics_vector_config(self, config: Optional[Dict] = None) -> Dict:
        """Update incoming configuration dictionary to include the configuration of Neptune Analytics vector backend.

        Args:
            config: Optional configuration dictionary to override defaults.

        Returns:
            An configuration dict with graph backend.
        """
        config = config or {}
        config["vector_store"] = {
            "provider": "neptune",
            "config": {
                "collection_name": os.environ.get("NEPTUNE_ANALYTICS_VECTOR_COLLECTION", "mem0"),
                "endpoint": f"neptune-graph://{os.environ.get('NEPTUNE_ANALYTICS_GRAPH_IDENTIFIER')}",
            },
        }
        return self._merge_config(config)

    def _append_neptune_database_backend(self, config: Optional[Dict] = None) -> Dict:
        """Update incoming configuration dictionary to include the configuration of Neptune Database graph backend.

        Args:
            config: Optional configuration dictionary to override defaults.

        Returns:
            An configuration dict with graph backend.
        """
        config = config or {}
        config["graph_store"] = {
            "provider": "neptunedb",
            "config": {"endpoint": f"neptune-db://{os.environ.get('NEPTUNE_DATABASE_ENDPOINT')}"},
        }
        # To retrieve cosine similarity score instead for Faiss.
        if "faiss" == config.get("vector_store", {}).get("provider"):
            config["vector_store"]["config"]["distance_strategy"] = "cosine"

        return config

    def _append_opensearch_config(self, config: Optional[Dict] = None) -> Dict:
        """Update incoming configuration dictionary to include the configuration of OpenSearch vector backend.

        Supports two modes:
        1. Local Docker mode (OPENSEARCH_LOCAL=true): No SSL, no auth, port 9200
        2. AWS OpenSearch mode (default): SSL, IAM auth, port 443

        Args:
            config: Optional configuration dictionary to override defaults.

        Returns:
            An initialized Mem0Memory instance configured for OpenSearch.
        """
        config = config or {}
        is_local = os.environ.get("OPENSEARCH_LOCAL", "").lower() == "true"
        
        if is_local:
            # Local Docker OpenSearch config (no security plugin)
            logger.debug("Using LOCAL OpenSearch configuration (no SSL, no auth)")
            config["vector_store"] = {
                "provider": "opensearch",
                "config": {
                    "host": os.environ.get("OPENSEARCH_HOST", "localhost"),
                    "port": int(os.environ.get("OPENSEARCH_PORT", "9200")),
                    "collection_name": os.environ.get("OPENSEARCH_COLLECTION", "mem0"),
                    "embedding_model_dims": 1024,
                    "use_ssl": False,
                    "verify_certs": False,
                    "connection_class": RequestsHttpConnection,
                    "pool_maxsize": 20,
                },
            }
            return self._merge_config(config)
        else:
            # AWS OpenSearch Serverless config (with IAM auth)
            logger.debug("Using AWS OpenSearch configuration (SSL, IAM auth)")
            config["vector_store"] = {
                "provider": "opensearch",
                "config": {
                    "port": 443,
                    "collection_name": os.environ.get("OPENSEARCH_COLLECTION", "mem0"),
                    "host": os.environ.get("OPENSEARCH_HOST"),
                    "embedding_model_dims": 1024,
                    "connection_class": RequestsHttpConnection,
                    "pool_maxsize": 20,
                    "use_ssl": True,
                    "verify_certs": True,
                },
            }

            # Set up AWS region
            self.region = os.environ.get("AWS_REGION", "us-west-2")
            if not os.environ.get("AWS_REGION"):
                os.environ["AWS_REGION"] = self.region

            # Set up AWS credentials
            session = boto3.Session()
            credentials = session.get_credentials()
            auth = AWSV4SignerAuth(credentials, self.region, "aoss")

            # Prepare configuration
            merged_config = self._merge_config(config)
            merged_config["vector_store"]["config"].update({"http_auth": auth, "host": os.environ["OPENSEARCH_HOST"]})

            return merged_config

    def _append_faiss_config(self, config: Optional[Dict] = None) -> Dict:
        """Update incoming configuration dictionary to include the configuration of FAISS vector backend.


        Args:
            config: Optional configuration dictionary to override defaults.

        Returns:
            An initialized Mem0Memory instance configured for FAISS.

        Raises:
            ImportError: If faiss-cpu package is not installed.
        """
        try:
            import faiss  # noqa: F401
        except ImportError as err:
            raise ImportError(
                "The faiss-cpu package is required for using FAISS as the vector store backend for Mem0."
                "Please install it using: pip install faiss-cpu"
            ) from err

        merged_config = self._merge_config(config)
        merged_config["vector_store"] = {
            "provider": "faiss",
            "config": {
                "embedding_model_dims": 1024,
                "path": "/tmp/mem0_384_faiss",
            },
        }
        return merged_config

    def _append_neptune_analytics_graph_config(self, config: Dict) -> Dict:
        """Update incoming configuration dictionary to include the configuration of Neptune Analytics graph backend.

        Args:
            config: Configuration dictionary to add Neptune Analytics graph backend

        Returns:
            An configuration dict with graph backend.
        """
        config["graph_store"] = {
            "provider": "neptune",
            "config": {"endpoint": f"neptune-graph://{os.environ.get('NEPTUNE_ANALYTICS_GRAPH_IDENTIFIER')}"},
        }
        return config

    def _merge_config(self, config: Optional[Dict] = None) -> Dict:
        """Merge user-provided configuration with default configuration.

        Args:
            config: Optional configuration dictionary to override defaults.

        Returns:
            A merged configuration dictionary.
        """
        merged_config = self.DEFAULT_CONFIG.copy()
        if not config:
            return merged_config

        # Deep merge the configs
        for key, value in config.items():
            if key in merged_config and isinstance(value, dict) and isinstance(merged_config[key], dict):
                merged_config[key].update(value)
            else:
                merged_config[key] = value

        return merged_config

    def store_memory(
        self,
        content: str,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        metadata: Optional[Dict] = None,
    ):
        """Store a memory in Mem0."""
        if not user_id and not agent_id:
            raise ValueError(
                "ERROR: Either user_id or agent_id must be provided for storing memories.\n"
                "USAGE: mem0_memory(action='store', content='...', user_id='alex') OR\n"
                "       mem0_memory(action='store', content='...', agent_id='agent1')\n"
                "NOTE: user_id is for user-specific memories, agent_id is for agent-specific memories"
            )

        messages = [{"role": "user", "content": content}]
        try:
            # Mem0 ALWAYS returns {"results": [...], "relations": [...]} structure
            return self.mem0.add(messages, user_id=user_id, agent_id=agent_id, metadata=metadata)
        except Exception as e:
            logger.error(f"Error storing memory: {e}")
            raise

    def get_memory(self, memory_id: str):
        """Get a memory by ID."""
        try:
            # Mem0 returns a memory dict if found, None if not found
            result = self.mem0.get(memory_id)
            if result is None:
                raise ValueError(f"Memory with ID '{memory_id}' not found")
            return result
        except Exception as e:
            logger.error(f"Error getting memory: {e}")
            raise

    def list_memories(self, user_id: Optional[str] = None, agent_id: Optional[str] = None):
        """List all memories for a user or agent."""
        if not user_id and not agent_id:
            raise ValueError(
                "ERROR: Either user_id or agent_id must be provided for listing memories.\n"
                "USAGE: mem0_memory(action='list', user_id='alex') OR\n"
                "       mem0_memory(action='list', agent_id='agent1')\n"
                "TIP: Use the same ID you used when storing memories"
            )

        try:
            # Mem0 ALWAYS returns {"results": [...], "relations": [...]} structure
            return self.mem0.get_all(user_id=user_id, agent_id=agent_id)
        except Exception as e:
            logger.error(f"Error listing memories: {e}")
            raise

    def search_memories(self, query: str, user_id: Optional[str] = None, agent_id: Optional[str] = None):
        """Search memories using semantic search."""
        if not user_id and not agent_id:
            raise ValueError(
                "ERROR: Either user_id or agent_id must be provided for searching memories.\n"
                "USAGE: mem0_memory(action='retrieve', query='...', user_id='alex') OR\n"
                "       mem0_memory(action='retrieve', query='...', agent_id='agent1')\n"
                "TIP: Use the same ID you used when storing memories"
            )

        try:
            # Mem0 ALWAYS returns {"results": [...], "relations": [...]} structure
            return self.mem0.search(query=query, user_id=user_id, agent_id=agent_id)
        except Exception as e:
            logger.error(f"Error searching memories: {e}")
            raise

    def delete_memory(self, memory_id: str):
        """Delete a memory by ID."""
        try:
            # Mem0 returns {"message": "Memory deleted successfully!"}
            return self.mem0.delete(memory_id)
        except Exception as e:
            logger.error(f"Error deleting memory: {e}")
            raise

    def update_memory(self, memory_id: str, text: Optional[str] = None, metadata: Optional[Dict] = None):
        """Update a memory by ID."""
        try:
            return self.mem0.update(memory_id, text=text, metadata=metadata)
        except Exception as e:
            logger.error(f"Error updating memory: {e}")
            raise

    def get_memory_history(self, memory_id: str):
        """Get the history of a memory by ID."""
        try:
            # Mem0 returns list of history dicts, or empty list [] if no history
            return self.mem0.history(memory_id)
        except Exception as e:
            logger.error(f"Error getting memory history: {e}")
            raise


def format_get_response(memory: Dict) -> Panel:
    """Format get memory response."""
    memory_id = memory.get("id", "unknown")
    content = memory.get("memory", "No content available")
    metadata = memory.get("metadata")
    created_at = memory.get("created_at", "Unknown")
    user_id = memory.get("user_id", "Unknown")

    result = [
        "✅ Memory retrieved successfully:",
        f"🔑 Memory ID: {memory_id}",
        f"👤 User ID: {user_id}",
        f"🕒 Created: {created_at}",
    ]

    if metadata:
        result.append(f"📋 Metadata: {json.dumps(metadata, indent=2)}")

    result.append(f"\n📄 Memory: {content}")

    return Panel("\n".join(result), title="[bold green]Memory Retrieved", border_style="green")


def format_list_response(memories: List[Dict]) -> Panel:
    """Format list memories response."""
    if not memories:
        return Panel("No memories found.", title="[bold yellow]No Memories", border_style="yellow")

    table = Table(title="Memories", show_header=True, header_style="bold magenta")
    table.add_column("ID", style="cyan")
    table.add_column("Memory", style="yellow", width=50)
    table.add_column("Created At", style="blue")
    table.add_column("User ID", style="green")
    table.add_column("Metadata", style="magenta")

    for memory in memories:
        memory_id = memory.get("id", "unknown")
        content = memory.get("memory", "No content available")
        created_at = memory.get("created_at", "Unknown")
        user_id = memory.get("user_id", "Unknown")
        metadata = memory.get("metadata", {})

        # Truncate content if too long
        content_preview = content[:100] + "..." if content and len(content) > 100 else (content or "No content available")

        # Format metadata for display
        metadata_str = json.dumps(metadata, indent=2) if metadata else "None"

        table.add_row(memory_id, content_preview, created_at, user_id, metadata_str)

    return Panel(table, title="[bold green]Memories List", border_style="green")


def format_delete_response(memory_id: str) -> Panel:
    """Format delete memory response."""
    content = [
        "✅ Memory deleted successfully:",
        f"🔑 Memory ID: {memory_id}",
    ]
    return Panel("\n".join(content), title="[bold green]Memory Deleted", border_style="green")


def format_retrieve_response(memories: List[Dict]) -> Panel:
    """Format retrieve response."""
    if not memories:
        return Panel("No memories found matching the query.", title="[bold yellow]No Matches", border_style="yellow")

    table = Table(title="Search Results", show_header=True, header_style="bold magenta")
    table.add_column("ID", style="cyan")
    table.add_column("Memory", style="yellow", width=50)
    table.add_column("Relevance", style="green")
    table.add_column("Created At", style="blue")
    table.add_column("User ID", style="magenta")
    table.add_column("Metadata", style="white")

    for memory in memories:
        memory_id = memory.get("id", "unknown")
        content = memory.get("memory", "No content available")
        score = memory.get("score", 0)
        created_at = memory.get("created_at", "Unknown")
        user_id = memory.get("user_id", "Unknown")
        metadata = memory.get("metadata", {})

        # Truncate content if too long
        content_preview = content[:100] + "..." if content and len(content) > 100 else (content or "No content available")

        # Format metadata for display
        metadata_str = json.dumps(metadata, indent=2) if metadata else "None"

        # Color code the relevance score
        if score > 0.8:
            score_color = "green"
        elif score > 0.5:
            score_color = "yellow"
        else:
            score_color = "red"

        table.add_row(
            memory_id, content_preview, f"[{score_color}]{score}[/{score_color}]", created_at, user_id, metadata_str
        )

    return Panel(table, title="[bold green]Search Results", border_style="green")


def format_retrieve_graph_response(memories: List[Dict]) -> Panel:
    """Format retrieve response for graph data"""
    if not memories:
        return Panel(
            "No graph memories found matching the query.", title="[bold yellow]No Matches", border_style="yellow"
        )

    table = Table(title="Search Results", show_header=True, header_style="bold magenta")
    table.add_column("Source", style="cyan", width=25)
    table.add_column("Relationship", style="yellow", width=45)
    table.add_column("Destination", style="green", width=30)

    for memory in memories:
        source = memory.get("source", "N/A")
        relationship = memory.get("relationship", "N/A")
        destination = memory.get("destination", "N/A")

        table.add_row(source, relationship, destination)

    return Panel(table, title="[bold green]Search Results (Graph)", border_style="green")


def format_list_graph_response(memories: List[Dict]) -> Panel:
    """Format list response for graph data"""
    if not memories:
        return Panel("No graph memories found.", title="[bold yellow]No Memories", border_style="yellow")

    table = Table(title="Graph Memories", show_header=True, header_style="bold magenta")
    table.add_column("Source", style="cyan", width=25)
    table.add_column("Relationship", style="yellow", width=45)
    table.add_column("Target", style="green", width=30)

    for memory in memories:
        source = memory.get("source", "N/A")
        relationship = memory.get("relationship", "N/A")
        destination = memory.get("target", "N/A")

        table.add_row(source, relationship, destination)

    return Panel(table, title="[bold green]Memories List (Graph)", border_style="green")


def format_history_response(history: List[Dict]) -> Panel:
    """Format memory history response."""
    if not history:
        return Panel("No history found for this memory.", title="[bold yellow]No History", border_style="yellow")

    table = Table(title="Memory History", show_header=True, header_style="bold magenta")
    table.add_column("ID", style="cyan")
    table.add_column("Memory ID", style="green")
    table.add_column("Event", style="yellow")
    table.add_column("Old Memory", style="blue", width=30)
    table.add_column("New Memory", style="blue", width=30)
    table.add_column("Created At", style="magenta")

    for entry in history:
        entry_id = entry.get("id", "unknown")
        memory_id = entry.get("memory_id", "unknown")
        event = entry.get("event", "UNKNOWN")
        old_memory = entry.get("old_memory", "None")
        new_memory = entry.get("new_memory", "None")
        created_at = entry.get("created_at", "Unknown")

        # Truncate memory content if too long
        old_memory_preview = old_memory[:100] + "..." if old_memory and len(old_memory) > 100 else (old_memory or "None")
        new_memory_preview = new_memory[:100] + "..." if new_memory and len(new_memory) > 100 else (new_memory or "None")

        table.add_row(entry_id, memory_id, event, old_memory_preview, new_memory_preview, created_at)

    return Panel(table, title="[bold green]Memory History", border_style="green")


def format_store_response(results: List[Dict]) -> Panel:
    """Format store memory response."""
    if not results:
        return Panel("No memories stored.", title="[bold yellow]No Memories Stored", border_style="yellow")

    table = Table(title="Memory Stored", show_header=True, header_style="bold magenta")
    table.add_column("Operation", style="green")
    table.add_column("Content", style="yellow", width=50)

    for memory in results:
        event = memory.get("event")
        text = memory.get("memory")
        # Truncate content if too long
        content_preview = text[:100] + "..." if text and len(text) > 100 else (text or "No content")
        table.add_row(event, content_preview)

    return Panel(table, title="[bold green]Memory Stored", border_style="green")


def format_store_graph_response(memories: List[Dict]) -> Panel:
    """Format store response for graph data"""
    if not memories:
        return Panel("No graph memories stored.", title="[bold yellow]No Memories Stored", border_style="yellow")

    table = Table(title="Graph Memories Stored", show_header=True, header_style="bold magenta")
    table.add_column("Source", style="cyan", width=25)
    table.add_column("Relationship", style="yellow", width=45)
    table.add_column("Target", style="green", width=30)

    for memory in memories:
        # Handle both nested list format and direct dict format
        if isinstance(memory, list) and len(memory) > 0:
            # Nested list format: [[{source, relationship, target}]]
            item = memory[0] if isinstance(memory[0], dict) else memory
            source = item.get("source", "N/A")
            relationship = item.get("relationship", "N/A")
            destination = item.get("target", "N/A")
        elif isinstance(memory, dict):
            # Direct dict format: {source, relationship, target}
            source = memory.get("source", "N/A")
            relationship = memory.get("relationship", "N/A")
            destination = memory.get("target", memory.get("destination", "N/A"))
        else:
            # Skip invalid formats
            continue

        table.add_row(source, relationship, destination)

    return Panel(table, title="[bold green]Memories Stored (Graph)", border_style="green")


@tool
def mem0_memory(
    action: str,
    content: Optional[str] = None,
    memory_id: Optional[str] = None,
    query: Optional[str] = None,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    metadata: Optional[Dict] = None,
) -> Dict:
    """Memory management tool for storing, retrieving, and managing memories in Mem0.

    This tool provides a comprehensive interface for managing memories with Mem0,
    including storing new memories, retrieving existing ones, listing all memories,
    performing semantic searches, and managing memory history.

    CRITICAL: HOW TO DETERMINE user_id AND agent_id
    ------------------------------------------------
    user_id: The ACTUAL USER'S identifier from your application context
        - Use the logged-in user's username, email, or database ID
        - Examples: "tim_hunter", "user@example.com", "user_12345"
        - MUST be consistent across all sessions for the same user
        - Use this to store memories ABOUT the user or FROM the user

    agent_id: The AGENT'S OWN consistent identifier
        - Use your agent's name or identifier (e.g., "ron", "assistant", "travel_planner")
        - MUST be the same value every time this agent runs
        - Use this to store the agent's own knowledge or context

    REQUIRED: Always provide BOTH user_id AND agent_id on every call.
    This scopes memories to the correct user while keeping all agent types
    (SuperAgent, Search Agent, Task Agent) unified under the same agent identity.

    IMPORTANT ID REQUIREMENTS:
    - store, list, retrieve actions: MUST provide both user_id AND agent_id
    - get, delete, history actions: MUST provide memory_id
    - IDs are arbitrary strings but MUST be consistent across sessions

    COMMON USAGE PATTERNS:
    1. Store user preference: action='store', content='User prefers dark mode', agent_id='ron', user_id='<actual_user_id>'
    2. Store agent learning: action='store', content='User asked about Python', agent_id='ron', user_id='<actual_user_id>'
    3. List memories: action='list', agent_id='ron', user_id='<actual_user_id>'
    4. Search memories: action='retrieve', query='previous interactions', agent_id='ron', user_id='<actual_user_id>'
    5. Delete specific memory: action='delete', memory_id='mem_123'

    Args:
        action: The action to perform (store, get, list, retrieve, delete, history)
        content: Content to store (required for store action)
        memory_id: Memory ID from a previous list/retrieve operation (required for get, delete, history)
        query: Semantic search query to find relevant memories (required for retrieve action)
        user_id: The actual user's identifier from application context (username, email, user DB ID)
        agent_id: This agent's consistent identifier (e.g., "ron", "assistant", your agent name)
        metadata: Optional metadata dict to attach to the memory (e.g., {"category": "preferences"})

    Returns:
        Dictionary containing status and response content
    """
    try:
        # Validate required parameters
        if not action:
            raise ValueError("action parameter is required")

        # Initialize client
        client = Mem0ServiceClient()

        # Check if we're in development mode
        strands_dev = os.environ.get("BYPASS_TOOL_CONSENT", "").lower() == "true"

        # For mutative operations, show confirmation dialog unless in BYPASS_TOOL_CONSENT mode
        mutative_actions = {"store", "delete"}
        needs_confirmation = action in mutative_actions and not strands_dev

        if needs_confirmation:
            if action == "store":
                # Validate content
                if not content:
                    raise ValueError("content is required for store action")

                # Preview what will be stored
                content_preview = (
                    content[:15000] + "..."
                    if content and len(content) > 15000
                    else content
                )
                preview_title = (
                    f"Memory for {'user ' + user_id}"
                    if user_id
                    else f"agent {agent_id}"
                )

                console.print(Panel(content_preview, title=f"[bold green]{preview_title}", border_style="green"))

            elif action == "delete":
                # Validate memory_id
                if not memory_id:
                    raise ValueError("memory_id is required for delete action")

                # Try to get memory info first for better context
                try:
                    memory = client.get_memory(memory_id)
                    memory_metadata = memory.get("metadata", {})

                    console.print(
                        Panel(
                            (
                                f"Memory ID: {memory_id}\n"
                                f"Metadata: {json.dumps(memory_metadata) if memory_metadata else 'None'}"
                            ),
                            title="[bold red]⚠️ Memory to be permanently deleted",
                            border_style="red",
                        )
                    )
                except Exception:
                    # Fall back to basic info if we can't get memory details
                    console.print(
                        Panel(
                            f"Memory ID: {memory_id}",
                            title="[bold red]⚠️ Memory to be permanently deleted",
                            border_style="red",
                        )
                    )

        # Execute the requested action
        if action == "store":
            if not content:
                raise ValueError(
                    "ERROR: 'store' action requires 'content' parameter.\n"
                    "USAGE: mem0_memory(action='store', content='Text to remember', user_id='alex')"
                )

            results = client.store_memory(
                content,
                user_id,
                agent_id,
                metadata,
            )

            # Mem0 ALWAYS returns {"results": [...], "relations": [...]} structure
            results_list = results.get("results", [])

            if results_list:
                panel = format_store_response(results_list)
                console.print(panel)

            # Process graph relations if present (relations is a list, not dict)
            relations = results.get("relations", [])
            if relations:
                panel_graph = format_store_graph_response(relations)
                console.print(panel_graph)

            return {
                "status": "success",
                "content": [{"text": json.dumps(results_list, indent=2)}],
            }

        elif action == "get":
            if not memory_id:
                raise ValueError(
                    "ERROR: 'get' action requires 'memory_id' parameter.\n"
                    "USAGE: mem0_memory(action='get', memory_id='mem_123')\n"
                    "TIP: Use 'list' action first to find memory IDs"
                )

            memory = client.get_memory(memory_id)
            panel = format_get_response(memory)
            console.print(panel)
            return {
                "status": "success",
                "content": [{"text": json.dumps(memory, indent=2)}],
            }

        elif action == "list":
            memories = client.list_memories(user_id, agent_id)
            # Mem0 ALWAYS returns {"results": [...], "relations": [...]} structure
            results_list = memories.get("results", [])

            panel = format_list_response(results_list)
            console.print(panel)

            # Process graph relations if present (relations is a list, not dict)
            relations = memories.get("relations", [])
            if relations:
                panel_graph = format_list_graph_response(relations)
                console.print(panel_graph)

            return {
                "status": "success",
                "content": [{"text": json.dumps(results_list, indent=2)}],
            }

        elif action == "retrieve":
            if not query:
                raise ValueError(
                    "ERROR: 'retrieve' action requires 'query' parameter.\n"
                    "USAGE: mem0_memory(action='retrieve', query='search text', user_id='alex')"
                )

            memories = client.search_memories(
                query,
                user_id,
                agent_id,
            )
            # Mem0 ALWAYS returns {"results": [...], "relations": [...]} structure
            results_list = memories.get("results", [])

            panel = format_retrieve_response(results_list)
            console.print(panel)

            # Process graph relations if present (relations is a list, not dict)
            relations = memories.get("relations", [])
            if relations:
                panel_graph = format_retrieve_graph_response(relations)
                console.print(panel_graph)

            return {
                "status": "success",
                "content": [{"text": json.dumps(results_list, indent=2)}],
            }

        elif action == "delete":
            if not memory_id:
                raise ValueError(
                    "ERROR: 'delete' action requires 'memory_id' parameter.\n"
                    "USAGE: mem0_memory(action='delete', memory_id='mem_123')\n"
                    "TIP: Use 'list' action first to find memory IDs"
                )

            client.delete_memory(memory_id)
            panel = format_delete_response(memory_id)
            console.print(panel)
            return {
                "status": "success",
                "content": [{"text": f"Memory {memory_id} deleted successfully"}],
            }

        elif action == "update":
            if not memory_id:
                raise ValueError(
                    "ERROR: 'update' action requires 'memory_id' parameter.\n"
                    "USAGE: mem0_memory(action='update', memory_id='mem_123', content='New text')\n"
                    "TIP: Use 'list' action first to find memory IDs"
                )
            if not content and not metadata:
                raise ValueError(
                    "ERROR: 'update' action requires 'content' or 'metadata' parameter.\n"
                    "USAGE: mem0_memory(action='update', memory_id='mem_123', content='New text')"
                )

            result = client.update_memory(memory_id, text=content, metadata=metadata)
            console.print(Panel(f"✅ Memory {memory_id} updated successfully", title="[bold green]Memory Updated", border_style="green"))
            return {
                "status": "success",
                "content": [{"text": json.dumps(result, indent=2)}],
            }

        elif action == "history":
            if not memory_id:
                raise ValueError(
                    "ERROR: 'history' action requires 'memory_id' parameter.\n"
                    "USAGE: mem0_memory(action='history', memory_id='mem_123')\n"
                    "TIP: Use 'list' action first to find memory IDs"
                )

            history = client.get_memory_history(memory_id)
            panel = format_history_response(history)
            console.print(panel)
            return {
                "status": "success",
                "content": [{"text": json.dumps(history, indent=2)}],
            }

        else:
            raise ValueError(f"Invalid action: {action}")

    except Exception as e:
        error_panel = Panel(
            Text(str(e), style="red"),
            title="❌ Memory Operation Error",
            border_style="red",
        )
        console.print(error_panel)
        return {
            "status": "error",
            "content": [{"text": f"Error: {str(e)}"}],
        }
