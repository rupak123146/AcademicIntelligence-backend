"""
🎓 Academic Intelligence Platform - Data Models (Schemas)
"""

from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict


# =====================================================
# Enums
# =====================================================

class MasteryLevel(str, Enum):
    EXPERT = "expert"
    ADVANCED = "advanced"
    INTERMEDIATE = "intermediate"
    BEGINNER = "beginner"
    NOVICE = "novice"


class DifficultyLevel(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    EXPERT = "expert"


class GapSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class GapType(str, Enum):
    FOUNDATIONAL = "foundational"
    CONCEPTUAL = "conceptual"
    APPLICATION = "application"
    SPEED = "speed"


class TrendDirection(str, Enum):
    IMPROVING = "improving"
    DECLINING = "declining"
    STABLE = "stable"
    INSUFFICIENT_DATA = "insufficient_data"


class FeedbackType(str, Enum):
    STRENGTH = "strength"
    IMPROVEMENT = "improvement"
    RECOMMENDATION = "recommendation"
    ACHIEVEMENT = "achievement"
    WARNING = "warning"


class PerformanceTag(str, Enum):
    EXCELLENT = "excellent"
    ABOVE_AVERAGE = "above_average"
    AVERAGE = "average"
    BELOW_AVERAGE = "below_average"
    NEEDS_IMPROVEMENT = "needs_improvement"


# =====================================================
# Base Schemas
# =====================================================

class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TimestampMixin(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# =====================================================
# Chapter Analysis Schemas
# =====================================================

class ChapterPerformance(BaseSchema):
    """Individual chapter performance metrics."""
    chapter_id: int
    chapter_name: str
    total_questions: int
    correct_answers: int
    incorrect_answers: int
    skipped_answers: int
    accuracy: float = Field(..., ge=0, le=100)
    mastery_level: MasteryLevel
    avg_time_per_question: float  # seconds
    total_time_spent: int  # seconds
    improvement_from_last: Optional[float] = None  # percentage points


class ChapterAnalysisResponse(BaseSchema):
    """Response for chapter-wise analysis."""
    student_id: int
    exam_id: Optional[int] = None
    course_id: int
    analysis_date: datetime
    chapters: List[ChapterPerformance]
    overall_accuracy: float
    strongest_chapter: Optional[ChapterPerformance] = None
    weakest_chapter: Optional[ChapterPerformance] = None


# =====================================================
# Concept Analysis Schemas
# =====================================================

class ConceptPerformance(BaseSchema):
    """Individual concept performance metrics."""
    concept_id: int
    concept_name: str
    chapter_id: int
    chapter_name: str
    total_attempts: int
    correct_attempts: int
    accuracy: float = Field(..., ge=0, le=100)
    understanding_score: float = Field(..., ge=0, le=100)
    time_efficiency: float = Field(..., ge=0, le=100)
    consistency: float = Field(..., ge=0, le=100)
    mastery_level: MasteryLevel
    prerequisites: List[int] = []
    is_prerequisite_weak: bool = False


class ConceptAnalysisResponse(BaseSchema):
    """Response for concept-wise analysis."""
    student_id: int
    chapter_id: Optional[int] = None
    course_id: int
    analysis_date: datetime
    concepts: List[ConceptPerformance]
    mastered_concepts: int
    struggling_concepts: int


# =====================================================
# Difficulty Analysis Schemas
# =====================================================

class DifficultyPerformance(BaseSchema):
    """Performance by difficulty level."""
    difficulty: DifficultyLevel
    total_questions: int
    correct_answers: int
    accuracy: float = Field(..., ge=0, le=100)
    avg_time: float  # seconds
    benchmark: float  # expected accuracy
    performance_tag: PerformanceTag
    deviation_from_benchmark: float  # percentage points


class DifficultyAnalysisResponse(BaseSchema):
    """Response for difficulty-wise analysis."""
    student_id: int
    exam_id: Optional[int] = None
    course_id: Optional[int] = None
    analysis_date: datetime
    difficulty_breakdown: Dict[DifficultyLevel, DifficultyPerformance]
    difficulty_transition_issue: bool = False
    recommended_difficulty: DifficultyLevel


# =====================================================
# Learning Gap Schemas
# =====================================================

class LearningGap(BaseSchema):
    """Individual learning gap."""
    gap_id: str
    gap_type: GapType
    severity: GapSeverity
    chapter_id: Optional[int] = None
    chapter_name: Optional[str] = None
    concept_id: Optional[int] = None
    concept_name: Optional[str] = None
    prerequisite_id: Optional[int] = None
    prerequisite_name: Optional[str] = None
    current_accuracy: float
    target_accuracy: float = 70.0
    impact_score: float = Field(..., ge=0, le=100)  # How much this gap affects overall performance
    recommendation: str
    action_items: List[str] = []
    estimated_fix_time: Optional[str] = None  # e.g., "2-3 hours"


class LearningGapsResponse(BaseSchema):
    """Response for learning gaps detection."""
    student_id: int
    course_id: int
    analysis_date: datetime
    total_gaps: int
    critical_gaps: int
    high_gaps: int
    gaps: List[LearningGap]
    priority_order: List[str]  # gap_ids in priority order


# =====================================================
# Trend Analysis Schemas
# =====================================================

class TrendDataPoint(BaseSchema):
    """Single data point in trend."""
    exam_id: int
    exam_date: datetime
    score: float
    exam_title: Optional[str] = None


class PerformanceTrend(BaseSchema):
    """Performance trend analysis."""
    student_id: int
    course_id: int
    analysis_date: datetime
    direction: TrendDirection
    slope: float  # Rate of change
    avg_score: float
    min_score: float
    max_score: float
    consistency_score: float = Field(..., ge=0, le=100)
    volatility: float  # Standard deviation
    data_points: List[TrendDataPoint]
    moving_average: List[float]
    predicted_next: Optional[float] = None
    confidence_level: float = Field(default=0.0, ge=0, le=100)


# =====================================================
# Feedback Schemas
# =====================================================

class FeedbackItem(BaseSchema):
    """Individual feedback item."""
    feedback_id: str
    feedback_type: FeedbackType
    priority: GapSeverity
    title: str
    description: str
    related_chapter_id: Optional[int] = None
    related_concept_id: Optional[int] = None
    action_items: List[str] = []
    resources: List[Dict[str, str]] = []  # [{title, url}]


class PersonalizedFeedback(BaseSchema):
    """Complete personalized feedback for a student."""
    student_id: int
    exam_id: Optional[int] = None
    course_id: int
    generated_at: datetime
    overall_score: Optional[float] = None
    grade: Optional[str] = None
    strengths: List[FeedbackItem]
    improvements: List[FeedbackItem]
    recommendations: List[FeedbackItem]
    achievements: List[FeedbackItem]
    warnings: List[FeedbackItem]
    summary: str


# =====================================================
# Class Analytics Schemas (Educator)
# =====================================================

class ClassStatistics(BaseSchema):
    """Statistical summary for class."""
    total_students: int
    submitted_count: int
    mean_score: float
    median_score: float
    std_dev: float
    min_score: float
    max_score: float
    pass_rate: float
    pass_threshold: float = 40.0


class GradeDistribution(BaseSchema):
    """Grade distribution."""
    grade: str
    count: int
    percentage: float


class WeakArea(BaseSchema):
    """Common weak area in class."""
    chapter_id: int
    chapter_name: str
    concept_id: Optional[int] = None
    concept_name: Optional[str] = None
    class_accuracy: float
    students_struggling: int
    struggling_percentage: float


class QuestionEffectiveness(BaseSchema):
    """Question item analysis."""
    question_id: int
    question_text: Optional[str] = None
    difficulty_index: float = Field(..., ge=0, le=1)  # % who got it right
    discrimination_index: float = Field(..., ge=-1, le=1)  # How well it differentiates
    effectiveness: str  # effective, too_easy, too_hard, poor_discriminator, needs_review
    correct_count: int
    incorrect_count: int
    common_wrong_answers: List[Dict[str, Any]] = []


class AtRiskStudent(BaseSchema):
    """Student at risk of failing."""
    student_id: int
    student_name: str
    current_score: Optional[float] = None
    trend: TrendDirection
    risk_level: GapSeverity
    main_issues: List[str]
    recommended_actions: List[str]


class ClassAnalyticsResponse(BaseSchema):
    """Complete class analytics for educator."""
    course_id: int
    exam_id: Optional[int] = None
    educator_id: int
    analysis_date: datetime
    statistics: ClassStatistics
    grade_distribution: List[GradeDistribution]
    weak_areas: List[WeakArea]
    question_effectiveness: List[QuestionEffectiveness]
    at_risk_students: List[AtRiskStudent]
    recommendations: List[str]


# =====================================================
# Dashboard Schemas
# =====================================================

class StudentDashboard(BaseSchema):
    """Student dashboard data."""
    student_id: int
    student_name: str
    course_id: Optional[int] = None
    
    # Overview
    total_exams_taken: int
    overall_accuracy: float
    overall_grade: str
    class_rank: Optional[int] = None
    percentile: Optional[float] = None
    
    # Recent activity
    recent_exams: List[Dict[str, Any]]
    
    # Performance breakdown
    chapter_performance: List[ChapterPerformance]
    difficulty_performance: Dict[str, DifficultyPerformance]
    
    # Progress
    trend: PerformanceTrend
    
    # Areas to focus
    learning_gaps: List[LearningGap]
    
    # Feedback
    recent_feedback: List[FeedbackItem]
    
    # Achievements
    achievements: List[Dict[str, Any]]


class EducatorDashboard(BaseSchema):
    """Educator dashboard data."""
    educator_id: int
    educator_name: str
    
    # Overview
    total_courses: int
    total_students: int
    total_exams_created: int
    
    # Recent exams
    recent_exam_results: List[Dict[str, Any]]
    
    # Class performance overview
    class_performance_summary: List[Dict[str, Any]]
    
    # Alerts
    at_risk_students_count: int
    pending_evaluations: int
    
    # Quick stats
    average_class_score: float
    most_challenging_topics: List[WeakArea]


# =====================================================
# Request Schemas
# =====================================================

class AnalyzeExamRequest(BaseSchema):
    """Request to analyze an exam attempt."""
    attempt_id: int
    include_feedback: bool = True
    include_gaps: bool = True


class BatchAnalysisRequest(BaseSchema):
    """Request for batch analysis."""
    student_ids: List[int]
    course_id: int
    exam_id: Optional[int] = None


class CompareStudentsRequest(BaseSchema):
    """Request to compare students."""
    student_ids: List[int]
    course_id: int
    metrics: List[str] = ["accuracy", "consistency", "trend"]


# =====================================================
# API Response Wrapper
# =====================================================

class APIResponse(BaseSchema):
    """Standard API response wrapper."""
    success: bool = True
    message: Optional[str] = None
    data: Optional[Any] = None
    errors: Optional[List[str]] = None
    meta: Optional[Dict[str, Any]] = None
