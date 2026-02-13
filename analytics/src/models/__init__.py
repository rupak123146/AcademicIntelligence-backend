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


__all__ = [
    # Enums
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
    "APIResponse"
]
