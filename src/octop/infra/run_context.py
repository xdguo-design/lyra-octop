"""Execution identity propagated to work scheduled by the current Run."""

from contextvars import ContextVar
from typing import NamedTuple


class RunContext(NamedTuple):
    run_id: str
    owner_user_id: int


current_run_context: ContextVar[RunContext | None] = ContextVar(
    "octop_current_run_context", default=None
)
