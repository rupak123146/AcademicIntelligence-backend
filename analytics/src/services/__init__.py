"""
🎓 Academic Intelligence Platform - Services Package
"""

from src.services.chapter_analyzer import chapter_analyzer, ChapterAnalyzer
from src.services.concept_analyzer import concept_analyzer, ConceptAnalyzer
from src.services.difficulty_analyzer import difficulty_analyzer, DifficultyAnalyzer
from src.services.gap_detector import gap_detector, GapDetector
from src.services.trend_analyzer import trend_analyzer, TrendAnalyzer
from src.services.feedback_generator import feedback_generator, FeedbackGenerator
from src.services.class_analyzer import class_analyzer, ClassAnalyzer


__all__ = [
    # Chapter Analysis
    "chapter_analyzer",
    "ChapterAnalyzer",
    
    # Concept Analysis
    "concept_analyzer",
    "ConceptAnalyzer",
    
    # Difficulty Analysis
    "difficulty_analyzer",
    "DifficultyAnalyzer",
    
    # Gap Detection
    "gap_detector",
    "GapDetector",
    
    # Trend Analysis
    "trend_analyzer",
    "TrendAnalyzer",
    
    # Feedback Generation
    "feedback_generator",
    "FeedbackGenerator",
    
    # Class Analytics
    "class_analyzer",
    "ClassAnalyzer"
]


async def initialize_all_services():
    """Initialize all analytics services."""
    await chapter_analyzer.initialize()
    await concept_analyzer.initialize()
    await difficulty_analyzer.initialize()
    await gap_detector.initialize()
    await trend_analyzer.initialize()
    await feedback_generator.initialize()
    await class_analyzer.initialize()
