"""
🎓 Academic Intelligence Platform - Concept Analysis Service

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
    """
    Analyzes student performance at the concept level within chapters.
    """
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_student_concepts(
        self,
        student_id: int,
        course_id: int,
        chapter_id: Optional[int] = None
    ) -> ConceptAnalysisResponse:
        """
        Analyze concept-wise performance for a student.
        
        Args:
            student_id: Student's ID
            course_id: Course ID
            chapter_id: Optional specific chapter ID
        
        Returns:
            ConceptAnalysisResponse with concept-level breakdown
        """
        logger.info(
            f"Analyzing concepts for student {student_id}, "
            f"course {course_id}, chapter {chapter_id}"
        )
        
        try:
            # Get concepts to analyze
            concepts = await self._get_concepts(course_id, chapter_id)
            
            concept_performances = []
            
            for concept in concepts:
                performance = await self._analyze_single_concept(
                    student_id=student_id,
                    concept=concept
                )
                if performance:
                    concept_performances.append(performance)
            
            # Count mastery levels
            mastered = len([
                c for c in concept_performances 
                if c.mastery_level in [MasteryLevel.EXPERT, MasteryLevel.ADVANCED]
            ])
            struggling = len([
                c for c in concept_performances 
                if c.mastery_level in [MasteryLevel.BEGINNER, MasteryLevel.NOVICE]
            ])
            
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
    
    async def _get_concepts(
        self,
        course_id: int,
        chapter_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Get concepts for analysis."""
        
        if chapter_id:
            query = """
                SELECT c.id, c.name, c.chapter_id, ch.name as chapter_name,
                       c.prerequisites
                FROM concepts c
                JOIN chapters ch ON c.chapter_id = ch.id
                WHERE ch.course_id = $1 AND c.chapter_id = $2 AND c.is_active = true
                ORDER BY ch.sequence_order, c.sequence_order
            """
            params = [course_id, chapter_id]
        else:
            query = """
                SELECT c.id, c.name, c.chapter_id, ch.name as chapter_name,
                       c.prerequisites
                FROM concepts c
                JOIN chapters ch ON c.chapter_id = ch.id
                WHERE ch.course_id = $1 AND c.is_active = true
                ORDER BY ch.sequence_order, c.sequence_order
            """
            params = [course_id]
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [dict(row) for row in rows]
    
    async def _analyze_single_concept(
        self,
        student_id: int,
        concept: Dict[str, Any]
    ) -> Optional[ConceptPerformance]:
        """Analyze performance for a single concept."""
        
        concept_id = concept['id']
        
        # Get all attempts for this concept
        query = """
            SELECT 
                q.id as question_id,
                sa.is_correct,
                sa.time_spent,
                ea.submitted_at
            FROM questions q
            JOIN question_concepts qc ON q.id = qc.question_id
            JOIN student_answers sa ON q.id = sa.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            WHERE qc.concept_id = $1
                AND ea.student_id = $2
                AND ea.status = 'evaluated'
            ORDER BY ea.submitted_at
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, concept_id, student_id)
            
            if not rows:
                return None
            
            total_attempts = len(rows)
            correct_attempts = sum(1 for r in rows if r['is_correct'])
            
            # Calculate metrics
            accuracy = calculate_percentage(correct_attempts, total_attempts)
            
            # Time efficiency (normalized against expected time)
            times = [r['time_spent'] for r in rows if r['time_spent']]
            time_efficiency = await self._calculate_time_efficiency(
                concept_id, times
            )
            
            # Consistency (how stable is performance over time)
            scores = [1 if r['is_correct'] else 0 for r in rows]
            consistency = calculate_consistency_score(
                [sum(scores[max(0, i-2):i+1])/min(3, i+1)*100 
                 for i in range(len(scores))]
            ) if len(scores) > 1 else 100.0
            
            # Understanding score (weighted combination)
            understanding_score = (
                accuracy * 0.6 +
                time_efficiency * 0.2 +
                consistency * 0.2
            )
            
            mastery = get_mastery_level(understanding_score)
            
            # Check if prerequisites are weak
            is_prereq_weak = await self._check_prerequisite_weakness(
                student_id, concept.get('prerequisites', [])
            )
            
            return ConceptPerformance(
                concept_id=concept_id,
                concept_name=concept['name'],
                chapter_id=concept['chapter_id'],
                chapter_name=concept['chapter_name'],
                total_attempts=total_attempts,
                correct_attempts=correct_attempts,
                accuracy=accuracy,
                understanding_score=round(understanding_score, 2),
                time_efficiency=time_efficiency,
                consistency=consistency,
                mastery_level=MasteryLevel(mastery),
                prerequisites=concept.get('prerequisites', []),
                is_prerequisite_weak=is_prereq_weak
            )
    
    async def _calculate_time_efficiency(
        self,
        concept_id: int,
        student_times: List[int]
    ) -> float:
        """
        Calculate time efficiency score (0-100).
        Compares student's time with average expected time.
        """
        if not student_times:
            return 50.0
        
        # Get average time for this concept across all students
        query = """
            SELECT AVG(sa.time_spent) as avg_time
            FROM student_answers sa
            JOIN questions q ON sa.question_id = q.id
            JOIN question_concepts qc ON q.id = qc.question_id
            WHERE qc.concept_id = $1 AND sa.time_spent IS NOT NULL
        """
        
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, concept_id)
            avg_expected = row['avg_time'] if row and row['avg_time'] else 60
        
        student_avg = calculate_average(student_times)
        
        # Calculate efficiency (faster is better, but not too fast)
        if student_avg < avg_expected * 0.5:
            # Too fast might indicate rushing
            efficiency = 70.0
        elif student_avg <= avg_expected:
            # Faster than average
            efficiency = 70 + (1 - student_avg / avg_expected) * 30
        elif student_avg <= avg_expected * 1.5:
            # Slightly slower
            efficiency = 50 + (1.5 - student_avg / avg_expected) * 40
        else:
            # Much slower
            efficiency = max(20, 50 * (avg_expected * 2) / student_avg)
        
        return round(efficiency, 2)
    
    async def _check_prerequisite_weakness(
        self,
        student_id: int,
        prerequisite_ids: List[int]
    ) -> bool:
        """Check if any prerequisite concept is weak."""
        if not prerequisite_ids:
            return False
        
        query = """
            SELECT percentage
            FROM concept_analytics
            WHERE student_id = $1 AND concept_id = ANY($2)
            ORDER BY analyzed_at DESC
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, prerequisite_ids)
            
            for row in rows:
                if row['percentage'] < 60:
                    return True
            
            return False
    
    async def get_concept_dependency_analysis(
        self,
        student_id: int,
        concept_id: int
    ) -> Dict[str, Any]:
        """
        Analyze how a concept's prerequisites affect performance.
        """
        # Get the concept and its prerequisites
        query = """
            SELECT id, name, prerequisites
            FROM concepts
            WHERE id = $1
        """
        
        async with self.pool.acquire() as conn:
            concept = await conn.fetchrow(query, concept_id)
            
            if not concept:
                return {"error": "Concept not found"}
            
            prerequisites = concept['prerequisites'] or []
            
            # Get performance for each prerequisite
            prereq_analysis = []
            for prereq_id in prerequisites:
                prereq_query = """
                    SELECT c.name, ca.percentage
                    FROM concepts c
                    LEFT JOIN concept_analytics ca ON c.id = ca.concept_id 
                        AND ca.student_id = $1
                    WHERE c.id = $2
                    ORDER BY ca.analyzed_at DESC
                    LIMIT 1
                """
                prereq_row = await conn.fetchrow(prereq_query, student_id, prereq_id)
                
                if prereq_row:
                    prereq_analysis.append({
                        "concept_id": prereq_id,
                        "concept_name": prereq_row['name'],
                        "performance": prereq_row['percentage'] or 0,
                        "status": "weak" if (prereq_row['percentage'] or 0) < 60 else "ok"
                    })
            
            weak_prereqs = [p for p in prereq_analysis if p['status'] == 'weak']
            
            return {
                "concept_id": concept_id,
                "concept_name": concept['name'],
                "prerequisites": prereq_analysis,
                "has_weak_prerequisites": len(weak_prereqs) > 0,
                "weak_prerequisites": weak_prereqs,
                "recommendation": (
                    f"Focus on strengthening: {', '.join([p['concept_name'] for p in weak_prereqs])}"
                    if weak_prereqs else
                    "Prerequisites are strong. Focus on this concept directly."
                )
            }
    
    async def get_concept_mastery_progression(
        self,
        student_id: int,
        concept_id: int
    ) -> List[Dict[str, Any]]:
        """
        Get mastery progression over time for a concept.
        """
        query = """
            SELECT 
                ea.submitted_at as date,
                COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 as accuracy
            FROM student_answers sa
            JOIN questions q ON sa.question_id = q.id
            JOIN question_concepts qc ON q.id = qc.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            WHERE qc.concept_id = $1
                AND ea.student_id = $2
                AND ea.status = 'evaluated'
            GROUP BY ea.submitted_at
            ORDER BY ea.submitted_at
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, concept_id, student_id)
            
            progression = []
            for row in rows:
                accuracy = float(row['accuracy']) if row['accuracy'] else 0
                progression.append({
                    "date": row['date'].isoformat() if row['date'] else None,
                    "accuracy": round(accuracy, 2),
                    "mastery_level": get_mastery_level(accuracy)
                })
            
            return progression
    
    async def store_analysis(
        self,
        analysis: ConceptAnalysisResponse
    ) -> bool:
        """Store concept analysis results in database."""
        
        try:
            async with self.pool.acquire() as conn:
                for concept in analysis.concepts:
                    await conn.execute("""
                        INSERT INTO concept_analytics (
                            student_id, concept_id, chapter_id,
                            total_attempts, correct_attempts, percentage,
                            understanding_score, time_efficiency, consistency,
                            mastery_level, analyzed_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (student_id, concept_id, analyzed_at::date)
                        DO UPDATE SET
                            total_attempts = EXCLUDED.total_attempts,
                            correct_attempts = EXCLUDED.correct_attempts,
                            percentage = EXCLUDED.percentage,
                            understanding_score = EXCLUDED.understanding_score,
                            time_efficiency = EXCLUDED.time_efficiency,
                            consistency = EXCLUDED.consistency,
                            mastery_level = EXCLUDED.mastery_level
                    """,
                        analysis.student_id,
                        concept.concept_id,
                        concept.chapter_id,
                        concept.total_attempts,
                        concept.correct_attempts,
                        concept.accuracy,
                        concept.understanding_score,
                        concept.time_efficiency,
                        concept.consistency,
                        concept.mastery_level.value,
                        analysis.analysis_date
                    )
            
            logger.info(f"Stored concept analysis for student {analysis.student_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing concept analysis: {e}")
            return False


# Singleton instance
concept_analyzer = ConceptAnalyzer()
