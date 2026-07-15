"""FastAPI application entry point for the afk_review service."""

from fastapi import FastAPI

from src.config.settings import REVIEW_IN_FLIGHT_TTL_SECONDS
from src.fast_api_eda_gateway.review_state_tracker import ReviewStateTracker
from src.fast_api_eda_gateway.routing import router

app = FastAPI(title="AFK Review Service")
app.state.review_tracker = ReviewStateTracker(ttl_seconds=REVIEW_IN_FLIGHT_TTL_SECONDS)
app.include_router(router)
