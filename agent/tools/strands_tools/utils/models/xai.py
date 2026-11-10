"""Independent xAI model instances for graph nodes.

Graph nodes must not share the parent agent's model. A shared model is locked
while the parent request is in flight, and child invocations then fail with
"Agent is already processing a request".
"""

import os
from typing import Any

from strands.models import Model


def instance(**model_config: Any) -> Model:
    """Create a fresh xAI model. Uses RonXAIModel when the panel package is importable."""
    model_id = model_config.get("model_id") or os.getenv("XAI_MODEL", "grok-4.7")
    client_args = model_config.get("client_args") or {"api_key": os.environ["XAI_API_KEY"]}
    params = model_config.get("params") or {}
    try:
        from agent.api.core.xai_model import RonXAIModel

        return RonXAIModel(client_args=client_args, model_id=model_id, params=params)
    except Exception:
        from strands_xai import xAIModel

        return xAIModel(client_args=client_args, model_id=model_id, params=params)
