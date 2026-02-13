"""
🎓 Academic Intelligence Platform - Feedback Generation Service

Generates personalized, actionable feedback based on comprehensive analysis.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
import uuid

from src.config import db
from src.models import (
    FeedbackItem,
    PersonalizedFeedback,
    FeedbackType,
    GapSeverity,
    ChapterAnalysisResponse,
    DifficultyAnalysisResponse,
    LearningGapsResponse,
    PerformanceTrend,
    MasteryLevel,
    TrendDirection
)
from src.utils import (
    logger,
    calculate_grade,
    get_mastery_level
)


class FeedbackGenerator:
    """
    Generates personalized feedback based on comprehensive analysis.
    
    Feedback is designed to be:
    - Positive and encouraging
    - Specific and actionable
    - Prioritized by impact
    - Tailored to individual student patterns
    """
    
    def __init__(self):
        self.pool = None
        self.mongo_db = None
    
    async def initialize(self):
        """Initialize database connections."""
        self.pool = db.pg_pool
        self.mongo_db = db.mongo_db
    
    async def generate_feedback(
        self,
        student_id: int,
        course_id: int,
        exam_id: Optional[int] = None,
        chapter_analysis: Optional[ChapterAnalysisResponse] = None,
        difficulty_analysis: Optional[DifficultyAnalysisResponse] = None,
        gaps: Optional[LearningGapsResponse] = None,
        trend: Optional[PerformanceTrend] = None
    ) -> PersonalizedFeedback:
        """
        Generate comprehensive personalized feedback.
        
        Args:
            student_id: Student's ID
            course_id: Course ID
            exam_id: Optional specific exam
            chapter_analysis: Pre-computed chapter analysis
            difficulty_analysis: Pre-computed difficulty analysis
            gaps: Pre-computed learning gaps
            trend: Pre-computed trend analysis
        
        Returns:
            PersonalizedFeedback with categorized feedback items
        """
        logger.info(f"Generating feedback for student {student_id}")
        
        try:
            # Get exam score if exam_id provided
            overall_score = None
            grade = None
            
            if exam_id:
                score_data = await self._get_exam_score(student_id, exam_id)
                if score_data:
                    overall_score = score_data['percentage']
                    grade = calculate_grade(overall_score)
            
            # Initialize feedback categories
            strengths = []
            improvements = []
            recommendations = []
            achievements = []
            warnings = []
            
            # Generate strength feedback from chapter analysis
            if chapter_analysis:
                strength_items = self._generate_strength_feedback(chapter_analysis)
                strengths.extend(strength_items)
                
                improvement_items = self._generate_improvement_feedback(chapter_analysis)
                improvements.extend(improvement_items)
            
            # Generate difficulty-based feedback
            if difficulty_analysis:
                diff_feedback = self._generate_difficulty_feedback(difficulty_analysis)
                for item in diff_feedback:
                    if item.feedback_type == FeedbackType.STRENGTH:
                        strengths.append(item)
                    elif item.feedback_type == FeedbackType.IMPROVEMENT:
                        improvements.append(item)
                    else:
                        recommendations.append(item)
            
            # Generate gap-based recommendations
            if gaps:
                gap_items = self._generate_gap_feedback(gaps)
                recommendations.extend(gap_items)
                
                # Add warnings for critical gaps
                for gap in gaps.gaps:
                    if gap.severity == GapSeverity.CRITICAL:
                        warnings.append(FeedbackItem(
                            feedback_id=str(uuid.uuid4()),
                            feedback_type=FeedbackType.WARNING,
                            priority=GapSeverity.CRITICAL,
                            title=f"Critical: {gap.chapter_name or gap.concept_name}",
                            description=f"This area requires immediate attention. {gap.recommendation}",
                            related_chapter_id=gap.chapter_id,
                            related_concept_id=gap.concept_id,
                            action_items=gap.action_items
                        ))
            
            # Generate trend-based feedback
            if trend:
                trend_items = self._generate_trend_feedback(trend)
                for item in trend_items:
                    if item.feedback_type == FeedbackType.ACHIEVEMENT:
                        achievements.append(item)
                    elif item.feedback_type == FeedbackType.WARNING:
                        warnings.append(item)
                    else:
                        recommendations.append(item)
            
            # Generate achievements
            achievement_items = await self._detect_achievements(
                student_id, course_id, chapter_analysis, trend
            )
            achievements.extend(achievement_items)
            
            # Generate summary
            summary = self._generate_summary(
                overall_score, grade, len(strengths), len(improvements),
                len(warnings), trend
            )
            
            return PersonalizedFeedback(
                student_id=student_id,
                exam_id=exam_id,
                course_id=course_id,
                generated_at=datetime.utcnow(),
                overall_score=overall_score,
                grade=grade,
                strengths=strengths[:5],  # Limit to top 5
                improvements=improvements[:5],
                recommendations=recommendations[:5],
                achievements=achievements[:3],
                warnings=warnings[:3],
                summary=summary
            )
            
        except Exception as e:
            logger.error(f"Error generating feedback: {e}")
            raise
    
    async def _get_exam_score(
        self,
        student_id: int,
        exam_id: int
    ) -> Optional[Dict[str, Any]]:
        """Get exam score for a specific attempt."""
        query = """
            SELECT percentage, total_marks, obtained_marks
            FROM exam_attempts
            WHERE student_id = $1 AND exam_id = $2 AND status = 'evaluated'
            ORDER BY submitted_at DESC
            LIMIT 1
        """
        
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, student_id, exam_id)
            if row:
                return {
                    'percentage': float(row['percentage']) if row['percentage'] else 0,
                    'total_marks': row['total_marks'],
                    'obtained_marks': float(row['obtained_marks']) if row['obtained_marks'] else 0
                }
        return None
    
    def _generate_strength_feedback(
        self,
        chapter_analysis: ChapterAnalysisResponse
    ) -> List[FeedbackItem]:
        """Generate feedback for strong chapters."""
        strengths = []
        
        # Sort chapters by accuracy descending
        sorted_chapters = sorted(
            chapter_analysis.chapters,
            key=lambda x: x.accuracy,
            reverse=True
        )
        
        for chapter in sorted_chapters[:3]:  # Top 3 strong chapters
            if chapter.accuracy >= 75:
                if chapter.mastery_level in [MasteryLevel.EXPERT, MasteryLevel.ADVANCED]:
                    title = f"Excellent mastery in {chapter.chapter_name}!"
                    description = (
                        f"You've achieved {chapter.accuracy:.1f}% accuracy with "
                        f"{chapter.mastery_level.value} level mastery. Keep up the great work!"
                    )
                else:
                    title = f"Good performance in {chapter.chapter_name}"
                    description = (
                        f"You scored {chapter.accuracy:.1f}% in this chapter. "
                        f"You're on track to mastering this topic."
                    )
                
                strengths.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.STRENGTH,
                    priority=GapSeverity.LOW,
                    title=title,
                    description=description,
                    related_chapter_id=chapter.chapter_id,
                    action_items=[
                        "Continue practicing to maintain your edge",
                        "Consider helping classmates with this topic",
                        "Try more challenging problems in this area"
                    ]
                ))
        
        return strengths
    
    def _generate_improvement_feedback(
        self,
        chapter_analysis: ChapterAnalysisResponse
    ) -> List[FeedbackItem]:
        """Generate feedback for chapters needing improvement."""
        improvements = []
        
        # Sort chapters by accuracy ascending
        sorted_chapters = sorted(
            chapter_analysis.chapters,
            key=lambda x: x.accuracy
        )
        
        for chapter in sorted_chapters[:3]:  # Bottom 3 chapters
            if chapter.accuracy < 60:
                severity = (
                    GapSeverity.CRITICAL if chapter.accuracy < 30 else
                    GapSeverity.HIGH if chapter.accuracy < 45 else
                    GapSeverity.MEDIUM
                )
                
                title = f"Focus needed in {chapter.chapter_name}"
                
                if chapter.accuracy < 30:
                    description = (
                        f"Your {chapter.accuracy:.1f}% accuracy in this chapter suggests "
                        f"significant gaps in understanding. Let's work on building a stronger foundation."
                    )
                    action_items = [
                        "Review the chapter's fundamental concepts",
                        "Work through basic examples before advancing",
                        "Consider watching tutorial videos",
                        "Schedule time with a tutor if needed"
                    ]
                else:
                    description = (
                        f"You scored {chapter.accuracy:.1f}% in {chapter.chapter_name}. "
                        f"With some focused practice, you can significantly improve."
                    )
                    action_items = [
                        "Identify specific concepts you find challenging",
                        "Practice with varied problem types",
                        "Review your mistakes to understand patterns"
                    ]
                
                # Check for improvement
                if chapter.improvement_from_last and chapter.improvement_from_last > 0:
                    description += f" Great news: you've improved by {chapter.improvement_from_last:.1f}% since last time!"
                
                improvements.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.IMPROVEMENT,
                    priority=severity,
                    title=title,
                    description=description,
                    related_chapter_id=chapter.chapter_id,
                    action_items=action_items
                ))
        
        return improvements
    
    def _generate_difficulty_feedback(
        self,
        analysis: DifficultyAnalysisResponse
    ) -> List[FeedbackItem]:
        """Generate feedback based on difficulty analysis."""
        feedback = []
        
        for difficulty, perf in analysis.difficulty_breakdown.items():
            if perf.deviation_from_benchmark >= 15:
                # Performing well above benchmark
                feedback.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.STRENGTH,
                    priority=GapSeverity.LOW,
                    title=f"Strong on {difficulty.value} questions",
                    description=(
                        f"You're {perf.deviation_from_benchmark:.1f}% above benchmark "
                        f"on {difficulty.value} questions. Consider challenging yourself "
                        f"with harder problems."
                    ),
                    action_items=[f"Try more {analysis.recommended_difficulty.value} level questions"]
                ))
            elif perf.deviation_from_benchmark <= -15:
                # Performing below benchmark
                feedback.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.IMPROVEMENT,
                    priority=GapSeverity.MEDIUM,
                    title=f"Difficulty with {difficulty.value} questions",
                    description=(
                        f"Your accuracy on {difficulty.value} questions is "
                        f"{abs(perf.deviation_from_benchmark):.1f}% below expected. "
                        f"Focus on building confidence at this level."
                    ),
                    action_items=[
                        f"Practice more {difficulty.value} level problems",
                        "Review problem-solving strategies",
                        "Don't rush - focus on understanding"
                    ]
                ))
        
        # Transition issue feedback
        if analysis.difficulty_transition_issue:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.RECOMMENDATION,
                priority=GapSeverity.MEDIUM,
                title="Difficulty transition challenge",
                description=(
                    "You perform well on easier questions but struggle when difficulty increases. "
                    "This often indicates a need to strengthen foundational understanding."
                ),
                action_items=[
                    "Focus on understanding 'why', not just 'how'",
                    "Practice progressively harder problems",
                    "Build bridge concepts between difficulty levels"
                ]
            ))
        
        return feedback
    
    def _generate_gap_feedback(
        self,
        gaps: LearningGapsResponse
    ) -> List[FeedbackItem]:
        """Generate feedback from learning gaps."""
        feedback = []
        
        for gap in gaps.gaps[:5]:  # Top 5 gaps
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.RECOMMENDATION,
                priority=gap.severity,
                title=f"Learning gap: {gap.concept_name or gap.chapter_name}",
                description=gap.recommendation,
                related_chapter_id=gap.chapter_id,
                related_concept_id=gap.concept_id,
                action_items=gap.action_items,
                resources=[]  # TODO: Add resource recommendations
            ))
        
        return feedback
    
    def _generate_trend_feedback(
        self,
        trend: PerformanceTrend
    ) -> List[FeedbackItem]:
        """Generate feedback based on performance trend."""
        feedback = []
        
        if trend.direction == TrendDirection.IMPROVING:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.ACHIEVEMENT,
                priority=GapSeverity.LOW,
                title="🎉 You're improving!",
                description=(
                    f"Your scores have been trending upward. "
                    f"Keep up the great work! Your consistency score is {trend.consistency_score:.1f}%."
                ),
                action_items=[
                    "Maintain your current study habits",
                    "Set new challenging goals",
                    "Celebrate your progress!"
                ]
            ))
            
            if trend.predicted_next and trend.confidence_level > 60:
                feedback.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.RECOMMENDATION,
                    priority=GapSeverity.LOW,
                    title="Performance prediction",
                    description=(
                        f"Based on your trend, you're predicted to score around "
                        f"{trend.predicted_next:.1f}% on your next exam. "
                        f"Stay focused to achieve or exceed this!"
                    ),
                    action_items=[]
                ))
        
        elif trend.direction == TrendDirection.DECLINING:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.WARNING,
                priority=GapSeverity.HIGH,
                title="⚠️ Performance declining",
                description=(
                    f"Your recent scores show a declining trend. "
                    f"Let's identify what's changed and get back on track."
                ),
                action_items=[
                    "Review what worked for you before",
                    "Check if study time or methods have changed",
                    "Consider seeking help early",
                    "Focus on fundamentals before advancing"
                ]
            ))
        
        elif trend.direction == TrendDirection.STABLE:
            if trend.avg_score >= 70:
                feedback.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.RECOMMENDATION,
                    priority=GapSeverity.LOW,
                    title="Consistent performance",
                    description=(
                        f"Your scores are stable at {trend.avg_score:.1f}%. "
                        f"Consider pushing yourself to the next level!"
                    ),
                    action_items=[
                        "Set stretch goals",
                        "Try more challenging problems",
                        "Explore advanced topics"
                    ]
                ))
            else:
                feedback.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.RECOMMENDATION,
                    priority=GapSeverity.MEDIUM,
                    title="Room for improvement",
                    description=(
                        f"Your scores are consistent but below target at {trend.avg_score:.1f}%. "
                        f"Let's work on breaking through this plateau."
                    ),
                    action_items=[
                        "Try new study techniques",
                        "Focus on your weakest areas",
                        "Consider additional practice resources"
                    ]
                ))
        
        # High volatility warning
        if trend.volatility > 15:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.WARNING,
                priority=GapSeverity.MEDIUM,
                title="Inconsistent performance",
                description=(
                    f"Your scores vary significantly (±{trend.volatility:.1f}%). "
                    f"Building consistency will help you perform reliably."
                ),
                action_items=[
                    "Establish a regular study routine",
                    "Practice under exam-like conditions",
                    "Work on time management during exams"
                ]
            ))
        
        return feedback
    
    async def _detect_achievements(
        self,
        student_id: int,
        course_id: int,
        chapter_analysis: Optional[ChapterAnalysisResponse],
        trend: Optional[PerformanceTrend]
    ) -> List[FeedbackItem]:
        """Detect and generate achievement feedback."""
        achievements = []
        
        # Expert mastery achievement
        if chapter_analysis:
            expert_chapters = [
                c for c in chapter_analysis.chapters 
                if c.mastery_level == MasteryLevel.EXPERT
            ]
            if len(expert_chapters) >= 3:
                achievements.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.ACHIEVEMENT,
                    priority=GapSeverity.LOW,
                    title="🏆 Multi-chapter Expert!",
                    description=f"You've achieved expert mastery in {len(expert_chapters)} chapters!",
                    action_items=["Consider helping others learn these topics"]
                ))
        
        # Perfect score achievement
        if chapter_analysis:
            perfect_chapters = [c for c in chapter_analysis.chapters if c.accuracy == 100]
            if perfect_chapters:
                achievements.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.ACHIEVEMENT,
                    priority=GapSeverity.LOW,
                    title="💯 Perfect Score!",
                    description=f"100% accuracy in: {', '.join([c.chapter_name for c in perfect_chapters[:3]])}",
                    action_items=[]
                ))
        
        # Consistency achievement
        if trend and trend.consistency_score >= 90:
            achievements.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.ACHIEVEMENT,
                priority=GapSeverity.LOW,
                title="🎯 Consistency Champion!",
                description=f"Your {trend.consistency_score:.1f}% consistency shows reliable performance!",
                action_items=[]
            ))
        
        # Improvement achievement
        if trend and trend.direction == TrendDirection.IMPROVING and trend.slope > 2:
            achievements.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.ACHIEVEMENT,
                priority=GapSeverity.LOW,
                title="📈 Rapid Improver!",
                description="Your scores have shown significant improvement recently!",
                action_items=[]
            ))
        
        return achievements
    
    def _generate_summary(
        self,
        overall_score: Optional[float],
        grade: Optional[str],
        num_strengths: int,
        num_improvements: int,
        num_warnings: int,
        trend: Optional[PerformanceTrend]
    ) -> str:
        """Generate a summary paragraph for the feedback."""
        parts = []
        
        if overall_score is not None:
            parts.append(f"You scored {overall_score:.1f}%{f' (Grade: {grade})' if grade else ''}.")
        
        if num_strengths > 0:
            parts.append(f"You have {num_strengths} areas of strength to be proud of.")
        
        if num_improvements > 0:
            parts.append(f"There are {num_improvements} areas where focused practice will help you improve.")
        
        if num_warnings > 0:
            parts.append(f"Pay attention to {num_warnings} area(s) that need immediate attention.")
        
        if trend:
            if trend.direction == TrendDirection.IMPROVING:
                parts.append("Your overall trajectory is positive - keep up the momentum!")
            elif trend.direction == TrendDirection.DECLINING:
                parts.append("Let's work together to reverse the recent decline in performance.")
            elif trend.direction == TrendDirection.STABLE and trend.avg_score >= 70:
                parts.append("Your consistent performance provides a solid foundation to build upon.")
        
        return " ".join(parts) if parts else "Keep working hard and your efforts will pay off!"
    
    async def store_feedback(
        self,
        feedback: PersonalizedFeedback
    ) -> bool:
        """Store generated feedback in MongoDB."""
        
        try:
            # Convert to dictionary
            feedback_doc = {
                "student_id": feedback.student_id,
                "exam_id": feedback.exam_id,
                "course_id": feedback.course_id,
                "generated_at": feedback.generated_at,
                "overall_score": feedback.overall_score,
                "grade": feedback.grade,
                "strengths": [f.model_dump() for f in feedback.strengths],
                "improvements": [f.model_dump() for f in feedback.improvements],
                "recommendations": [f.model_dump() for f in feedback.recommendations],
                "achievements": [f.model_dump() for f in feedback.achievements],
                "warnings": [f.model_dump() for f in feedback.warnings],
                "summary": feedback.summary,
                "is_read": False
            }
            
            await self.mongo_db.student_feedback.insert_one(feedback_doc)
            
            logger.info(f"Stored feedback for student {feedback.student_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing feedback: {e}")
            return False
    
    async def get_feedback_templates(
        self,
        feedback_type: FeedbackType
    ) -> List[Dict[str, str]]:
        """Get feedback templates from MongoDB."""
        
        cursor = self.mongo_db.feedback_templates.find({
            "feedback_type": feedback_type.value,
            "is_active": True
        })
        
        templates = await cursor.to_list(length=100)
        return templates


# Singleton instance
feedback_generator = FeedbackGenerator()
