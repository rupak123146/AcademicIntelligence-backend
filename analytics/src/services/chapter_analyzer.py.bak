"""
🎓 Academic Intelligence Platform - Chapter Analysis Service

Analyzes student performance by chapter to identify strengths and weaknesses.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime

from src.config import db, MASTERY_LEVELS
from src.models import (
    ChapterPerformance,
    ChapterAnalysisResponse,
    MasteryLevel
)
from src.utils import (
    logger,
    calculate_percentage,
    calculate_average,
    get_mastery_level
)


class ChapterAnalyzer:
    """
    Analyzes student performance at the chapter level.
    """
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_student_chapters(
        self,
        student_id: int,
        course_id: int,
        exam_id: Optional[int] = None
    ) -> ChapterAnalysisResponse:
        """
        Analyze chapter-wise performance for a student.
        
        Args:
            student_id: Student's ID
            course_id: Course ID to analyze
            exam_id: Optional specific exam ID (if None, analyze all exams)
        
        Returns:
            ChapterAnalysisResponse with detailed chapter breakdown
        """
        logger.info(
            f"Analyzing chapters for student {student_id}, "
            f"course {course_id}, exam {exam_id}"
        )
        
        try:
            # Get all chapters for the course
            chapters = await self._get_course_chapters(course_id)
            
            chapter_performances = []
            
            for chapter in chapters:
                performance = await self._analyze_single_chapter(
                    student_id=student_id,
                    chapter_id=chapter['id'],
                    chapter_name=chapter['name'],
                    exam_id=exam_id
                )
                if performance:
                    chapter_performances.append(performance)
            
            # Sort by accuracy to find strongest/weakest
            sorted_by_accuracy = sorted(
                chapter_performances, 
                key=lambda x: x.accuracy, 
                reverse=True
            )
            
            # Calculate overall accuracy
            total_correct = sum(c.correct_answers for c in chapter_performances)
            total_questions = sum(c.total_questions for c in chapter_performances)
            overall_accuracy = calculate_percentage(total_correct, total_questions)
            
            return ChapterAnalysisResponse(
                student_id=student_id,
                exam_id=exam_id,
                course_id=course_id,
                analysis_date=datetime.utcnow(),
                chapters=chapter_performances,
                overall_accuracy=overall_accuracy,
                strongest_chapter=sorted_by_accuracy[0] if sorted_by_accuracy else None,
                weakest_chapter=sorted_by_accuracy[-1] if sorted_by_accuracy else None
            )
            
        except Exception as e:
            logger.error(f"Error analyzing chapters: {e}")
            raise
    
    async def _get_course_chapters(self, course_id: int) -> List[Dict[str, Any]]:
        """Get all chapters for a course."""
        query = """
            SELECT id, name, sequence_order
            FROM chapters
            WHERE course_id = $1 AND is_active = true
            ORDER BY sequence_order
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id)
            return [dict(row) for row in rows]
    
    async def _analyze_single_chapter(
        self,
        student_id: int,
        chapter_id: int,
        chapter_name: str,
        exam_id: Optional[int] = None
    ) -> Optional[ChapterPerformance]:
        """Analyze performance for a single chapter."""
        
        # Build query based on whether exam_id is provided
        if exam_id:
            query = """
                SELECT 
                    COUNT(*) as total_questions,
                    COUNT(CASE WHEN sa.is_correct = true THEN 1 END) as correct_answers,
                    COUNT(CASE WHEN sa.is_correct = false THEN 1 END) as incorrect_answers,
                    COUNT(CASE WHEN sa.is_skipped = true OR sa.selected_option_id IS NULL THEN 1 END) as skipped,
                    COALESCE(AVG(sa.time_spent), 0) as avg_time,
                    COALESCE(SUM(sa.time_spent), 0) as total_time
                FROM questions q
                JOIN student_answers sa ON q.id = sa.question_id
                JOIN exam_attempts ea ON sa.attempt_id = ea.id
                WHERE q.chapter_id = $1
                    AND ea.student_id = $2
                    AND ea.exam_id = $3
                    AND ea.status = 'evaluated'
            """
            params = [chapter_id, student_id, exam_id]
        else:
            query = """
                SELECT 
                    COUNT(*) as total_questions,
                    COUNT(CASE WHEN sa.is_correct = true THEN 1 END) as correct_answers,
                    COUNT(CASE WHEN sa.is_correct = false THEN 1 END) as incorrect_answers,
                    COUNT(CASE WHEN sa.is_skipped = true OR sa.selected_option_id IS NULL THEN 1 END) as skipped,
                    COALESCE(AVG(sa.time_spent), 0) as avg_time,
                    COALESCE(SUM(sa.time_spent), 0) as total_time
                FROM questions q
                JOIN student_answers sa ON q.id = sa.question_id
                JOIN exam_attempts ea ON sa.attempt_id = ea.id
                WHERE q.chapter_id = $1
                    AND ea.student_id = $2
                    AND ea.status = 'evaluated'
            """
            params = [chapter_id, student_id]
        
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, *params)
            
            if not row or row['total_questions'] == 0:
                return None
            
            total = row['total_questions']
            correct = row['correct_answers']
            incorrect = row['incorrect_answers']
            skipped = row['skipped']
            
            accuracy = calculate_percentage(correct, total)
            mastery = get_mastery_level(accuracy)
            
            # Get previous performance for improvement calculation
            improvement = await self._calculate_improvement(
                student_id, chapter_id, accuracy
            )
            
            return ChapterPerformance(
                chapter_id=chapter_id,
                chapter_name=chapter_name,
                total_questions=total,
                correct_answers=correct,
                incorrect_answers=incorrect,
                skipped_answers=skipped,
                accuracy=accuracy,
                mastery_level=MasteryLevel(mastery),
                avg_time_per_question=round(row['avg_time'], 2),
                total_time_spent=int(row['total_time']),
                improvement_from_last=improvement
            )
    
    async def _calculate_improvement(
        self,
        student_id: int,
        chapter_id: int,
        current_accuracy: float
    ) -> Optional[float]:
        """Calculate improvement from last attempt."""
        
        query = """
            SELECT percentage as last_accuracy
            FROM chapter_analytics
            WHERE student_id = $1 AND chapter_id = $2
            ORDER BY analyzed_at DESC
            LIMIT 1 OFFSET 1
        """
        
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, student_id, chapter_id)
            
            if row:
                return round(current_accuracy - row['last_accuracy'], 2)
            return None
    
    async def get_chapter_comparison(
        self,
        student_id: int,
        course_id: int
    ) -> Dict[str, Any]:
        """
        Get chapter comparison with class average.
        """
        query = """
            WITH student_perf AS (
                SELECT 
                    q.chapter_id,
                    c.name as chapter_name,
                    COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                        NULLIF(COUNT(*), 0) * 100 as student_accuracy
                FROM questions q
                JOIN chapters c ON q.chapter_id = c.id
                JOIN student_answers sa ON q.id = sa.question_id
                JOIN exam_attempts ea ON sa.attempt_id = ea.id
                WHERE ea.student_id = $1 AND c.course_id = $2 AND ea.status = 'evaluated'
                GROUP BY q.chapter_id, c.name
            ),
            class_perf AS (
                SELECT 
                    q.chapter_id,
                    COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                        NULLIF(COUNT(*), 0) * 100 as class_accuracy
                FROM questions q
                JOIN chapters c ON q.chapter_id = c.id
                JOIN student_answers sa ON q.id = sa.question_id
                JOIN exam_attempts ea ON sa.attempt_id = ea.id
                JOIN course_enrollments ce ON ea.student_id = ce.student_id
                WHERE c.course_id = $2 AND ea.status = 'evaluated'
                GROUP BY q.chapter_id
            )
            SELECT 
                sp.chapter_id,
                sp.chapter_name,
                ROUND(sp.student_accuracy::numeric, 2) as student_accuracy,
                ROUND(cp.class_accuracy::numeric, 2) as class_accuracy,
                ROUND((sp.student_accuracy - cp.class_accuracy)::numeric, 2) as deviation
            FROM student_perf sp
            JOIN class_perf cp ON sp.chapter_id = cp.chapter_id
            ORDER BY sp.chapter_name
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            
            comparisons = []
            for row in rows:
                comparisons.append({
                    "chapter_id": row['chapter_id'],
                    "chapter_name": row['chapter_name'],
                    "student_accuracy": float(row['student_accuracy']) if row['student_accuracy'] else 0,
                    "class_accuracy": float(row['class_accuracy']) if row['class_accuracy'] else 0,
                    "deviation": float(row['deviation']) if row['deviation'] else 0,
                    "status": (
                        "above_average" if row['deviation'] and row['deviation'] > 5 else
                        "average" if row['deviation'] and row['deviation'] >= -5 else
                        "below_average"
                    )
                })
            
            return {
                "student_id": student_id,
                "course_id": course_id,
                "comparisons": comparisons,
                "chapters_above_average": len([c for c in comparisons if c['status'] == 'above_average']),
                "chapters_below_average": len([c for c in comparisons if c['status'] == 'below_average'])
            }
    
    async def store_analysis(
        self,
        analysis: ChapterAnalysisResponse
    ) -> bool:
        """Store chapter analysis results in database."""
        
        try:
            async with self.pool.acquire() as conn:
                for chapter in analysis.chapters:
                    await conn.execute("""
                        INSERT INTO chapter_analytics (
                            student_id, chapter_id, total_questions,
                            correct_answers, incorrect_answers, skipped,
                            percentage, mastery_level, avg_time_per_question,
                            total_time_spent, analyzed_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (student_id, chapter_id, analyzed_at::date)
                        DO UPDATE SET
                            total_questions = EXCLUDED.total_questions,
                            correct_answers = EXCLUDED.correct_answers,
                            incorrect_answers = EXCLUDED.incorrect_answers,
                            skipped = EXCLUDED.skipped,
                            percentage = EXCLUDED.percentage,
                            mastery_level = EXCLUDED.mastery_level,
                            avg_time_per_question = EXCLUDED.avg_time_per_question,
                            total_time_spent = EXCLUDED.total_time_spent
                    """,
                        analysis.student_id,
                        chapter.chapter_id,
                        chapter.total_questions,
                        chapter.correct_answers,
                        chapter.incorrect_answers,
                        chapter.skipped_answers,
                        chapter.accuracy,
                        chapter.mastery_level.value,
                        chapter.avg_time_per_question,
                        chapter.total_time_spent,
                        analysis.analysis_date
                    )
            
            logger.info(f"Stored chapter analysis for student {analysis.student_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing chapter analysis: {e}")
            return False


# Singleton instance
chapter_analyzer = ChapterAnalyzer()
