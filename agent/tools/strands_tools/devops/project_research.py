from anthropic import Anthropic
import json
import os

def research_project(
    project_type: str,
    name: str,
    description: str,
    context_info: str = ""
) -> dict:
    """
    Research a project and generate comprehensive breakdown with initiatives, epics, and stories.

    Args:
        project_type: Type of project (software, academic, research, etc.)
        name: Project name
        description: Project description
        context_info: Additional context and requirements

    Returns:
        dict with keys: plan (str), initiatives (list), epics (list), stories (list)
    """

    # Load SOP based on project type
    sop_file_map = {
        "software": "software-project-discovery.sop.md",
        "academic": "academic-project-discovery.sop.md",
        "research": "research-project-discovery.sop.md",
        "data_accrual": "data-pipeline-discovery.sop.md",
        "product_discovery": "product-discovery-project.sop.md",
        "founder": "founder-project-discovery.sop.md",
        "work": "general-work-project.sop.md",
        "personal": "personal-goals-project.sop.md",
    }

    sop_file = sop_file_map.get(project_type, "general-work-project.sop.md")
    sop_path = os.path.join(os.path.dirname(__file__), "../sops", sop_file)

    # Load SOP content
    try:
        with open(sop_path, 'r') as f:
            sop_content = f.read()
    except FileNotFoundError:
        # Fallback SOP
        sop_content = """
# Project Discovery SOP

Analyze the project and create a breakdown:
1. Identify 2-4 major initiatives (phases)
2. For each initiative, create 2-6 epics (major features)
3. For each epic, create 3-10 stories (user stories)
"""

    # Create prompt for Claude
    client = Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))

    prompt = f"""You are a project planning expert following a structured SOP.

{sop_content}

Project Details:
- Type: {project_type}
- Name: {name}
- Description: {description}
- Additional Context: {context_info}

Generate a comprehensive project breakdown following the SOP. Return a JSON object with this structure:
{{
  "plan": "# Research Plan\\n\\nDetailed markdown research findings...",
  "initiatives": [
    {{"id": "init-1", "title": "...", "description": "..."}}
  ],
  "epics": [
    {{"id": "epic-1", "parentId": "init-1", "title": "...", "description": "..."}}
  ],
  "stories": [
    {{"id": "story-1", "parentId": "epic-1", "title": "...", "description": "As a [user], I want [goal]..."}}
  ]
}}"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )

    # Parse response
    result_text = response.content[0].text

    # Extract JSON from response (may be wrapped in ```json blocks)
    if "```json" in result_text:
        json_start = result_text.find("```json") + 7
        json_end = result_text.find("```", json_start)
        result_text = result_text[json_start:json_end].strip()

    result = json.loads(result_text)

    return result
