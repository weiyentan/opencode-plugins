"""Routing for /afk_review endpoint with review state tracking."""

from typing import Optional

import pydantic
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from src.fast_api_eda_gateway.review_state_tracker import ReviewStateTracker


class AfkReviewRequest(pydantic.BaseModel):
    pr_key: str


class AfkReviewResponse(pydantic.BaseModel):
    status: str
    reason: Optional[str] = None


router = APIRouter()


def get_review_tracker(request: Request) -> ReviewStateTracker:
    """Dependency that provides the app-level ReviewStateTracker singleton."""
    return request.app.state.review_tracker


@router.post("/afk_review", response_model=AfkReviewResponse)
def afk_review(
    request: AfkReviewRequest,
    review_tracker: ReviewStateTracker = Depends(get_review_tracker),
):
    """Handle /afk_review command with duplicate protection and stale TTL.

    Returns:
        200 with status="accepted" if review is allowed (new or stale).
        409 with status="rejected" if an active in-flight entry exists.
    """
    is_in_flight, reason = review_tracker.is_in_flight(request.pr_key)

    if is_in_flight:
        # Active review is in-flight — reject duplicate
        return JSONResponse(
            status_code=409,
            content={"status": "rejected", "reason": reason},
        )

    # Accept the review: whether it was stale (reason=review_in_flight_expired)
    # or new (reason=None), we proceed and mark in-flight
    review_tracker.set_in_flight(request.pr_key)
    return AfkReviewResponse(status="accepted", reason=reason)
