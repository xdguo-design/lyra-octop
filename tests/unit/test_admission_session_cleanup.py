from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from octop.infra.admission_session_cleanup import (
    ADMISSION_SESSION_CLEANUP_JOB_ID,
    install_admission_session_cleanup_job,
    purge_expired_admission_sessions,
)


@pytest.mark.asyncio
async def test_purge_expired_admission_sessions_runs_repo_cleanup_in_thread() -> None:
    repo = MagicMock(delete_expired=MagicMock(return_value=3))

    deleted = await purge_expired_admission_sessions(repo)

    assert deleted == 3
    repo.delete_expired.assert_called_once_with()


@pytest.mark.asyncio
async def test_installed_hourly_cleanup_calls_repo() -> None:
    cron = MagicMock()
    repo = MagicMock(delete_expired=MagicMock(return_value=0))

    install_admission_session_cleanup_job(cron, repo)

    cron.schedule_system_job.assert_called_once()
    job_id = cron.schedule_system_job.call_args.args[0]
    options = cron.schedule_system_job.call_args.kwargs
    assert job_id == ADMISSION_SESSION_CLEANUP_JOB_ID
    assert options["trigger"] == "interval:3600"
    await options["func"]()
    repo.delete_expired.assert_called_once_with()
