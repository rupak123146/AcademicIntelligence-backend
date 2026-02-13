"""
🎓 Academic Intelligence Platform - Analytics Engine

FastAPI application entry point for the Python analytics microservice.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from src.config import settings, db
from src.api import analytics_router
from src.services import initialize_all_services
from src.utils import logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    Handles startup and shutdown events.
    """
    # Startup
    logger.info("🚀 Starting Analytics Engine...")
    
    try:
        # Initialize database connections
        await db.init_all()
        logger.info("✅ Database connections established")
        
        # Initialize all services
        await initialize_all_services()
        logger.info("✅ Analytics services initialized")
        
        logger.info(f"🎓 Analytics Engine v{settings.app_version} is ready!")
        
    except Exception as e:
        logger.error(f"❌ Startup failed: {e}")
        raise
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down Analytics Engine...")
    
    try:
        await db.close_all()
        logger.info("✅ Database connections closed")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")
    
    logger.info("👋 Analytics Engine stopped")


# Create FastAPI application
app = FastAPI(
    title="Academic Intelligence Platform - Analytics Engine",
    description="""
    🧠 Python-based analytics microservice for the Academic Intelligence Platform.
    
    Provides comprehensive academic performance analytics:
    
    - **Chapter-wise Analysis**: Performance breakdown by chapter
    - **Concept-wise Analysis**: Deep dive into concept mastery
    - **Difficulty Analysis**: Performance across difficulty levels
    - **Learning Gap Detection**: Identify knowledge gaps
    - **Trend Analysis**: Track performance over time
    - **Feedback Generation**: Personalized, actionable feedback
    - **Class Analytics**: Aggregate insights for educators
    
    All endpoints return structured JSON responses with the standard format:
    ```json
    {
        "success": true,
        "message": "Operation description",
        "data": { ... },
        "errors": null,
        "meta": null
    }
    ```
    """,
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan
)


# =====================================================
# Middleware
# =====================================================

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests."""
    logger.info(f"📥 {request.method} {request.url.path}")
    
    response = await call_next(request)
    
    logger.info(
        f"📤 {request.method} {request.url.path} - {response.status_code}"
    )
    
    return response


# =====================================================
# Exception Handlers
# =====================================================

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": "Internal server error",
            "data": None,
            "errors": [str(exc)] if settings.app_debug else ["An unexpected error occurred"],
            "meta": None
        }
    )


# =====================================================
# Routes
# =====================================================

# Health check
@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "analytics-engine",
        "version": settings.app_version,
        "environment": settings.app_env
    }


# Ready check (includes dependency checks)
@app.get("/ready", tags=["Health"])
async def ready_check():
    """
    Readiness check with dependency verification.
    """
    checks = {
        "postgres": False,
        "mongodb": False,
        "redis": False
    }
    
    try:
        # Check PostgreSQL
        async with db.pg_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        checks["postgres"] = True
    except Exception as e:
        logger.warning(f"PostgreSQL check failed: {e}")
    
    try:
        # Check MongoDB
        await db.mongo_db.command("ping")
        checks["mongodb"] = True
    except Exception as e:
        logger.warning(f"MongoDB check failed: {e}")
    
    try:
        # Check Redis
        await db.redis.ping()
        checks["redis"] = True
    except Exception as e:
        logger.warning(f"Redis check failed: {e}")
    
    all_healthy = all(checks.values())
    
    return {
        "ready": all_healthy,
        "checks": checks
    }


# Include analytics routes
app.include_router(analytics_router, prefix="/api/v1")


# =====================================================
# Root endpoint
# =====================================================

@app.get("/", tags=["Root"])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Academic Intelligence Platform - Analytics Engine",
        "version": settings.app_version,
        "description": "Python-based analytics microservice",
        "documentation": "/docs",
        "health": "/health",
        "api_base": "/api/v1/analytics"
    }


# =====================================================
# Run application
# =====================================================

def main():
    """Run the application."""
    uvicorn.run(
        "src.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_debug,
        workers=1 if settings.app_debug else settings.worker_concurrency,
        log_level=settings.log_level.lower()
    )


if __name__ == "__main__":
    main()
