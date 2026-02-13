"""
🎓 Academic Intelligence Platform - Database Configuration
MongoDB Atlas is the primary database
"""

from typing import Optional
from motor.motor_asyncio import AsyncIOMotorClient
import redis.asyncio as aioredis

from src.config.settings import settings
from src.utils.logger import logger


class DatabaseManager:
    """
    Manages database connections: MongoDB Atlas (primary), Redis (caching)
    """
    
    def __init__(self):
        self._mongo_client: Optional[AsyncIOMotorClient] = None
        self._mongo_db = None
        self._redis: Optional[aioredis.Redis] = None
    
    async def init_mongodb(self):
        """Initialize MongoDB Atlas connection."""
        try:
            self._mongo_client = AsyncIOMotorClient(
                settings.mongodb_uri,
                minPoolSize=settings.mongodb_min_pool_size,
                maxPoolSize=settings.mongodb_max_pool_size
            )
            self._mongo_db = self._mongo_client[settings.mongodb_database]
            
            # Verify connection
            await self._mongo_client.admin.command('ping')
            
            logger.info("MongoDB Atlas connection initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize MongoDB Atlas: {e}")
            raise
    
    async def init_redis(self):
        """Initialize Redis connection for caching."""
        try:
            self._redis = aioredis.from_url(
                settings.redis_dsn,
                encoding="utf-8",
                decode_responses=True
            )
            await self._redis.ping()
            logger.info("Redis connection initialized successfully")
        except Exception as e:
            logger.warning(f"Redis not available (caching disabled): {e}")
            self._redis = None
    
    async def init_all(self):
        """Initialize all database connections."""
        await self.init_mongodb()
        try:
            await self.init_redis()
        except Exception:
            logger.warning("Continuing without Redis caching")
        logger.info("Database connections initialized")
    
    async def close_all(self):
        """Close all database connections."""
        try:
            if self._mongo_client:
                self._mongo_client.close()
            if self._redis:
                await self._redis.close()
            logger.info("All database connections closed")
        except Exception as e:
            logger.error(f"Error closing database connections: {e}")
    
    @property
    def mongo_db(self):
        """Get MongoDB database instance."""
        if not self._mongo_db:
            raise RuntimeError("MongoDB not initialized")
        return self._mongo_db
    
    @property
    def redis(self) -> Optional[aioredis.Redis]:
        """Get Redis client (may be None if not available)."""
        return self._redis
    
    # Collection shortcuts for MongoDB
    @property
    def users(self):
        return self.mongo_db.users
    
    @property
    def exams(self):
        return self.mongo_db.exams
    
    @property
    def attempts(self):
        return self.mongo_db.attempts
    
    @property
    def exam_activity_logs(self):
        return self.mongo_db.exam_activity_logs
    
    @property
    def analytics_snapshots(self):
        return self.mongo_db.analytics_snapshots
    
    @property
    def feedback_templates(self):
        return self.mongo_db.feedback_templates


# Global database manager instance
db = DatabaseManager()


async def get_mongo_db():
    """Dependency for getting MongoDB database."""
    return db.mongo_db


async def get_redis() -> Optional[aioredis.Redis]:
    """Dependency for getting Redis client."""
    return db.redis
