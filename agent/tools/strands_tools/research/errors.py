"""Error types for the RonBrowser research tool surface.

This module is referenced via ``from .errors import NotConfiguredError`` by the
research tools. It is a small, well-scoped module that centralises the
exception taxonomy used by the Perplexity-backed search / deep-research tools.
"""

from __future__ import annotations


class ResearchToolError(RuntimeError):
    """Base class for all RonBrowser research-tool failures."""


class NotConfiguredError(ResearchToolError):
    """Raised when a tool is invoked without the required API key or endpoint."""
