"""
🎓 Academic Intelligence Platform - Difficulty Analysis Service

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
    """
    Analyzes student performance across different difficulty levels.
    """
    
    def __init__(self):
        self.pool = None
        self.benchmarks = DIFFICULTY_BENCHMARKS
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_difficulty_performance(
        self,
        student_id: int,
        course_id: Optional[int] = None,
        exam_id: Optional[int] = None
    ) -> DifficultyAnalysisResponse:
        """
        Analyze performance by difficulty level.
        
        Args:
            student_id: Student's ID
            course_id: Optional course filter
            exam_id: Optional specific exam
        
        Returns:
            DifficultyAnalysisResponse with difficulty breakdown
        """
        logger.info(
            f"Analyzing difficulty for student {student_id}, "
            f"course {course_id}, exam {exam_id}"
        )
        
        try:
            difficulty_breakdown = {}
            
            for difficulty in DifficultyLevel:
                performance = await self._analyze_difficulty_level(
                    student_id=student_id,
                    difficulty=difficulty,
                    course_id=course_id,
                    exam_id=exam_id
                )
                if performance:
                    difficulty_breakdown[difficulty] = performance
            
            # Check for difficulty transition issues
            transition_issue = self._check_transition_issue(difficulty_breakdown)
            
            # Recommend appropriate difficulty
            recommended = self._recommend_difficulty(difficulty_breakdown)
            
            return DifficultyAnalysisResponse(
                student_id=student_id,
                exam_id=exam_id,
                course_id=course_id,
                analysis_date=datetime.utcnow(),
                difficulty_breakdown=difficulty_breakdown,
                difficulty_transition_issue=transition_issue,
                recommended_difficulty=recommended
            )
            
        except Exception as e:
            logger.error(f"Error analyzing difficulty: {e}")
            raise
    
    async def _analyze_difficulty_level(
        self,
        student_id: int,
        difficulty: DifficultyLevel,
        course_id: Optional[int] = None,
        exam_id: Optional[int] = None
    ) -> Optional[DifficultyPerformance]:
        """Analyze performance for a specific difficulty level."""
        
        # Build query based on filters
        base_query = """
            SELECT 
                COUNT(*) as total_questions,
                COUNT(CASE WHEN sa.is_correct = true THEN 1 END) as correct_answers,
                COALESCE(AVG(sa.time_spent), 0) as avg_time
            FROM questions q
            JOIN student_answers sa ON q.id = sa.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            WHERE q.difficulty_level = $1
                AND ea.student_id = $2
                AND ea.status = 'evaluated'
        """
        
        params = [difficulty.value, student_id]
        
        if exam_id:
            base_query += " AND ea.exam_id = $3"
            params.append(exam_id)
        elif course_id:
            base_query += """
                AND ea.exam_id IN (
                    SELECT id FROM exams WHERE course_id = $3
                )
            """
            params.append(course_id)
        
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(base_query, *params)
            
            if not row or row['total_questions'] == 0:
                return None
            
            total = row['total_questions']
            correct = row['correct_answers']
            accuracy = calculate_percentage(correct, total)
            
            benchmark = self.benchmarks.get(difficulty.value, 60)
            deviation = round(accuracy - benchmark, 2)
            performance_tag = get_performance_tag(accuracy, benchmark)
            
            return DifficultyPerformance(
                difficulty=difficulty,
                total_questions=total,
                correct_answers=correct,
                accuracy=accuracy,
                avg_time=round(row['avg_time'], 2),
                benchmark=benchmark,
                performance_tag=PerformanceTag(performance_tag),
                deviation_from_benchmark=deviation
            )
    
    def _check_transition_issue(
        self,
        breakdown: Dict[DifficultyLevel, DifficultyPerformance]
    ) -> bool:
        """
        Check if student has difficulty transition issues.
        
        A transition issue occurs when:
        - Easy accuracy is significantly higher than medium/hard
        - There's a sudden drop between adjacent difficulty levels
        """
        if len(breakdown) < 2:
            return False
        
        levels = [DifficultyLevel.EASY, DifficultyLevel.MEDIUM, 
                  DifficultyLevel.HARD, DifficultyLevel.EXPERT]
        
        accuracies = []
        for level in levels:
            if level in breakdown:
                accuracies.append((level, breakdown[level].accuracy))
        
        if len(accuracies) < 2:
            return False
        
        # Check for sudden drops (> 30% drop between adjacent levels)
        for i in range(len(accuracies) - 1):
            current_acc = accuracies[i][1]
            next_acc = accuracies[i + 1][1]
            
            if current_acc - next_acc > 30:
                return True
        
        return False
    
    def _recommend_difficulty(
        self,
        breakdown: Dict[DifficultyLevel, DifficultyPerformance]
    ) -> DifficultyLevel:
        """
        Recommend the most appropriate difficulty level for the student.
        
        Logic:
        - Find the highest difficulty where student meets benchmark
        - If all below benchmark, recommend the level they're closest to meeting
        """
        levels = [DifficultyLevel.EASY, DifficultyLevel.MEDIUM, 
                  DifficultyLevel.HARD, DifficultyLevel.EXPERT]
        
        recommended = DifficultyLevel.EASY
        
        for level in levels:
            if level in breakdown:
                perf = breakdown[level]
                # If meeting or exceeding benchmark, they can handle this level
                if perf.accuracy >= perf.benchmark:
                    recommended = level
                else:
                    # Stop at first level where they're struggling
                    break
        
        return recommended
    
    async def get_difficulty_progression(
        self,
        student_id: int,
        course_id: int
    ) -> Dict[str, Any]:
        """
        Analyze how student's difficulty handling has progressed over time.
        """
        query = """
            SELECT 
                q.difficulty_level,
                DATE_TRUNC('week', ea.submitted_at) as week,
                COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 as accuracy
            FROM questions q
            JOIN student_answers sa ON q.id = sa.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            JOIN exams e ON ea.exam_id = e.id
            WHERE ea.student_id = $1 
                AND e.course_id = $2
                AND ea.status = 'evaluated'
            GROUP BY q.difficulty_level, DATE_TRUNC('week', ea.submitted_at)
            ORDER BY week, q.difficulty_level
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            
            # Organize by difficulty level
            progression = {level.value: [] for level in DifficultyLevel}
            
            for row in rows:
                level = row['difficulty_level']
                if level in progression:
                    progression[level].append({
                        "week": row['week'].isoformat() if row['week'] else None,
                        "accuracy": round(float(row['accuracy']), 2) if row['accuracy'] else 0
                    })
            
            # Calculate improvement for each level
            improvements = {}
            for level, data in progression.items():
                if len(data) >= 2:
                    first_acc = data[0]['accuracy']
                    last_acc = data[-1]['accuracy']
                    improvements[level] = round(last_acc - first_acc, 2)
                else:
                    improvements[level] = 0
            
            return {
                "student_id": student_id,
                "course_id": course_id,
                "progression": progression,
                "improvements": improvements,
                "summary": self._generate_progression_summary(improvements)
            }
    
    def _generate_progression_summary(
        self,
        improvements: Dict[str, float]
    ) -> str:
        """Generate a summary of difficulty progression."""
        improving_levels = [
            level for level, imp in improvements.items() if imp > 5
        ]
        declining_levels = [
            level for level, imp in improvements.items() if imp < -5
        ]
        
        if improving_levels and not declining_levels:
            return f"Great progress on {', '.join(improving_levels)} difficulty questions!"
        elif declining_levels and not improving_levels:
            return f"Performance has declined on {', '.join(declining_levels)} questions. Consider reviewing fundamentals."
        elif improving_levels and declining_levels:
            return f"Mixed progress: Improving on {', '.join(improving_levels)}, but struggling with {', '.join(declining_levels)}."
        else:
            return "Performance has been relatively stable across difficulty levels."
    
    async def get_class_difficulty_distribution(
        self,
        course_id: int,
        exam_id: int
    ) -> Dict[str, Any]:
        """
        Get class-wide performance distribution by difficulty.
        Useful for educators to understand question calibration.
        """
        query = """
            SELECT 
                q.difficulty_level,
                COUNT(DISTINCT ea.student_id) as total_students,
                COUNT(*) as total_attempts,
                COUNT(CASE WHEN sa.is_correct THEN 1 END) as correct_count,
                COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 as accuracy,
                AVG(sa.time_spent) as avg_time
            FROM questions q
            JOIN student_answers sa ON q.id = sa.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            WHERE ea.exam_id = $1 AND ea.status = 'evaluated'
            GROUP BY q.difficulty_level
            ORDER BY q.difficulty_level
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, exam_id)
            
            distribution = {}
            for row in rows:
                level = row['difficulty_level']
                accuracy = float(row['accuracy']) if row['accuracy'] else 0
                benchmark = self.benchmarks.get(level, 60)
                
                # Determine if difficulty is calibrated correctly
                if accuracy > benchmark + 15:
                    calibration = "too_easy"
                elif accuracy < benchmark - 15:
                    calibration = "too_hard"
                else:
                    calibration = "well_calibrated"
                
                distribution[level] = {
                    "total_students": row['total_students'],
                    "total_attempts": row['total_attempts'],
                    "correct_count": row['correct_count'],
                    "accuracy": round(accuracy, 2),
                    "benchmark": benchmark,
                    "avg_time": round(float(row['avg_time']), 2) if row['avg_time'] else 0,
                    "calibration": calibration
                }
            
            return {
                "course_id": course_id,
                "exam_id": exam_id,
                "distribution": distribution,
                "recommendations": self._generate_calibration_recommendations(distribution)
            }
    
    def _generate_calibration_recommendations(
        self,
        distribution: Dict[str, Dict]
    ) -> List[str]:
        """Generate recommendations for question difficulty calibration."""
        recommendations = []
        
        for level, data in distribution.items():
            if data.get('calibration') == 'too_easy':
                recommendations.append(
                    f"{level.capitalize()} questions may be too easy. "
                    f"Consider adding more challenging questions at this level."
                )
            elif data.get('calibration') == 'too_hard':
                recommendations.append(
                    f"{level.capitalize()} questions may be too difficult. "
                    f"Review these questions for clarity or consider adjusting difficulty."
                )
        
        if not recommendations:
            recommendations.append(
                "Question difficulties are well calibrated across all levels."
            )
        
        return recommendations
    
    async def store_analysis(
        self,
        analysis: DifficultyAnalysisResponse
    ) -> bool:
        """Store difficulty analysis results in database."""
        
        try:
            async with self.pool.acquire() as conn:
                for difficulty, perf in analysis.difficulty_breakdown.items():
                    await conn.execute("""
                        INSERT INTO difficulty_analytics (
                            student_id, course_id, difficulty_level,
                            total_questions, correct_answers, percentage,
                            avg_time, performance_tag, analyzed_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        ON CONFLICT (student_id, course_id, difficulty_level, analyzed_at::date)
                        DO UPDATE SET
                            total_questions = EXCLUDED.total_questions,
                            correct_answers = EXCLUDED.correct_answers,
                            percentage = EXCLUDED.percentage,
                            avg_time = EXCLUDED.avg_time,
                            performance_tag = EXCLUDED.performance_tag
                    """,
                        analysis.student_id,
                        analysis.course_id,
                        difficulty.value,
                        perf.total_questions,
                        perf.correct_answers,
                        perf.accuracy,
                        perf.avg_time,
                        perf.performance_tag.value,
                        analysis.analysis_date
                    )
            
            logger.info(f"Stored difficulty analysis for student {analysis.student_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing difficulty analysis: {e}")
            return False


# Singleton instance
difficulty_analyzer = DifficultyAnalyzer()
