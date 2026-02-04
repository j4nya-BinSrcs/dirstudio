"""
FastAPI application setup and configuration.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .endpoints import router
from db.database import init_db


def create_app() -> FastAPI:
    """Create and configure FastAPI application."""
    
    app = FastAPI(
        title="DirStudio API",
        description="Directory Intelligence and Organization System",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc"
    )
    
    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Initialize database
    @app.on_event("startup")
    async def startup():
        init_db()
        print("Database initialized")
    
    # Include API routes
    app.include_router(router, prefix="/api")
    
    @app.get("/")
    async def root():
        """API root endpoint."""
        return {
            "name": "DirStudio API",
            "version": "1.0.0",
            "status": "running",
            "docs": "/docs"
        }
    
    @app.get("/health")
    async def health():
        """Health check endpoint."""
        return {"status": "healthy"}
    
    return app


# Create app instance
app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )