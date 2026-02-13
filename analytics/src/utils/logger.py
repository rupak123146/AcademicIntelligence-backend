"""
🎓 Academic Intelligence Platform - Logger Configuration
"""

import sys
from pathlib import Path
from loguru import logger

from src.config.settings import settings


def setup_logger():
    """Configure application logger using loguru."""
    
    # Remove default handler
    logger.remove()
    
    # Format based on environment
    if settings.log_format == "json":
        log_format = (
            '{{"time": "{time:YYYY-MM-DD HH:mm:ss.SSS}", '
            '"level": "{level.name}", '
            '"message": "{message}", '
            '"module": "{module}", '
            '"function": "{function}", '
            '"line": {line}}}'
        )
    else:
        log_format = (
            "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{module}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        )
    
    # Console handler
    logger.add(
        sys.stdout,
        format=log_format,
        level=settings.log_level,
        colorize=settings.log_format != "json",
        serialize=False
    )
    
    # File handler (if configured)
    if settings.log_file:
        log_path = Path(settings.log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        
        logger.add(
            settings.log_file,
            format=log_format,
            level=settings.log_level,
            rotation="10 MB",
            retention="7 days",
            compression="gz",
            serialize=settings.log_format == "json"
        )
    
    # Error file handler
    if settings.log_file:
        error_log = settings.log_file.replace(".log", ".error.log")
        logger.add(
            error_log,
            format=log_format,
            level="ERROR",
            rotation="10 MB",
            retention="30 days",
            compression="gz"
        )
    
    logger.info(f"Logger initialized - Level: {settings.log_level}")


# Initialize logger on import
setup_logger()


__all__ = ["logger"]
