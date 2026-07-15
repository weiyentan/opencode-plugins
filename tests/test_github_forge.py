"""Tests for ReviewStateTracker, settings, and routing — in-flight review state
management with stale TTL support for /afk_review endpoint.
"""

import importlib
import sys
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.config.settings import REVIEW_IN_FLIGHT_TTL_SECONDS
from src.fast_api_eda_gateway.review_state_tracker import ReviewStateTracker


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _reload_settings():
    """Re-import settings module to pick up fresh env vars."""
    if "src.config.settings" in sys.modules:
        importlib.reload(sys.modules["src.config.settings"])
    else:
        import src.config.settings  # noqa: F811


def _purge_app_modules():
    """Remove cached imports so each test gets a fresh app instance."""
    for mod in list(sys.modules.keys()):
        if mod.startswith("src.main") or mod.startswith("src.fast_api_eda_gateway.routing"):
            del sys.modules[mod]


# ---------------------------------------------------------------------------
# Settings tests
# ---------------------------------------------------------------------------

class TestSettingsReviewInFlightTTL:
    """Tests for REVIEW_IN_FLIGHT_TTL_SECONDS env var integration."""

    def test_default_ttl_is_3600(self, monkeypatch):
        """Default TTL is 3600 seconds when env var is not set."""
        monkeypatch.delenv("REVIEW_IN_FLIGHT_TTL_SECONDS", raising=False)
        _reload_settings()
        from src.config.settings import REVIEW_IN_FLIGHT_TTL_SECONDS
        assert REVIEW_IN_FLIGHT_TTL_SECONDS == 3600

    def test_custom_ttl_from_env(self, monkeypatch):
        """Custom TTL is read from REVIEW_IN_FLIGHT_TTL_SECONDS env var."""
        monkeypatch.setenv("REVIEW_IN_FLIGHT_TTL_SECONDS", "600")
        _reload_settings()
        from src.config.settings import REVIEW_IN_FLIGHT_TTL_SECONDS
        assert REVIEW_IN_FLIGHT_TTL_SECONDS == 600

    def test_tracker_uses_ttl_from_settings(self, monkeypatch):
        """ReviewStateTracker default TTL matches settings value."""
        monkeypatch.setenv("REVIEW_IN_FLIGHT_TTL_SECONDS", "1800")
        _reload_settings()
        from src.config.settings import REVIEW_IN_FLIGHT_TTL_SECONDS
        tracker = ReviewStateTracker(
            ttl_seconds=REVIEW_IN_FLIGHT_TTL_SECONDS
        )
        assert tracker._ttl_seconds == 1800


# ---------------------------------------------------------------------------
# State tracker tests
# ---------------------------------------------------------------------------

class TestProcessGithubPayloadReviewStateTracking:
    """Tests for review state tracking, including stale in-flight TTL behavior."""

    def test_duplicate_afk_review_blocked_while_in_flight(self):
        """
        A second /afk_review on the same PR is rejected while the
        in-flight state is active and younger than the configured TTL.
        """
        tracker = ReviewStateTracker()
        pr_key = "owner/repo/42"

        tracker.set_in_flight(pr_key)

        is_in_flight, reason = tracker.is_in_flight(pr_key)
        assert is_in_flight is True
        assert reason == "review_already_in_flight"

    def test_stale_in_flight_allows_new_review(self):
        """
        A /afk_review on the same PR is accepted when the existing in-flight
        entry is older than the configured TTL, logging a distinct reason.
        """
        tracker = ReviewStateTracker(ttl_seconds=0)
        pr_key = "owner/repo/42"

        base_time = 1000000.0
        with patch.object(time, "time", return_value=base_time):
            tracker.set_in_flight(pr_key)

        # Simulate TTL exceeded by advancing time
        with patch.object(time, "time", return_value=base_time + 10.0):
            is_in_flight, reason = tracker.is_in_flight(pr_key)
            assert is_in_flight is False
            assert reason == "review_in_flight_expired"

    def test_stale_review_resets_in_flight_state(self):
        """
        When a stale review is detected, the caller can set it in-flight
        again for the new review, and the new entry is not stale.
        """
        tracker = ReviewStateTracker(ttl_seconds=1)
        pr_key = "owner/repo/42"

        base_time = 1000000.0
        with patch.object(time, "time", return_value=base_time):
            tracker.set_in_flight(pr_key)

            # Within TTL — still active
            is_in_flight, reason = tracker.is_in_flight(pr_key)
            assert is_in_flight is True
            assert reason == "review_already_in_flight"

        # Advance past TTL — stale
        with patch.object(time, "time", return_value=base_time + 2.0):
            is_in_flight, reason = tracker.is_in_flight(pr_key)
            assert is_in_flight is False
            assert reason == "review_in_flight_expired"

            # Re-set at the stale timestamp for the new review
            tracker.set_in_flight(pr_key)

            # Immediately check — within TTL since time hasn't advanced
            is_in_flight, reason = tracker.is_in_flight(pr_key)
            assert is_in_flight is True
            assert reason == "review_already_in_flight"

    def test_no_in_flight_returns_false(self):
        """A PR that was never set in-flight returns False."""
        tracker = ReviewStateTracker()
        is_in_flight, reason = tracker.is_in_flight("unknown/pr/99")
        assert is_in_flight is False
        assert reason is None

    def test_in_flight_within_ttl_still_blocks(self):
        """With a generous TTL, a recent in-flight entry still blocks."""
        tracker = ReviewStateTracker(ttl_seconds=3600)
        pr_key = "owner/repo/42"

        tracker.set_in_flight(pr_key)
        is_in_flight, reason = tracker.is_in_flight(pr_key)
        assert is_in_flight is True
        assert reason == "review_already_in_flight"


