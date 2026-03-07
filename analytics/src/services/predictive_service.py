"""
Predictive Analytics Service

Uses machine learning to forecast:
- Future exam performance
- Dropout risk
- Performance trends
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import statistics
import math

from ..config.database import get_db_pool
from ..models.huggingface_models import get_model_manager
from ..models.enhanced_models import (
    PerformanceForecast,
    DropoutRisk
)
from ..utils.logger import get_logger

logger = get_logger(__name__)


class PredictiveAnalyticsService:
    """
    Service for predictive analytics using ML
    
    Features:
    - Performance forecasting for future exams
    - Dropout risk prediction
    - Trend analysis and extrapolation
    """
    
    def __init__(self):
        self.db_pool = None
        self.model_manager = None
        self.cache = {}
        self.cache_ttl = 3600  # 1 hour
        
    async def initialize(self):
        """Initialize service and ML models"""
        try:
            self.db_pool = await get_db_pool()
            self.model_manager = get_model_manager()
            logger.info("PredictiveAnalyticsService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize PredictiveAnalyticsService: {e}")
            raise
    
    async def predict_next_exam_performance(
        self,
        student_id: str,
        course_id: str,
        confidence_level: float = 0.95
    ) -> PerformanceForecast:
        """
        Predict student's performance on next exam
        
        Uses:
        - Historical exam scores
        - Learning curve analysis
        - Trend extrapolation
        - ML-based prediction
        
        Args:
            student_id: Student identifier
            course_id: Course identifier
            confidence_level: Confidence level for interval (default 95%)
            
        Returns:
            PerformanceForecast with predicted score and confidence interval
        """
        try:
            logger.info(f"Predicting performance for student {student_id} in course {course_id}")
            
            # Get historical performance data
            exam_history = await self._get_exam_history(student_id, course_id)
            
            if len(exam_history) < 2:
                logger.warning(f"Insufficient history for prediction: {len(exam_history)} exams")
                # Return baseline prediction
                return self._baseline_prediction(student_id, exam_history)
            
            # Extract scores and calculate trends
            scores = [exam['score'] for exam in exam_history]
            timestamps = [exam['completed_at'] for exam in exam_history]
            
            # Calculate trend-based prediction
            trend_prediction = self._calculate_trend_prediction(scores)
            
            # Calculate learning curve prediction
            learning_curve_prediction = self._calculate_learning_curve(scores)
            
            # Use ML model for enhanced prediction
            ml_prediction = await self._ml_performance_prediction(
                student_id, course_id, exam_history
            )
            
            # Ensemble prediction (weighted average)
            predicted_score = (
                0.3 * trend_prediction +
                0.3 * learning_curve_prediction +
                0.4 * ml_prediction
            )
            
            # Clamp to valid range [0, 100]
            predicted_score = max(0, min(100, predicted_score))
            
            # Calculate confidence interval
            std_dev = statistics.stdev(scores) if len(scores) > 1 else 10.0
            z_score = 1.96 if confidence_level == 0.95 else 2.576  # 95% or 99%
            margin = z_score * (std_dev / math.sqrt(len(scores)))
            
            confidence_interval = (
                max(0, predicted_score - margin),
                min(100, predicted_score + margin)
            )
            
            # Calculate probabilities
            probability_passing = self._calculate_pass_probability(
                predicted_score, std_dev
            )
            probability_high_performance = self._calculate_high_perf_probability(
                predicted_score, std_dev
            )
            
            forecast = PerformanceForecast(
                student_id=student_id,
                next_exam_predicted_score=round(predicted_score, 2),
                confidence_interval=confidence_interval,
                probability_of_passing=round(probability_passing, 3),
                probability_of_high_performance=round(probability_high_performance, 3),
                forecast_based_on_exams=len(exam_history),
                generated_at=datetime.utcnow()
            )
            
            logger.info(f"Forecast generated: {predicted_score:.2f}% (±{margin:.2f})")
            return forecast
            
        except Exception as e:
            logger.error(f"Error predicting performance: {e}")
            raise
    
    async def predict_dropout_risk(
        self,
        student_id: str,
        course_id: str
    ) -> DropoutRisk:
        """
        Predict risk of student dropping course
        
        Factors considered:
        - Declining performance trends
        - Low engagement (missing exams, late submissions)
        - Low absolute performance
        - Comparison to successful student patterns
        
        Args:
            student_id: Student identifier
            course_id: Course identifier
            
        Returns:
            DropoutRisk with probability and factors
        """
        try:
            logger.info(f"Analyzing dropout risk for student {student_id}")
            
            # Collect comprehensive student data
            exam_history = await self._get_exam_history(student_id, course_id)
            engagement_metrics = await self._get_engagement_metrics(student_id, course_id)
            
            # Calculate risk factors
            risk_factors = []
            protective_factors = []
            risk_score = 0.0
            
            # Factor 1: Performance trend (30% weight)
            if len(exam_history) >= 3:
                scores = [e['score'] for e in exam_history]
                trend = self._calculate_trend(scores)
                
                if trend < -5:  # Declining by >5 points per exam
                    risk_factors.append("Declining performance trend")
                    risk_score += 0.3
                elif trend > 5:  # Improving
                    protective_factors.append("Improving performance trend")
                    risk_score -= 0.1
            
            # Factor 2: Absolute performance (25% weight)
            if exam_history:
                avg_score = statistics.mean([e['score'] for e in exam_history])
                
                if avg_score < 50:
                    risk_factors.append("Low average performance (below 50%)")
                    risk_score += 0.25
                elif avg_score < 60:
                    risk_factors.append("Borderline performance (50-60%)")
                    risk_score += 0.15
                elif avg_score >= 80:
                    protective_factors.append("Strong academic performance")
                    risk_score -= 0.1
            
            # Factor 3: Engagement (25% weight)
            if engagement_metrics:
                attendance_rate = engagement_metrics.get('attendance_rate', 1.0)
                submission_rate = engagement_metrics.get('submission_rate', 1.0)
                
                if attendance_rate < 0.6:
                    risk_factors.append("Poor attendance (< 60%)")
                    risk_score += 0.15
                
                if submission_rate < 0.7:
                    risk_factors.append("Low assignment submission rate")
                    risk_score += 0.10
                
                if attendance_rate >= 0.9 and submission_rate >= 0.9:
                    protective_factors.append("Excellent engagement")
                    risk_score -= 0.15
            
            # Factor 4: Exam attempt patterns (20% weight)
            if len(exam_history) >= 2:
                missed_exams = engagement_metrics.get('missed_exams', 0)
                late_submissions = engagement_metrics.get('late_submissions', 0)
                
                if missed_exams > 1:
                    risk_factors.append(f"Missed {missed_exams} exams")
                    risk_score += 0.15
                
                if late_submissions > 2:
                    risk_factors.append("Pattern of late submissions")
                    risk_score += 0.05
            
            # ML-based pattern detection
            ml_risk = await self._ml_dropout_prediction(student_id, course_id, exam_history)
                        risk_score = (risk_score * 0.6) + (ml_risk * 0.4)  # Weighted with ML
            
            # Normalize to [0, 1]
            dropout_probability = max(0.0, min(1.0, risk_score))
            
            # Calculate confidence based on data availability
            confidence = min(1.0, len(exam_history) / 5.0)  # Max confidence at 5+ exams
            
            # Generate interventions
            interventions = self._recommend_interventions(
                risk_factors, dropout_probability
            )
            
            dropout_risk = DropoutRisk(
                student_id=student_id,
                dropout_probability=round(dropout_probability, 3),
                risk_factors=risk_factors,
                protective_factors=protective_factors,
                recommended_interventions=interventions,
                confidence=round(confidence, 2)
            )
            
            logger.info(
                f"Dropout risk: {dropout_probability:.3f} "
                f"({len(risk_factors)} risk factors, {len(protective_factors)} protective)"
            )
            return dropout_risk
            
        except Exception as e:
            logger.error(f"Error predicting dropout risk: {e}")
            raise
    
    async def _get_exam_history(
        self,
        student_id: str,
        course_id: str
    ) -> List[Dict]:
        """Get student's exam history in chronological order"""
        async with self.db_pool.acquire() as conn:
            query = """
                SELECT 
                    e.id as exam_id,
                    e.title as exam_title,
                    a.score,
                    a.max_score,
                    a.completed_at,
                    a.time_taken_minutes
                FROM exam_attempts a
                JOIN exams e ON a.exam_id = e.id
                WHERE a.student_id = $1 
                  AND e.course_id = $2 
                  AND a.status = 'completed'
                ORDER BY a.completed_at ASC
            """
            rows = await conn.fetch(query, student_id, course_id)
            
            history = []
            for row in rows:
                score_percentage = (row['score'] / row['max_score'] * 100) if row['max_score'] > 0 else 0
                history.append({
                    'exam_id': row['exam_id'],
                    'exam_title': row['exam_title'],
                    'score': score_percentage,
                    'raw_score': row['score'],
                    'max_score': row['max_score'],
                    'completed_at': row['completed_at'],
                    'time_taken_minutes': row['time_taken_minutes']
                })
            
            return history
    
    async def _get_engagement_metrics(
        self,
        student_id: str,
        course_id: str
    ) -> Dict:
        """Get student engagement metrics"""
        async with self.db_pool.acquire() as conn:
            # Count total exams and attempts
            query = """
                SELECT 
                    COUNT(DISTINCT e.id) as total_exams,
                    COUNT(DISTINCT CASE WHEN a.status = 'completed' THEN e.id END) as completed_exams,
                    COUNT(DISTINCT CASE WHEN a.submitted_at > e.due_date THEN e.id END) as late_submissions
                FROM exams e
                LEFT JOIN exam_attempts a ON e.id = a.exam_id AND a.student_id = $1
                WHERE e.course_id = $2
            """
            row = await conn.fetchrow(query, student_id, course_id)
            
            total = row['total_exams'] or 0
            completed = row['completed_exams'] or 0
            late = row['late_submissions'] or 0
            
            return {
                'attendance_rate': completed / total if total > 0 else 1.0,
                'submission_rate': completed / total if total > 0 else 1.0,
                'missed_exams': total - completed,
                'late_submissions': late
            }
    
    def _calculate_trend_prediction(self, scores: List[float]) -> float:
        """Calculate linear trend and extrapolate"""
        if len(scores) < 2:
            return scores[0] if scores else 50.0
        
        # Simple linear regression
        n = len(scores)
        x = list(range(n))
        y = scores
        
        x_mean = statistics.mean(x)
        y_mean = statistics.mean(y)
        
        # Calculate slope
        numerator = sum((x[i] - x_mean) * (y[i] - y_mean) for i in range(n))
        denominator = sum((x[i] - x_mean) ** 2 for i in range(n))
        
        slope = numerator / denominator if denominator != 0 else 0
        intercept = y_mean - slope * x_mean
        
        # Predict next point
        next_x = n
        prediction = slope * next_x + intercept
        
        return prediction
    
    def _calculate_learning_curve(self, scores: List[float]) -> float:
        """
        Calculate learning curve prediction
        
        Uses exponential model: score = max_score * (1 - exp(-k * attempt))
        """
        if len(scores) < 3:
            return scores[-1] if scores else 50.0
        
        # Estimate asymptotic performance (max likely score)
        recent_scores = scores[-3:]
        asymptote = max(scores) + (100 - max(scores)) * 0.2  # 20% above current max
        
        # Simple exponential smoothing
        alpha = 0.3  # Smoothing factor
        prediction = scores[-1]
        
        for i in range(len(scores) - 1, -1, -1):
            prediction = alpha * scores[i] + (1 - alpha) * prediction
        
        # Blend with asymptote (learning curve approaching maximum)
        prediction = 0.7 * prediction + 0.3 * asymptote
        
        return prediction
    
    async def _ml_performance_prediction(
        self,
        student_id: str,
        course_id: str,
        exam_history: List[Dict]
    ) -> float:
        """Use ML model to predict performance"""
        try:
            # Prepare features for ML model
            scores = [e['score'] for e in exam_history]
            
            # Create performance summary text for model
            avg_score = statistics.mean(scores)
            trend = self._calculate_trend(scores)
            volatility = statistics.stdev(scores) if len(scores) > 1 else 0
            
            performance_text = (
                f"Student has completed {len(exam_history)} exams. "
                f"Average score: {avg_score:.1f}%. "
                f"Trend: {trend:+.1f} points per exam. "
                f"Score consistency: {'high' if volatility < 10 else 'medium' if volatility < 20 else 'low'}. "
                f"Recent scores: {', '.join(f'{s:.1f}' for s in scores[-3:])}."
            )
            
            # Use HF model for prediction
            prediction = await self.model_manager.predict_at_risk(performance_text)
            
            # Convert risk score to performance prediction
            # High risk = lower predicted score
            risk_score = prediction.risk_score
            predicted_score = avg_score * (1 - risk_score * 0.3)  # Risk reduces prediction up to 30%
            
            return predicted_score
            
        except Exception as e:
            logger.warning(f"ML prediction failed, using fallback: {e}")
            return statistics.mean([e['score'] for e in exam_history])
    
    async def _ml_dropout_prediction(
        self,
        student_id: str,
        course_id: str,
        exam_history: List[Dict]
    ) -> float:
        """Use ML model to predict dropout risk"""
        try:
            if not exam_history:
                return 0.5  # Neutral risk
            
            scores = [e['score'] for e in exam_history]
            avg_score = statistics.mean(scores)
            trend = self._calculate_trend(scores)
            
            # Create risk assessment text
            risk_text = (
                f"Student performance analysis: "
                f"Average score {avg_score:.1f}%, "
                f"trend {trend:+.1f} points per exam, "
                f"{len(exam_history)} exams completed. "
                f"Risk indicators: {'declining performance' if trend < -5 else 'stable' if abs(trend) < 5 else 'improving'}."
            )
            
            # Use HF model
            prediction = await self.model_manager.predict_at_risk(risk_text)
            
            return prediction.risk_score
            
        except Exception as e:
            logger.warning(f"ML dropout prediction failed: {e}")
            return 0.5  # Neutral risk
    
    def _calculate_trend(self, scores: List[float]) -> float:
        """Calculate average change per exam"""
        if len(scores) < 2:
            return 0.0
        
        changes = [scores[i+1] - scores[i] for i in range(len(scores) - 1)]
        return statistics.mean(changes)
    
    def _calculate_pass_probability(self, predicted_score: float, std_dev: float) -> float:
        """Calculate probability of passing (>= 60%)"""
        # Using normal distribution approximation
        if std_dev == 0:
            return 1.0 if predicted_score >= 60 else 0.0
        
        # Z-score for passing threshold
        z = (60 - predicted_score) / std_dev
        
        # Approximate cumulative probability
        # P(score >= 60) = 1 - P(score < 60)
        if z <= -3:
            return 1.0
        elif z >= 3:
            return 0.0
        else:
            # Rough approximation
            prob_below = 0.5 + 0.5 * math.erf(z / math.sqrt(2))
            return 1.0 - prob_below
    
    def _calculate_high_perf_probability(self, predicted_score: float, std_dev: float) -> float:
        """Calculate probability of high performance (>= 85%)"""
        if std_dev == 0:
            return 1.0 if predicted_score >= 85 else 0.0
        
        z = (85 - predicted_score) / std_dev
        
        if z <= -3:
            return 1.0
        elif z >= 3:
            return 0.0
        else:
            prob_below = 0.5 + 0.5 * math.erf(z / math.sqrt(2))
            return 1.0 - prob_below
    
    def _baseline_prediction(self, student_id: str, exam_history: List[Dict]) -> PerformanceForecast:
        """Baseline prediction when insufficient data"""
        if exam_history:
            predicted_score = exam_history[0]['score']
        else:
            predicted_score = 70.0  # Neutral prediction
        
        return PerformanceForecast(
            student_id=student_id,
            next_exam_predicted_score=predicted_score,
            confidence_interval=(predicted_score - 20, predicted_score + 20),
            probability_of_passing=0.7,
            probability_of_high_performance=0.3,
            forecast_based_on_exams=len(exam_history),
            generated_at=datetime.utcnow()
        )
    
    def _recommend_interventions(
        self,
        risk_factors: List[str],
        dropout_probability: float
    ) -> List[str]:
        """Recommend interventions based on risk level"""
        interventions = []
        
        if dropout_probability >= 0.7:
            interventions.append("URGENT: Schedule immediate academic advising session")
            interventions.append("Consider reduced course load or withdrawal options")
            interventions.append("Connect with campus support services")
        elif dropout_probability >= 0.5:
            interventions.append("Schedule academic support meeting within 1 week")
            interventions.append("Provide access to tutoring resources")
            interventions.append("Monitor attendance and engagement closely")
        elif dropout_probability >= 0.3:
            interventions.append("Send proactive check-in email")
            interventions.append("Recommend study groups or peer support")
        
        # Specific interventions based on risk factors
        for factor in risk_factors:
            if "performance" in factor.lower():
                interventions.append("Provide supplemental learning materials")
            if "attendance" in factor.lower():
                interventions.append("Send attendance reminders")
            if "late" in factor.lower():
                interventions.append("Review time management strategies")
        
        return list(set(interventions))  # Remove duplicates


# Global service instance
predictive_service = PredictiveAnalyticsService()


async def get_predictive_service() -> PredictiveAnalyticsService:
    """Get the predictive analytics service instance"""
    return predictive_service
