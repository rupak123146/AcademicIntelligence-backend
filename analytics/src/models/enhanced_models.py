"""
🎓 Enhanced Analytics Models
Data structures for all analytics features
"""

from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from datetime import datetime
from enum import Enum


class MasteryLevel(str, Enum):
    """Mastery levels"""
    DISTINGUISHED = "distinguished"
    PROFICIENT = "proficient"
    DEVELOPING = "developing"
    STRUGGLING = "struggling"


class RiskLevel(str, Enum):
    """Risk levels for student at-risk detection"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class GapSeverity(str, Enum):
    """Gap severity levels"""
    MINOR = "minor"
    MODERATE = "moderate"
    SIGNIFICANT = "significant"


class TrendDirection(str, Enum):
    """Performance trend direction"""
    IMPROVING = "improving"
    STABLE = "stable"
    DECLINING = "declining"


class AnomalyType(str, Enum):
    """Types of detected anomalies"""
    TIMING = "timing"
    PATTERNS = "patterns"
    BEHAVIOR = "behavior"


class FeedbackType(str, Enum):
    """Types of feedback"""
    STRENGTH = "strength"
    IMPROVEMENT = "improvement"
    RECOMMENDATION = "recommendation"


# ============================================================================
# RISK DETECTION MODELS
# ============================================================================

class RiskFactor(BaseModel):
    """A contributing factor to risk"""
    name: str
    description: str
    weight: float  # 0-1


class StudentRiskProfile(BaseModel):
    """Complete risk profile"""
    student_id: str
    risk_score: float = Field(0, ge=0, le=1)
    risk_level: RiskLevel
    risk_factors: List[RiskFactor]
    recommended_interventions: List[str]
    confidence: float = Field(0, ge=0, le=1)
    calculated_at: datetime
    expires_at: datetime


# ============================================================================
# FEEDBACK MODELS
# ============================================================================

class FeedbackItem(BaseModel):
    """Individual feedback item"""
    type: FeedbackType
    message: str
    priority: int  # 1-5, higher = more important
    related_concept: Optional[str] = None
    resource_links: List[Dict[str, str]] = []
    

class PersonalizedFeedback(BaseModel):
    """Complete personalized feedback"""
    student_id: str
    exam_id: Optional[str] = None
    course_id: Optional[str] = None
    feedback_items: List[FeedbackItem]
    overall_assessment: str
    improvement_pathway: List[Dict[str, Any]]
    learning_goals: List[str]
    generated_at: datetime


# ============================================================================
# RESOURCE MODELS
# ============================================================================

class Resource(BaseModel):
    """Learning resource"""
    id: str
    title: str
    description: str
    resource_type: str  # "video", "article", "practice", "interactive"
    url: str
    difficulty_level: str  # "entry", "intermediate", "advanced"
    duration_minutes: Optional[int] = None
    authors: List[str] = []


class ResourceRecommendation(BaseModel):
    """Recommended resource"""
    resource: Resource
    relevance_score: float = Field(0, ge=0, le=1)
    reason: str
    learning_need: str
    priority: int = 1


# ============================================================================
# EXAM PROCTORING MODELS
# ============================================================================

class ExamActivity(BaseModel):
    """Single exam activity event"""
    student_id: str
    exam_id: str
    event_type: str
    timestamp: datetime
    duration_seconds: Optional[int] = None
    metadata: Dict[str, Any] = {}


class ProctorAlert(BaseModel):
    """Alert during proctoring"""
    student_id: str
    exam_id: str
    alert_type: str  # "tab_switch", "copy_paste", "unusual_timing", etc.
    severity: str  # "info", "warning", "critical"
    timestamp: datetime
    description: str
    flagged_for_review: bool = False
    reviewer_notes: Optional[str] = None


class RealTimeExamStatus(BaseModel):
    """Real-time exam status for monitoring"""
    student_id: str
    exam_id: str
    status: str  # "not_started", "in_progress", "paused", "submitted"
    current_question: int
    total_questions: int
    time_elapsed: int  # seconds
    time_remaining: int  # seconds
    alerts_count: int = 0
    last_activity: datetime


# ============================================================================
# PERFORMANCE ANALYSIS MODELS
# ============================================================================

class ChapterAnalysisResponse(BaseModel):
    """Chapter-level analysis"""
    chapter_id: str
    chapter_name: str
    questions_attempted: int
    correct_answers: int
    accuracy_percentage: float
    mastery_level: MasteryLevel
    concepts: List[Dict[str, Any]] = []  # Per-concept breakdown
    difficulty_distribution: Dict[str, int]


class ConceptAnalysisResponse(BaseModel):
    """Concept-level analysis"""
    concept_id: str
    concept_name: str
    chapter_id: str
    attempts: int
    correct: int
    accuracy: float
    mastery_level: MasteryLevel
    prerequisite_gaps: List[str]
    practice_recommended: bool


class DifficultyAnalysisResponse(BaseModel):
    """Difficulty-level analysis"""
    difficulty_level: str
    questions_count: int
    correct_answers: int
    accuracy_percentage: float
    average_time_seconds: int
    mastery_level: MasteryLevel
    performance_trend: TrendDirection


class LearningGap(BaseModel):
    """Learning gap identified"""
    concept_id: str
    concept_name: str
    chapter_id: str
    gap_severity: GapSeverity
    current_accuracy: float
    target_accuracy: float
    prerequisite_gaps: List[str]
    recommended_actions: List[str]


class LearningGapsResponse(BaseModel):
    """Collection of learning gaps"""
    student_id: str
    course_id: str
    gaps: List[LearningGap]
    critical_gaps: List[LearningGap]
    immediate_actions: List[str]


class PerformanceTrend(BaseModel):
    """Performance trend over time"""
    period: str  # "weekly", "monthly", etc.
    exam_count: int
    average_score: float
    trend_direction: TrendDirection
    improvement_rate: float  # percentage change
    consistency_score: float  # 0-1, how consistent is performance


# ============================================================================
# FAIRNESS & BIAS MODELS
# ============================================================================

class BiasIndicator(BaseModel):
    """Bias indicator for an item"""
    item_id: str
    item_question: str
    disparate_impact_ratio: float
    affected_demographic_groups: List[str]
    severity: str  # "low", "medium", "high"
    evidence: List[str]


class FairnessAnalysis(BaseModel):
    """Fairness analysis results"""
    analysis_date: datetime
    exam_id: Optional[str] = None
    course_id: Optional[str] = None
    biased_items: List[BiasIndicator]
    group_performance_comparison: Dict[str, float]
    overall_fairness_score: float = Field(0, ge=0, le=1)
    recommendations: List[str]


# ============================================================================
# ITEM ANALYSIS MODELS
# ============================================================================

class ItemAnalysis(BaseModel):
    """Analysis of a single exam item"""
    item_id: str
    item_text: str
    difficulty_index: float  # 0-1, higher = easier
    discrimination_index: float  # -1 to 1, higher = better discrimination
    point_biserial_correlation: Optional[float] = None
    distractor_analysis: Dict[str, float]  # option -> percentage selected
    quality_assessment: str  # "poor", "fair", "good", "excellent"
    recommendations: List[str]


class ExamReliability(BaseModel):
    """Reliability metrics for an exam"""
    exam_id: str
    cronbach_alpha: float  # Internal consistency
    test_retest_correlation: Optional[float] = None
    split_half_reliability: Optional[float] = None
    reliability_level: str  # "unacceptable", "poor", "acceptable", "good", "excellent"
    recommendations: List[str]


# ============================================================================
# AUDIT & COMPLIANCE MODELS
# ============================================================================

class AuditLog(BaseModel):
    """Single audit log entry"""
    audit_id: str
    timestamp: datetime
    user_id: str
    action: str
    resource_type: str
    resource_id: str
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    status: str  # "success", "failure"
    error_message: Optional[str] = None


class ComplianceReport(BaseModel):
    """Compliance report"""
    report_date: datetime
    report_type: str  # "FERPA", "GDPR", "COPPA", "general"
    compliance_status: Dict[str, bool]
    violations: List[str]
    recommendations: List[str]
    reviewer_name: Optional[str] = None
    reviewer_signature: Optional[str] = None


# ============================================================================
# PREDICTIVE MODELS
# ============================================================================

class PerformanceForecast(BaseModel):
    """Forecast of future performance"""
    student_id: str
    next_exam_predicted_score: float
    confidence_interval: tuple  # (lower, upper)
    probability_of_passing: float = Field(0, ge=0, le=1)
    probability_of_high_performance: float = Field(0, ge=0, le=1)
    forecast_based_on_exams: int
    generated_at: datetime


class DropoutRisk(BaseModel):
    """Dropout risk assessment"""
    student_id: str
    dropout_probability: float = Field(0, ge=0, le=1)
    risk_factors: List[str]
    protective_factors: List[str]
    recommended_interventions: List[str]
    confidence: float


# ============================================================================
# REPORTING MODELS
# ============================================================================

class ReportSection(BaseModel):
    """Section of a report"""
    section_title: str
    section_type: str  # "text", "chart", "table", "summary"
    content: Any
    insights: List[str] = []


class AnalyticsReport(BaseModel):
    """Complete analytics report"""
    report_id: str
    report_type: str  # "student_summary", "class_analytics", "institution_overview"
    generated_date: datetime
    student_id: Optional[str] = None
    course_id: Optional[str] = None
    institution_id: Optional[str] = None
    sections: List[ReportSection]
    summary: str
    export_formats: List[str] = ["pdf", "excel", "csv"]


# ============================================================================
# STUDY PLAN MODELS
# ============================================================================

class StudyActivity(BaseModel):
    """Single study activity"""
    activity_type: str  # "practice", "review", "watch_video", "read_article"
    concept_id: str
    resource_id: Optional[str] = None
    duration_minutes: int
    difficulty_level: str
    description: str


class PersonalizedStudyPlan(BaseModel):
    """Personalized study plan for a student"""
    student_id: str
    course_id: str
    plan_id: str
    created_date: datetime
    target_completion_date: datetime
    overall_goal: str
    weekly_goals: List[str]
    activities: List[StudyActivity]
    estimated_total_hours: int
    priority_areas: List[str]
    progress_percentage: float = 0


# ============================================================================
# COMPARATIVE ANALYTICS MODELS
# ============================================================================

class StudentComparison(BaseModel):
    """Comparison of one student to class"""
    student_id: str
    student_name: str
    student_score: float
    class_average: float
    class_percentile: int
    comparison_metrics: Dict[str, Any]
    strengths_relative_to_class: List[str]
    areas_needing_improvement: List[str]


# ============================================================================
# RESPONSE TIME ANALYTICS MODELS
# ============================================================================

class SpeedAccuracyMetrics(BaseModel):
    """Speed vs accuracy correlation metrics"""
    fastest_quarter_accuracy: float
    fast_quarter_accuracy: float
    slow_quarter_accuracy: float
    slowest_quarter_accuracy: float
    correlation_coefficient: float
    pattern_description: str


class TimingAnomaly(BaseModel):
    """Detected timing anomaly"""
    question_id: str
    time_taken_seconds: float
    expected_time_seconds: float
    anomaly_type: str  # "very_fast", "very_slow"
    severity: str  # "low", "medium", "high"
    description: str


class ResponseTimeAnalysis(BaseModel):
    """Comprehensive response time analysis"""
    student_id: str
    exam_id: Optional[str]
    total_questions_analyzed: int
    average_response_time_seconds: float
    response_time_std_dev: float
    speed_accuracy_metrics: SpeedAccuracyMetrics
    timing_anomalies: List[TimingAnomaly]
    effort_score: float  # 0-1 scale, indicates engagement/effort
    optimal_time_range_seconds: Dict[str, float]
    consistency_score: float  # 0-1 scale, higher = more consistent timing
    recommendations: List[str]
    analyzed_at: datetime


# ============================================================================
# GOAL TRACKING MODELS
# ============================================================================

class StudentGoal(BaseModel):
    """Student goal record"""
    id: int
    student_id: str
    course_id: str
    goal_type: str  # performance, mastery, completion, speed, engagement
    target_metric: str
    target_value: float
    current_value: float
    target_date: datetime
    description: Optional[str]
    priority: str  # high, medium, low
    status: str  # active, achieved, missed, cancelled
    created_at: datetime
    updated_at: datetime


class GoalMilestone(BaseModel):
    """Milestone within a goal"""
    id: int
    goal_id: int
    milestone_name: str
    target_value: float
    achieved: bool
    achieved_at: Optional[datetime]
    reward_message: Optional[str]


class GoalProgress(BaseModel):
    """Goal progress summary"""
    goal_id: int
    current_value: float
    target_value: float
    progress_percentage: float
    status: str
    days_remaining: int
    milestones: List[GoalMilestone]
    milestones_achieved: int


# ============================================================================
# NOTIFICATION MODELS
# ============================================================================

class Notification(BaseModel):
    """Notification record"""
    id: int
    user_id: str
    notification_type: str
    title: str
    message: str
    priority: str  # critical, high, normal, low
    read_at: Optional[datetime]
    created_at: datetime


class NotificationPreferences(BaseModel):
    """User notification preferences"""
    user_id: str
    notification_type: str
    enabled_channels: List[str]  # email, in_app, sms
    quiet_hours_start: Optional[str]  # HH:MM format
    quiet_hours_end: Optional[str]
    frequency: str  # immediate, daily_digest, weekly_digest


# ============================================================================
# INTERVENTION MODELS
# ============================================================================

class InterventionCheckIn(BaseModel):
    """Progress check-in for an intervention"""
    id: int
    intervention_id: int
    educator_id: str
    student_response: str  # positive, neutral, negative
    progress_notes: str
    next_steps: Optional[str]
    checkin_date: datetime


class InterventionOutcome(BaseModel):
    """Measured outcome of an intervention"""
    id: int
    intervention_id: int
    outcome_metric: str  # score_improvement, attendance_improvement, etc.
    baseline_value: float
    post_intervention_value: float
    improvement_percentage: float
    measured_at: datetime


class StudentIntervention(BaseModel):
    """Educator intervention for student"""
    id: int
    student_id: str
    educator_id: str
    course_id: str
    intervention_type: str  # tutoring, mentoring, resource_provision, etc.
    trigger_reason: Optional[str]
    description: str
    status: str  # planning, active, paused, completed, cancelled
    start_date: datetime
    expected_end_date: datetime
    actual_end_date: Optional[datetime]


class InterventionEffectiveness(BaseModel):
    """Effectiveness metrics for an intervention"""
    intervention_id: int
    status: str
    effectiveness: Dict[str, Any]
    duration_days: int
    outcomes_measured: int
    average_improvement_percentage: float


class ClassComparison(BaseModel):
    """Comparison of two classes"""
    class_id_1: str
    class_id_2: str
    class_name_1: str
    class_name_2: str
    average_score_1: float
    average_score_2: float
    performance_difference: float
    statistical_significance: Optional[float] = None
    similar_areas: List[str]
    different_areas: List[str]


# ============================================================================
# ITEM ANALYSIS MODELS
# ============================================================================

class DifficultLevel(str, Enum):
    """Item difficulty classification"""
    VERY_EASY = "very_easy"          # Facility > 0.85
    EASY = "easy"                     # Facility 0.70-0.85
    MODERATE = "moderate"             # Facility 0.30-0.70
    DIFFICULT = "difficult"           # Facility 0.15-0.30
    VERY_DIFFICULT = "very_difficult" # Facility < 0.15


class DiscriminationLevel(str, Enum):
    """Item discrimination quality"""
    EXCELLENT = "excellent"  # D >= 0.40
    GOOD = "good"           # D >= 0.30
    FAIR = "fair"           # D >= 0.20
    POOR = "poor"           # D >= 0.0
    NEGATIVE = "negative"   # D < 0.0 (problematic!)


class DistractorOption(BaseModel):
    """Analysis of a single distractor option"""
    option_value: str
    selection_count: int
    selection_rate: float
    average_score_of_selectors: float
    is_plausible: bool  # Selected by >= 5% of students


class DistractorAnalysis(BaseModel):
    """Distractor effectiveness analysis"""
    correct_answer: str
    distractor_options: List[DistractorOption]
    non_functional_distractors: int  # Count selected by <5%
    total_options: int


class ItemRecommendation(BaseModel):
    """Recommendation for item improvement"""
    category: str  # "difficulty", "discrimination", "distractors", "quality"
    severity: str  # "critical", "high", "medium", "low", "info"
    message: str
    action: str


class ItemAnalysis(BaseModel):
    """Complete analysis of a single assessment item"""
    item_id: str
    exam_id: str
    
    # Facility index (difficulty)
    facility_index: float  # 0.0 to 1.0 (proportion correct)
    difficulty_level: DifficultLevel
    
    # Discrimination index
    discrimination_index: float  # -1.0 to 1.0
    discrimination_level: DiscriminationLevel
    
    # Response data
    total_responses: int
    correct_responses: int
    
    # Distractor analysis
    distractor_analysis: Optional[DistractorAnalysis] = None
    
    # Recommendations
    recommendations: List[ItemRecommendation]
    
    # Metadata
    analysis_date: datetime


class ItemStatistics(BaseModel):
    """Statistical summary for item analysis"""
    exam_id: str
    total_items: int
    average_facility_index: float
    average_discrimination_index: float
    items_needing_revision: int
    quality_score: float  # 0-100 scale
