"""
Academic Intelligence Platform - Chapter Analysis Service
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
    """Analyzes student performance at the chapter level."""
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_student_chapters(
        self,
        student_id: str,
        course_id: str,
        exam_id: Optional[str] = None
    ) -> ChapterAnalysisResponse:
        """Analyze chapter-wise performance for a student."""
        logger.info(f"Analyzing chapters for student {student_id}, course {course_id}, exam {exam_id}")
        
        try:
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
            
            sorted_by_accuracy = sorted(chapter_performances, key=lambda x: x.accuracy, reverse=True)
            
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
    
    async def _get_course_chapters(self, course_id: str) -> List[Dict[str, Any]]:
        """Get all chapters for a course (via course -> subject -> chapters)."""
        query = """
            SELECT ch.id, ch.name, ch.chapterNumber
            FROM chapters ch
            JOIN courses c ON ch.subjectId = c.subjectId
            WHERE c.id = %s
            ORDER BY ch.chapterNumber
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id)
            return [dict(row) for row in rows]
    
    async def _analyze_single_chapter(
        self,
        student_id: str,
        chapter_id: str,
        chapter_name: str,
        exam_id: Optional[str] = None
    ) -> Optional[ChapterPerformance]:
        """Analyze performance for a single chapter."""
        if exam_id:
            query = """
                SELECT 
                    COUNT(*) as total_questions,
                    SUM(CASE WHEN sa.isCorrect = 1 THEN 1 ELSE 0 END) as correct_answers,
                    SUM(CASE WHEN sa.isCorrect = 0 THEN 1 ELSE 0 END) as incorrect_answers,
                    SUM(CASE WHEN sa.isAnswered = 0 THEN 1 ELSE 0 END) as skipped,
                    COALESCE(AVG(sa.timeSpent), 0) as avg_time,
                    COALESCE(SUM(sa.timeSpent), 0) as total_time
                FROM questions q
                JOIN student_answers sa ON q.id = sa.questionId
                JOIN exam_attempts ea ON sa.attemptId = ea.id
                WHERE q.chapterId = %s
                    AND ea.studentId = %s
                    AND ea.examId = %s
                    AND ea.status IN ('submitted', 'auto_submitted', 'graded')
            """
            params = (chapter_id, student_id, exam_id)
        else:
            query = """
                SELECT 
                    COUNT(*) as total_questions,
                    SUM(CASE WHEN sa.isCorrect = 1 THEN 1 ELSE 0 END) as correct_answers,
                    SUM(CASE WHEN sa.isCorrect = 0 THEN 1 ELSE 0 END) as incorrect_answers,
                    SUM(CASE WHEN sa.isAnswered = 0 THEN 1 ELSE 0 END) as skipped,
                    COALESCE(AVG(sa.timeSpent), 0) as avg_time,
                    COALESCE(SUM(sa.timeSpent), 0) as total_time
                FROM questions q
                JOIN student_answers sa ON q.id = sa.questionId
                JOIN exam_attempts ea ON sa.attemptId = ea.id
                WHERE q.chapterId = %s
                    AND ea.studentId = %s
                    AND ea.status IN ('submitted', 'auto_submitted', 'graded')
            """
            params = (chapter_id, student_id)
        
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, *params)
            
            if not row or not row.get('total_questions') or row['total_questions'] == 0:
                return None
            
            total = row['total_questions']
            correct = row['correct_answers'] or 0
            incorrect = row['incorrect_answers'] or 0
            skipped = row['skipped'] or 0
            
            accuracy = calculate_percentage(correct, total)
            mastery = get_mastery_level(accuracy)
            
            improvement = await self._calculate_improvement(student_id, chapter_id, accuracy)
            
            return ChapterPerformance(
                chapter_id=chapter_id,
                chapter_name=chapter_name,
                total_questions=total,
                correct_answers=correct,
                incorrect_answers=incorrect,
                skipped_answers=skipped,
                accuracy=accuracy,
                mastery_level=MasteryLevel(mastery),
                avg_time_per_question=round(float(row['avg_time']), 2),
                total_time_spent=int(row['total_time']),
                improvement_from_last=improvement
            )
    
    async def _calculate_improvement(
        self, student_id: str, chapter_id: str, current_accuracy: float
    ) -> Optional[float]:
        """Calculate improvement from previous exams for this chapter."""
        try:
            query = """
                SELECT 
                    AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) as prev_accuracy
                FROM student_answers sa
                JOIN questions q ON sa.questionId = q.id
                JOIN exam_attempts ea ON sa.attemptId = ea.id
                WHERE q.chapterId = %s
                    AND ea.studentId = %s
                    AND ea.status IN ('submitted', 'auto_submitted', 'graded')
                    AND ea.submittedAt < (
                        SELECT MAX(ea2.submittedAt)
                        FROM exam_attempts ea2
                        JOIN student_answers sa2 ON sa2.attemptId = ea2.id
                        JOIN questions q2 ON sa2.questionId = q2.id
                        WHERE q2.chapterId = %s AND ea2.studentId = %s
                            AND ea2.status IN ('submitted', 'auto_submitted', 'graded')
                    )
            """
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(query, chapter_id, student_id, chapter_id, student_id)
                if row and row.get('prev_accuracy') is not None:
                    return round(current_accuracy - float(row['prev_accuracy']), 2)
            return None
        except Exception:
            return None

    async def get_chapter_comparison(self, student_id: str, course_id: str) -> Dict[str, Any]:
        """Get chapter comparison with class average."""
        query = """
            SELECT 
                q.chapterId as chapter_id,
                ch.name as chapter_name,
                AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) as student_accuracy
            FROM questions q
            JOIN chapters ch ON q.chapterId = ch.id
            JOIN student_answers sa ON q.id = sa.questionId
            JOIN exam_attempts ea ON sa.attemptId = ea.id
            WHERE ea.studentId = %s
                AND ch.subjectId IN (SELECT subjectId FROM courses WHERE id = %s)
                AND ea.status IN ('submitted', 'auto_submitted', 'graded')
            GROUP BY q.chapterId, ch.name
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            comparisons = []
            for row in rows:
                class_query = """
                    SELECT AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) as class_accuracy
                    FROM questions q
                    JOIN student_answers sa ON q.id = sa.questionId
                    JOIN exam_attempts ea ON sa.attemptId = ea.id
                    WHERE q.chapterId = %s
                        AND ea.status IN ('submitted', 'auto_submitted', 'graded')
                """
                class_row = await conn.fetchrow(class_query, row['chapter_id'])
                class_acc = float(class_row['class_accuracy']) if class_row and class_row.get('class_accuracy') else 0
                student_acc = float(row['student_accuracy']) if row.get('student_accuracy') else 0
                deviation = round(student_acc - class_acc, 2)
                comparisons.append({
                    "chapter_id": row['chapter_id'],
                    "chapter_name": row['chapter_name'],
                    "student_accuracy": round(student_acc, 2),
                    "class_accuracy": round(class_acc, 2),
                    "deviation": deviation,
                    "status": "above_average" if deviation > 5 else ("average" if deviation >= -5 else "below_average")
                })
            return {
                "student_id": student_id,
                "course_id": course_id,
                "comparisons": comparisons,
                "chapters_above_average": len([c for c in comparisons if c['status'] == 'above_average']),
                "chapters_below_average": len([c for c in comparisons if c['status'] == 'below_average'])
            }

    async def store_analysis(self, analysis: ChapterAnalysisResponse) -> bool:
        """Store chapter analysis results in MongoDB."""
        try:
            mongo_db = db.mongo_db
            if mongo_db:
                await mongo_db.chapter_analytics.update_one(
                    {"student_id": analysis.student_id, "course_id": analysis.course_id},
                    {"$set": analysis.model_dump(mode='json')},
                    upsert=True
                )
            logger.info(f"Stored chapter analysis for student {analysis.student_id}")
            return True
        except Exception as e:
            logger.error(f"Error storing chapter analysis: {e}")
            return False


# Singleton instance
chapter_analyzer = ChapterAnalyzer()
