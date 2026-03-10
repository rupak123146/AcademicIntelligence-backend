"""
🎓 Academic Intelligence Platform - Database Configuration
MongoDB Atlas (primary) + MySQL (relational data from backend)
"""

import re
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorClient
import redis.asyncio as aioredis

from src.config.settings import settings
from src.utils.logger import logger


# =====================================================
# MySQL Pool Wrapper (asyncpg-compatible interface)
# =====================================================

class MySQLQueryInterface:
    """Provides asyncpg-like query methods over aiomysql connection."""

    def __init__(self, conn):
        self._conn = conn

    @staticmethod
    def _translate_query(query: str) -> str:
        """Convert PostgreSQL parameterized query to MySQL format."""
        translated = re.sub(r'\$\d+', '%s', query)
        translated = re.sub(
            r'::(?:float|int|integer|text|varchar|numeric|bigint|real|double precision)\b',
            '', translated
        )
        return translated

    async def fetch(self, query: str, *args):
        """Execute query and return all rows as list of dicts."""
        import aiomysql
        translated = self._translate_query(query)
        async with self._conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(translated, args if args else None)
            return await cur.fetchall()

    async def fetchrow(self, query: str, *args):
        """Execute query and return first row as dict."""
        import aiomysql
        translated = self._translate_query(query)
        async with self._conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(translated, args if args else None)
            return await cur.fetchone()

    async def fetchval(self, query: str, *args):
        """Execute query and return first column of first row."""
        import aiomysql
        translated = self._translate_query(query)
        async with self._conn.cursor() as cur:
            await cur.execute(translated, args if args else None)
            row = await cur.fetchone()
            return row[0] if row else None

    async def execute(self, query: str, *args):
        """Execute a statement and return affected row count."""
        translated = self._translate_query(query)
        import aiomysql
        async with self._conn.cursor() as cur:
            await cur.execute(translated, args if args else None)
            await self._conn.commit()
            return cur.rowcount


class MySQLConnectionContext:
    """Context manager wrapping aiomysql connection with asyncpg-like interface."""

    def __init__(self, pool):
        self._pool = pool
        self._conn = None

    async def __aenter__(self):
        self._conn = await self._pool.acquire()
        return MySQLQueryInterface(self._conn)

    async def __aexit__(self, *args):
        self._pool.release(self._conn)
        self._conn = None


class MySQLPoolWrapper:
    """Wraps aiomysql pool with asyncpg-compatible .acquire() interface."""

    def __init__(self, pool):
        self._pool = pool

    def acquire(self):
        return MySQLConnectionContext(self._pool)

    # Convenience methods for direct pool-level queries (no acquire() needed)
    async def fetch(self, query: str, *args):
        async with self.acquire() as conn:
            return await conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args):
        async with self.acquire() as conn:
            return await conn.fetchrow(query, *args)

    async def fetchval(self, query: str, *args):
        async with self.acquire() as conn:
            return await conn.fetchval(query, *args)

    async def execute(self, query: str, *args):
        async with self.acquire() as conn:
            return await conn.execute(query, *args)


# =====================================================
# Database Manager
# =====================================================

class DatabaseManager:
    """
    Manages database connections: MongoDB Atlas (primary), MySQL (relational), Redis (caching)
    """
    
    def __init__(self):
        self._mongo_client: Optional[AsyncIOMotorClient] = None
        self._mongo_db = None
        self._redis: Optional[aioredis.Redis] = None
        self._mysql_pool = None
    
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

    async def init_mysql(self):
        """Initialize MySQL connection pool for relational data."""
        try:
            import aiomysql
            params = settings.mysql_connection_params
            self._mysql_pool = await aiomysql.create_pool(
                host=params["host"],
                port=params["port"],
                user=params["user"],
                password=params["password"],
                db=params["database"],
                minsize=2,
                maxsize=10,
                autocommit=True,
                charset='utf8mb4',
            )
            # Verify connection
            async with self._mysql_pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT 1")
            logger.info(f"MySQL connection pool initialized ({params['host']}:{params['port']})")
        except ImportError:
            logger.warning("aiomysql not installed – MySQL pool disabled. Install with: pip install aiomysql")
            self._mysql_pool = None
        except Exception as e:
            logger.warning(f"MySQL pool init failed (analytics SQL features disabled): {e}")
            self._mysql_pool = None

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
        await self.init_mysql()
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
            if self._mysql_pool:
                self._mysql_pool.close()
                await self._mysql_pool.wait_closed()
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
    def pg_pool(self):
        """Get SQL connection pool (MySQL with asyncpg-compatible interface)."""
        if not self._mysql_pool:
            raise RuntimeError(
                "MySQL pool not initialized. "
                "Set DATABASE_URL or MYSQL_HOST/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE env vars."
            )
        return MySQLPoolWrapper(self._mysql_pool)
    
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


async def get_db_session():
    """Dependency for getting a MySQL query session."""
    async with db.pg_pool.acquire() as conn:
        yield conn


async def get_pg_pool():
    """Dependency for getting the SQL connection pool."""
    return db.pg_pool


async def get_mongo_db():
    """Dependency for getting MongoDB database."""
    return db.mongo_db


async def get_redis() -> Optional[aioredis.Redis]:
    """Dependency for getting Redis client."""
    return db.redis