# ---------------------------------------------------------------------------
# Routing tests — /afk_review endpoint with state tracking
# ---------------------------------------------------------------------------

class TestAfkReviewEndpointStateTracking:
    """Integration tests for /afk_review endpoint using TestClient."""

    @pytest.fixture
    def client(self):
        """Create a fresh FastAPI TestClient with a clean tracker instance."""
        _purge_app_modules()
        from src.main import app
        return TestClient(app)

    def test_accept_first_review(self, client):
        """First /afk_review for a PR is accepted."""
        response = client.post("/afk_review", json={"pr_key": "owner/repo/1"})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "accepted"
        assert data["reason"] is None

    def test_reject_duplicate_active_review(self, client):
        """Second /afk_review is rejected when existing entry is active."""
        pr_key = "owner/repo/1"
        client.post("/afk_review", json={"pr_key": pr_key})
        response = client.post("/afk_review", json={"pr_key": pr_key})
        assert response.status_code == 409
        data = response.json()
        assert data["status"] == "rejected"
        assert data["reason"] == "review_already_in_flight"

    def test_accept_stale_review(self, client):
        """/afk_review is accepted when existing entry is stale."""
        pr_key = "owner/repo/1"
        from src.main import review_tracker
        base_time = 1000000.0
        with patch.object(time, "time", return_value=base_time):
            review_tracker.set_in_flight(pr_key)

        # Advance past TTL
        with patch.object(time, "time", return_value=base_time + REVIEW_IN_FLIGHT_TTL_SECONDS + 1):
            response = client.post("/afk_review", json={"pr_key": pr_key})
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "accepted"
            assert data["reason"] == "review_in_flight_expired"

    def test_accept_review_for_different_pr(self, client):
        """/afk_review is accepted for a different PR even when another is in-flight."""
        client.post("/afk_review", json={"pr_key": "owner/repo/1"})
        response = client.post("/afk_review", json={"pr_key": "owner/repo/2"})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "accepted"
        assert data["reason"] is None

    def test_missing_pr_key_returns_422(self, client):
        """Request without pr_key returns validation error."""
        response = client.post("/afk_review", json={})
        assert response.status_code == 422

    def test_stale_entry_response_includes_reason(self, client):
        """Stale acceptance response includes the distinct stale reason."""
        pr_key = "owner/repo/42"
        from src.main import review_tracker
        base_time = 1000000.0
        with patch.object(time, "time", return_value=base_time):
            review_tracker.set_in_flight(pr_key)

        with patch.object(time, "time", return_value=base_time + REVIEW_IN_FLIGHT_TTL_SECONDS + 1):
            response = client.post("/afk_review", json={"pr_key": pr_key})
            data = response.json()
            assert data["status"] == "accepted"
            assert data["reason"] == "review_in_flight_expired"
            assert "review_in_flight_expired" != "review_already_in_flight"
