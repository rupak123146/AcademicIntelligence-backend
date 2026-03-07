"""
🎓 Academic Intelligence Platform - Models Package
"""

from src.models.schemas import (
    # Enums
    MasteryLevel,
    DifficultyLevel,
    GapSeverity,
    GapType,
    TrendDirection,
    FeedbackType,
    PerformanceTag,
    
    # Chapter Analysis
    ChapterPerformance,
    ChapterAnalysisResponse,
    
    # Concept Analysis
    ConceptPerformance,
    ConceptAnalysisResponse,
    
    # Difficulty Analysis
    DifficultyPerformance,
    DifficultyAnalysisResponse,
    
    # Learning Gaps
    LearningGap,
    LearningGapsResponse,
    
    # Trend Analysis
    TrendDataPoint,
    PerformanceTrend,
    
    # Feedback
    FeedbackItem,
    PersonalizedFeedback,
    
    # Class Analytics
    ClassStatistics,
    GradeDistribution,
    WeakArea,
    QuestionEffectiveness,
    AtRiskStudent,
    ClassAnalyticsResponse,
    
    # Dashboards
    StudentDashboard,
    EducatorDashboard,
    
    # Requests
    AnalyzeExamRequest,
    BatchAnalysisRequest,
    CompareStudentsRequest,
    
    # Response
    APIResponse
)

from src.models.enhanced_models import (
    # Enums
    RiskLevel,
    AnomalyType,
    
    # Risk Detection
    RiskFactor,
    StudentRiskProfile,
    
    # Personalized Feedback & Resources
    Resource,
    ResourceRecommendation,
    
    # Exam Proctoring
    ExamActivity,
    ProctorAlert,
    RealTimeExamStatus,
    
    # Fairness
    BiasIndicator,
    FairnessAnalysis,
    
    # Item Analysis (Phase 2)
    DifficultLevel,
    DiscriminationLevel,
    DistractorOption,
    DistractorAnalysis,
    ItemRecommendation,
    ItemAnalysis,
    ItemStatistics,
    
    # Audit & Compliance
    AuditLog,
    ComplianceReport,
    
    # Predictive
    PerformanceForecast,
    DropoutRisk,
    
    # Reporting
    ReportSection,
    AnalyticsReport,
    
    # Study Plans
    StudyActivity,
    PersonalizedStudyPlan,
    
    # Comparative
    StudentComparison,
    ClassComparison,
)


__all__ = [
    # Enums (original)
    "MasteryLevel",
    "DifficultyLevel",
    "GapSeverity",
    "GapType",
    "TrendDirection",
    "FeedbackType",
    "PerformanceTag",
    
    # Chapter Analysis
    "ChapterPerformance",
    "ChapterAnalysisResponse",
    
    # Concept Analysis
    "ConceptPerformance",
    "ConceptAnalysisResponse",
    
    # Difficulty Analysis
    "DifficultyPerformance",
    "DifficultyAnalysisResponse",
    
    # Learning Gaps
    "LearningGap",
    "LearningGapsResponse",
    
    # Trend Analysis
    "TrendDataPoint",
    "PerformanceTrend",
    
    # Feedback
    "FeedbackItem",
    "PersonalizedFeedback",
    
    # Class Analytics
    "ClassStatistics",
    "GradeDistribution",
    "WeakArea",
    "QuestionEffectiveness",
    "AtRiskStudent",
    "ClassAnalyticsResponse",
    
    # Dashboards
    "StudentDashboard",
    "EducatorDashboard",
    
    # Requests
    "AnalyzeExamRequest",
    "BatchAnalysisRequest",
    "CompareStudentsRequest",
    
    # Response
    "APIResponse",
    
    # New Enhanced Models
    # Enums
    "RiskLevel",
    "AnomalyType",
    
    # Risk Detection
    "RiskFactor",
    "StudentRiskProfile",
    
    # Resources
    "Resource",
    "ResourceRecommendation",
    
    # Exam Proctoring
    "ExamActivity",
    "ProctorAlert",
    "RealTimeExamStatus",
    
    # Fairness
    "BiasIndicator",
    "FairnessAnalysis",
    
    # Item Analysis (Phase 2)
    "DifficultLevel",
    "DiscriminationLevel",
    "DistractorOption",
    "DistractorAnalysis",
    "ItemRecommendation",
    "ItemAnalysis",
    "ItemStatistics",
    
    # Audit & Compliance
    "AuditLog",
    "ComplianceReport",
    
    # Predictive
    "PerformanceForecast",
    "DropoutRisk",
    
    # Reporting
    "ReportSection",
    "AnalyticsReport",
    
    # Study Plans
    "StudyActivity",
    "PersonalizedStudyPlan",
    
    # Comparative
    "StudentComparison",
    "ClassComparison",
]
