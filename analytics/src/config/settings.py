"""
🎓 Academic Intelligence Platform - Analytics Engine Configuration
"""

from typing import List, Optional
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    """
    
    # Application
    app_name: str = "AcademicAnalyticsEngine"
    app_env: str = Field(default="development", alias="APP_ENV")
    app_debug: bool = Field(default=False, alias="APP_DEBUG")
    app_version: str = Field(default="1.0.0", alias="APP_VERSION")
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8001, alias="APP_PORT")
    
    # MongoDB Atlas (Primary Database)
    mongodb_uri: str = Field(
        default="mongodb+srv://vijeth:2006@wtlab.9b3zqxr.mongodb.net/academic", 
        alias="MONGODB_URI"
    )
    mongodb_database: str = Field(default="academic", alias="MONGODB_DATABASE")
    mongodb_min_pool_size: int = Field(default=5, alias="MONGODB_MIN_POOL_SIZE")
    mongodb_max_pool_size: int = Field(default=50, alias="MONGODB_MAX_POOL_SIZE")
    
    # Redis
    redis_host: str = Field(default="localhost", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
    redis_password: Optional[str] = Field(default=None, alias="REDIS_PASSWORD")
    redis_db: int = Field(default=1, alias="REDIS_DB")
    redis_url: Optional[str] = Field(default=None, alias="REDIS_URL")
    
    # Celery
    celery_broker_url: str = Field(
        default="redis://localhost:6379/2", 
        alias="CELERY_BROKER_URL"
    )
    celery_result_backend: str = Field(
        default="redis://localhost:6379/3", 
        alias="CELERY_RESULT_BACKEND"
    )
    
    # Backend API
    backend_api_url: str = Field(
        default="http://localhost:3000/api/v1", 
        alias="BACKEND_API_URL"
    )
    backend_api_key: Optional[str] = Field(default=None, alias="BACKEND_API_KEY")
    
    # Logging
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    log_format: str = Field(default="json", alias="LOG_FORMAT")
    log_file: Optional[str] = Field(default="logs/analytics.log", alias="LOG_FILE")
    
    # Analytics
    analytics_batch_size: int = Field(default=100, alias="ANALYTICS_BATCH_SIZE")
    analytics_cache_ttl: int = Field(default=3600, alias="ANALYTICS_CACHE_TTL")
    min_attempts_for_trend: int = Field(default=3, alias="MIN_ATTEMPTS_FOR_TREND")
    learning_gap_threshold: float = Field(default=50.0, alias="LEARNING_GAP_THRESHOLD")
    
    # Performance
    worker_concurrency: int = Field(default=4, alias="WORKER_CONCURRENCY")
    task_timeout: int = Field(default=300, alias="TASK_TIMEOUT")
    memory_limit_mb: int = Field(default=1024, alias="MEMORY_LIMIT_MB")
    
    # Security
    api_key: Optional[str] = Field(default=None, alias="API_KEY")
    cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:5173", 
        alias="CORS_ORIGINS"
    )
    
    @property
    def redis_dsn(self) -> str:
        """Get Redis connection string."""
        if self.redis_url:
            return self.redis_url
        if self.redis_password:
            return f"redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}/{self.redis_db}"
        return f"redis://{self.redis_host}:{self.redis_port}/{self.redis_db}"
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Get CORS origins as list."""
        return [origin.strip() for origin in self.cors_origins.split(",")]
    
    @property
    def is_production(self) -> bool:
        """Check if running in production."""
        return self.app_env.lower() == "production"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


# Global settings instance
settings = Settings()


# Mastery level thresholds
MASTERY_LEVELS = {
    "expert": 90,
    "advanced": 75,
    "intermediate": 60,
    "beginner": 40,
    "novice": 0
}

# Difficulty benchmarks
DIFFICULTY_BENCHMARKS = {
    "easy": 85,
    "medium": 70,
    "hard": 55,
    "expert": 40
}

# Gap severity levels
GAP_SEVERITY = {
    "critical": 30,
    "high": 50,
    "medium": 70,
    "low": 85
}

# Performance tags
PERFORMANCE_TAGS = {
    "excellent": 90,
    "good": 75,
    "average": 60,
    "needs_improvement": 40,
    "critical": 0
}
