"""Routing for /afk_review endpoint with review state tracking."""

from typing import Optional

import pydantic
from fastapi import APIRouter

from src.config.settings import REVIEW_IN_FLIGHT_TTL_SECONDS
from src.fast_api_eda_gateway.review_state_tracker import ReviewStateTracker


class AfkReviewRequest(pydantic.BaseModel):
    pr_key: str


class AfkReviewResponse(pydantic.BaseModel):
    status: str
    reason: Optional[str] = None


router = APIRouter()
review_tracker = ReviewStateTracker(ttl_seconds=REVIEW_IN_FLIGHT_TTL_SECONDS)


@router.post("/afk_review", response_model=AfkReviewResponse)
def afk_review(request: AfkReviewRequest):
    """Handle /afk_review command with duplicate protection and stale TTL.

    Returns:
        200 with status="accepted" if review is allowed (new or stale).
        409 with status="rejected" if an active in-flight entry exists.
    """
    is_in_flight, reason = review_tracker.is_in_flight(request.pr_key)

    if is_in_flight:
        # Active review is in-flight — reject duplicate
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=409,
            content={"status": "rejected", "reason": reason},
        )

    # Accept the review: whether it was stale (reason=review_in_flight_expired)
    # or new (reason=None), we proceed and mark in-flight
    review_tracker.set_in_flight(request.pr_key)
    return AfkReviewResponse(status="accepted", reason=reason)
