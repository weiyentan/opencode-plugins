"""Application settings, loaded from environment variables."""

import os

# Configurable TTL (in seconds) for in-flight review state.
# After this duration, an in-flight entry is considered stale
# and a new /afk_review can proceed.
REVIEW_IN_FLIGHT_TTL_SECONDS = int(
    os.environ.get("REVIEW_IN_FLIGHT_TTL_SECONDS", "3600")
)
