"""
🎓 Real-Time Exam Monitoring Service
Monitors exams in real-time and detects anomalies
"""

from typing import List, Dict, Optional, Any
from datetime import datetime
import asyncio
from src.config import db
from src.models.enhanced_models import (
    RealTimeExamStatus,
    ProctorAlert,
    ExamActivity,
    AnomalyType
)
from src.models.huggingface_models import get_model_manager
from src.utils import logger


class RealTimeExamMonitoringService:
    """
    Service for monitoring exams in real-time
    Detects suspicious behavior and anomalies
    """

    def __init__(self):
        self.pool = None
        self.mongo_db = None
        self.active_exams = {}  # In-memory cache of active exams
        self.alerts_by_student = {}  # Track alerts per student

    async def initialize(self):
        """Initialize service"""
        self.pool = db.pg_pool
        self.mongo_db = db.mongo_db
        await self._load_active_exams()

    async def _load_active_exams(self):
        """Load currently active exams"""
        try:
            active = await self.pool.fetch("""
                SELECT id, title, start_time, end_time, duration_minutes
                FROM exams
                WHERE status = 'active'
                AND start_time <= NOW()
                AND end_time >= NOW()
            """)
            
            for exam in active:
                self.active_exams[exam['id']] = dict(exam)
                
            logger.info(f"Loaded {len(active)} active exams")
        except Exception as e:
            logger.error(f"Error loading active exams: {e}")

    async def record_activity(
        self,
        student_id: str,
        exam_id: str,
        event_type: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[ProctorAlert]:
        """
        Record and analyze exam activity
        
        Args:
            student_id: Student ID
            exam_id: Exam ID
            event_type: Type of event (question_view, answer_submit, tab_switch, etc.)
            metadata: Additional event data
        
        Returns:
            ProctorAlert if suspicious activity detected
        """
        try:
            # Store activity
            activity = ExamActivity(
                student_id=student_id,
                exam_id=exam_id,
                event_type=event_type,
                timestamp=datetime.now(),
                metadata=metadata or {}
            )
            
            # Store in database
            await self._store_activity(activity)
            
            # Check for anomalies
            alert = await self._check_anomaly(student_id, exam_id, event_type, metadata)
            
            if alert:
                await self._store_alert(alert)
            
            return alert
            
        except Exception as e:
            logger.error(f"Error recording activity: {e}")
            return None

    async def _check_anomaly(
        self,
        student_id: str,
        exam_id: str,
        event_type: str,
        metadata: Optional[Dict[str, Any]]
    ) -> Optional[ProctorAlert]:
        """Check for anomalous behavior"""
        try:
            # Get student's current activity stream
            activities = await self._get_recent_activities(student_id, exam_id, minutes=10)
            
            if not activities:
                return None
            
            # Check different anomaly types
            
            # 1. Tab switching anomaly
            if event_type == "tab_switched":
                tab_switch_count = sum(1 for a in activities if a['event_type'] == 'tab_switched')
                if tab_switch_count > 5:  # More than 5 tab switches in 10 minutes
                    return ProctorAlert(
                        student_id=student_id,
                        exam_id=exam_id,
                        alert_type="excessive_tab_switching",
                        severity="warning",
                        timestamp=datetime.now(),
                        description=f"Student switched tabs {tab_switch_count} times in 10 minutes",
                        flagged_for_review=True
                    )
            
            # 2. Rapid answer submission
            if event_type == "answer_submitted":
                recent_submits = [a for a in activities if a['event_type'] == 'answer_submitted']
                if len(recent_submits) >= 2:
                    time_diff = (activities[-1]['timestamp'] - activities[-2]['timestamp']).total_seconds()
                    if time_diff < 5:  # Less than 5 seconds between answers
                        return ProctorAlert(
                            student_id=student_id,
                            exam_id=exam_id,
                            alert_type="suspiciously_fast_answers",
                            severity="critical",
                            timestamp=datetime.now(),
                            description=f"Student submitting answers too quickly ({time_diff}s between answers)",
                            flagged_for_review=True
                        )
            
            # 3. Long inactivity
            if event_type == "question_viewed":
                # Check time since last activity
                if len(activities) > 1:
                    last_activity = activities[-2]
                    time_since_activity = (datetime.now() - last_activity['timestamp']).total_seconds()
                    if time_since_activity > 300:  # More than 5 minutes
                        return ProctorAlert(
                            student_id=student_id,
                            exam_id=exam_id,
                            alert_type="prolonged_inactivity",
                            severity="info",
                            timestamp=datetime.now(),
                            description=f"Student inactive for {time_since_activity/60:.1f} minutes",
                            flagged_for_review=False
                        )
            
            # 4. Detect using HF models
            exam_activities_data = [
                {
                    'student_id': student_id,
                    'exam_id': exam_id,
                    'event_type': a['event_type'],
                    'timestamp': a['timestamp']
                }
                for a in activities
            ]
            
            model_manager = await get_model_manager()
            anomalies = await model_manager.detect_anomalies(exam_activities_data)
            
            if anomalies:
                anomaly = anomalies[0]
                if anomaly.anomaly_score > 0.7:
                    return ProctorAlert(
                        student_id=student_id,
                        exam_id=exam_id,
                        alert_type=anomaly.anomaly_type,
                        severity=anomaly.severity,
                        timestamp=datetime.now(),
                        description=f"ML-detected anomaly: {', '.join(anomaly.indicators)}",
                        flagged_for_review=anomaly.severity in ["high", "critical"]
                    )
            
            return None
            
        except Exception as e:
            logger.error(f"Error checking anomaly: {e}")
            return None

    async def get_exam_status(
        self,
        student_id: str,
        exam_id: str
    ) -> RealTimeExamStatus:
        """Get real-time status of student's exam"""
        try:
            # Get attempt data
            attempt = await self.pool.fetchrow("""
                SELECT id, started_at, submitted_at, status
                FROM exam_attempts
                WHERE student_id = $1 AND exam_id = $2
            """, student_id, exam_id)
            
            if not attempt:
                raise ValueError("No exam attempt found")
            
            # Get exam details
            exam = await self.pool.fetchrow("""
                SELECT duration_minutes, total_questions
                FROM exams
                WHERE id = $1
            """, exam_id)
            
            # Get current question
            answers = await self.pool.fetch("""
                SELECT question_id, submitted_at
                FROM answers
                WHERE attempt_id = $1
                ORDER BY submitted_at DESC
                LIMIT 1
            """, attempt['id'])
            
            current_q = 1
            if answers:
                # Get question number
                q_num = await self.pool.fetchval("""
                    SELECT COUNT(*) + 1
                    FROM answers
                    WHERE attempt_id = $1
                """, attempt['id'])
                current_q = q_num or 1
            
            # Calculate timing
            started = attempt['started_at']
            now = datetime.now()
            elapsed = int((now - started).total_seconds())
            total_duration = (exam['duration_minutes'] or 60) * 60
            remaining = max(0, total_duration - elapsed)
            
            # Get alerts
            alerts = await self._get_student_alerts(student_id, exam_id)
            
            return RealTimeExamStatus(
                student_id=student_id,
                exam_id=exam_id,
                status=attempt['status'],
                current_question=current_q,
                total_questions=exam['total_questions'] or 50,
                time_elapsed=elapsed,
                time_remaining=remaining,
                alerts_count=len(alerts),
                last_activity=datetime.now()
            )
            
        except Exception as e:
            logger.error(f"Error getting exam status: {e}")
            raise

    async def get_educator_dashboard(
        self,
        exam_id: str
    ) -> Dict[str, Any]:
        """Get real-time dashboard for educators"""
        try:
            # Get all attempts for exam
            attempts = await self.pool.fetch("""
                SELECT 
                    student_id,
                    status,
                    started_at,
                    submitted_at,
                    percentage
                FROM exam_attempts
                WHERE exam_id = $1
                ORDER BY started_at DESC
            """, exam_id)
            
            # Get statuses
            total = len(attempts)
            in_progress = sum(1 for a in attempts if a['status'] in ['started', 'in_progress'])
            submitted = sum(1 for a in attempts if a['status'] in ['submitted', 'auto_submitted'])
            
            # Get alerts
            all_alerts = await self.pool.fetch("""
                SELECT student_id, alert_type, severity, flagged_for_review
                FROM proctor_alerts
                WHERE exam_id = $1 AND timestamp > NOW() - INTERVAL '30 minutes'
            """, exam_id)
            
            flagged_students = len(set(a['student_id'] for a in all_alerts if a['flagged_for_review']))
            
            return {
                'exam_id': exam_id,
                'total_students': total,
                'in_progress': in_progress,
                'submitted': submitted,
                'average_score': sum(a['percentage'] or 0 for a in attempts) / max(1, submitted),
                'alerts_total': len(all_alerts),
                'students_flagged': flagged_students,
                'alert_types': self._count_alert_types(all_alerts),
                'updated_at': datetime.now()
            }
            
        except Exception as e:
            logger.error(f"Error getting educator dashboard: {e}")
            raise

    def _count_alert_types(self, alerts: List[Dict[str, Any]]) -> Dict[str, int]:
        """Count alert types"""
        counts = {}
        for alert in alerts:
            alert_type = alert.get('alert_type', 'unknown')
            counts[alert_type] = counts.get(alert_type, 0) + 1
        return counts

    async def _store_activity(self, activity: ExamActivity):
        """Store activity in database"""
        try:
            await self.pool.execute("""
                INSERT INTO exam_activity_logs
                (student_id, exam_id, event_type, timestamp, metadata)
                VALUES ($1, $2, $3, $4, $5)
            """, activity.student_id, activity.exam_id, activity.event_type,
            activity.timestamp, activity.metadata)
        except Exception as e:
            logger.error(f"Error storing activity: {e}")

    async def _store_alert(self, alert: ProctorAlert):
        """Store alert in database"""
        try:
            await self.pool.execute("""
                INSERT INTO proctor_alerts
                (student_id, exam_id, alert_type, severity, timestamp, description, flagged_for_review)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, alert.student_id, alert.exam_id, alert.alert_type, alert.severity,
            alert.timestamp, alert.description, alert.flagged_for_review)
            
            # Also store in MongoDB for real-time access
            if self.mongo_db:
                await self.mongo_db.proctor_alerts.insert_one({
                    'student_id': alert.student_id,
                    'exam_id': alert.exam_id,
                    'alert_type': alert.alert_type,
                    'severity': alert.severity,
                    'timestamp': alert.timestamp,
                    'description': alert.description,
                    'flagged_for_review': alert.flagged_for_review
                })
        except Exception as e:
            logger.error(f"Error storing alert: {e}")

    async def _get_recent_activities(
        self,
        student_id: str,
        exam_id: str,
        minutes: int = 10
    ) -> List[Dict[str, Any]]:
        """Get recent activities for student"""
        try:
            activities = await self.pool.fetch("""
                SELECT event_type, timestamp, metadata
                FROM exam_activity_logs
                WHERE student_id = $1 AND exam_id = $2
                AND timestamp > NOW() - INTERVAL '%s minutes'
                ORDER BY timestamp DESC
            """ % minutes, student_id, exam_id)
            
            return [dict(a) for a in activities]
        except Exception as e:
            logger.error(f"Error getting recent activities: {e}")
            return []

    async def _get_student_alerts(
        self,
        student_id: str,
        exam_id: str
    ) -> List[Dict[str, Any]]:
        """Get alerts for student in exam"""
        try:
            alerts = await self.pool.fetch("""
                SELECT alert_type, severity, flagged_for_review
                FROM proctor_alerts
                WHERE student_id = $1 AND exam_id = $2
            """, student_id, exam_id)
            
            return [dict(a) for a in alerts]
        except Exception as e:
            logger.error(f"Error getting student alerts: {e}")
            return []
