"""
🎓 Academic Intelligence Platform - Configuration Package
"""

from src.config.settings import (
    settings,
    MASTERY_LEVELS,
    DIFFICULTY_BENCHMARKS,
    GAP_SEVERITY,
    PERFORMANCE_TAGS
)
from src.config.database import (
    db,
    get_db_session,
    get_pg_pool,
    get_mongo_db,
    get_redis
)


__all__ = [
    "settings",
    "MASTERY_LEVELS",
    "DIFFICULTY_BENCHMARKS",
    "GAP_SEVERITY",
    "PERFORMANCE_TAGS",
    "db",
    "get_db_session",
    "get_pg_pool",
    "get_mongo_db",
    "get_redis"
]
