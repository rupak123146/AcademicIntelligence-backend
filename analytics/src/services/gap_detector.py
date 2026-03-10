"""
Academic Intelligence Platform - Learning Gap Detection Service
Identifies specific knowledge gaps that hinder student progress.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
import uuid

from src.config import db, GAP_SEVERITY
from src.models import (
    LearningGap,
    LearningGapsResponse,
    GapType,
    GapSeverity
)
from src.utils import (
    logger,
    calculate_percentage,
    get_gap_severity
)


class GapDetector:
    """Detects learning gaps through multi-factor analysis."""
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def detect_learning_gaps(
        self, student_id: str, course_id: str
    ) -> LearningGapsResponse:
        """Detect all learning gaps for a student in a course."""
        logger.info(f"Detecting learning gaps for student {student_id}, course {course_id}")
        
        try:
            all_gaps = []
            
            conceptual_gaps = await self._detect_conceptual_gaps(student_id, course_id)
            all_gaps.extend(conceptual_gaps)
            
            chapter_gaps = await self._detect_chapter_gaps(student_id, course_id)
            all_gaps.extend(chapter_gaps)
            
            speed_gaps = await self._detect_speed_gaps(student_id, course_id)
            all_gaps.extend(speed_gaps)
            
            all_gaps = self._prioritize_gaps(all_gaps)
            
            critical_count = len([g for g in all_gaps if g.severity == GapSeverity.CRITICAL])
            high_count = len([g for g in all_gaps if g.severity == GapSeverity.HIGH])
            
            return LearningGapsResponse(
                student_id=student_id, course_id=course_id,
                analysis_date=datetime.utcnow(),
                total_gaps=len(all_gaps), critical_gaps=critical_count, high_gaps=high_count,
                gaps=all_gaps,
                priority_order=[g.gap_id for g in all_gaps]
            )
        except Exception as e:
            logger.error(f"Error detecting learning gaps: {e}")
            raise
    
    async def _detect_chapter_gaps(self, student_id: str, course_id: str) -> List[LearningGap]:
        """Detect chapter-level gaps where student accuracy is below threshold."""
        gaps = []
        query = """
            SELECT 
                ch.id as chapter_id, ch.name as chapter_name,
                AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) as accuracy,
                COUNT(*) as total_questions
            FROM questions q
            JOIN chapters ch ON q.chapterId = ch.id
            JOIN student_answers sa ON q.id = sa.questionId
            JOIN exam_attempts ea ON sa.attemptId = ea.id
            JOIN courses c ON ch.subjectId = c.subjectId
            WHERE ea.studentId = %s AND c.id = %s
                AND ea.status IN ('submitted', 'auto_submitted', 'graded')
            GROUP BY ch.id, ch.name
            HAVING AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) < 60
            ORDER BY accuracy ASC
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            for row in rows:
                accuracy = float(row['accuracy']) if row.get('accuracy') else 0
                severity = get_gap_severity(accuracy)
                impact = min(100, (60 - accuracy) * 2)
                gaps.append(LearningGap(
                    gap_id=str(uuid.uuid4()),
                    gap_type=GapType.FOUNDATIONAL,
                    severity=GapSeverity(severity),
                    chapter_id=row['chapter_id'],
                    chapter_name=row['chapter_name'],
                    current_accuracy=accuracy,
                    target_accuracy=70.0,
                    impact_score=impact,
                    recommendation=f"Focus on strengthening your understanding of {row['chapter_name']}. "
                                   f"Your accuracy is {accuracy:.1f}%, which needs improvement.",
                    action_items=[
                        f"Review fundamental concepts in {row['chapter_name']}",
                        "Work through basic examples before advancing",
                        "Practice with progressively harder problems"
                    ],
                    estimated_fix_time="3-5 hours" if accuracy > 40 else "5-8 hours"
                ))
        return gaps
    
    async def _detect_conceptual_gaps(self, student_id: str, course_id: str) -> List[LearningGap]:
        """Detect concept-level gaps."""
        gaps = []
        query = """
            SELECT 
                co.id as concept_id, co.name as concept_name,
                ch.id as chapter_id, ch.name as chapter_name,
                AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) as accuracy,
                COUNT(*) as total_questions
            FROM questions q
            JOIN concepts co ON q.conceptId = co.id
            JOIN chapters ch ON co.chapterId = ch.id
            JOIN student_answers sa ON q.id = sa.questionId
            JOIN exam_attempts ea ON sa.attemptId = ea.id
            JOIN courses c ON ch.subjectId = c.subjectId
            WHERE ea.studentId = %s AND c.id = %s
                AND ea.status IN ('submitted', 'auto_submitted', 'graded')
                AND q.conceptId IS NOT NULL
            GROUP BY co.id, co.name, ch.id, ch.name
            HAVING AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) < 50
            ORDER BY accuracy ASC
            LIMIT 10
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            for row in rows:
                accuracy = float(row['accuracy']) if row.get('accuracy') else 0
                severity = get_gap_severity(accuracy)
                impact = min(100, (50 - accuracy) * 2.5)
                gaps.append(LearningGap(
                    gap_id=str(uuid.uuid4()),
                    gap_type=GapType.CONCEPTUAL,
                    severity=GapSeverity(severity),
                    chapter_id=row['chapter_id'],
                    chapter_name=row['chapter_name'],
                    concept_id=row['concept_id'],
                    concept_name=row['concept_name'],
                    current_accuracy=accuracy,
                    target_accuracy=70.0,
                    impact_score=impact,
                    recommendation=f"Your understanding of '{row['concept_name']}' in {row['chapter_name']} "
                                   f"needs attention ({accuracy:.1f}% accuracy).",
                    action_items=[
                        f"Review the concept '{row['concept_name']}' thoroughly",
                        "Study related examples and worked solutions",
                        "Practice concept-specific questions"
                    ],
                    estimated_fix_time="2-4 hours"
                ))
        return gaps
    
    async def _detect_speed_gaps(self, student_id: str, course_id: str) -> List[LearningGap]:
        """Detect speed gaps where student is correct but too slow."""
        gaps = []
        query = """
            SELECT 
                ch.id as chapter_id, ch.name as chapter_name,
                AVG(sa.timeSpent) as avg_student_time,
                AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) as accuracy
            FROM questions q
            JOIN chapters ch ON q.chapterId = ch.id
            JOIN student_answers sa ON q.id = sa.questionId
            JOIN exam_attempts ea ON sa.attemptId = ea.id
            JOIN courses c ON ch.subjectId = c.subjectId
            WHERE ea.studentId = %s AND c.id = %s
                AND ea.status IN ('submitted', 'auto_submitted', 'graded')
                AND sa.timeSpent IS NOT NULL
            GROUP BY ch.id, ch.name
            HAVING AVG(CASE WHEN sa.isCorrect = 1 THEN 100.0 ELSE 0.0 END) >= 60
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            for row in rows:
                student_avg = float(row['avg_student_time']) if row.get('avg_student_time') else 0
                class_query = """
                    SELECT AVG(sa.timeSpent) as class_avg
                    FROM student_answers sa
                    JOIN questions q ON sa.questionId = q.id
                    JOIN exam_attempts ea ON sa.attemptId = ea.id
                    WHERE q.chapterId = %s AND sa.timeSpent IS NOT NULL
                        AND ea.status IN ('submitted', 'auto_submitted', 'graded')
                """
                class_row = await conn.fetchrow(class_query, row['chapter_id'])
                class_avg = float(class_row['class_avg']) if class_row and class_row.get('class_avg') else student_avg
                
                if class_avg > 0 and student_avg > class_avg * 1.5:
                    gaps.append(LearningGap(
                        gap_id=str(uuid.uuid4()),
                        gap_type=GapType.SPEED,
                        severity=GapSeverity.LOW,
                        chapter_id=row['chapter_id'],
                        chapter_name=row['chapter_name'],
                        current_accuracy=float(row['accuracy']),
                        target_accuracy=70.0,
                        impact_score=30.0,
                        recommendation=f"You understand {row['chapter_name']} well but take longer than average. "
                                       f"Practice for speed improvement.",
                        action_items=[
                            "Practice timed problem-solving",
                            "Focus on recognizing patterns quickly",
                            "Work on mental math and shortcuts"
                        ],
                        estimated_fix_time="2-3 hours"
                    ))
        return gaps
    
    def _prioritize_gaps(self, gaps: List[LearningGap]) -> List[LearningGap]:
        """Sort gaps by severity and impact."""
        severity_order = {GapSeverity.CRITICAL: 0, GapSeverity.HIGH: 1, GapSeverity.MEDIUM: 2, GapSeverity.LOW: 3}
        return sorted(gaps, key=lambda g: (severity_order.get(g.severity, 4), -g.impact_score))
    
    async def store_gaps(self, gaps_response: LearningGapsResponse) -> bool:
        """Store learning gaps in MongoDB."""
        try:
            mongo_db = db.mongo_db
            if mongo_db:
                await mongo_db.learning_gaps.update_one(
                    {"student_id": gaps_response.student_id, "course_id": gaps_response.course_id},
                    {"$set": gaps_response.model_dump(mode='json')},
                    upsert=True
                )
            return True
        except Exception as e:
            logger.error(f"Error storing gaps: {e}")
            return False


# Singleton instance
gap_detector = GapDetector()
