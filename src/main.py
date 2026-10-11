"""
TrailQuest Backend API entry point.
Run with: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.controllers.routes_controller import router as routes_router
from src.controllers.sync_controller import router as sync_router

app = FastAPI(
    title="TrailQuest Backend Engine",
    description="Offline-first outdoor running quest generator and AI evaluation pipeline.",
    version="1.0.0",
)

# Enable CORS for mobile development and local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount controllers
app.include_router(routes_router)
app.include_router(sync_router)


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "TrailQuest API"}
