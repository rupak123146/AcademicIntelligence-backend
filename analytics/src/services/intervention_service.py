"""
Intervention Tracking Service

Tracks educator interventions for at-risk students:
- Intervention creation and management
- Progress tracking
- Outcome measurement
- Effectiveness analysis
- ROI calculation
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum

from ..config.database import get_db_pool
from ..utils.logger import get_logger

logger = get_logger(__name__)


class InterventionType(str, Enum):
    """Types of interventions"""
    TUTORING = "tutoring"
    MENTORING = "mentoring"
    RESOURCE_PROVISION = "resource_provision"
    COUNSELING = "counseling"
    STUDY_GROUP = "study_group"
    TECH_SUPPORT = "tech_support"


class InterventionStatus(str, Enum):
    """Intervention status"""
    PLANNING = "planning"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class InterventionService:
    """
    Service for managing student interventions
    
    Features:
    - Intervention creation and tracking
    - Progress check-ins
    - Outcome measurement
    - Success rate analysis
    - Impact assessment
    """
    
    def __init__(self):
        self.db_pool = None
        
    async def initialize(self):
        """Initialize service"""
        try:
            self.db_pool = await get_db_pool()
            logger.info("InterventionService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize InterventionService: {e}")
            raise
    
    async def create_intervention(
        self,
        student_id: str,
        educator_id: str,
        course_id: str,
        intervention_type: InterventionType,
        description: str,
        trigger_reason: Optional[str] = None,
        planned_actions: Optional[List[str]] = None,
        expected_duration_days: int = 14
    ) -> Dict[str, Any]:
        """
        Create a new intervention
        
        Args:
            student_id: Student to intervene for
            educator_id: Educator managing intervention
            course_id: Course context
            intervention_type: Type of intervention
            description: Intervention description
            trigger_reason: Why intervention was triggered
            planned_actions: List of planned actions
            expected_duration_days: Expected intervention duration
            
        Returns:
            Created intervention record
        """
        try:
            logger.info(f"Creating {intervention_type.value} intervention for {student_id}")
            
            expected_end_date = datetime.utcnow() + timedelta(days=expected_duration_days)
            
            async with self.db_pool.acquire() as conn:
                query = """
                    INSERT INTO interventions 
                    (student_id, educator_id, course_id, intervention_type, trigger_reason,
                     description, planned_actions, start_date, expected_end_date, status, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    RETURNING 
                        id, student_id, educator_id, intervention_type, description,
                        planned_actions, start_date, expected_end_date, status, created_at
                """
                
                import json
                result = await conn.fetchrow(
                    query,
                    student_id, educator_id, course_id, intervention_type.value, trigger_reason,
                    description, json.dumps(planned_actions or []),
                    datetime.utcnow(), expected_end_date, InterventionStatus.PLANNING.value,
                    datetime.utcnow(), datetime.utcnow()
                )
                
                intervention = dict(result)
                logger.info(f"Intervention created: {intervention['id']}")
                return intervention
                
        except Exception as e:
            logger.error(f"Error creating intervention: {e}")
            raise
    
    async def start_intervention(self, intervention_id: int) -> Dict[str, Any]:
        """Activate an intervention"""
        try:
            async with self.db_pool.acquire() as conn:
                result = await conn.execute(
                    """UPDATE interventions SET status = $1, updated_at = $2 WHERE id = $3""",
                    InterventionStatus.ACTIVE.value,
                    datetime.utcnow(),
                    intervention_id
                )
                
                logger.info(f"Intervention {intervention_id} activated")
                return {"intervention_id": intervention_id, "status": InterventionStatus.ACTIVE.value}
                
        except Exception as e:
            logger.error(f"Error starting intervention: {e}")
            raise
    
    async def add_checkin(
        self,
        intervention_id: int,
        educator_id: str,
        student_response: str,  # positive, neutral, negative
        progress_notes: str,
        next_steps: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Add a progress check-in to an intervention
        
        Tracks:
        - Student response/engagement
        - Progress notes
        - Next steps
        - Check-in timeline
        """
        try:
            logger.info(f"Adding check-in for intervention {intervention_id}")
            
            async with self.db_pool.acquire() as conn:
                query = """
                    INSERT INTO intervention_checkins 
                    (intervention_id, educator_id, checkin_date, student_response, progress_notes, next_steps, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id, intervention_id, checkin_date, student_response, progress_notes
                """
                
                result = await conn.fetchrow(
                    query,
                    intervention_id, educator_id, datetime.utcnow(),
                    student_response, progress_notes, next_steps,
                    datetime.utcnow()
                )
                
                checkin = dict(result)
                logger.info(f"Check-in added: {checkin['id']}")
                return checkin
                
        except Exception as e:
            logger.error(f"Error adding check-in: {e}")
            raise
    
    async def record_outcome(
        self,
        intervention_id: int,
        outcome_metric: str,  # e.g., "score_improvement", "attendance_improvement"
        baseline_value: float,
        post_intervention_value: float,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Record intervention outcome measurement
        
        Args:
            outcome_metric: What metric was measured
            baseline_value: Value before intervention
            post_intervention_value: Value after intervention
            
        Returns:
            Recorded outcome with calculated improvement
        """
        try:
            improvement = post_intervention_value - baseline_value
            improvement_pct = (improvement / baseline_value * 100) if baseline_value != 0 else 0
            
            logger.info(f"Recording outcome for intervention {intervention_id}: {improvement_pct:.1f}%")
            
            async with self.db_pool.acquire() as conn:
                query = """
                    INSERT INTO intervention_outcomes 
                    (intervention_id, outcome_metric, baseline_value, post_intervention_value, improvement_percentage, measured_at, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id, intervention_id, outcome_metric, improvement_percentage, measured_at
                """
                
                result = await conn.fetchrow(
                    query,
                    intervention_id, outcome_metric, baseline_value, post_intervention_value,
                    improvement_pct, datetime.utcnow(), notes
                )
                
                outcome = dict(result)
                logger.info(f"Outcome recorded: {outcome['id']}")
                return outcome
                
        except Exception as e:
            logger.error(f"Error recording outcome: {e}")
            raise
    
    async def complete_intervention(
        self,
        intervention_id: int,
        summary: Optional[str] = None
    ) -> Dict[str, Any]:
        """Complete an intervention and calculate effectiveness"""
        try:
            async with self.db_pool.acquire() as conn:
                # Update status
                await conn.execute(
                    """UPDATE interventions SET status = $1, actual_end_date = $2, updated_at = $3 WHERE id = $4""",
                    InterventionStatus.COMPLETED.value,
                    datetime.utcnow(),
                    datetime.utcnow(),
                    intervention_id
                )
                
                # Get intervention details
                intervention = await conn.fetchrow(
                    "SELECT * FROM interventions WHERE id = $1",
                    intervention_id
                )
                
                # Get outcomes
                outcomes = await conn.fetch(
                    "SELECT * FROM intervention_outcomes WHERE intervention_id = $1",
                    intervention_id
                )
                
                # Get check-ins
                checkins = await conn.fetch(
                    "SELECT * FROM intervention_checkins WHERE intervention_id = $1",
                    intervention_id
                )
                
                # Calculate effectiveness
                effectiveness = {
                    "outcomes_measured": len(outcomes),
                    "average_improvement_percentage": 0,
                    "positive_checkins": 0,
                    "total_checkins": len(checkins)
                }
                
                if outcomes:
                    avg_improvement = sum(o['improvement_percentage'] for o in outcomes) / len(outcomes)
                    effectiveness["average_improvement_percentage"] = round(avg_improvement, 1)
                
                if checkins:
                    effectiveness["positive_checkins"] = sum(1 for c in checkins if c['student_response'] == 'positive')
                
                logger.info(f"Intervention {intervention_id} completed with {effectiveness['average_improvement_percentage']:.1f}% improvement")
                
                return {
                    "intervention_id": intervention_id,
                    "status": InterventionStatus.COMPLETED.value,
                    "effectiveness": effectiveness,
                    "completed_at": datetime.utcnow()
                }
                
        except Exception as e:
            logger.error(f"Error completing intervention: {e}")
            raise
    
    async def get_intervention_details(self, intervention_id: int) -> Dict[str, Any]:
        """Get full intervention details including outcomes and check-ins"""
        try:
            async with self.db_pool.acquire() as conn:
                # Get intervention
                intervention = await conn.fetchrow(
                    "SELECT * FROM interventions WHERE id = $1",
                    intervention_id
                )
                
                if not intervention:
                    raise ValueError(f"Intervention {intervention_id} not found")
                
                # Get outcomes
                outcomes = await conn.fetch(
                    """SELECT * FROM intervention_outcomes WHERE intervention_id = $1 
                       ORDER BY measured_at DESC""",
                    intervention_id
                )
                
                # Get check-ins
                checkins = await conn.fetch(
                    """SELECT * FROM intervention_checkins WHERE intervention_id = $1 
                       ORDER BY checkin_date DESC""",
                    intervention_id
                )
                
                # Calculate statistics
                stats = {
                    "duration_days": 0,
                    "status": intervention['status'],
                    "outcomes_count": len(outcomes),
                    "checkins_count": len(checkins)
                }
                
                if intervention['actual_end_date']:
                    duration = intervention['actual_end_date'] - intervention['start_date']
                    stats["duration_days"] = duration.days
                
                return {
                    "intervention": dict(intervention),
                    "outcomes": [dict(o) for o in outcomes],
                    "checkins": [dict(c) for c in checkins],
                    "statistics": stats
                }
                
        except Exception as e:
            logger.error(f"Error getting intervention details: {e}")
            raise
    
    async def get_student_interventions(
        self,
        student_id: str,
        course_id: Optional[str] = None,
        status: Optional[InterventionStatus] = None
    ) -> List[Dict[str, Any]]:
        """Get all interventions for a student"""
        try:
            async with self.db_pool.acquire() as conn:
                query = "SELECT * FROM interventions WHERE student_id = $1"
                params = [student_id]
                
                if course_id:
                    query += " AND course_id = $2"
                    params.append(course_id)
                
                if status:
                    query += f" AND status = ${len(params) + 1}"
                    params.append(status.value)
                
                query += " ORDER BY start_date DESC"
                
                results = await conn.fetch(query, *params)
                return [dict(r) for r in results]
                
        except Exception as e:
            logger.error(f"Error getting student interventions: {e}")
            raise
    
    async def get_effectiveness_report(self, course_id: str) -> Dict[str, Any]:
        """
        Get intervention effectiveness report for a course
        
        Shows:
        - Intervention statistics
        - Success rates by type
        - Average improvement metrics
        - ROI analysis
        """
        try:
            async with self.db_pool.acquire() as conn:
                # Overall statistics
                overall = await conn.fetchrow(
                    """
                    SELECT 
                        COUNT(*) as total_interventions,
                        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_interventions,
                        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_interventions,
                        COUNT(DISTINCT student_id) as students_helped
                    FROM interventions
                    WHERE course_id = $1
                    """,
                    course_id
                )
                
                # By type
                by_type = await conn.fetch(
                    """
                    SELECT 
                        intervention_type,
                        COUNT(*) as count,
                        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                        AVG(EXTRACT(DAY FROM actual_end_date - start_date)) as avg_duration_days
                    FROM interventions
                    WHERE course_id = $1
                    GROUP BY intervention_type
                    """,
                    course_id
                )
                
                # Outcome statistics
                outcomes_stats = await conn.fetchrow(
                    """
                    SELECT 
                        COUNT(*) as total_outcomes,
                        AVG(improvement_percentage) as avg_improvement,
                        MIN(improvement_percentage) as min_improvement,
                        MAX(improvement_percentage) as max_improvement
                    FROM intervention_outcomes io
                    JOIN interventions i ON io.intervention_id = i.id
                    WHERE i.course_id = $1
                    """,
                    course_id
                )
                
                return {
                    "course_id": course_id,
                    "overall_statistics": dict(overall) if overall else {},
                    "by_intervention_type": [dict(r) for r in by_type],
                    "outcome_statistics": dict(outcomes_stats) if outcomes_stats else {},
                    "generated_at": datetime.utcnow()
                }
                
        except Exception as e:
            logger.error(f"Error generating effectiveness report: {e}")
            raise


# Global service instance
intervention_service = InterventionService()


async def get_intervention_service() -> InterventionService:
    """Get the intervention service instance"""
    return intervention_service
