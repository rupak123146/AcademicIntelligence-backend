"""
🎓 Academic Intelligence Platform - Learning Gap Detection Service

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
    """
    Detects learning gaps through multi-factor analysis.
    
    Gap Types:
    1. Foundational Gap: Missing prerequisite knowledge
    2. Conceptual Gap: Misunderstanding of core concepts
    3. Application Gap: Cannot apply knowledge to problems
    4. Speed Gap: Understands but too slow
    """
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def detect_learning_gaps(
        self,
        student_id: int,
        course_id: int
    ) -> LearningGapsResponse:
        """
        Detect all learning gaps for a student in a course.
        
        Args:
            student_id: Student's ID
            course_id: Course ID to analyze
        
        Returns:
            LearningGapsResponse with detected gaps prioritized by severity
        """
        logger.info(f"Detecting learning gaps for student {student_id}, course {course_id}")
        
        try:
            all_gaps = []
            
            # Detect foundational gaps
            foundational_gaps = await self._detect_foundational_gaps(
                student_id, course_id
            )
            all_gaps.extend(foundational_gaps)
            
            # Detect conceptual gaps
            conceptual_gaps = await self._detect_conceptual_gaps(
                student_id, course_id
            )
            all_gaps.extend(conceptual_gaps)
            
            # Detect application gaps
            application_gaps = await self._detect_application_gaps(
                student_id, course_id
            )
            all_gaps.extend(application_gaps)
            
            # Detect speed gaps
            speed_gaps = await self._detect_speed_gaps(
                student_id, course_id
            )
            all_gaps.extend(speed_gaps)
            
            # Sort by severity and impact
            all_gaps = self._prioritize_gaps(all_gaps)
            
            # Count by severity
            critical_count = len([g for g in all_gaps if g.severity == GapSeverity.CRITICAL])
            high_count = len([g for g in all_gaps if g.severity == GapSeverity.HIGH])
            
            return LearningGapsResponse(
                student_id=student_id,
                course_id=course_id,
                analysis_date=datetime.utcnow(),
                total_gaps=len(all_gaps),
                critical_gaps=critical_count,
                high_gaps=high_count,
                gaps=all_gaps,
                priority_order=[g.gap_id for g in all_gaps]
            )
            
        except Exception as e:
            logger.error(f"Error detecting learning gaps: {e}")
            raise
    
    async def _detect_foundational_gaps(
        self,
        student_id: int,
        course_id: int
    ) -> List[LearningGap]:
        """
        Detect foundational gaps where prerequisites are weak.
        """
        gaps = []
        
        # Get chapters with weak performance AND weak prerequisites
        query = """
            WITH student_chapter_perf AS (
                SELECT 
                    c.id as chapter_id,
                    c.name as chapter_name,
                    c.prerequisites,
                    COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                        NULLIF(COUNT(*), 0) * 100 as accuracy
                FROM chapters c
                LEFT JOIN questions q ON q.chapter_id = c.id
                LEFT JOIN student_answers sa ON sa.question_id = q.id
                LEFT JOIN exam_attempts ea ON sa.attempt_id = ea.id AND ea.student_id = $1
                WHERE c.course_id = $2 AND ea.status = 'evaluated'
                GROUP BY c.id, c.name, c.prerequisites
            )
            SELECT * FROM student_chapter_perf
            WHERE accuracy < 60 AND prerequisites IS NOT NULL AND array_length(prerequisites, 1) > 0
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            
            for row in rows:
                chapter_id = row['chapter_id']
                chapter_name = row['chapter_name']
                chapter_accuracy = float(row['accuracy']) if row['accuracy'] else 0
                prerequisites = row['prerequisites'] or []
                
                # Check each prerequisite
                for prereq_id in prerequisites:
                    prereq_query = """
                        SELECT 
                            c.name,
                            COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                                NULLIF(COUNT(*), 0) * 100 as accuracy
                        FROM chapters c
                        LEFT JOIN questions q ON q.chapter_id = c.id
                        LEFT JOIN student_answers sa ON sa.question_id = q.id
                        LEFT JOIN exam_attempts ea ON sa.attempt_id = ea.id AND ea.student_id = $1
                        WHERE c.id = $2 AND ea.status = 'evaluated'
                        GROUP BY c.name
                    """
                    prereq_row = await conn.fetchrow(prereq_query, student_id, prereq_id)
                    
                    if prereq_row:
                        prereq_accuracy = float(prereq_row['accuracy']) if prereq_row['accuracy'] else 0
                        
                        if prereq_accuracy < 60:
                            severity = get_gap_severity(prereq_accuracy)
                            impact = self._calculate_impact(
                                prereq_accuracy, chapter_accuracy, is_prerequisite=True
                            )
                            
                            gaps.append(LearningGap(
                                gap_id=str(uuid.uuid4()),
                                gap_type=GapType.FOUNDATIONAL,
                                severity=GapSeverity(severity),
                                chapter_id=chapter_id,
                                chapter_name=chapter_name,
                                prerequisite_id=prereq_id,
                                prerequisite_name=prereq_row['name'],
                                current_accuracy=prereq_accuracy,
                                target_accuracy=70.0,
                                impact_score=impact,
                                recommendation=self._generate_foundational_recommendation(
                                    prereq_row['name'], chapter_name, prereq_accuracy
                                ),
                                action_items=self._generate_action_items(
                                    GapType.FOUNDATIONAL, prereq_row['name']
                                ),
                                estimated_fix_time=self._estimate_fix_time(prereq_accuracy)
                            ))
        
        return gaps
    
    async def _detect_conceptual_gaps(
        self,
        student_id: int,
        course_id: int
    ) -> List[LearningGap]:
        """
        Detect conceptual gaps where core understanding is lacking.
        """
        gaps = []
        
        # Get concepts with consistent incorrect answers
        query = """
            SELECT 
                c.id as concept_id,
                c.name as concept_name,
                ch.id as chapter_id,
                ch.name as chapter_name,
                COUNT(*) as total_attempts,
                COUNT(CASE WHEN sa.is_correct THEN 1 END) as correct_count,
                COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 as accuracy
            FROM concepts c
            JOIN chapters ch ON c.chapter_id = ch.id
            JOIN question_concepts qc ON c.id = qc.concept_id
            JOIN questions q ON qc.question_id = q.id
            JOIN student_answers sa ON q.id = sa.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            WHERE ch.course_id = $1 
                AND ea.student_id = $2 
                AND ea.status = 'evaluated'
            GROUP BY c.id, c.name, ch.id, ch.name
            HAVING COUNT(*) >= 3 AND 
                   COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                       NULLIF(COUNT(*), 0) * 100 < 50
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id, student_id)
            
            for row in rows:
                accuracy = float(row['accuracy']) if row['accuracy'] else 0
                severity = get_gap_severity(accuracy)
                
                # Calculate impact based on concept importance
                impact = self._calculate_impact(accuracy, accuracy, is_prerequisite=False)
                
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
                    recommendation=self._generate_conceptual_recommendation(
                        row['concept_name'], accuracy
                    ),
                    action_items=self._generate_action_items(
                        GapType.CONCEPTUAL, row['concept_name']
                    ),
                    estimated_fix_time=self._estimate_fix_time(accuracy)
                ))
        
        return gaps
    
    async def _detect_application_gaps(
        self,
        student_id: int,
        course_id: int
    ) -> List[LearningGap]:
        """
        Detect application gaps where theory is understood but not applied.
        
        Indicator: Good on easy/recall questions, poor on application/analysis questions.
        """
        gaps = []
        
        query = """
            WITH chapter_by_type AS (
                SELECT 
                    ch.id as chapter_id,
                    ch.name as chapter_name,
                    q.question_type,
                    COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                        NULLIF(COUNT(*), 0) * 100 as accuracy
                FROM chapters ch
                JOIN questions q ON q.chapter_id = ch.id
                JOIN student_answers sa ON q.id = sa.question_id
                JOIN exam_attempts ea ON sa.attempt_id = ea.id
                WHERE ch.course_id = $1 
                    AND ea.student_id = $2 
                    AND ea.status = 'evaluated'
                GROUP BY ch.id, ch.name, q.question_type
            ),
            recall_vs_application AS (
                SELECT 
                    chapter_id,
                    chapter_name,
                    MAX(CASE WHEN question_type IN ('mcq', 'true_false') THEN accuracy END) as recall_accuracy,
                    MAX(CASE WHEN question_type IN ('short_answer', 'long_answer', 'coding') THEN accuracy END) as application_accuracy
                FROM chapter_by_type
                GROUP BY chapter_id, chapter_name
            )
            SELECT * FROM recall_vs_application
            WHERE recall_accuracy > 70 AND application_accuracy < 50
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id, student_id)
            
            for row in rows:
                app_accuracy = float(row['application_accuracy']) if row['application_accuracy'] else 0
                recall_accuracy = float(row['recall_accuracy']) if row['recall_accuracy'] else 0
                
                severity = get_gap_severity(app_accuracy)
                impact = recall_accuracy - app_accuracy  # The bigger the gap, higher impact
                
                gaps.append(LearningGap(
                    gap_id=str(uuid.uuid4()),
                    gap_type=GapType.APPLICATION,
                    severity=GapSeverity(severity),
                    chapter_id=row['chapter_id'],
                    chapter_name=row['chapter_name'],
                    current_accuracy=app_accuracy,
                    target_accuracy=70.0,
                    impact_score=min(100, impact),
                    recommendation=self._generate_application_recommendation(
                        row['chapter_name'], recall_accuracy, app_accuracy
                    ),
                    action_items=self._generate_action_items(
                        GapType.APPLICATION, row['chapter_name']
                    ),
                    estimated_fix_time=self._estimate_fix_time(app_accuracy)
                ))
        
        return gaps
    
    async def _detect_speed_gaps(
        self,
        student_id: int,
        course_id: int
    ) -> List[LearningGap]:
        """
        Detect speed gaps where understanding exists but performance is slow.
        
        Indicator: Good accuracy but significantly longer time than average.
        """
        gaps = []
        
        query = """
            WITH student_times AS (
                SELECT 
                    ch.id as chapter_id,
                    ch.name as chapter_name,
                    COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                        NULLIF(COUNT(*), 0) * 100 as accuracy,
                    AVG(sa.time_spent) as student_avg_time
                FROM chapters ch
                JOIN questions q ON q.chapter_id = ch.id
                JOIN student_answers sa ON q.id = sa.question_id
                JOIN exam_attempts ea ON sa.attempt_id = ea.id
                WHERE ch.course_id = $1 
                    AND ea.student_id = $2 
                    AND ea.status = 'evaluated'
                    AND sa.time_spent IS NOT NULL
                GROUP BY ch.id, ch.name
            ),
            class_times AS (
                SELECT 
                    ch.id as chapter_id,
                    AVG(sa.time_spent) as class_avg_time
                FROM chapters ch
                JOIN questions q ON q.chapter_id = ch.id
                JOIN student_answers sa ON q.id = sa.question_id
                JOIN exam_attempts ea ON sa.attempt_id = ea.id
                WHERE ch.course_id = $1 
                    AND ea.status = 'evaluated'
                    AND sa.time_spent IS NOT NULL
                GROUP BY ch.id
            )
            SELECT 
                st.chapter_id,
                st.chapter_name,
                st.accuracy,
                st.student_avg_time,
                ct.class_avg_time
            FROM student_times st
            JOIN class_times ct ON st.chapter_id = ct.chapter_id
            WHERE st.accuracy >= 70 
                AND st.student_avg_time > ct.class_avg_time * 1.5
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id, student_id)
            
            for row in rows:
                student_time = float(row['student_avg_time']) if row['student_avg_time'] else 0
                class_time = float(row['class_avg_time']) if row['class_avg_time'] else 0
                
                # Speed gap severity based on time ratio
                time_ratio = student_time / class_time if class_time > 0 else 1
                
                if time_ratio >= 2.5:
                    severity = "high"
                elif time_ratio >= 2:
                    severity = "medium"
                else:
                    severity = "low"
                
                impact = min(100, (time_ratio - 1) * 50)
                
                gaps.append(LearningGap(
                    gap_id=str(uuid.uuid4()),
                    gap_type=GapType.SPEED,
                    severity=GapSeverity(severity),
                    chapter_id=row['chapter_id'],
                    chapter_name=row['chapter_name'],
                    current_accuracy=float(row['accuracy']) if row['accuracy'] else 0,
                    target_accuracy=70.0,
                    impact_score=impact,
                    recommendation=self._generate_speed_recommendation(
                        row['chapter_name'], time_ratio
                    ),
                    action_items=self._generate_action_items(
                        GapType.SPEED, row['chapter_name']
                    ),
                    estimated_fix_time="1-2 weeks of practice"
                ))
        
        return gaps
    
    def _calculate_impact(
        self,
        accuracy: float,
        dependent_accuracy: float,
        is_prerequisite: bool
    ) -> float:
        """Calculate impact score of a gap."""
        base_impact = 100 - accuracy
        
        if is_prerequisite:
            # Prerequisite gaps have higher impact as they affect downstream learning
            cascade_factor = 1.3
            base_impact = base_impact * cascade_factor
        
        return min(100, round(base_impact, 2))
    
    def _prioritize_gaps(self, gaps: List[LearningGap]) -> List[LearningGap]:
        """Sort gaps by priority (severity and impact)."""
        severity_order = {
            GapSeverity.CRITICAL: 0,
            GapSeverity.HIGH: 1,
            GapSeverity.MEDIUM: 2,
            GapSeverity.LOW: 3
        }
        
        type_order = {
            GapType.FOUNDATIONAL: 0,  # Fix foundations first
            GapType.CONCEPTUAL: 1,
            GapType.APPLICATION: 2,
            GapType.SPEED: 3
        }
        
        return sorted(gaps, key=lambda g: (
            severity_order.get(g.severity, 99),
            type_order.get(g.gap_type, 99),
            -g.impact_score
        ))
    
    def _generate_foundational_recommendation(
        self,
        prereq_name: str,
        chapter_name: str,
        accuracy: float
    ) -> str:
        """Generate recommendation for foundational gap."""
        if accuracy < 30:
            return (
                f"Critical: You need to review '{prereq_name}' before continuing with "
                f"'{chapter_name}'. Your understanding of prerequisites is very weak."
            )
        elif accuracy < 50:
            return (
                f"'{prereq_name}' is a prerequisite for '{chapter_name}' and needs attention. "
                f"Strengthening this foundation will help you progress."
            )
        else:
            return (
                f"Review '{prereq_name}' to strengthen your foundation for '{chapter_name}'."
            )
    
    def _generate_conceptual_recommendation(
        self,
        concept_name: str,
        accuracy: float
    ) -> str:
        """Generate recommendation for conceptual gap."""
        if accuracy < 30:
            return (
                f"You have a significant misunderstanding of '{concept_name}'. "
                f"Consider revisiting the fundamentals and working through basic examples."
            )
        elif accuracy < 50:
            return (
                f"Your understanding of '{concept_name}' needs improvement. "
                f"Focus on the core principles and practice with varied examples."
            )
        else:
            return (
                f"Strengthen your grasp of '{concept_name}' through additional practice."
            )
    
    def _generate_application_recommendation(
        self,
        chapter_name: str,
        recall_accuracy: float,
        app_accuracy: float
    ) -> str:
        """Generate recommendation for application gap."""
        return (
            f"You understand the theory of '{chapter_name}' well ({recall_accuracy:.0f}% recall) "
            f"but struggle to apply it ({app_accuracy:.0f}% application). "
            f"Focus on practice problems and real-world applications."
        )
    
    def _generate_speed_recommendation(
        self,
        chapter_name: str,
        time_ratio: float
    ) -> str:
        """Generate recommendation for speed gap."""
        return (
            f"You understand '{chapter_name}' well but take {time_ratio:.1f}x longer than average. "
            f"Practice timed exercises to improve speed while maintaining accuracy."
        )
    
    def _generate_action_items(
        self,
        gap_type: GapType,
        topic_name: str
    ) -> List[str]:
        """Generate specific action items for a gap."""
        actions = {
            GapType.FOUNDATIONAL: [
                f"Review foundational material for {topic_name}",
                "Complete prerequisite practice exercises",
                "Watch tutorial videos on basic concepts",
                "Take a mini-quiz to assess improvement"
            ],
            GapType.CONCEPTUAL: [
                f"Re-read the chapter on {topic_name}",
                "Create summary notes or flashcards",
                "Work through solved examples step by step",
                "Explain the concept to someone else or write it out"
            ],
            GapType.APPLICATION: [
                "Practice with real-world problem scenarios",
                "Work on case studies and complex problems",
                "Start with guided problems, then try unguided ones",
                "Review worked solutions to understand problem-solving approaches"
            ],
            GapType.SPEED: [
                "Practice with timed quizzes",
                "Review shortcuts and efficient methods",
                "Build muscle memory through repetition",
                "Focus on one topic at a time until fluent"
            ]
        }
        
        return actions.get(gap_type, [])
    
    def _estimate_fix_time(self, accuracy: float) -> str:
        """Estimate time to fix a gap based on current accuracy."""
        if accuracy < 30:
            return "3-4 weeks of focused study"
        elif accuracy < 50:
            return "2-3 weeks of regular practice"
        elif accuracy < 70:
            return "1-2 weeks of targeted practice"
        else:
            return "A few days of review"
    
    async def store_gaps(
        self,
        gaps_response: LearningGapsResponse
    ) -> bool:
        """Store detected gaps in database."""
        
        try:
            async with self.pool.acquire() as conn:
                for gap in gaps_response.gaps:
                    await conn.execute("""
                        INSERT INTO learning_gaps (
                            id, student_id, course_id, gap_type, severity,
                            chapter_id, concept_id, prerequisite_id,
                            current_accuracy, target_accuracy, impact_score,
                            recommendation, status, detected_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13)
                        ON CONFLICT (id) DO UPDATE SET
                            current_accuracy = EXCLUDED.current_accuracy,
                            impact_score = EXCLUDED.impact_score,
                            recommendation = EXCLUDED.recommendation
                    """,
                        uuid.UUID(gap.gap_id),
                        gaps_response.student_id,
                        gaps_response.course_id,
                        gap.gap_type.value,
                        gap.severity.value,
                        gap.chapter_id,
                        gap.concept_id,
                        gap.prerequisite_id,
                        gap.current_accuracy,
                        gap.target_accuracy,
                        gap.impact_score,
                        gap.recommendation,
                        gaps_response.analysis_date
                    )
            
            logger.info(f"Stored {len(gaps_response.gaps)} learning gaps for student {gaps_response.student_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing learning gaps: {e}")
            return False


# Singleton instance
gap_detector = GapDetector()
