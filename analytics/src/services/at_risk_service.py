"""
🎓 At-Risk Detection Service
Identifies students at risk of failure/dropout using ML
"""

from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
import asyncio
from src.config import db
from src.models.enhanced_models import StudentRiskProfile, RiskFactor, RiskLevel
from src.models.huggingface_models import get_model_manager
from src.utils import logger


class AtRiskDetectionService:
    """
    Service for detecting students at risk of failure
    using Hugging Face classification models
    """

    def __init__(self):
        self.pool = None
        self.mongo_db = None

    async def initialize(self):
        """Initialize database connections"""
        self.pool = db.pg_pool
        self.mongo_db = db.mongo_db

    async def detect_at_risk_students(
        self,
        course_id: str,
        threshold: float = 0.5
    ) -> List[StudentRiskProfile]:
        """
        Detect all at-risk students in a course
        
        Args:
            course_id: Course ID
            threshold: Risk score threshold (0-1)
        
        Returns:
            List of StudentRiskProfile objects for at-risk students
        """
        try:
            logger.info(f"Detecting at-risk students for course {course_id}")
            
            # Get all students in course
            students = await self._get_course_students(course_id)
            logger.info(f"Found {len(students)} students in course")
            
            at_risk_students = []
            
            for student in students:
                try:
                    # Analyze each student
                    risk_profile = await self.analyze_student_risk(
                        student_id=student['id'],
                        course_id=course_id
                    )
                    
                    # Add if above threshold
                    if risk_profile.risk_score >= threshold:
                        at_risk_students.append(risk_profile)
                        
                except Exception as e:
                    logger.error(f"Error analyzing student {student['id']}: {e}")
                    continue
            
            logger.info(f"Identified {len(at_risk_students)} at-risk students")
            
            # Store results in cache/database
            if at_risk_students:
                await self._cache_risk_profiles(course_id, at_risk_students)
            
            return sorted(
                at_risk_students,
                key=lambda x: x.risk_score,
                reverse=True
            )
            
        except Exception as e:
            logger.error(f"Error detecting at-risk students: {e}")
            raise

    async def analyze_student_risk(
        self,
        student_id: str,
        course_id: str
    ) -> StudentRiskProfile:
        """
        Analyze specific student's risk profile
        
        Args:
            student_id: Student ID
            course_id: Course ID
        
        Returns:
            StudentRiskProfile with risk assessment
        """
        try:
            # Collect student performance metrics
            metrics = await self._collect_performance_metrics(
                student_id, course_id
            )
            
            # Get model manager
            model_manager = await get_model_manager()
            
            # Create performance text for model
            perf_text = self._format_performance_text(metrics)
            
            # Get HF model prediction
            hf_prediction = await model_manager.predict_at_risk(
                perf_text, metrics
            )
            
            # Calculate risk factors
            risk_factors = self._calculate_risk_factors(metrics)
            
            # Determine risk level
            risk_level = self._determine_risk_level(hf_prediction.risk_score)
            
            # Create profile
            profile = StudentRiskProfile(
                student_id=student_id,
                risk_score=hf_prediction.risk_score,
                risk_level=risk_level,
                risk_factors=risk_factors,
                recommended_interventions=hf_prediction.recommended_interventions,
                confidence=hf_prediction.confidence,
                calculated_at=datetime.now(),
                expires_at=datetime.now() + timedelta(days=7)
            )
            
            return profile
            
        except Exception as e:
            logger.error(f"Error analyzing student risk: {e}")
            raise

    async def _collect_performance_metrics(
        self,
        student_id: str,
        course_id: str
    ) -> Dict[str, Any]:
        """Collect comprehensive performance metrics"""
        try:
            metrics = {}
            
            # Average score
            avg_score_result = await self.pool.fetchval("""
                SELECT AVG(percentage) 
                FROM exam_attempts 
                WHERE student_id = $1 AND exam_id IN (
                    SELECT id FROM exams WHERE course_id = $2
                )
            """, student_id, course_id)
            metrics['avg_score'] = float(avg_score_result) if avg_score_result else 0
            
            # Recent trend
            recent_attempts = await self.pool.fetch("""
                SELECT percentage 
                FROM exam_attempts 
                WHERE student_id = $1 AND exam_id IN (
                    SELECT id FROM exams WHERE course_id = $2
                )
                ORDER BY submitted_at DESC 
                LIMIT 5
            """, student_id, course_id)
            
            if len(recent_attempts) >= 2:
                recent_avg = sum(a['percentage'] for a in recent_attempts[:3]) / min(3, len(recent_attempts))
                older_avg = sum(a['percentage'] for a in recent_attempts[3:]) / max(1, len(recent_attempts) - 3)
                metrics['recent_trend'] = recent_avg - older_avg
            else:
                metrics['recent_trend'] = 0
            
            # Total attempts
            attempt_count = len(recent_attempts)
            metrics['total_attempts'] = attempt_count
            
            # Attendance (if tracked)
            metrics['attendance_rate'] = 85  # Placeholder
            
            # Time spent (average)
            avg_time = await self.pool.fetchval("""
                SELECT AVG(EXTRACT(EPOCH FROM (submitted_at - started_at))/60)
                FROM exam_attempts 
                WHERE student_id = $1 AND exam_id IN (
                    SELECT id FROM exams WHERE course_id = $2
                )
            """, student_id, course_id)
            metrics['time_spent'] = float(avg_time) if avg_time else 0
            
            # Passing attempts
            pass_count = await self.pool.fetchval("""
                SELECT COUNT(*) 
                FROM exam_attempts 
                WHERE student_id = $1 AND percentage >= 40 AND exam_id IN (
                    SELECT id FROM exams WHERE course_id = $2
                )
            """, student_id, course_id)
            metrics['pass_rate'] = (pass_count / max(1, attempt_count)) * 100
            
            return metrics
            
        except Exception as e:
            logger.error(f"Error collecting metrics: {e}")
            return {}

    def _format_performance_text(self, metrics: Dict[str, Any]) -> str:
        """Format metrics as text for HF model"""
        return f"""
        Student performance summary:
        - Average score: {metrics.get('avg_score', 0):.1f}%
        - Recent trend: {metrics.get('recent_trend', 0):+.1f}%
        - Total attempts: {metrics.get('total_attempts', 0)}
        - Pass rate: {metrics.get('pass_rate', 0):.1f}%
        - Average time spent: {metrics.get('time_spent', 0):.1f} minutes
        - Attendance: {metrics.get('attendance_rate', 0):.1f}%
        """

    def _calculate_risk_factors(self, metrics: Dict[str, Any]) -> List[RiskFactor]:
        """Calculate individual risk factors"""
        factors = []
        
        if metrics.get('avg_score', 0) < 50:
            factors.append(RiskFactor(
                name="Low Average Score",
                description=f"Student's average score is {metrics['avg_score']:.1f}%, well below passing",
                weight=0.9
            ))
        
        if metrics.get('recent_trend', 0) < -10:
            factors.append(RiskFactor(
                name="Declining Performance",
                description=f"Performance declining by {abs(metrics['recent_trend']):.1f}% over recent attempts",
                weight=0.8
            ))
        
        if metrics.get('pass_rate', 0) < 30:
            factors.append(RiskFactor(
                name="Low Pass Rate",
                description=f"Only {metrics['pass_rate']:.1f}% of attempts are passing",
                weight=0.85
            ))
        
        if metrics.get('total_attempts', 0) < 2:
            factors.append(RiskFactor(
                name="Limited Assessment Data",
                description="Very few attempts make prediction less reliable",
                weight=0.5
            ))
        
        if metrics.get('time_spent', 0) < 10:
            factors.append(RiskFactor(
                name="Minimal Engagement",
                description=f"Average time per exam is only {metrics['time_spent']:.1f} minutes",
                weight=0.7
            ))
        
        return factors

    def _determine_risk_level(self, risk_score: float) -> RiskLevel:
        """Determine risk level from score"""
        if risk_score >= 0.8:
            return RiskLevel.CRITICAL
        elif risk_score >= 0.6:
            return RiskLevel.HIGH
        elif risk_score >= 0.4:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW

    async def _get_course_students(self, course_id: str) -> List[Dict[str, Any]]:
        """Get all students in course"""
        return await self.pool.fetch("""
            SELECT DISTINCT u.id, u.email, u.first_name, u.last_name
            FROM users u
            JOIN exam_attempts ea ON u.id = ea.student_id
            JOIN exams e ON ea.exam_id = e.id
            WHERE e.course_id = $1 AND u.role = 'student'
        """, course_id)

    async def _cache_risk_profiles(
        self,
        course_id: str,
        profiles: List[StudentRiskProfile]
    ):
        """Cache risk profiles in database"""
        try:
            # Store in MongoDB for quick retrieval
            if self.mongo_db:
                collection = self.mongo_db.at_risk_profiles
                
                profiles_dict = [
                    {
                        'student_id': p.student_id,
                        'course_id': course_id,
                        'risk_score': p.risk_score,
                        'risk_level': p.risk_level.value,
                        'calculated_at': p.calculated_at,
                        'factors': [
                            {'name': f.name, 'weight': f.weight}
                            for f in p.risk_factors
                        ],
                        'interventions': p.recommended_interventions
                    }
                    for p in profiles
                ]
                
                await collection.delete_many({'course_id': course_id})
                await collection.insert_many(profiles_dict)
                
        except Exception as e:
            logger.error(f"Error caching risk profiles: {e}")

    async def get_cached_risk_profiles(
        self,
        course_id: str
    ) -> List[StudentRiskProfile]:
        """Get cached risk profiles"""
        try:
            if not self.mongo_db:
                return []
            
            collection = self.mongo_db.at_risk_profiles
            profiles = await collection.find({
                'course_id': course_id,
                'risk_level': {'$in': ['high', 'critical']}
            }).to_list(None)
            
            return profiles
        except Exception as e:
            logger.error(f"Error retrieving cached profiles: {e}")
            return []

    async def trigger_interventions(
        self,
        student_id: str,
        risk_profile: StudentRiskProfile
    ):
        """Trigger appropriate interventions"""
        try:
            logger.info(f"Triggering interventions for student {student_id}")
            
            # Store intervention request
            if self.mongo_db:
                collection = self.mongo_db.interventions
                await collection.insert_one({
                    'student_id': student_id,
                    'risk_level': risk_profile.risk_level.value,
                    'recommended_actions': risk_profile.recommended_interventions,
                    'created_at': datetime.now(),
                    'status': 'pending'
                })
            
            # Would trigger actual interventions here
            # - Send email to educator
            # - Create support ticket
            # - Schedule counseling session
            # etc.
            
        except Exception as e:
            logger.error(f"Error triggering interventions: {e}")
