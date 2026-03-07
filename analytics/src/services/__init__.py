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
from src.services.at_risk_service import AtRiskDetectionService
from src.services.enhanced_feedback_service import EnhancedFeedbackService
from src.services.exam_monitoring_service import RealTimeExamMonitoringService
from src.services.audit_service import AuditLoggingService
from src.services.fairness_service import FairnessAnalysisService
from src.services.item_analysis_service import ItemAnalysisService
from src.services.predictive_service import PredictiveAnalyticsService
from src.services.report_service import ReportGenerationService
from src.services.randomization_service import QuestionRandomizationService
from src.services.response_time_service import ResponseTimeAnalyticsService
from src.services.goal_tracking_service import GoalTrackingService
from src.services.notification_service import NotificationService
from src.services.intervention_service import InterventionService


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
    "ClassAnalyzer",
    
    # Enhanced Services (HF-powered)
    "AtRiskDetectionService",
    "EnhancedFeedbackService",
    "RealTimeExamMonitoringService",
    "AuditLoggingService",
    "FairnessAnalysisService",
    
    # Phase 2 Services
    "ItemAnalysisService",
    "PredictiveAnalyticsService",
    "ReportGenerationService",
    
    # Phase 3 Services
    "QuestionRandomizationService",
    "ResponseTimeAnalyticsService",
    "GoalTrackingService",
    "NotificationService",
    "InterventionService",
]

# Initialize service instances
at_risk_service = AtRiskDetectionService()
enhanced_feedback_service = EnhancedFeedbackService()
exam_monitoring_service = RealTimeExamMonitoringService()
audit_service = AuditLoggingService()
fairness_service = FairnessAnalysisService()

# Phase 2 service instances
item_analysis_service = ItemAnalysisService()
predictive_service = PredictiveAnalyticsService()
report_service = ReportGenerationService()

# Phase 3 service instances
randomization_service = QuestionRandomizationService()
response_time_service = ResponseTimeAnalyticsService()
goal_tracking_service = GoalTrackingService()
notification_service = NotificationService()
intervention_service = InterventionService()


async def initialize_all_services():
    """Initialize all analytics services."""
    # Original services
    await chapter_analyzer.initialize()
    await concept_analyzer.initialize()
    await difficulty_analyzer.initialize()
    await gap_detector.initialize()
    await trend_analyzer.initialize()
    await feedback_generator.initialize()
    await class_analyzer.initialize()
    
    # Enhanced services (Phase 1)
    await at_risk_service.initialize()
    await enhanced_feedback_service.initialize()
    await exam_monitoring_service.initialize()
    await audit_service.initialize()
    await fairness_service.initialize()
    
    # Phase 2 services
    await item_analysis_service.initialize()
    await predictive_service.initialize()
    await report_service.initialize()
    
    # Phase 3 services
    await randomization_service.initialize()
    await response_time_service.initialize()
    await goal_tracking_service.initialize()
    await notification_service.initialize()
    await intervention_service.initialize()
