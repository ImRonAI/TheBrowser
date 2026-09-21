"""Task Tools for Agent-UI Integration

Provides tools for the agent to create, update, search, and manage tasks
in the Ron Browser Kanban board via the browser IPC bridge.
"""

import json
import logging
import time
import asyncio
from typing import Dict, Any, List, Optional
from strands import tool
from strands_tools.browser import LocalChromiumBrowser
from strands_tools.browser.models import InitSessionAction

logger = logging.getLogger(__name__)


class TaskTools:
    """Task management tools that bridge agent actions to the frontend task store."""
    
    def __init__(self, browser: LocalChromiumBrowser):
        self.browser = browser

    @tool
    async def create_task(
        self,
        title: str,
        description: str = "",
        priority: str = "medium",
        status: str = "backlog",
        parent_task_id: Optional[str] = None,
        subtasks: List[Dict[str, Any]] = None,
        assignee_ids: List[str] = None,
        labels: List[str] = None,
        due_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a new task on the Kanban board.
        
        Args:
            title: Title of the task
            description: HTML content (e.g. <p>, <ul>, <b>). Do NOT use Markdown.
            priority: 'low', 'medium', 'high', 'critical'
            status: 'backlog', 'in-progress', 'review', 'done'
            parent_task_id: ID of parent task (for subtasks)
            subtasks: List of subtasks [{title, completed}]
            assignee_ids: IDs of users to assign (e.g. ['agent', 'user'])
            labels: List of label text
            due_date: ISO date string (YYYY-MM-DD)
            
        Returns:
            Dict with status and created task data. IMPORTANT: Save the returned 'id' to update this task later.
        """
        # Convert date string to timestamp (ms) if provided
        due_date_ts = None
        if due_date:
            try:
                # Basic ISO parsing
                import datetime
                dt = datetime.datetime.fromisoformat(due_date.replace('Z', '+00:00'))
                due_date_ts = int(dt.timestamp() * 1000)
            except Exception as e:
                logger.warning(f"Failed to parse due date {due_date}: {e}")

        task_data = {
            "title": title,
            "description": description,
            "priority": priority,
            "status": status,
            "parentTaskId": parent_task_id,
            "subtasks": subtasks or [],
            "assigneeIds": assignee_ids or [],
            "labels": labels or [],
            "dueDate": due_date_ts
        }
        
        # Automatic Session Linking (User Request: "Caused By Conversation Session ID")
        try:
            # Lazy import to avoid circular dependency
            import sys
            sa = None
            if "superagent" in sys.modules:
                import superagent as sa
            elif "agent.superagent" in sys.modules:
                import agent.superagent as sa
                
            if sa:
                # Access the current agent session through the singleton
                if hasattr(sa, "_current_agent") and sa._current_agent:
                    # Check if session manager has id
                    session_id = getattr(sa._current_agent.session_manager, "session_id", None)
                    if session_id and not session_id.startswith("ron-superagent"): 
                         # 1. Link via externalRefId
                        task_data["externalRefId"] = session_id
                        task_data["sourceChannel"] = "ai-generated"
                        
                        # 2. Link via Context Links (Deep link to chat)
                        task_data["contextLinks"] = [{
                            "id": f"ctx-{int(time.time()*1000)}",
                            "url": f"ron://chat/{session_id}",
                            "title": "Originating Conversation",
                            "type": "reference",
                            "addedBy": "agent"
                        }]
                        logger.info(f"Auto-linked task to session: {session_id}")
        except Exception as e:
            logger.warning(f"Failed to auto-link task to session: {e}")
        
        script = f"""
            (function() {{
                if (window.ronApp && window.ronApp.taskStore) {{
                    return window.ronApp.taskStore.createTask({json.dumps(task_data)});
                }}
                return {{ error: 'Task store not available' }};
            }})()
        """
        
        result = await self._execute_on_shell(script)
        # Check if _execute_on_shell returned an error
        if isinstance(result, dict) and result.get("error"):
            return {"status": "error", **result}
        return {"status": "success", "task": result}

    @tool
    async def update_task(
        self,
        task_id: str,
        updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Update an existing task.
        
        Args:
            task_id: REQUIRED. The ID of the task to update (returned from create_task or search_tasks).
            updates: Dictionary of fields to update (title, description, status, priority, due_date, assignee_ids, etc.)
            
        Returns:
            Dict with status and message
        """
        # Sanitize updates
        sanitized_updates = {**updates}
        
        # Handle date fields in updates
        date_fields = ["due_date", "start_date", "sla_deadline", "dueDate", "startDate", "slaDeadline"]
        for field in date_fields:
            if field in sanitized_updates and isinstance(sanitized_updates[field], str):
                try:
                    import datetime
                    dt = datetime.datetime.fromisoformat(sanitized_updates[field].replace('Z', '+00:00'))
                    # Convert to camelCase key for JS store if needed, or rely on store normalizer
                    # Ideally we send camelCase to match store expectations if we can, but store now handles snake_case too
                    ts = int(dt.timestamp() * 1000)
                    sanitized_updates[field] = ts
                except Exception as e:
                    logger.warning(f"Failed to parse date field {field}: {e}")
                    # If parse fails, leave as string, store normalizer might handle it or it will be ignored

        script = f"""
            (function() {{
                if (window.ronApp && window.ronApp.taskStore) {{
                    return window.ronApp.taskStore.updateTask('{task_id}', {json.dumps(sanitized_updates)});
                }}
                return {{ error: 'Task store not available' }};
            }})()
        """
        result = await self._execute_on_shell(script)
        # Check if _execute_on_shell returned an error
        if isinstance(result, dict) and result.get("error"):
            return {"status": "error", **result}
        return {"status": "success", "message": f"Task {task_id} updated"}

    @tool
    async def get_task(
        self,
        task_id: str
    ) -> Dict[str, Any]:
        """
        Get a single task by ID.
        
        Args:
            task_id: ID of the task to retrieve
            
        Returns:
            Dict with task data or error
        """
        script = f"""
            (function() {{
                if (window.ronApp && window.ronApp.taskStore) {{
                    const tasks = window.ronApp.taskStore.getState().tasks;
                    return tasks.find(t => t.id === '{task_id}') || {{ error: 'Task not found' }};
                }}
                return {{ error: 'Task store not available' }};
            }})()
        """
        result = await self._execute_on_shell(script)
        # Check if _execute_on_shell returned an error
        if isinstance(result, dict) and result.get("error"):
            return {"status": "error", **result}
        return {"status": "success", "task": result}

    @tool
    async def search_tasks(
        self,
        query: Optional[str] = None,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        labels: Optional[List[str]] = None,
        limit: int = 10
    ) -> Dict[str, Any]:
        """
        Search for tasks by various criteria.
        
        Args:
            query: Text to search in title and description
            status: Filter by status ('backlog', 'in-progress', 'review', 'done')
            priority: Filter by priority ('low', 'medium', 'high')
            labels: Filter by labels (task must have ALL specified labels)
            limit: Maximum number of results (default 10)
            
        Returns:
            Dict with list of matching tasks. **Each task includes an 'id' field which is REQUIRED for update_task.**
        """
        filters = {
            "query": query,
            "status": status,
            "priority": priority,
            "labels": labels or [],
            "limit": limit
        }
        
        script = f"""
            (function() {{
                if (!window.ronApp || !window.ronApp.taskStore) {{
                    return {{ error: 'Task store not available' }};
                }}
                
                const filters = {json.dumps(filters)};
                let tasks = window.ronApp.taskStore.getState().tasks || [];
                
                // Apply query filter
                if (filters.query) {{
                    const q = filters.query.toLowerCase();
                    tasks = tasks.filter(t => 
                        t.title.toLowerCase().includes(q) || 
                        (t.description && t.description.toLowerCase().includes(q))
                    );
                }}
                
                // Apply status filter
                if (filters.status) {{
                    tasks = tasks.filter(t => t.status === filters.status);
                }}
                
                // Apply priority filter
                if (filters.priority) {{
                    tasks = tasks.filter(t => t.priority === filters.priority);
                }}
                
                // Apply labels filter
                if (filters.labels && filters.labels.length > 0) {{
                    tasks = tasks.filter(t => 
                        filters.labels.every(label => 
                            t.labels && t.labels.some(l => l.label === label)
                        )
                    );
                }}
                
                // Return limited results with key fields
                return tasks.slice(0, filters.limit).map(t => ({{
                    id: t.id,
                    title: t.title,
                    status: t.status,
                    priority: t.priority,
                    labels: t.labels ? t.labels.map(l => l.label) : [],
                    subtaskCount: t.subtasks ? t.subtasks.length : 0,
                    hasDescription: !!t.description
                }}));
            }})()
        """
        result = await self._execute_on_shell(script)
        # Check if _execute_on_shell returned an error
        if isinstance(result, dict) and result.get("error"):
            return {"status": "error", **result}
        return {"status": "success", "tasks": result, "count": len(result) if isinstance(result, list) else 0}

    @tool
    async def add_relationship(
        self,
        task_id: str,
        related_task_id: str,
        relationship_type: str = "related-to"
    ) -> Dict[str, Any]:
        """
        Add a relationship between two tasks.
        
        Args:
            task_id: ID of the source task
            related_task_id: ID of the related task
            relationship_type: Type of relationship ('blocks', 'blocked-by', 'related-to', 'duplicates')
            
        Returns:
            Dict with status and message
        """
        relationship = {
            "id": f"rel-{int(time.time() * 1000)}",
            "targetTaskId": related_task_id,
            "type": relationship_type,
            "createdAt": int(time.time() * 1000)
        }
        
        script = f"""
            (function() {{
                if (!window.ronApp || !window.ronApp.taskStore) {{
                    return {{ error: 'Task store not available' }};
                }}
                
                const state = window.ronApp.taskStore.getState();
                const task = state.tasks.find(t => t.id === '{task_id}');
                
                if (!task) {{
                    return {{ error: 'Task not found' }};
                }}
                
                const relationships = task.relationships || [];
                relationships.push({json.dumps(relationship)});
                
                return window.ronApp.taskStore.updateTask('{task_id}', {{ relationships }});
            }})()
        """
        result = await self._execute_on_shell(script)
        # Check if _execute_on_shell returned an error
        if isinstance(result, dict) and result.get("error"):
            return {"status": "error", **result}
        return {"status": "success", "message": f"Relationship added: {task_id} -> {related_task_id} ({relationship_type})"}

    @tool
    async def add_file_reference(
        self,
        task_id: str,
        file_path: str,
        file_type: str = "code"
    ) -> Dict[str, Any]:
        """
        Register a file created/modified for a task.
        
        Args:
            task_id: ID of the task
            file_path: Absolute path to the file
            file_type: Type of file ('code', 'document', 'image', 'data')
            
        Returns:
            Dict with status and message
        """
        file_ref = {
            "id": f"ref-{int(time.time() * 1000)}",
            "path": file_path,
            "name": file_path.split("/")[-1],
            "type": file_type,
            "createdBy": "agent",
            "createdAt": int(time.time() * 1000)
        }
        
        script = f"""
            (function() {{
                if (!window.ronApp || !window.ronApp.taskStore) {{
                    return {{ error: 'Task store not available' }};
                }}
                
                const state = window.ronApp.taskStore.getState();
                const task = state.tasks.find(t => t.id === '{task_id}');
                
                if (!task) {{
                    return {{ error: 'Task not found' }};
                }}
                
                const fileReferences = task.fileReferences || [];
                fileReferences.push({json.dumps(file_ref)});
                
                return window.ronApp.taskStore.updateTask('{task_id}', {{ fileReferences }});
            }})()
        """
        result = await self._execute_on_shell(script)
        # Check if _execute_on_shell returned an error
        if isinstance(result, dict) and result.get("error"):
            return {"status": "error", **result}
        return {"status": "success", "message": f"File reference added: {file_path}"}
        
    async def _execute_on_shell(self, script: str) -> Any:
        """Execute JavaScript on the main Electron shell window.
        
        Returns the result of the script execution, or an error dict if the
        shell page is not available. Never throws - allows graceful degradation.
        """
        # Ensure we have at least one session (which triggers CDP connection)
        if hasattr(self.browser, '_sessions') and not self.browser._sessions:
            logger.info("No active browser sessions - initializing system connection...")
            try:
                # Initialize a system session to force connection to the Electron app
                await self.browser.init_session(InitSessionAction(
                    type="init_session",
                    session_name="system-task-connection", 
                    description="System Task Connection"
                ))
            except Exception as e:
                 logger.warning(f"Failed to auto-connect to system: {e}")

        # Try dedicated shell page method first
        if hasattr(self.browser, '_get_shell_page'):
            try:
                page = await self.browser._get_shell_page()
                if page:
                    try:
                        return await asyncio.wait_for(page.evaluate(script), timeout=5.0)
                    except asyncio.TimeoutError:
                        return {"error": "shell_eval_timeout", "message": "Timed out executing task operation on shell page."}
            except Exception as e:
                logger.warning(f"Failed to execute on shell page: {e}")
        
        # Fallback: search all pages for ronApp
        if hasattr(self.browser, '_sessions'):
            for session in self.browser._sessions.values():
                if session.context:
                    for page in session.context.pages:
                        try:
                            has_app = await asyncio.wait_for(
                                page.evaluate("!!window.ronApp"),
                                timeout=2.0
                            )
                            if has_app:
                                try:
                                    return await asyncio.wait_for(page.evaluate(script), timeout=5.0)
                                except asyncio.TimeoutError:
                                    return {"error": "shell_eval_timeout", "message": "Timed out executing task operation on page."}
                        except Exception:
                            continue
        
        # Return error dict instead of throwing - allows graceful degradation
        logger.warning("Task store not connected - browser shell page not found")
        return {"error": "task_store_unavailable", "message": "Task operations are currently unavailable. The task store will reconnect automatically."}
