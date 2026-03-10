"""
Academic Intelligence Platform - Class Analytics Service
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
    """Aggregates analytics at class/course level for educators."""
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_class(
        self, course_id: str, educator_id: str, exam_id: Optional[str] = None
    ) -> ClassAnalyticsResponse:
        """Generate comprehensive class analytics."""
        logger.info(f"Analyzing class for course {course_id}, exam {exam_id}")
        try:
            statistics = await self._calculate_class_statistics(course_id, exam_id)
            grade_dist = await self._calculate_grade_distribution(course_id, exam_id)
            weak_areas = await self._identify_weak_areas(course_id, exam_id)
            question_analysis = []
            if exam_id:
                question_analysis = await self._analyze_question_effectiveness(exam_id)
            at_risk = await self._identify_at_risk_students(course_id)
            recommendations = self._generate_recommendations(statistics, weak_areas, question_analysis, at_risk)
            
            return ClassAnalyticsResponse(
                course_id=course_id, exam_id=exam_id, educator_id=educator_id,
                analysis_date=datetime.utcnow(),
                statistics=statistics, grade_distribution=grade_dist,
                weak_areas=weak_areas, question_effectiveness=question_analysis,
                at_risk_students=at_risk, recommendations=recommendations
            )
        except Exception as e:
            logger.error(f"Error analyzing class: {e}")
            raise
    
    async def _calculate_class_statistics(
        self, course_id: str, exam_id: Optional[str] = None
    ) -> ClassStatistics:
        """Calculate statistical summary for the class."""
        enrolled_query = """
            SELECT COUNT(DISTINCT studentId) as count
            FROM student_enrollments
            WHERE courseId = %s AND status = 'enrolled'
        """
        if exam_id:
            scores_query = "SELECT percentage FROM exam_attempts WHERE examId = %s AND status IN ('submitted','auto_submitted','graded')"
            scores_params = (exam_id,)
        else:
            scores_query = """
                SELECT ea.percentage FROM exam_attempts ea
                JOIN exams e ON ea.examId = e.id
                WHERE e.courseId = %s AND ea.status IN ('submitted','auto_submitted','graded')
            """
            scores_params = (course_id,)
        
        async with self.pool.acquire() as conn:
            enrolled = await conn.fetchval(enrolled_query, course_id)
            rows = await conn.fetch(scores_query, *scores_params)
            scores = [float(row['percentage']) for row in rows if row.get('percentage')]
            
            if not scores:
                return ClassStatistics(
                    total_students=enrolled or 0, submitted_count=0,
                    mean_score=0.0, median_score=0.0, std_dev=0.0,
                    min_score=0.0, max_score=0.0, pass_rate=0.0, pass_threshold=40.0
                )
            
            return ClassStatistics(
                total_students=enrolled or 0, submitted_count=len(rows),
                mean_score=round(calculate_average(scores), 2),
                median_score=round(calculate_median(scores), 2),
                std_dev=round(calculate_std_dev(scores), 2),
                min_score=min(scores), max_score=max(scores),
                pass_rate=round(calculate_percentage(len([s for s in scores if s >= 40]), len(scores)), 2),
                pass_threshold=40.0
            )
    
    async def _calculate_grade_distribution(
        self, course_id: str, exam_id: Optional[str] = None
    ) -> List[GradeDistribution]:
        """Calculate grade distribution."""
        if exam_id:
            query = "SELECT percentage FROM exam_attempts WHERE examId = %s AND status IN ('submitted','auto_submitted','graded')"
            params = (exam_id,)
        else:
            query = """
                SELECT ea.percentage FROM exam_attempts ea
                JOIN exams e ON ea.examId = e.id
                WHERE e.courseId = %s AND ea.status IN ('submitted','auto_submitted','graded')
            """
            params = (course_id,)
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            scores = [float(row['percentage']) for row in rows if row.get('percentage')]
            if not scores:
                return []
            distribution = get_grade_distribution(scores)
            total = len(scores)
            return [GradeDistribution(grade=g, count=c, percentage=round(calculate_percentage(c, total), 2)) for g, c in distribution.items()]
    
    async def _identify_weak_areas(
        self, course_id: str, exam_id: Optional[str] = None, threshold: float = 60.0
    ) -> List[WeakArea]:
        """Identify common weak areas across the class."""
        if exam_id:
            query = """
                SELECT 
                    ch.id as chapter_id, ch.name as chapter_name,
                    AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) as class_accuracy,
                    COUNT(DISTINCT CASE WHEN sa.isCorrect = 0 THEN ea.studentId END) as struggling_students,
                    COUNT(DISTINCT ea.studentId) as total_students
                FROM questions q
                JOIN chapters ch ON q.chapterId = ch.id
                JOIN exam_questions eq ON eq.questionId = q.id
                JOIN student_answers sa ON sa.questionId = q.id
                JOIN exam_attempts ea ON sa.attemptId = ea.id
                WHERE eq.examId = %s AND ea.status IN ('submitted','auto_submitted','graded')
                GROUP BY ch.id, ch.name
                HAVING AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) < %s
                ORDER BY class_accuracy ASC
            """
            params = (exam_id, threshold)
        else:
            query = """
                SELECT 
                    ch.id as chapter_id, ch.name as chapter_name,
                    AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) as class_accuracy,
                    COUNT(DISTINCT CASE WHEN sa.isCorrect = 0 THEN ea.studentId END) as struggling_students,
                    COUNT(DISTINCT ea.studentId) as total_students
                FROM questions q
                JOIN chapters ch ON q.chapterId = ch.id
                JOIN student_answers sa ON sa.questionId = q.id
                JOIN exam_attempts ea ON sa.attemptId = ea.id
                JOIN exams e ON ea.examId = e.id
                WHERE e.courseId = %s AND ea.status IN ('submitted','auto_submitted','graded')
                GROUP BY ch.id, ch.name
                HAVING AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) < %s
                ORDER BY class_accuracy ASC
            """
            params = (course_id, threshold)
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            weak_areas = []
            for row in rows[:10]:
                total = row['total_students'] or 1
                struggling = row['struggling_students'] or 0
                weak_areas.append(WeakArea(
                    chapter_id=row['chapter_id'], chapter_name=row['chapter_name'],
                    class_accuracy=round(float(row['class_accuracy']), 2) if row.get('class_accuracy') else 0,
                    students_struggling=struggling,
                    struggling_percentage=round(calculate_percentage(struggling, total), 2)
                ))
            return weak_areas
    
    async def _analyze_question_effectiveness(self, exam_id: str) -> List[QuestionEffectiveness]:
        """Perform item analysis on exam questions."""
        query = """
            SELECT 
                q.id as question_id, q.questionText as question_text,
                COUNT(*) as total_attempts,
                SUM(CASE WHEN sa.isCorrect = 1 THEN 1 ELSE 0 END) as correct_count
            FROM questions q
            JOIN exam_questions eq ON q.id = eq.questionId
            JOIN student_answers sa ON q.id = sa.questionId
            JOIN exam_attempts ea ON sa.attemptId = ea.id
            WHERE eq.examId = %s AND ea.status IN ('submitted','auto_submitted','graded')
            GROUP BY q.id, q.questionText
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, exam_id)
            if not rows:
                return []
            
            results = []
            for row in rows:
                total = row['total_attempts']
                correct = row['correct_count'] or 0
                difficulty_index = correct / total if total > 0 else 0
                effectiveness = self._determine_effectiveness(difficulty_index, 0.3)
                results.append(QuestionEffectiveness(
                    question_id=row['question_id'],
                    question_text=row['question_text'][:100] if row.get('question_text') else None,
                    difficulty_index=round(difficulty_index, 3),
                    discrimination_index=0.3,
                    effectiveness=effectiveness,
                    correct_count=correct,
                    incorrect_count=total - correct,
                    common_wrong_answers=[]
                ))
            return results
    
    async def _identify_at_risk_students(self, course_id: str, threshold: float = 50.0) -> List[AtRiskStudent]:
        """Identify students at risk of failing."""
        query = """
            SELECT 
                u.id as student_id,
                CONCAT(u.firstName, ' ', u.lastName) as student_name,
                AVG(ea.percentage) as avg_score,
                COUNT(ea.id) as exam_count
            FROM users u
            JOIN student_enrollments se ON u.id = se.studentId
            LEFT JOIN exam_attempts ea ON u.id = ea.studentId
            LEFT JOIN exams e ON ea.examId = e.id AND e.courseId = se.courseId
            WHERE se.courseId = %s AND se.status = 'enrolled'
                AND ea.status IN ('submitted','auto_submitted','graded')
            GROUP BY u.id, u.firstName, u.lastName
            HAVING AVG(ea.percentage) < %s
            ORDER BY avg_score ASC
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id, threshold)
            at_risk = []
            for row in rows:
                avg_score = float(row['avg_score']) if row.get('avg_score') else 0
                risk_level = GapSeverity.CRITICAL if avg_score < 30 else GapSeverity.HIGH if avg_score < 40 else GapSeverity.MEDIUM
                issues = []
                recommendations = []
                if avg_score < 40:
                    issues.append("Below passing threshold")
                    recommendations.append("Schedule one-on-one support session")
                at_risk.append(AtRiskStudent(
                    student_id=row['student_id'],
                    student_name=row['student_name'] or 'Unknown',
                    current_score=avg_score,
                    trend=TrendDirection.STABLE,
                    risk_level=risk_level,
                    main_issues=issues, recommended_actions=recommendations
                ))
            return at_risk
    
    def _determine_effectiveness(self, difficulty_index: float, discrimination_index: float) -> str:
        """Determine question effectiveness based on item analysis."""
        if discrimination_index < 0:
            return "needs_review"
        if difficulty_index > 0.9:
            return "too_easy"
        if difficulty_index < 0.2:
            return "too_hard"
        if discrimination_index < 0.2:
            return "poor_discriminator"
        if 0.3 <= difficulty_index <= 0.7 and discrimination_index >= 0.2:
            return "effective"
        return "acceptable"
    
    def _generate_recommendations(self, statistics, weak_areas, question_analysis, at_risk) -> List[str]:
        """Generate actionable recommendations for educator."""
        recommendations = []
        if statistics.pass_rate < 60:
            recommendations.append(f"Overall pass rate is {statistics.pass_rate:.1f}%. Consider reviewing teaching approach.")
        if statistics.std_dev > 20:
            recommendations.append("High score variance suggests mixed understanding levels. Consider differentiated instruction.")
        if weak_areas:
            weak_names = [w.chapter_name for w in weak_areas[:3]]
            recommendations.append(f"Focus on: {', '.join(weak_names)}. These areas show class-wide difficulty.")
        problematic = [q for q in question_analysis if q.effectiveness in ['needs_review', 'too_hard', 'poor_discriminator']]
        if problematic:
            recommendations.append(f"{len(problematic)} questions may need revision.")
        critical_risk = [s for s in at_risk if s.risk_level == GapSeverity.CRITICAL]
        if critical_risk:
            recommendations.append(f"{len(critical_risk)} students are at critical risk. Urgent intervention recommended.")
        if not recommendations:
            recommendations.append("Class is performing well overall. Continue current teaching strategies.")
        return recommendations

    async def get_class_comparison(self, course_ids: List[str], educator_id: str) -> Dict[str, Any]:
        """Compare performance across multiple classes/courses."""
        comparisons = []
        for course_id in course_ids:
            stats = await self._calculate_class_statistics(course_id)
            async with self.pool.acquire() as conn:
                course_name = await conn.fetchval("SELECT name FROM courses WHERE id = %s", course_id)
            comparisons.append({
                "course_id": course_id, "course_name": course_name,
                "mean_score": stats.mean_score, "median_score": stats.median_score,
                "pass_rate": stats.pass_rate, "total_students": stats.total_students
            })
        return {"educator_id": educator_id, "comparisons": comparisons, "analysis_date": datetime.utcnow().isoformat()}


# Singleton instance
class_analyzer = ClassAnalyzer()
