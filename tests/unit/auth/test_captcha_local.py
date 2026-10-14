"""Unit tests for the built-in image captcha challenge store."""

from __future__ import annotations

import base64
import time

from octop.infra.auth.captcha import local


def test_issue_challenge_returns_svg_data_uri() -> None:
    local.reset_challenges()
    cid, image = local.issue_challenge()
    assert cid
    assert image.startswith("data:image/svg+xml;base64,")
    svg = base64.b64decode(image.split(",", 1)[1]).decode("utf-8")
    assert "<svg" in svg and "</svg>" in svg
    assert local.challenge_issued_count() == 1


def test_verify_token_correct_then_single_use() -> None:
    local.reset_challenges()
    cid, _image, code = local.issue_challenge_for_tests()
    assert local.verify_token(f"{cid}:{code}") is True
    # Single use: a replay of the same answer must fail.
    assert local.verify_token(f"{cid}:{code}") is False


def test_verify_token_is_case_insensitive() -> None:
    local.reset_challenges()
    cid, _image, code = local.issue_challenge_for_tests()
    assert local.verify_token(f"{cid}:{code.lower()}") is True


def test_verify_token_wrong_answer_counts_tries_then_invalidates() -> None:
    local.reset_challenges()
    cid, _image, code = local.issue_challenge_for_tests()
    wrong = "AAAA" if code != "AAAA" else "BBBB"
    for _ in range(local.MAX_ANSWER_ATTEMPTS):
        assert local.verify_token(f"{cid}:{wrong}") is False
    # Challenge is spent now: even the right answer no longer works.
    assert local.verify_token(f"{cid}:{code}") is False


def test_verify_token_malformed() -> None:
    local.reset_challenges()
    assert local.verify_token("") is False
    assert local.verify_token("no-separator") is False
    assert local.verify_token(":only-answer") is False
    assert local.verify_token("only-cid:") is False


def test_verify_token_unknown_challenge() -> None:
    local.reset_challenges()
    assert local.verify_token("deadbeef:ABCD") is False


def test_expired_challenge_is_rejected() -> None:
    local.reset_challenges()
    cid, _image, code = local.issue_challenge_for_tests()
    with local._lock:
        local._challenges[cid]["expires"] = time.monotonic() - 1
    assert local.verify_token(f"{cid}:{code}") is False
    assert local.challenge_issued_count() == 0
