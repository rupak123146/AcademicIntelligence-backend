"""
🎓 Academic Intelligence Platform - Class Analytics Service

Aggregates individual student analytics into class-level insights for educators.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
import numpy as np

from src.config import db, DIFFICULTY_BENCHMARKS
from src.models import (
    ClassStatistics,
    GradeDistribution,
    WeakArea,
    QuestionEffectiveness,
    AtRiskStudent,
    ClassAnalyticsResponse,
    GapSeverity,
    TrendDirection
)
from src.utils import (
    logger,
    calculate_percentage,
    calculate_average,
    calculate_median,
    calculate_std_dev,
    get_grade_distribution,
    calculate_grade,
    get_percentile
)


class ClassAnalyzer:
    """
    Aggregates analytics at class/course level for educators.
    
    Provides:
    - Class performance statistics
    - Grade distribution analysis
    - Common weak areas identification
    - Question effectiveness (item analysis)
    - At-risk student identification
    """
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_class(
        self,
        course_id: int,
        educator_id: int,
        exam_id: Optional[int] = None
    ) -> ClassAnalyticsResponse:
        """
        Generate comprehensive class analytics.
        
        Args:
            course_id: Course ID
            educator_id: Educator's ID
            exam_id: Optional specific exam ID
        
        Returns:
            ClassAnalyticsResponse with class-level insights
        """
        logger.info(f"Analyzing class for course {course_id}, exam {exam_id}")
        
        try:
            # Get class statistics
            statistics = await self._calculate_class_statistics(course_id, exam_id)
            
            # Get grade distribution
            grade_dist = await self._calculate_grade_distribution(course_id, exam_id)
            
            # Identify weak areas
            weak_areas = await self._identify_weak_areas(course_id, exam_id)
            
            # Analyze question effectiveness (if exam specified)
            question_analysis = []
            if exam_id:
                question_analysis = await self._analyze_question_effectiveness(exam_id)
            
            # Identify at-risk students
            at_risk = await self._identify_at_risk_students(course_id)
            
            # Generate recommendations
            recommendations = self._generate_recommendations(
                statistics, weak_areas, question_analysis, at_risk
            )
            
            return ClassAnalyticsResponse(
                course_id=course_id,
                exam_id=exam_id,
                educator_id=educator_id,
                analysis_date=datetime.utcnow(),
                statistics=statistics,
                grade_distribution=grade_dist,
                weak_areas=weak_areas,
                question_effectiveness=question_analysis,
                at_risk_students=at_risk,
                recommendations=recommendations
            )
            
        except Exception as e:
            logger.error(f"Error analyzing class: {e}")
            raise
    
    async def _calculate_class_statistics(
        self,
        course_id: int,
        exam_id: Optional[int] = None
    ) -> ClassStatistics:
        """Calculate statistical summary for the class."""
        
        # Get enrolled students count
        enrolled_query = """
            SELECT COUNT(DISTINCT student_id) as count
            FROM course_enrollments
            WHERE course_id = $1 AND status = 'active'
        """
        
        # Get exam scores
        if exam_id:
            scores_query = """
                SELECT ea.percentage
                FROM exam_attempts ea
                WHERE ea.exam_id = $1 AND ea.status = 'evaluated'
            """
            scores_params = [exam_id]
        else:
            scores_query = """
                SELECT ea.percentage
                FROM exam_attempts ea
                JOIN exams e ON ea.exam_id = e.id
                WHERE e.course_id = $1 AND ea.status = 'evaluated'
            """
            scores_params = [course_id]
        
        async with self.pool.acquire() as conn:
            # Get enrolled count
            enrolled = await conn.fetchval(enrolled_query, course_id)
            
            # Get scores
            rows = await conn.fetch(scores_query, *scores_params)
            scores = [float(row['percentage']) for row in rows if row['percentage']]
            
            if not scores:
                return ClassStatistics(
                    total_students=enrolled or 0,
                    submitted_count=0,
                    mean_score=0.0,
                    median_score=0.0,
                    std_dev=0.0,
                    min_score=0.0,
                    max_score=0.0,
                    pass_rate=0.0,
                    pass_threshold=40.0
                )
            
            submitted_count = len(set([row['percentage'] for row in rows]))
            
            return ClassStatistics(
                total_students=enrolled or 0,
                submitted_count=len(rows),
                mean_score=round(calculate_average(scores), 2),
                median_score=round(calculate_median(scores), 2),
                std_dev=round(calculate_std_dev(scores), 2),
                min_score=min(scores),
                max_score=max(scores),
                pass_rate=round(
                    calculate_percentage(
                        len([s for s in scores if s >= 40]),
                        len(scores)
                    ),
                    2
                ),
                pass_threshold=40.0
            )
    
    async def _calculate_grade_distribution(
        self,
        course_id: int,
        exam_id: Optional[int] = None
    ) -> List[GradeDistribution]:
        """Calculate grade distribution."""
        
        if exam_id:
            query = """
                SELECT ea.percentage
                FROM exam_attempts ea
                WHERE ea.exam_id = $1 AND ea.status = 'evaluated'
            """
            params = [exam_id]
        else:
            query = """
                SELECT ea.percentage
                FROM exam_attempts ea
                JOIN exams e ON ea.exam_id = e.id
                WHERE e.course_id = $1 AND ea.status = 'evaluated'
            """
            params = [course_id]
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            scores = [float(row['percentage']) for row in rows if row['percentage']]
            
            if not scores:
                return []
            
            distribution = get_grade_distribution(scores)
            total = len(scores)
            
            result = []
            for grade, count in distribution.items():
                result.append(GradeDistribution(
                    grade=grade,
                    count=count,
                    percentage=round(calculate_percentage(count, total), 2)
                ))
            
            return result
    
    async def _identify_weak_areas(
        self,
        course_id: int,
        exam_id: Optional[int] = None,
        threshold: float = 60.0
    ) -> List[WeakArea]:
        """Identify common weak areas across the class."""
        
        if exam_id:
            query = """
                SELECT 
                    ch.id as chapter_id,
                    ch.name as chapter_name,
                    c.id as concept_id,
                    c.name as concept_name,
                    COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                        NULLIF(COUNT(*), 0) * 100 as class_accuracy,
                    COUNT(DISTINCT CASE WHEN sa.is_correct = false THEN ea.student_id END) as struggling_students,
                    COUNT(DISTINCT ea.student_id) as total_students
                FROM chapters ch
                LEFT JOIN concepts c ON c.chapter_id = ch.id
                LEFT JOIN question_concepts qc ON qc.concept_id = c.id
                LEFT JOIN questions q ON (q.chapter_id = ch.id OR qc.question_id = q.id)
                LEFT JOIN exam_questions eq ON eq.question_id = q.id
                LEFT JOIN student_answers sa ON sa.question_id = q.id
                LEFT JOIN exam_attempts ea ON sa.attempt_id = ea.id
                WHERE eq.exam_id = $1 AND ea.status = 'evaluated'
                GROUP BY ch.id, ch.name, c.id, c.name
                HAVING COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 < $2
                ORDER BY class_accuracy ASC
            """
            params = [exam_id, threshold]
        else:
            query = """
                SELECT 
                    ch.id as chapter_id,
                    ch.name as chapter_name,
                    NULL as concept_id,
                    NULL as concept_name,
                    COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                        NULLIF(COUNT(*), 0) * 100 as class_accuracy,
                    COUNT(DISTINCT CASE WHEN sa.is_correct = false THEN ea.student_id END) as struggling_students,
                    COUNT(DISTINCT ea.student_id) as total_students
                FROM chapters ch
                LEFT JOIN questions q ON q.chapter_id = ch.id
                LEFT JOIN student_answers sa ON sa.question_id = q.id
                LEFT JOIN exam_attempts ea ON sa.attempt_id = ea.id
                LEFT JOIN exams e ON ea.exam_id = e.id
                WHERE ch.course_id = $1 AND ea.status = 'evaluated'
                GROUP BY ch.id, ch.name
                HAVING COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 < $2
                ORDER BY class_accuracy ASC
            """
            params = [course_id, threshold]
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            
            weak_areas = []
            for row in rows[:10]:  # Top 10 weak areas
                total = row['total_students'] or 1
                struggling = row['struggling_students'] or 0
                
                weak_areas.append(WeakArea(
                    chapter_id=row['chapter_id'],
                    chapter_name=row['chapter_name'],
                    concept_id=row['concept_id'],
                    concept_name=row['concept_name'],
                    class_accuracy=round(float(row['class_accuracy']), 2) if row['class_accuracy'] else 0,
                    students_struggling=struggling,
                    struggling_percentage=round(calculate_percentage(struggling, total), 2)
                ))
            
            return weak_areas
    
    async def _analyze_question_effectiveness(
        self,
        exam_id: int
    ) -> List[QuestionEffectiveness]:
        """
        Perform item analysis on exam questions.
        
        Metrics:
        - Difficulty Index: Proportion of students who answered correctly
        - Discrimination Index: How well question differentiates students
        """
        # Get question-level statistics
        query = """
            SELECT 
                q.id as question_id,
                q.question_text,
                COUNT(*) as total_attempts,
                COUNT(CASE WHEN sa.is_correct THEN 1 END) as correct_count
            FROM questions q
            JOIN exam_questions eq ON q.id = eq.question_id
            JOIN student_answers sa ON q.id = sa.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            WHERE eq.exam_id = $1 AND ea.status = 'evaluated'
            GROUP BY q.id, q.question_text
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, exam_id)
            
            if not rows:
                return []
            
            # Get top and bottom 27% performers for discrimination index
            top_bottom = await self._get_top_bottom_performers(conn, exam_id)
            
            results = []
            for row in rows:
                question_id = row['question_id']
                total = row['total_attempts']
                correct = row['correct_count']
                
                # Difficulty Index (proportion correct)
                difficulty_index = correct / total if total > 0 else 0
                
                # Discrimination Index
                discrimination_index = await self._calculate_discrimination(
                    conn, question_id, top_bottom['top'], top_bottom['bottom']
                )
                
                # Determine effectiveness
                effectiveness = self._determine_effectiveness(
                    difficulty_index, discrimination_index
                )
                
                # Get common wrong answers for MCQ
                wrong_answers = await self._get_common_wrong_answers(
                    conn, question_id
                )
                
                results.append(QuestionEffectiveness(
                    question_id=question_id,
                    question_text=row['question_text'][:100] if row['question_text'] else None,
                    difficulty_index=round(difficulty_index, 3),
                    discrimination_index=round(discrimination_index, 3),
                    effectiveness=effectiveness,
                    correct_count=correct,
                    incorrect_count=total - correct,
                    common_wrong_answers=wrong_answers
                ))
            
            return results
    
    async def _get_top_bottom_performers(
        self,
        conn,
        exam_id: int,
        percentile: int = 27
    ) -> Dict[str, List[int]]:
        """Get top and bottom N% performers for discrimination analysis."""
        
        query = """
            SELECT student_id, percentage
            FROM exam_attempts
            WHERE exam_id = $1 AND status = 'evaluated'
            ORDER BY percentage DESC
        """
        
        rows = await conn.fetch(query, exam_id)
        
        if not rows:
            return {"top": [], "bottom": []}
        
        n = len(rows)
        cutoff = max(1, int(n * percentile / 100))
        
        top_students = [row['student_id'] for row in rows[:cutoff]]
        bottom_students = [row['student_id'] for row in rows[-cutoff:]]
        
        return {"top": top_students, "bottom": bottom_students}
    
    async def _calculate_discrimination(
        self,
        conn,
        question_id: int,
        top_students: List[int],
        bottom_students: List[int]
    ) -> float:
        """
        Calculate discrimination index.
        
        D = (H - L) / N
        where H = correct in top group, L = correct in bottom group, N = group size
        """
        if not top_students or not bottom_students:
            return 0.0
        
        # Count correct answers in top group
        top_query = """
            SELECT COUNT(*) as correct
            FROM student_answers sa
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            WHERE sa.question_id = $1 
                AND ea.student_id = ANY($2)
                AND sa.is_correct = true
        """
        
        top_correct = await conn.fetchval(top_query, question_id, top_students) or 0
        bottom_correct = await conn.fetchval(top_query, question_id, bottom_students) or 0
        
        n = len(top_students)
        
        return (top_correct - bottom_correct) / n if n > 0 else 0
    
    def _determine_effectiveness(
        self,
        difficulty_index: float,
        discrimination_index: float
    ) -> str:
        """Determine question effectiveness based on item analysis."""
        
        # Negative discrimination is problematic
        if discrimination_index < 0:
            return "needs_review"
        
        # Very easy questions
        if difficulty_index > 0.9:
            return "too_easy"
        
        # Very hard questions
        if difficulty_index < 0.2:
            return "too_hard"
        
        # Poor discrimination
        if discrimination_index < 0.2:
            return "poor_discriminator"
        
        # Good questions
        if 0.3 <= difficulty_index <= 0.7 and discrimination_index >= 0.2:
            return "effective"
        
        return "acceptable"
    
    async def _get_common_wrong_answers(
        self,
        conn,
        question_id: int,
        limit: int = 3
    ) -> List[Dict[str, Any]]:
        """Get most common wrong answers for a question."""
        
        query = """
            SELECT 
                ao.id as option_id,
                ao.option_text,
                COUNT(*) as selection_count
            FROM student_answers sa
            JOIN answer_options ao ON sa.selected_option_id = ao.id
            WHERE sa.question_id = $1 
                AND sa.is_correct = false
                AND sa.selected_option_id IS NOT NULL
            GROUP BY ao.id, ao.option_text
            ORDER BY COUNT(*) DESC
            LIMIT $2
        """
        
        rows = await conn.fetch(query, question_id, limit)
        
        return [
            {
                "option_id": row['option_id'],
                "option_text": row['option_text'][:50] if row['option_text'] else None,
                "selection_count": row['selection_count']
            }
            for row in rows
        ]
    
    async def _identify_at_risk_students(
        self,
        course_id: int,
        threshold: float = 50.0
    ) -> List[AtRiskStudent]:
        """Identify students at risk of failing."""
        
        query = """
            WITH student_performance AS (
                SELECT 
                    u.id as student_id,
                    u.first_name || ' ' || u.last_name as student_name,
                    AVG(ea.percentage) as avg_score,
                    COUNT(ea.id) as exam_count,
                    MAX(ea.submitted_at) as last_exam,
                    ARRAY_AGG(ea.percentage ORDER BY ea.submitted_at DESC) as recent_scores
                FROM users u
                JOIN course_enrollments ce ON u.id = ce.student_id
                LEFT JOIN exam_attempts ea ON u.id = ea.student_id
                LEFT JOIN exams e ON ea.exam_id = e.id AND e.course_id = ce.course_id
                WHERE ce.course_id = $1 
                    AND ce.status = 'active'
                    AND ea.status = 'evaluated'
                GROUP BY u.id, u.first_name, u.last_name
            )
            SELECT *
            FROM student_performance
            WHERE avg_score < $2 OR (
                array_length(recent_scores, 1) >= 2 AND
                recent_scores[1] < recent_scores[2] - 10
            )
            ORDER BY avg_score ASC
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id, threshold)
            
            at_risk = []
            for row in rows:
                recent_scores = row['recent_scores'] or []
                
                # Determine trend
                if len(recent_scores) >= 2:
                    if recent_scores[0] > recent_scores[-1] + 10:
                        trend = TrendDirection.IMPROVING
                    elif recent_scores[0] < recent_scores[-1] - 10:
                        trend = TrendDirection.DECLINING
                    else:
                        trend = TrendDirection.STABLE
                else:
                    trend = TrendDirection.INSUFFICIENT_DATA
                
                # Determine risk level
                avg_score = float(row['avg_score']) if row['avg_score'] else 0
                if avg_score < 30:
                    risk_level = GapSeverity.CRITICAL
                elif avg_score < 40:
                    risk_level = GapSeverity.HIGH
                elif avg_score < 50:
                    risk_level = GapSeverity.MEDIUM
                else:
                    risk_level = GapSeverity.LOW
                
                # Generate issues and recommendations
                issues = []
                recommendations = []
                
                if avg_score < 40:
                    issues.append("Below passing threshold")
                    recommendations.append("Schedule one-on-one support session")
                
                if trend == TrendDirection.DECLINING:
                    issues.append("Declining performance trend")
                    recommendations.append("Review recent material with student")
                
                at_risk.append(AtRiskStudent(
                    student_id=row['student_id'],
                    student_name=row['student_name'],
                    current_score=avg_score,
                    trend=trend,
                    risk_level=risk_level,
                    main_issues=issues,
                    recommended_actions=recommendations
                ))
            
            return at_risk
    
    def _generate_recommendations(
        self,
        statistics: ClassStatistics,
        weak_areas: List[WeakArea],
        question_analysis: List[QuestionEffectiveness],
        at_risk: List[AtRiskStudent]
    ) -> List[str]:
        """Generate actionable recommendations for educator."""
        
        recommendations = []
        
        # Based on overall performance
        if statistics.pass_rate < 60:
            recommendations.append(
                f"Overall pass rate is {statistics.pass_rate:.1f}%. "
                "Consider reviewing teaching approach for challenging topics."
            )
        
        if statistics.std_dev > 20:
            recommendations.append(
                "High score variance suggests mixed understanding levels. "
                "Consider differentiated instruction strategies."
            )
        
        # Based on weak areas
        if weak_areas:
            weak_names = [w.chapter_name for w in weak_areas[:3]]
            recommendations.append(
                f"Focus additional attention on: {', '.join(weak_names)}. "
                "These areas show class-wide difficulty."
            )
        
        # Based on question analysis
        problematic_questions = [
            q for q in question_analysis 
            if q.effectiveness in ['needs_review', 'too_hard', 'poor_discriminator']
        ]
        if problematic_questions:
            recommendations.append(
                f"{len(problematic_questions)} questions may need revision. "
                "Review questions flagged as ineffective."
            )
        
        # Based on at-risk students
        critical_risk = [s for s in at_risk if s.risk_level == GapSeverity.CRITICAL]
        if critical_risk:
            recommendations.append(
                f"{len(critical_risk)} students are at critical risk. "
                "Urgent intervention recommended."
            )
        
        if not recommendations:
            recommendations.append(
                "Class is performing well overall. "
                "Continue current teaching strategies."
            )
        
        return recommendations
    
    async def get_class_comparison(
        self,
        course_ids: List[int],
        educator_id: int
    ) -> Dict[str, Any]:
        """Compare performance across multiple classes/courses."""
        
        comparisons = []
        
        for course_id in course_ids:
            stats = await self._calculate_class_statistics(course_id)
            
            query = """
                SELECT name FROM courses WHERE id = $1
            """
            async with self.pool.acquire() as conn:
                course_name = await conn.fetchval(query, course_id)
            
            comparisons.append({
                "course_id": course_id,
                "course_name": course_name,
                "mean_score": stats.mean_score,
                "median_score": stats.median_score,
                "pass_rate": stats.pass_rate,
                "total_students": stats.total_students
            })
        
        return {
            "educator_id": educator_id,
            "comparisons": comparisons,
            "analysis_date": datetime.utcnow().isoformat()
        }


# Singleton instance
class_analyzer = ClassAnalyzer()
