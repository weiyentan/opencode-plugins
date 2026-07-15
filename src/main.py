"""FastAPI application entry point for the afk_review service."""

from fastapi import FastAPI

from src.fast_api_eda_gateway.routing import router, review_tracker

app = FastAPI(title="AFK Review Service")
app.include_router(router)
