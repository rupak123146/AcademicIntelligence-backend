"""
Academic Intelligence Platform - AI-Powered Feedback Generation Service
Generates personalized, actionable feedback using HuggingFace T5 model
combined with comprehensive rule-based analysis.
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
from src.models.huggingface_models import get_model_manager
from src.utils import (
    logger,
    calculate_grade,
    get_mastery_level
)


class FeedbackGenerator:
    """
    Generates personalized feedback using HuggingFace AI models
    combined with rule-based analysis for comprehensive, accurate feedback.
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
        student_id: str,
        course_id: str,
        exam_id: Optional[str] = None,
        chapter_analysis: Optional[ChapterAnalysisResponse] = None,
        difficulty_analysis: Optional[DifficultyAnalysisResponse] = None,
        gaps: Optional[LearningGapsResponse] = None,
        trend: Optional[PerformanceTrend] = None
    ) -> PersonalizedFeedback:
        """
        Generate comprehensive personalized feedback using AI + rules.
        
        Combines:
        1. Rule-based analysis from chapter/difficulty/gap/trend data
        2. HuggingFace T5 AI-generated natural language feedback
        3. Achievement detection and encouragement
        """
        logger.info(f"Generating AI-powered feedback for student {student_id}")
        
        try:
            overall_score = None
            grade = None
            
            if exam_id:
                score_data = await self._get_exam_score(student_id, exam_id)
                if score_data:
                    overall_score = score_data['percentage']
                    grade = calculate_grade(overall_score)
            
            # Rule-based categorized feedback
            strengths = []
            improvements = []
            recommendations = []
            achievements = []
            warnings = []
            
            if chapter_analysis:
                strengths.extend(self._generate_strength_feedback(chapter_analysis))
                improvements.extend(self._generate_improvement_feedback(chapter_analysis))
            
            if difficulty_analysis:
                for item in self._generate_difficulty_feedback(difficulty_analysis):
                    if item.feedback_type == FeedbackType.STRENGTH:
                        strengths.append(item)
                    elif item.feedback_type == FeedbackType.IMPROVEMENT:
                        improvements.append(item)
                    else:
                        recommendations.append(item)
            
            if gaps:
                recommendations.extend(self._generate_gap_feedback(gaps))
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
            
            if trend:
                for item in self._generate_trend_feedback(trend):
                    if item.feedback_type == FeedbackType.ACHIEVEMENT:
                        achievements.append(item)
                    elif item.feedback_type == FeedbackType.WARNING:
                        warnings.append(item)
                    else:
                        recommendations.append(item)
            
            achievement_items = self._detect_achievements(chapter_analysis, trend)
            achievements.extend(achievement_items)
            
            # === AI-POWERED ENHANCEMENT ===
            # Use HuggingFace T5 to generate natural language feedback
            ai_feedback = await self._generate_ai_feedback(
                overall_score, grade, chapter_analysis, difficulty_analysis, gaps, trend
            )
            
            if ai_feedback:
                # Merge AI-generated insights with rule-based feedback
                for ai_strength in ai_feedback.get('strengths', []):
                    if ai_strength and not any(ai_strength.lower() in s.description.lower() for s in strengths):
                        strengths.append(FeedbackItem(
                            feedback_id=str(uuid.uuid4()),
                            feedback_type=FeedbackType.STRENGTH,
                            priority=GapSeverity.LOW,
                            title="AI Insight",
                            description=ai_strength,
                            action_items=[]
                        ))
                
                for ai_improvement in ai_feedback.get('improvements', []):
                    if ai_improvement and not any(ai_improvement.lower() in i.description.lower() for i in improvements):
                        improvements.append(FeedbackItem(
                            feedback_id=str(uuid.uuid4()),
                            feedback_type=FeedbackType.IMPROVEMENT,
                            priority=GapSeverity.MEDIUM,
                            title="AI Recommendation",
                            description=ai_improvement,
                            action_items=[]
                        ))
                
                for ai_rec in ai_feedback.get('recommendations', []):
                    if ai_rec:
                        recommendations.append(FeedbackItem(
                            feedback_id=str(uuid.uuid4()),
                            feedback_type=FeedbackType.RECOMMENDATION,
                            priority=GapSeverity.MEDIUM,
                            title="AI Study Recommendation",
                            description=ai_rec,
                            action_items=[]
                        ))
            
            # Generate summary (AI-enhanced if available)
            summary = ai_feedback.get('overall_message', '') if ai_feedback else ''
            if not summary:
                summary = self._generate_summary(
                    overall_score, grade, len(strengths), len(improvements), len(warnings), trend
                )
            
            return PersonalizedFeedback(
                student_id=student_id,
                exam_id=exam_id,
                course_id=course_id,
                generated_at=datetime.utcnow(),
                overall_score=overall_score,
                grade=grade,
                strengths=strengths[:5],
                improvements=improvements[:5],
                recommendations=recommendations[:5],
                achievements=achievements[:3],
                warnings=warnings[:3],
                summary=summary
            )
        except Exception as e:
            logger.error(f"Error generating feedback: {e}")
            raise
    
    async def _generate_ai_feedback(
        self, overall_score, grade, chapter_analysis, difficulty_analysis, gaps, trend
    ) -> Optional[Dict[str, Any]]:
        """Use HuggingFace T5 model to generate AI-powered feedback."""
        try:
            model_manager = await get_model_manager()
            
            # Build rich context from analysis data
            context_parts = []
            summary_parts = []
            
            if overall_score is not None:
                summary_parts.append(f"Overall score: {overall_score:.1f}%")
                if grade:
                    summary_parts.append(f"Grade: {grade}")
            
            if chapter_analysis and chapter_analysis.chapters:
                strong = [c for c in chapter_analysis.chapters if c.accuracy >= 75]
                weak = [c for c in chapter_analysis.chapters if c.accuracy < 50]
                context_parts.append(f"Strong chapters ({len(strong)}): {', '.join([c.chapter_name for c in strong[:3]])}")
                if weak:
                    context_parts.append(f"Weak chapters ({len(weak)}): {', '.join([c.chapter_name for c in weak[:3]])}")
                summary_parts.append(f"Overall chapter accuracy: {chapter_analysis.overall_accuracy:.1f}%")
            
            if difficulty_analysis:
                for diff, perf in difficulty_analysis.difficulty_breakdown.items():
                    summary_parts.append(f"{diff.value} accuracy: {perf.accuracy:.1f}%")
            
            if gaps and gaps.total_gaps > 0:
                context_parts.append(f"Learning gaps detected: {gaps.total_gaps} ({gaps.critical_gaps} critical)")
                top_gaps = [g.concept_name or g.chapter_name for g in gaps.gaps[:3] if g.concept_name or g.chapter_name]
                if top_gaps:
                    context_parts.append(f"Key gap areas: {', '.join(top_gaps)}")
            
            if trend:
                context_parts.append(f"Performance trend: {trend.direction.value}")
                summary_parts.append(f"Average score: {trend.avg_score:.1f}%")
                if trend.predicted_next:
                    summary_parts.append(f"Predicted next: {trend.predicted_next:.1f}%")
            
            context = "Student profile: " + "; ".join(context_parts) if context_parts else "Student performance data"
            summary = "Performance data: " + "; ".join(summary_parts) if summary_parts else "Score data unavailable"
            
            # Call HuggingFace T5 model
            hf_result = await model_manager.generate_feedback(context, summary)
            
            return {
                'strengths': hf_result.strengths,
                'improvements': hf_result.improvements,
                'recommendations': hf_result.recommendations,
                'overall_message': hf_result.overall_message,
                'resources': hf_result.resources
            }
        except Exception as e:
            logger.warning(f"AI feedback generation failed (using rule-based fallback): {e}")
            return None
    
    async def _get_exam_score(self, student_id: str, exam_id: str) -> Optional[Dict[str, Any]]:
        """Get exam score for a specific attempt."""
        try:
            query = """
                SELECT percentage, maxScore as total_marks, totalScore as obtained_marks
                FROM exam_attempts
                WHERE studentId = %s AND examId = %s 
                    AND status IN ('submitted', 'auto_submitted', 'graded')
                ORDER BY submittedAt DESC
                LIMIT 1
            """
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(query, student_id, exam_id)
                if row:
                    return {
                        'percentage': float(row['percentage']) if row.get('percentage') else 0,
                        'total_marks': row.get('total_marks'),
                        'obtained_marks': float(row['obtained_marks']) if row.get('obtained_marks') else 0
                    }
            return None
        except Exception as e:
            logger.error(f"Error fetching exam score: {e}")
            return None
    
    def _generate_strength_feedback(self, chapter_analysis: ChapterAnalysisResponse) -> List[FeedbackItem]:
        """Generate feedback for strong chapters."""
        strengths = []
        sorted_chapters = sorted(chapter_analysis.chapters, key=lambda x: x.accuracy, reverse=True)
        for chapter in sorted_chapters[:3]:
            if chapter.accuracy >= 75:
                if chapter.mastery_level in [MasteryLevel.EXPERT, MasteryLevel.ADVANCED]:
                    title = f"Excellent mastery in {chapter.chapter_name}!"
                    description = f"You've achieved {chapter.accuracy:.1f}% accuracy with {chapter.mastery_level.value} level mastery. Keep up the great work!"
                else:
                    title = f"Good performance in {chapter.chapter_name}"
                    description = f"You scored {chapter.accuracy:.1f}% in this chapter. You're on track to mastering this topic."
                strengths.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.STRENGTH,
                    priority=GapSeverity.LOW,
                    title=title, description=description,
                    related_chapter_id=chapter.chapter_id,
                    action_items=["Continue practicing to maintain your edge", "Try more challenging problems"]
                ))
        return strengths
    
    def _generate_improvement_feedback(self, chapter_analysis: ChapterAnalysisResponse) -> List[FeedbackItem]:
        """Generate feedback for chapters needing improvement."""
        improvements = []
        sorted_chapters = sorted(chapter_analysis.chapters, key=lambda x: x.accuracy)
        for chapter in sorted_chapters[:3]:
            if chapter.accuracy < 60:
                severity = GapSeverity.CRITICAL if chapter.accuracy < 30 else GapSeverity.HIGH if chapter.accuracy < 45 else GapSeverity.MEDIUM
                title = f"Focus needed in {chapter.chapter_name}"
                if chapter.accuracy < 30:
                    description = f"Your {chapter.accuracy:.1f}% accuracy suggests significant gaps. Let's work on building a stronger foundation."
                    action_items = ["Review fundamental concepts", "Work through basic examples", "Consider watching tutorial videos"]
                else:
                    description = f"You scored {chapter.accuracy:.1f}% in {chapter.chapter_name}. With focused practice, you can improve significantly."
                    action_items = ["Identify specific challenging concepts", "Practice with varied problem types", "Review your mistakes"]
                if chapter.improvement_from_last and chapter.improvement_from_last > 0:
                    description += f" Great news: you've improved by {chapter.improvement_from_last:.1f}% since last time!"
                improvements.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.IMPROVEMENT,
                    priority=severity, title=title, description=description,
                    related_chapter_id=chapter.chapter_id, action_items=action_items
                ))
        return improvements
    
    def _generate_difficulty_feedback(self, analysis: DifficultyAnalysisResponse) -> List[FeedbackItem]:
        """Generate feedback based on difficulty analysis."""
        feedback = []
        for difficulty, perf in analysis.difficulty_breakdown.items():
            if perf.deviation_from_benchmark >= 15:
                feedback.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.STRENGTH, priority=GapSeverity.LOW,
                    title=f"Strong on {difficulty.value} questions",
                    description=f"You're {perf.deviation_from_benchmark:.1f}% above benchmark on {difficulty.value} questions.",
                    action_items=[f"Try more {analysis.recommended_difficulty.value} level questions"]
                ))
            elif perf.deviation_from_benchmark <= -15:
                feedback.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.IMPROVEMENT, priority=GapSeverity.MEDIUM,
                    title=f"Difficulty with {difficulty.value} questions",
                    description=f"Your accuracy on {difficulty.value} questions is {abs(perf.deviation_from_benchmark):.1f}% below expected.",
                    action_items=[f"Practice more {difficulty.value} level problems", "Focus on understanding"]
                ))
        if analysis.difficulty_transition_issue:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.RECOMMENDATION, priority=GapSeverity.MEDIUM,
                title="Difficulty transition challenge",
                description="You perform well on easier questions but struggle when difficulty increases.",
                action_items=["Focus on understanding 'why', not just 'how'", "Practice progressively harder problems"]
            ))
        return feedback
    
    def _generate_gap_feedback(self, gaps: LearningGapsResponse) -> List[FeedbackItem]:
        """Generate feedback from learning gaps."""
        feedback = []
        for gap in gaps.gaps[:5]:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.RECOMMENDATION, priority=gap.severity,
                title=f"Learning gap: {gap.concept_name or gap.chapter_name}",
                description=gap.recommendation,
                related_chapter_id=gap.chapter_id, related_concept_id=gap.concept_id,
                action_items=gap.action_items
            ))
        return feedback
    
    def _generate_trend_feedback(self, trend: PerformanceTrend) -> List[FeedbackItem]:
        """Generate feedback based on performance trend."""
        feedback = []
        if trend.direction == TrendDirection.IMPROVING:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.ACHIEVEMENT, priority=GapSeverity.LOW,
                title="You're improving!",
                description=f"Your scores have been trending upward. Consistency score: {trend.consistency_score:.1f}%.",
                action_items=["Maintain your current study habits", "Set new challenging goals"]
            ))
            if trend.predicted_next and trend.confidence_level > 60:
                feedback.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.RECOMMENDATION, priority=GapSeverity.LOW,
                    title="Performance prediction",
                    description=f"Based on your trend, predicted next score: ~{trend.predicted_next:.1f}%.",
                    action_items=[]
                ))
        elif trend.direction == TrendDirection.DECLINING:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.WARNING, priority=GapSeverity.HIGH,
                title="Performance declining",
                description="Your recent scores show a declining trend. Let's identify what's changed.",
                action_items=["Review what worked before", "Check if study habits changed", "Seek help early"]
            ))
        elif trend.direction == TrendDirection.STABLE:
            msg = f"Your scores are stable at {trend.avg_score:.1f}%. "
            msg += "Consider pushing to the next level!" if trend.avg_score >= 70 else "Let's break through this plateau."
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.RECOMMENDATION,
                priority=GapSeverity.LOW if trend.avg_score >= 70 else GapSeverity.MEDIUM,
                title="Consistent performance" if trend.avg_score >= 70 else "Room for improvement",
                description=msg,
                action_items=["Set stretch goals", "Try new study techniques"]
            ))
        if trend.volatility > 15:
            feedback.append(FeedbackItem(
                feedback_id=str(uuid.uuid4()),
                feedback_type=FeedbackType.WARNING, priority=GapSeverity.MEDIUM,
                title="Inconsistent performance",
                description=f"Your scores vary significantly (+-{trend.volatility:.1f}%). Building consistency will help.",
                action_items=["Establish a regular study routine", "Practice under exam-like conditions"]
            ))
        return feedback
    
    def _detect_achievements(
        self, chapter_analysis: Optional[ChapterAnalysisResponse], trend: Optional[PerformanceTrend]
    ) -> List[FeedbackItem]:
        """Detect and generate achievement feedback."""
        achievements = []
        if chapter_analysis:
            expert_chapters = [c for c in chapter_analysis.chapters if c.mastery_level == MasteryLevel.EXPERT]
            if len(expert_chapters) >= 3:
                achievements.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.ACHIEVEMENT, priority=GapSeverity.LOW,
                    title="Multi-chapter Expert!",
                    description=f"You've achieved expert mastery in {len(expert_chapters)} chapters!",
                    action_items=["Consider helping others learn these topics"]
                ))
            perfect_chapters = [c for c in chapter_analysis.chapters if c.accuracy == 100]
            if perfect_chapters:
                achievements.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.ACHIEVEMENT, priority=GapSeverity.LOW,
                    title="Perfect Score!",
                    description=f"100% accuracy in: {', '.join([c.chapter_name for c in perfect_chapters[:3]])}",
                    action_items=[]
                ))
        if trend:
            if trend.consistency_score >= 90:
                achievements.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.ACHIEVEMENT, priority=GapSeverity.LOW,
                    title="Consistency Champion!",
                    description=f"{trend.consistency_score:.1f}% consistency shows reliable performance!",
                    action_items=[]
                ))
            if trend.direction == TrendDirection.IMPROVING and trend.slope > 2:
                achievements.append(FeedbackItem(
                    feedback_id=str(uuid.uuid4()),
                    feedback_type=FeedbackType.ACHIEVEMENT, priority=GapSeverity.LOW,
                    title="Rapid Improver!",
                    description="Your scores have shown significant improvement recently!",
                    action_items=[]
                ))
        return achievements
    
    def _generate_summary(self, overall_score, grade, num_strengths, num_improvements, num_warnings, trend):
        """Generate a summary paragraph."""
        parts = []
        if overall_score is not None:
            parts.append(f"You scored {overall_score:.1f}%{f' (Grade: {grade})' if grade else ''}.")
        if num_strengths > 0:
            parts.append(f"You have {num_strengths} areas of strength.")
        if num_improvements > 0:
            parts.append(f"There are {num_improvements} areas for focused improvement.")
        if num_warnings > 0:
            parts.append(f"Pay attention to {num_warnings} area(s) that need immediate attention.")
        if trend:
            if trend.direction == TrendDirection.IMPROVING:
                parts.append("Your overall trajectory is positive!")
            elif trend.direction == TrendDirection.DECLINING:
                parts.append("Let's work together to reverse the recent decline.")
            elif trend.direction == TrendDirection.STABLE and trend.avg_score >= 70:
                parts.append("Your consistent performance is a solid foundation.")
        return " ".join(parts) if parts else "Keep working hard and your efforts will pay off!"
    
    async def store_feedback(self, feedback: PersonalizedFeedback) -> bool:
        """Store feedback in MongoDB."""
        try:
            mongo_db = db.mongo_db
            if mongo_db:
                await mongo_db.personalized_feedback.update_one(
                    {"student_id": feedback.student_id, "exam_id": feedback.exam_id},
                    {"$set": feedback.model_dump(mode='json')},
                    upsert=True
                )
            return True
        except Exception as e:
            logger.error(f"Error storing feedback: {e}")
            return False


# Singleton instance
feedback_generator = FeedbackGenerator()
