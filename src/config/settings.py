"""Application settings, loaded from environment variables."""

import os
import logging

logger = logging.getLogger(__name__)

# Configurable TTL (in seconds) for in-flight review state.
# After this duration, an in-flight entry is considered stale
# and a new /afk_review can proceed.
_env_value = os.environ.get("REVIEW_IN_FLIGHT_TTL_SECONDS", "3600")
try:
    REVIEW_IN_FLIGHT_TTL_SECONDS = int(_env_value)
    if REVIEW_IN_FLIGHT_TTL_SECONDS < 0:
        raise ValueError("TTL must be non-negative")
except (ValueError, TypeError):
    logger.warning(
        "Invalid REVIEW_IN_FLIGHT_TTL_SECONDS value %r, falling back to 3600",
        _env_value,
    )
    REVIEW_IN_FLIGHT_TTL_SECONDS = 3600
