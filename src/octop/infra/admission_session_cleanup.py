"""Scheduled deletion of expired admission-registration conversation data."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

ADMISSION_SESSION_CLEANUP_JOB_ID = "sys-admission-session-expiry-cleanup"


async def purge_expired_admission_sessions(session_repo: Any) -> int:
    """Delete expired sessions and their cascading turn records off the event loop."""
    deleted = int(await asyncio.to_thread(session_repo.delete_expired))
    if deleted:
        logger.info("Purged %d expired admission registration sessions", deleted)
    return deleted


def install_admission_session_cleanup_job(cron_manager: Any, session_repo: Any) -> None:
    """Run the admission data-retention cleanup hourly for this server process."""

    async def _run() -> None:
        await purge_expired_admission_sessions(session_repo)

    cron_manager.schedule_system_job(
        ADMISSION_SESSION_CLEANUP_JOB_ID,
        trigger="interval:3600",
        func=_run,
    )
