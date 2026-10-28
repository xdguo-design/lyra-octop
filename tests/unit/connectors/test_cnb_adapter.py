from __future__ import annotations

import pytest

from octop.infra.connectors.gateway.adapters import cnb


def test_probe_credentials_requires_nonempty_token() -> None:
    with pytest.raises(ValueError, match="Access Token is required"):
        cnb.probe_credentials({"token": "  "})


def test_probe_credentials_accepts_repo_scoped_token_without_account_scope() -> None:
    cnb.probe_credentials({"token": "repo-read-token"})
