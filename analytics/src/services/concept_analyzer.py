"""
Academic Intelligence Platform - Concept Analysis Service
Analyzes student performance at the concept level for deeper insights.
"""

from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
import uuid

from src.config import db
from src.models import (
    ConceptPerformance,
    ConceptAnalysisResponse,
    MasteryLevel
)
from src.utils import (
    logger,
    calculate_percentage,
    calculate_average,
    calculate_consistency_score,
    get_mastery_level
)


class ConceptAnalyzer:
    """Analyzes student performance at the concept level within chapters."""
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_student_concepts(
        self,
        student_id: str,
        course_id: str,
        chapter_id: Optional[str] = None
    ) -> ConceptAnalysisResponse:
        """Analyze concept-wise performance for a student."""
        logger.info(f"Analyzing concepts for student {student_id}, course {course_id}, chapter {chapter_id}")
        
        try:
            concepts = await self._get_concepts(course_id, chapter_id)
            concept_performances = []
            
            for concept in concepts:
                performance = await self._analyze_single_concept(
                    student_id=student_id, concept=concept
                )
                if performance:
                    concept_performances.append(performance)
            
            mastered = len([c for c in concept_performances if c.mastery_level in [MasteryLevel.EXPERT, MasteryLevel.ADVANCED]])
            struggling = len([c for c in concept_performances if c.mastery_level in [MasteryLevel.BEGINNER, MasteryLevel.NOVICE]])
            
            return ConceptAnalysisResponse(
                student_id=student_id,
                chapter_id=chapter_id,
                course_id=course_id,
                analysis_date=datetime.utcnow(),
                concepts=concept_performances,
                mastered_concepts=mastered,
                struggling_concepts=struggling
            )
        except Exception as e:
            logger.error(f"Error analyzing concepts: {e}")
            raise
    
    async def _get_concepts(self, course_id: str, chapter_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get concepts for analysis."""
        if chapter_id:
            query = """
                SELECT co.id, co.name, co.chapterId as chapter_id, ch.name as chapter_name
                FROM concepts co
                JOIN chapters ch ON co.chapterId = ch.id
                JOIN courses c ON ch.subjectId = c.subjectId
                WHERE c.id = %s AND co.chapterId = %s
                ORDER BY ch.chapterNumber
            """
            params = (course_id, chapter_id)
        else:
            query = """
                SELECT co.id, co.name, co.chapterId as chapter_id, ch.name as chapter_name
                FROM concepts co
                JOIN chapters ch ON co.chapterId = ch.id
                JOIN courses c ON ch.subjectId = c.subjectId
                WHERE c.id = %s
                ORDER BY ch.chapterNumber
            """
            params = (course_id,)
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [dict(row) for row in rows]
    
    async def _analyze_single_concept(
        self, student_id: str, concept: Dict[str, Any]
    ) -> Optional[ConceptPerformance]:
        """Analyze performance for a single concept."""
        concept_id = concept['id']
        
        query = """
            SELECT 
                q.id as question_id,
                sa.isCorrect,
                sa.timeSpent,
                ea.submittedAt
            FROM questions q
            JOIN student_answers sa ON q.id = sa.questionId
            JOIN exam_attempts ea ON sa.attemptId = ea.id
            WHERE q.conceptId = %s
                AND ea.studentId = %s
                AND ea.status IN ('submitted', 'auto_submitted', 'graded')
            ORDER BY ea.submittedAt
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, concept_id, student_id)
            if not rows:
                return None
            
            total_attempts = len(rows)
            correct_attempts = sum(1 for r in rows if r.get('isCorrect'))
            accuracy = calculate_percentage(correct_attempts, total_attempts)
            
            times = [r['timeSpent'] for r in rows if r.get('timeSpent')]
            time_efficiency = await self._calculate_time_efficiency(concept_id, times)
            
            scores = [1 if r.get('isCorrect') else 0 for r in rows]
            consistency = calculate_consistency_score(
                [sum(scores[max(0, i-2):i+1])/min(3, i+1)*100 for i in range(len(scores))]
            ) if len(scores) > 1 else 100.0
            
            understanding_score = accuracy * 0.6 + time_efficiency * 0.2 + consistency * 0.2
            mastery = get_mastery_level(understanding_score)
            
            return ConceptPerformance(
                concept_id=concept_id,
                concept_name=concept['name'],
                chapter_id=concept['chapter_id'],
                chapter_name=concept['chapter_name'],
                total_attempts=total_attempts,
                correct_attempts=correct_attempts,
                accuracy=accuracy,
                understanding_score=round(understanding_score, 2),
                time_efficiency=round(time_efficiency, 2),
                consistency=round(consistency, 2),
                mastery_level=MasteryLevel(mastery),
                prerequisites=[],
                is_prerequisite_weak=False
            )
    
    async def _calculate_time_efficiency(self, concept_id: str, times: List) -> float:
        """Calculate time efficiency normalized against class average."""
        if not times:
            return 50.0
        
        avg_student_time = sum(times) / len(times)
        
        try:
            query = """
                SELECT AVG(sa.timeSpent) as class_avg_time
                FROM student_answers sa
                JOIN questions q ON sa.questionId = q.id
                WHERE q.conceptId = %s AND sa.timeSpent IS NOT NULL AND sa.timeSpent > 0
            """
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(query, concept_id)
                if row and row.get('class_avg_time') and float(row['class_avg_time']) > 0:
                    class_avg = float(row['class_avg_time'])
                    ratio = class_avg / max(avg_student_time, 1)
                    return min(100, max(0, ratio * 50))
        except Exception:
            pass
        return 50.0

    async def store_analysis(self, analysis: ConceptAnalysisResponse) -> bool:
        """Store concept analysis in MongoDB."""
        try:
            mongo_db = db.mongo_db
            if mongo_db:
                await mongo_db.concept_analytics.update_one(
                    {"student_id": analysis.student_id, "course_id": analysis.course_id},
                    {"$set": analysis.model_dump(mode='json')},
                    upsert=True
                )
            return True
        except Exception as e:
            logger.error(f"Error storing concept analysis: {e}")
            return False


# Singleton instance
concept_analyzer = ConceptAnalyzer()
