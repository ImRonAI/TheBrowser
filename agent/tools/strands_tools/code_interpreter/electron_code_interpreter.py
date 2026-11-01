from typing import Any, Optional

from .local_code_interpreter import LocalCodeInterpreter


class ElectronCodeInterpreter(LocalCodeInterpreter):
    """Local code interpreter for the Ron Electron runtime (delegates to LocalCodeInterpreter)."""

    def __init__(self, browser: Optional[Any] = None, **kwargs: Any):
        super().__init__(**kwargs)
        self.browser_tool = browser

