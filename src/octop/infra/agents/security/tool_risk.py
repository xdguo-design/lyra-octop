"""Fail-closed approval classification for tools that may cause side effects."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Literal

ToolOperation = Literal["read", "write", "external_send"]
_READ_ONLY = frozenset(
    {
        "ls",
        "read_file",
        "glob",
        "grep",
        "current_time",
        "web_fetch",
        "desktop_screenshot",
        "ask_user_question",
        "tavily_search",
        "brave_search",
        "google_search",
        "kimi_search",
        "searchfree_search",
        "memory_search",
        "memory_get",
        "cronjob_list",
        "cronjob_get",
        "search_knowledge",
        "mobile_screenshot",
        "mobile_ui_dump",
        "agent_list",
    }
)
_EXTERNAL_SEND = frozenset(
    {
        "send_file_to_user",
        "read_env_file",
        "browser_use",
        "generate_image",
        "generate_video",
        "mobile_tap",
        "mobile_swipe",
        "mobile_launch_app",
        "mobile_handoff_to_user",
        "ask_agent",
    }
)


def tool_operation(name: str) -> ToolOperation:
    """Classify a tool; unknown tools default to an approval-requiring write."""
    if name in _READ_ONLY:
        return "read"
    if name in _EXTERNAL_SEND:
        return "external_send"
    return "write"


def approval_required_tools(names: Iterable[str]) -> set[str]:
    return {name for name in names if name and tool_operation(name) != "read"}


def merge_required_tool_approvals(
    interrupt_on: dict[str, Any] | None,
    names: Iterable[str],
    allowed_decisions: Iterable[str],
    *,
    force_require: Iterable[str] = (),
) -> tuple[dict[str, Any], frozenset[str]]:
    """Add mandatory approvals while preserving configured predicates and decisions."""
    result = dict(interrupt_on or {})
    required = frozenset(approval_required_tools(names) | {name for name in force_require if name})
    for name in required:
        result.setdefault(name, {"allowed_decisions": list(allowed_decisions)})
    return result, required


__all__ = [
    "ToolOperation",
    "approval_required_tools",
    "merge_required_tool_approvals",
    "tool_operation",
]
