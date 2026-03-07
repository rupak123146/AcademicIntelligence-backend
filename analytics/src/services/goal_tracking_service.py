"""
Goal Tracking Service

Enables student goal setting and progress tracking with:
- SMART goal creation
- Milestone tracking
- Progress history
- Goal status management
- Achievement notifications
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum

from ..config.database import get_db_pool
from ..utils.logger import get_logger

logger = get_logger(__name__)


class GoalType(str, Enum):
    """Types of student goals"""
    PERFORMANCE = "performance"  # Score improvement
    MASTERY = "mastery"  # Concept/skill mastery
    COMPLETION = "completion"  # Assignment/course completion
    SPEED = "speed"  # Response time optimization
    ENGAGEMENT = "engagement"  # Attendance/participation


class GoalStatus(str, Enum):
    """Goal status"""
    ACTIVE = "active"
    ACHIEVED = "achieved"
    MISSED = "missed"
    CANCELLED = "cancelled"


class GoalPriority(str, Enum):
    """Goal priority levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class GoalTrackingService:
    """
    Service for managing student goals and progress
    
    Features:
    - SMART goal creation (Specific, Measurable, Achievable, Relevant, Time-bound)
    - Progress tracking with milestones
    - Automatic status updates
    - Goal-based notifications
    - Progress visualization
    """
    
    def __init__(self):
        self.db_pool = None
        
    async def initialize(self):
        """Initialize service"""
        try:
            self.db_pool = await get_db_pool()
            logger.info("GoalTrackingService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize GoalTrackingService: {e}")
            raise
    
    async def create_goal(
        self,
        student_id: str,
        course_id: str,
        goal_type: GoalType,
        target_metric: str,
        target_value: float,
        target_date: datetime,
        description: Optional[str] = None,
        priority: GoalPriority = GoalPriority.MEDIUM
    ) -> Dict[str, Any]:
        """
        Create a new student goal
        
        Args:
            student_id: Student identifier
            course_id: Course identifier
            goal_type: Type of goal (performance, mastery, etc.)
            target_metric: What to measure (score, accuracy, time, etc.)
            target_value: Target value for the metric
            target_date: When to achieve goal (must be future date)
            description: Optional goal description
            priority: Goal priority (low, medium, high)
            
        Returns:
            Created goal with ID and metadata
        """
        try:
            if target_date <= datetime.utcnow():
                raise ValueError("Target date must be in the future")
            
            logger.info(f"Creating goal for student {student_id}: {goal_type.value}")
            
            async with self.db_pool.acquire() as conn:
                query = """
                    INSERT INTO student_goals 
                    (student_id, course_id, goal_type, target_metric, target_value, 
                     target_date, description, priority, status, current_value, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    RETURNING 
                        id, student_id, course_id, goal_type, target_metric, target_value,
                        current_value, target_date, description, priority, status, created_at
                """
                
                result = await conn.fetchrow(
                    query,
                    student_id, course_id, goal_type.value, target_metric, target_value,
                    target_date, description, priority.value, GoalStatus.ACTIVE.value, 0,
                    datetime.utcnow(), datetime.utcnow()
                )
                
                goal = dict(result)
                
                # Create initial milestone at 50% of target
                await self._create_default_milestones(conn, goal['id'], target_value)
                
                logger.info(f"Goal created: {goal['id']}")
                return goal
                
        except Exception as e:
            logger.error(f"Error creating goal: {e}")
            raise
    
    async def get_student_goals(
        self,
        student_id: str,
        course_id: Optional[str] = None,
        status: Optional[GoalStatus] = None
    ) -> List[Dict[str, Any]]:
        """Get student's goals"""
        try:
            async with self.db_pool.acquire() as conn:
                query = "SELECT * FROM student_goals WHERE student_id = $1"
                params = [student_id]
                
                if course_id:
                    query += " AND course_id = $2"
                    params.append(course_id)
                
                if status:
                    query += f" AND status = ${len(params) + 1}"
                    params.append(status.value)
                
                query += " ORDER BY target_date ASC"
                
                rows = await conn.fetch(query, *params)
                return [dict(row) for row in rows]
                
        except Exception as e:
            logger.error(f"Error retrieving goals: {e}")
            raise
    
    async def update_goal_progress(
        self,
        goal_id: int,
        current_value: float,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Update goal progress
        
        Automatically:
        - Records progress to history
        - Updates goal status if achieved/missed
        - Triggers milestone checks
        - Prepares notification data
        """
        try:
            logger.info(f"Updating progress for goal {goal_id}: {current_value}")
            
            async with self.db_pool.acquire() as conn:
                # Get goal details
                goal = await conn.fetchrow(
                    "SELECT * FROM student_goals WHERE id = $1",
                    goal_id
                )
                
                if not goal:
                    raise ValueError(f"Goal {goal_id} not found")
                
                # Update current value
                await conn.execute(
                    "UPDATE student_goals SET current_value = $1, updated_at = $2 WHERE id = $3",
                    current_value, datetime.utcnow(), goal_id
                )
                
                # Record progress history
                await conn.execute(
                    """INSERT INTO goal_progress_history 
                       (goal_id, recorded_value, progress_percentage, recorded_at, notes)
                       VALUES ($1, $2, $3, $4, $5)""",
                    goal_id,
                    current_value,
                    (current_value / goal['target_value']) * 100 if goal['target_value'] > 0 else 0,
                    datetime.utcnow(),
                    notes
                )
                
                # Check milestone achievements
                milestones_achieved = await self._check_milestones(conn, goal_id, current_value)
                
                # Check goal completion
                goal_achieved = current_value >= goal['target_value']
                goal_status = GoalStatus.ACHIEVED if goal_achieved else GoalStatus.ACTIVE
                
                # Check if goal expired
                if datetime.utcnow() > goal['target_date'] and current_value < goal['target_value']:
                    goal_status = GoalStatus.MISSED
                
                # Update goal status
                await conn.execute(
                    "UPDATE student_goals SET status = $1, updated_at = $2 WHERE id = $3",
                    goal_status.value, datetime.utcnow(), goal_id
                )
                
                return {
                    "goal_id": goal_id,
                    "current_value": current_value,
                    "target_value": goal['target_value'],
                    "progress_percentage": (current_value / goal['target_value']) * 100 if goal['target_value'] > 0 else 0,
                    "status": goal_status.value,
                    "milestones_achieved": len(milestones_achieved),
                    "goal_achieved": goal_achieved,
                    "should_notify": goal_achieved or len(milestones_achieved) > 0,
                    "updated_at": datetime.utcnow()
                }
                
        except Exception as e:
            logger.error(f"Error updating goal progress: {e}")
            raise
    
    async def get_goal_progress(
        self,
        goal_id: int,
        include_history: bool = True
    ) -> Dict[str, Any]:
        """Get detailed goal progress"""
        try:
            async with self.db_pool.acquire() as conn:
                # Get goal
                goal = await conn.fetchrow(
                    "SELECT * FROM student_goals WHERE id = $1",
                    goal_id
                )
                
                if not goal:
                    raise ValueError(f"Goal {goal_id} not found")
                
                # Get milestones
                milestones = await conn.fetch(
                    """SELECT id, milestone_name, target_value, achieved, achieved_at, reward_message
                       FROM goal_milestones WHERE goal_id = $1 ORDER BY target_value ASC""",
                    goal_id
                )
                
                # Get progress history
                history = []
                if include_history:
                    rows = await conn.fetch(
                        """SELECT recorded_value, progress_percentage, recorded_at, notes
                           FROM goal_progress_history WHERE goal_id = $1 ORDER BY recorded_at DESC LIMIT 50""",
                        goal_id
                    )
                    history = [dict(row) for row in rows]
                
                progress_pct = (goal['current_value'] / goal['target_value']) * 100 if goal['target_value'] > 0 else 0
                days_remaining = (goal['target_date'] - datetime.utcnow()).days if goal['target_date'] > datetime.utcnow() else 0
                
                return {
                    "goal": dict(goal),
                    "current_value": goal['current_value'],
                    "target_value": goal['target_value'],
                    "progress_percentage": round(progress_pct, 1),
                    "days_remaining": days_remaining,
                    "milestones": [dict(m) for m in milestones],
                    "milestones_achieved": sum(1 for m in milestones if m['achieved']),
                    "progress_history": history
                }
                
        except Exception as e:
            logger.error(f"Error getting goal progress: {e}")
            raise
    
    async def get_course_goals_summary(self, course_id: str) -> Dict[str, Any]:
        """
        Get summary of all student goals in a course
        
        Useful for educators to:
        - Track class progress toward goals
        - Identify struggling students
        - Celebrate achievements
        """
        try:
            async with self.db_pool.acquire() as conn:
                query = """
                    SELECT 
                        COUNT(*) as total_goals,
                        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_goals,
                        COUNT(CASE WHEN status = 'achieved' THEN 1 END) as achieved_goals,
                        COUNT(CASE WHEN status = 'missed' THEN 1 END) as missed_goals,
                        AVG(CASE WHEN target_value > 0 THEN (current_value / target_value) * 100 ELSE 0 END) as avg_progress,
                        COUNT(DISTINCT student_id) as students_with_goals
                    FROM student_goals
                    WHERE course_id = $1
                """
                
                summary = await conn.fetchrow(query, course_id)
                
                # Get top performing students
                top_students = await conn.fetch(
                    """
                    SELECT 
                        student_id,
                        COUNT(*) as goals_count,
                        COUNT(CASE WHEN status = 'achieved' THEN 1 END) as achieved_count,
                        AVG(CASE WHEN target_value > 0 THEN (current_value / target_value) * 100 ELSE 0 END) as avg_progress
                    FROM student_goals
                    WHERE course_id = $1
                    GROUP BY student_id
                    ORDER BY avg_progress DESC
                    LIMIT 10
                    """,
                    course_id
                )
                
                return {
                    "course_id": course_id,
                    "total_goals": summary['total_goals'] or 0,
                    "active_goals": summary['active_goals'] or 0,
                    "achieved_goals": summary['achieved_goals'] or 0,
                    "missed_goals": summary['missed_goals'] or 0,
                    "average_progress_percentage": round(summary['avg_progress'] or 0, 1),
                    "students_with_goals": summary['students_with_goals'] or 0,
                    "top_performing_students": [dict(s) for s in top_students],
                    "summary_at": datetime.utcnow()
                }
                
        except Exception as e:
            logger.error(f"Error getting course goals summary: {e}")
            raise
    
    async def cancel_goal(self, goal_id: int, reason: Optional[str] = None) -> Dict[str, Any]:
        """Cancel an active goal"""
        try:
            async with self.db_pool.acquire() as conn:
                goal = await conn.fetchrow(
                    "SELECT * FROM student_goals WHERE id = $1",
                    goal_id
                )
                
                if not goal:
                    raise ValueError(f"Goal {goal_id} not found")
                
                if goal['status'] != GoalStatus.ACTIVE.value:
                    raise ValueError(f"Cannot cancel goal with status: {goal['status']}")
                
                await conn.execute(
                    """UPDATE student_goals SET status = $1, updated_at = $2 WHERE id = $3""",
                    GoalStatus.CANCELLED.value,
                    datetime.utcnow(),
                    goal_id
                )
                
                logger.info(f"Goal {goal_id} cancelled")
                
                return {
                    "goal_id": goal_id,
                    "status": GoalStatus.CANCELLED.value,
                    "cancelled_at": datetime.utcnow(),
                    "reason": reason
                }
                
        except Exception as e:
            logger.error(f"Error cancelling goal: {e}")
            raise
    
    async def _create_default_milestones(self, conn, goal_id: int, target_value: float):
        """Create default milestones at 25%, 50%, 75%, and 100% of target"""
        milestones = [
            (0.25, "25% Progress"),
            (0.50, "Halfway There"),
            (0.75, "Almost There"),
            (1.00, "Goal Achieved!")
        ]
        
        for percentage, name in milestones:
            milestone_value = target_value * percentage
            reward_msg = f"Great job! You've reached {int(percentage*100)}% of your goal!"
            
            await conn.execute(
                """INSERT INTO goal_milestones (goal_id, milestone_name, target_value, reward_message, achieved)
                   VALUES ($1, $2, $3, $4, $5)""",
                goal_id, name, milestone_value, reward_msg, False
            )
    
    async def _check_milestones(self, conn, goal_id: int, current_value: float) -> List[int]:
        """Check and mark achieved milestones"""
        achieved = []
        
        milestones = await conn.fetch(
            """SELECT id, target_value, achieved FROM goal_milestones 
               WHERE goal_id = $1 AND NOT achieved""",
            goal_id
        )
        
        for milestone in milestones:
            if current_value >= milestone['target_value']:
                await conn.execute(
                    """UPDATE goal_milestones SET achieved = true, achieved_at = $1 WHERE id = $2""",
                    datetime.utcnow(),
                    milestone['id']
                )
                achieved.append(milestone['id'])
        
        return achieved


# Global service instance
goal_tracking_service = GoalTrackingService()


async def get_goal_tracking_service() -> GoalTrackingService:
    """Get the goal tracking service instance"""
    return goal_tracking_service
