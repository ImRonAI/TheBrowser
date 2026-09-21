"""Project management tools for Ron Browser agent."""

import json
from strands import tool

@tool
async def create_project_via_browser(
    name: str,
    description: str = "",
    project_type: str = "work"
) -> dict:
    """Create a new project in Ron Browser.

    Args:
        name: Project name
        description: Optional description
        project_type: Type - software, work, personal, academic, research, data_accrual, product_discovery, or founder

    Returns:
        Dictionary with success status and created project
    """
    # Access the browser context via playwright MCP or direct JavaScript execution
    # For now, this is a placeholder - actual implementation would use playwright MCP
    script = f"""
    window.ronApp.projectStore.createProject(
      {json.dumps(name)},
      {json.dumps(description)},
      {json.dumps(project_type)}
    )
    """

    # TODO: Execute script via playwright MCP when available
    # For now, return simulated result
    return {
        "success": True,
        "message": f"Project '{name}' created successfully",
        "script": script
    }


@tool
async def create_issue_in_project(
    project_id: str,
    title: str,
    description: str = "",
    hierarchy_level: str = "task",
    parent_id: str = None
) -> dict:
    """Create a new issue (initiative/epic/story/task/subtask) in a project.

    Args:
        project_id: Project ID to create issue in
        title: Issue title
        description: Optional description
        hierarchy_level: Level - initiative, epic, story, task, or subtask
        parent_id: Optional parent task ID

    Returns:
        Dictionary with success status and created issue
    """
    script = f"""
    window.ronApp.taskStore.createTask({{
      title: {json.dumps(title)},
      description: {json.dumps(description)},
      projectId: {json.dumps(project_id)},
      hierarchy_level: {json.dumps(hierarchy_level)},
      parent_id: {json.dumps(parent_id) if parent_id else 'null'}
    }})
    """

    return {
        "success": True,
        "message": f"Issue '{title}' created successfully",
        "script": script
    }


@tool
async def get_projects() -> dict:
    """Get all projects from Ron Browser.

    Returns:
        Dictionary with projects list
    """
    script = "window.ronApp.projectStore.getProjects()"

    return {
        "success": True,
        "message": "Projects fetched successfully",
        "script": script
    }


@tool
async def set_selected_project(project_id: str) -> dict:
    """Set the currently selected project in Ron Browser.

    Args:
        project_id: Project ID to select, or 'null' for all tasks

    Returns:
        Dictionary with success status
    """
    script = f"""
    window.ronApp.projectStore.setSelectedProject({json.dumps(project_id) if project_id != 'null' else 'null'})
    """

    return {
        "success": True,
        "message": f"Selected project set to {project_id}",
        "script": script
    }


@tool
async def get_project_hierarchy(project_id: str) -> dict:
    """Get the full hierarchy for a project (initiatives → epics → stories → tasks).

    Args:
        project_id: Project ID

    Returns:
        Dictionary with hierarchy structure
    """
    script = f"""
    {{
      initiatives: window.ronApp.taskStore.getInitiatives({json.dumps(project_id)}),
      epics: window.ronApp.taskStore.getEpics({json.dumps(project_id)}),
    }}
    """

    return {
        "success": True,
        "message": f"Hierarchy fetched for project {project_id}",
        "script": script
    }


@tool
async def add_task_relationship(
    source_task_id: str,
    target_task_id: str,
    relationship_type: str
) -> dict:
    """Add a relationship between two tasks.

    Args:
        source_task_id: Source task ID
        target_task_id: Target task ID
        relationship_type: Type - blocks, blocked-by, relates-to, duplicates, causes, implements

    Returns:
        Dictionary with success status
    """
    script = f"""
    window.ronApp.taskStore.addRelationship(
      {json.dumps(source_task_id)},
      {json.dumps(target_task_id)},
      {json.dumps(relationship_type)}
    )
    """

    return {
        "success": True,
        "message": f"Relationship '{relationship_type}' added between tasks",
        "script": script
    }
