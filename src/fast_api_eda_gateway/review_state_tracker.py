"""Review state tracker with stale in-flight TTL support.

Tracks in-flight review state for PRs to prevent duplicate /afk_review
submissions. Supports configurable TTL so that stale in-flight entries
do not permanently block re-review.
"""
from __future__ import annotations

import time
import logging

logger = logging.getLogger(__name__)


class ReviewStateTracker:
    """Tracks in-flight review state for PRs with configurable TTL."""

    def __init__(self, ttl_seconds: int = 3600):
        """
        Args:
            ttl_seconds: Maximum age (in seconds) for an in-flight entry.
                After this duration, the entry is considered stale.
        """
        self._in_flight: dict[str, float] = {}
        self._ttl_seconds = ttl_seconds

    def set_in_flight(self, pr_key: str) -> None:
        """Mark a PR as in-flight with the current timestamp.

        Args:
            pr_key: Unique identifier for the PR (e.g. "owner/repo/number").
        """
        self._in_flight[pr_key] = time.time()

    def is_in_flight(self, pr_key: str) -> tuple[bool, str | None]:
        """Check if a PR is in-flight and whether it's stale.

        Returns:
            A tuple of (is_in_flight, reason):
            - (True, "review_already_in_flight") if active and within TTL
            - (False, "review_in_flight_expired") if stale (exceeded TTL)
            - (False, None) if no entry exists
        """
        if pr_key not in self._in_flight:
            return False, None

        started_at = self._in_flight[pr_key]
        elapsed = time.time() - started_at

        if elapsed > self._ttl_seconds:
            logger.info(
                "review_in_flight_expired",
                extra={"pr_key": pr_key, "elapsed_seconds": round(elapsed, 1)},
            )
            return False, "review_in_flight_expired"

        return True, "review_already_in_flight"

    def clear(self, pr_key: str) -> None:
        """Remove the in-flight entry for a PR."""
        self._in_flight.pop(pr_key, None)
