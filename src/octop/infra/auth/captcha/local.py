"""Built-in image captcha: one-shot SVG challenge issued and verified in-process.

This is the ``image`` provider — a self-hosted captcha that needs no vendor
account, no site key, and no outbound call. It follows the same provider
contract as the vendors (``providers.py``): pure metadata here, execution in
``verify.ensure_captcha``, which delegates to :func:`verify_token` because the
provider has no ``siteverify_url``.

Challenge lifecycle: 4 characters, 5 minute TTL, single use, three wrong
answers invalidate. Tokens travel as ``<challenge_id>:<answer>`` so the existing
``captcha_token`` field carries them without a protocol change.
"""

from __future__ import annotations

import base64
import logging
import random
import secrets
import threading
import time
from typing import Any

from octop.infra.errors import ErrorCode, OctopError

logger = logging.getLogger(__name__)

CHALLENGE_TTL_SECONDS = 300.0
MAX_ANSWER_ATTEMPTS = 3
CHALLENGE_LENGTH = 4
# Confusable glyphs are excluded: no O/0, no I/1, no Z/2.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXY3456789"
_INK = "#2a1a4a"
_PAPER = "#fff4d6"
_PALETTE = ("#6a3fd8", "#ff6fa5", "#ff9f43", "#4f9cff", "#2dd4a7")
_WIDTH, _HEIGHT = 132, 52
_MAX_CHALLENGES = 512

_lock = threading.Lock()
_challenges: dict[str, dict[str, Any]] = {}


def _gc(now_ts: float) -> None:
    """Drop expired challenges; called with the lock held."""
    if len(_challenges) < _MAX_CHALLENGES:
        return
    for cid in [k for k, v in _challenges.items() if v["expires"] < now_ts]:
        _challenges.pop(cid, None)


def _render_svg(code: str) -> str:
    rnd = random.Random(secrets.randbits(64))
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{_WIDTH}" height="{_HEIGHT}" '
        f'viewBox="0 0 {_WIDTH} {_HEIGHT}">',
        f'<rect width="{_WIDTH}" height="{_HEIGHT}" rx="10" fill="{_PAPER}" '
        f'stroke="{_INK}" stroke-width="2.5"/>',
    ]
    for _ in range(26):  # noise dots
        parts.append(
            f'<circle cx="{rnd.randint(5, _WIDTH - 5)}" cy="{rnd.randint(5, _HEIGHT - 5)}" '
            f'r="{rnd.choice(["1", "1.2", "1.6"])}" fill="{rnd.choice(_PALETTE)}" opacity="0.35"/>'
        )
    for _ in range(3):  # noise lines
        parts.append(
            f'<line x1="{rnd.randint(0, _WIDTH)}" y1="{rnd.randint(0, _HEIGHT)}" '
            f'x2="{rnd.randint(0, _WIDTH)}" y2="{rnd.randint(0, _HEIGHT)}" '
            f'stroke="{rnd.choice(_PALETTE)}" stroke-width="1.4" opacity="0.4"/>'
        )
    step = _WIDTH / (len(code) + 0.6)
    for i, char in enumerate(code):
        x = step * (i + 0.55) + rnd.uniform(-3, 3)
        y = _HEIGHT / 2 + rnd.uniform(-3, 7)
        rot = rnd.uniform(-22, 22)
        parts.append(
            f'<text x="{x:.1f}" y="{y:.1f}" font-family="Verdana,Arial,sans-serif" '
            f'font-size="30" font-weight="bold" fill="{rnd.choice(_PALETTE)}" '
            f'text-anchor="middle" transform="rotate({rot:.1f} {x:.1f} {y:.1f})">{char}</text>'
        )
    parts.append("</svg>")
    return "".join(parts)


def issue_challenge() -> tuple[str, str]:
    """Issue a challenge, returning ``(challenge_id, data-uri SVG)``."""
    cid = secrets.token_hex(8)
    code = "".join(secrets.choice(_ALPHABET) for _ in range(CHALLENGE_LENGTH))
    svg = _render_svg(code)
    data_uri = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode()
    now_ts = time.monotonic()
    with _lock:
        _gc(now_ts)
        _challenges[cid] = {"code": code, "expires": now_ts + CHALLENGE_TTL_SECONDS, "tries": 0}
    return cid, data_uri


def verify_token(token: str | None) -> bool:
    """Verify and consume a ``<challenge_id>:<answer>`` token.

    Single use: a correct answer removes the challenge. A wrong answer counts a
    try; after :data:`MAX_ANSWER_ATTEMPTS` wrong answers the challenge is
    invalidated and the client must fetch a fresh one.
    """
    raw = (token or "").strip()
    cid, sep, answer = raw.partition(":")
    if not sep or not cid or not answer:
        return False
    with _lock:
        entry = _challenges.get(cid)
        if entry is None:
            return False
        if entry["expires"] < time.monotonic():
            _challenges.pop(cid, None)
            return False
        if answer.strip().upper() != entry["code"]:
            entry["tries"] += 1
            if entry["tries"] >= MAX_ANSWER_ATTEMPTS:
                _challenges.pop(cid, None)
            return False
        _challenges.pop(cid, None)
        return True


def challenge_issued_count() -> int:
    """Test seam: number of live challenges."""
    with _lock:
        return len(_challenges)


def reset_challenges() -> None:
    """Test seam: drop every live challenge."""
    with _lock:
        _challenges.clear()


def issue_challenge_for_tests() -> tuple[str, str, str]:
    """Test seam: ``(cid, data_uri, code)`` so tests can answer correctly."""
    cid, data_uri = issue_challenge()
    return cid, data_uri, challenge_code_for_tests(cid)


def challenge_code_for_tests(cid: str) -> str:
    """Test seam: expected answer for a challenge issued in this process."""
    with _lock:
        return str(_challenges[cid]["code"])


def expired_token_error() -> OctopError:
    """Uniform failure reason shared with the vendor path."""
    return OctopError(ErrorCode.CAPTCHA_FAILED, "Captcha verification failed. Try again.")


logger.debug(
    "image captcha ready: %d-char challenges, ttl=%ss", CHALLENGE_LENGTH, CHALLENGE_TTL_SECONDS
)
