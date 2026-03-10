"""
Academic Intelligence Platform - Difficulty Analysis Service
Analyzes student performance across different difficulty levels.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime

from src.config import db, DIFFICULTY_BENCHMARKS
from src.models import (
    DifficultyPerformance,
    DifficultyAnalysisResponse,
    DifficultyLevel,
    PerformanceTag
)
from src.utils import (
    logger,
    calculate_percentage,
    calculate_average,
    get_performance_tag
)


class DifficultyAnalyzer:
    """Analyzes student performance across different difficulty levels."""
    
    def __init__(self):
        self.pool = None
        self.benchmarks = DIFFICULTY_BENCHMARKS
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_difficulty_performance(
        self,
        student_id: str,
        course_id: Optional[str] = None,
        exam_id: Optional[str] = None
    ) -> DifficultyAnalysisResponse:
        """Analyze performance by difficulty level."""
        logger.info(f"Analyzing difficulty for student {student_id}, course {course_id}, exam {exam_id}")
        
        try:
            difficulty_breakdown = {}
            for difficulty in DifficultyLevel:
                performance = await self._analyze_difficulty_level(
                    student_id=student_id, difficulty=difficulty,
                    course_id=course_id, exam_id=exam_id
                )
                if performance:
                    difficulty_breakdown[difficulty] = performance
            
            transition_issue = self._check_transition_issue(difficulty_breakdown)
            recommended = self._recommend_difficulty(difficulty_breakdown)
            
            return DifficultyAnalysisResponse(
                student_id=student_id, exam_id=exam_id, course_id=course_id,
                analysis_date=datetime.utcnow(),
                difficulty_breakdown=difficulty_breakdown,
                difficulty_transition_issue=transition_issue,
                recommended_difficulty=recommended
            )
        except Exception as e:
            logger.error(f"Error analyzing difficulty: {e}")
            raise
    
    async def _analyze_difficulty_level(
        self, student_id: str, difficulty: DifficultyLevel,
        course_id: Optional[str] = None, exam_id: Optional[str] = None
    ) -> Optional[DifficultyPerformance]:
        """Analyze performance for a specific difficulty level."""
        base_query = """
            SELECT 
                COUNT(*) as total_questions,
                SUM(CASE WHEN sa.isCorrect = 1 THEN 1 ELSE 0 END) as correct_answers,
                COALESCE(AVG(sa.timeSpent), 0) as avg_time
            FROM questions q
            JOIN student_answers sa ON q.id = sa.questionId
            JOIN exam_attempts ea ON sa.attemptId = ea.id
            WHERE q.difficulty = %s
                AND ea.studentId = %s
                AND ea.status IN ('submitted', 'auto_submitted', 'graded')
        """
        params = [difficulty.value, student_id]
        
        if exam_id:
            base_query += " AND ea.examId = %s"
            params.append(exam_id)
        elif course_id:
            base_query += " AND ea.examId IN (SELECT id FROM exams WHERE courseId = %s)"
            params.append(course_id)
        
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(base_query, *params)
            if not row or not row.get('total_questions') or row['total_questions'] == 0:
                return None
            
            total = row['total_questions']
            correct = row['correct_answers'] or 0
            accuracy = calculate_percentage(correct, total)
            benchmark = self.benchmarks.get(difficulty.value, 60)
            deviation = round(accuracy - benchmark, 2)
            performance_tag = get_performance_tag(accuracy, benchmark)
            
            return DifficultyPerformance(
                difficulty=difficulty,
                total_questions=total,
                correct_answers=correct,
                accuracy=accuracy,
                avg_time=round(float(row['avg_time']), 2),
                benchmark=benchmark,
                performance_tag=PerformanceTag(performance_tag),
                deviation_from_benchmark=deviation
            )
    
    def _check_transition_issue(self, breakdown: Dict[DifficultyLevel, DifficultyPerformance]) -> bool:
        """Check if student has difficulty transition issues."""
        if len(breakdown) < 2:
            return False
        levels = [DifficultyLevel.EASY, DifficultyLevel.MEDIUM, DifficultyLevel.HARD, DifficultyLevel.EXPERT]
        accuracies = [(level, breakdown[level].accuracy) for level in levels if level in breakdown]
        if len(accuracies) < 2:
            return False
        for i in range(len(accuracies) - 1):
            if accuracies[i][1] - accuracies[i + 1][1] > 30:
                return True
        return False
    
    def _recommend_difficulty(self, breakdown: Dict[DifficultyLevel, DifficultyPerformance]) -> DifficultyLevel:
        """Recommend the most appropriate difficulty level."""
        levels = [DifficultyLevel.EASY, DifficultyLevel.MEDIUM, DifficultyLevel.HARD, DifficultyLevel.EXPERT]
        best = DifficultyLevel.EASY
        for level in levels:
            if level in breakdown and breakdown[level].accuracy >= breakdown[level].benchmark:
                best = level
        return best

    async def store_analysis(self, analysis: DifficultyAnalysisResponse) -> bool:
        """Store difficulty analysis in MongoDB."""
        try:
            mongo_db = db.mongo_db
            if mongo_db:
                await mongo_db.difficulty_analytics.update_one(
                    {"student_id": analysis.student_id},
                    {"$set": analysis.model_dump(mode='json')},
                    upsert=True
                )
            return True
        except Exception as e:
            logger.error(f"Error storing difficulty analysis: {e}")
            return False


# Singleton instance
difficulty_analyzer = DifficultyAnalyzer()
