"""Emit JSX Tool - Render interactive React components in the UI

This tool allows the agent to emit JSX strings that will be rendered
inline in the chat using the JSXPreview component. The JSX can use
any components from the registered library (Catalyst UI, shadcn/ui,
Recharts, React Flow, KaTeX, React Three Fiber, etc.).

Usage:
    agent.tool.emit_jsx(
        jsx='<Card><CardHeader><CardTitle>Hello</CardTitle></CardHeader></Card>',
        title="Greeting Card"
    )
"""

from typing import Dict, Any, Optional
from strands import tool


@tool
def emit_jsx(
    jsx: str,
    title: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Render interactive React components inline in the chat.

    The JSX string is rendered using JSXPreview with access to a large
    component library including shadcn/ui, Catalyst UI, Recharts, 
    React Flow, KaTeX math rendering, and React Three Fiber 3D.

    Available component families (use exact names):
    - shadcn/ui: Button, Card, CardHeader, CardTitle, CardContent, Badge, 
      Tabs, TabsList, TabsTrigger, TabsContent, Input, Select, Dialog, etc.
    - Recharts: LineChart, BarChart, PieChart, AreaChart, XAxis, YAxis, 
      CartesianGrid, RechartsTooltip, RechartsLine, RechartsBar, 
      RechartsPie, RechartsArea, ResponsiveContainer, Cell, etc.
    - React Flow: ReactFlow, ReactFlowProvider, Background, Handle, etc.
    - KaTeX: InlineMath (math="E=mc^2"), BlockMath (math="\\int_0^1 x dx")
    - R3F: Canvas, OrbitControls, DreiBox, Sphere, DreiText, Environment
    - DnD: DragDropContext, Droppable, Draggable

    Use onAction(name, data) in bindings for user interaction callbacks.
    Example: onClick={() => onAction('submit', { value: 42 })}

    Args:
        jsx: The JSX string to render. Must be valid JSX using available components.
        title: Optional title displayed above the preview.
        description: Optional description text.

    Returns:
        Dict with __ui_data__ marker that triggers JSXPreview component in UI.
    """
    jsx_data: Dict[str, Any] = {
        "jsx": jsx,
    }

    if title:
        jsx_data["title"] = title

    if description:
        jsx_data["description"] = description

    # Return with __ui_data__ marker - callback handler will detect and emit data-part
    return {
        "status": "success",
        "content": [{"text": f"JSX component rendered{': ' + title if title else ''}"}],
        "__ui_data__": {
            "type": "jsx",
            "data": jsx_data,
        },
    }
