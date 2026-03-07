"""
Response Time Analytics Service

Provides multi-dimensional analysis:
- Speed vs accuracy analysis
- Response time patterns
- Effort indicators
- Timing-based anomaly detection
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from collections import defaultdict
import statistics

from ..config.database import get_db_pool
from ..models.enhanced_models import (
    ResponseTimeAnalysis,
    SpeedAccuracyMetrics,
    TimingAnomaly
)
from ..utils.logger import get_logger

logger = get_logger(__name__)


class ResponseTimeAnalyticsService:
    """
    Service for analyzing response time patterns
    
    Features:
    - Speed vs accuracy correlation
    - Optimal response time identification
    - Rushing/overthinking detection
    - Effort-based performance prediction
    """
    
    def __init__(self):
        self.db_pool = None
        
    async def initialize(self):
        """Initialize service"""
        try:
            self.db_pool = await get_db_pool()
            logger.info("ResponseTimeAnalyticsService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize ResponseTimeAnalyticsService: {e}")
            raise
    
    async def analyze_student_timing(
        self,
        student_id: str,
        exam_id: Optional[str] = None
    ) -> ResponseTimeAnalysis:
        """
        Analyze student's response time patterns
        
        Args:
            student_id: Student identifier
            exam_id: Optional specific exam (if None, analyze across all exams)
            
        Returns:
            ResponseTimeAnalysis with speed/accuracy insights
        """
        try:
            logger.info(f"Analyzing response times for student {student_id}")
            
            # Get response time data
            responses = await self._get_student_responses(student_id, exam_id)
            
            if len(responses) < 5:
                return self._baseline_analysis(student_id)
            
            # Calculate speed metrics
            response_times = [r['time_taken_seconds'] for r in responses if r['time_taken_seconds']]
            avg_time = statistics.mean(response_times) if response_times else 0
            std_time = statistics.stdev(response_times) if len(response_times) > 1 else 0
            
            # Calculate accuracy by time bucket
            speed_accuracy = await self._calculate_speed_accuracy_correlation(responses)
            
            # Detect timing anomalies
            anomalies = await self._detect_timing_anomalies(responses, avg_time, std_time)
            
            # Calculate effort indicator
            effort_score = await self._calculate_effort_score(responses)
            
            # Identify optimal time range
            optimal_range = await self._find_optimal_time_range(responses)
            
            # Performance by question difficulty
            difficulty_timing = await self._analyze_difficulty_timing(responses)
            
            analysis = ResponseTimeAnalysis(
                student_id=student_id,
                exam_id=exam_id,
                total_questions_analyzed=len(responses),
                average_response_time_seconds=round(avg_time, 2),
                response_time_std_dev=round(std_time, 2),
                speed_accuracy_metrics=speed_accuracy,
                timing_anomalies=anomalies,
                effort_score=round(effort_score, 3),
                optimal_time_range_seconds=optimal_range,
                consistency_score=self._calculate_consistency(response_times),
                recommendations=self._generate_timing_recommendations(
                    speed_accuracy, anomalies, effort_score
                ),
                analyzed_at=datetime.utcnow()
            )
            
            logger.info(f"Completed timing analysis: {len(anomalies)} anomalies detected")
            return analysis
            
        except Exception as e:
            logger.error(f"Error analyzing response times: {e}")
            raise
    
    async def analyze_exam_timing_patterns(
        self,
        exam_id: str
    ) -> Dict[str, Any]:
        """
        Analyze timing patterns across all students for an exam
        
        Useful for:
        - Identifying questions that take too long
        - Detecting systematic timing issues
        - Estimating appropriate time limits
        """
        try:
            logger.info(f"Analyzing timing patterns for exam {exam_id}")
            
            async with self.db_pool.acquire() as conn:
                query = """
                    SELECT 
                        r.question_id,
                        q.content as question_text,
                        q.type as question_type,
                        AVG(r.time_taken_seconds) as avg_time,
                        STDDEV(r.time_taken_seconds) as std_time,
                        MIN(r.time_taken_seconds) as min_time,
                        MAX(r.time_taken_seconds) as max_time,
                        COUNT(*) as total_responses,
                        COUNT(CASE WHEN r.is_correct THEN 1 END) as correct_count
                    FROM question_responses r
                    JOIN questions q ON r.question_id = q.id
                    JOIN exam_attempts a ON r.attempt_id = a.id
                    WHERE a.exam_id = $1 AND a.status = 'completed'
                      AND r.time_taken_seconds IS NOT NULL
                    GROUP BY r.question_id, q.content, q.type
                    ORDER BY avg_time DESC
                """
                rows = await conn.fetch(query, exam_id)
                
                question_timing = []
                for row in rows:
                    accuracy_rate = (row['correct_count'] / row['total_responses']) if row['total_responses'] > 0 else 0
                    
                    # Identify problematic questions
                    issues = []
                    if row['avg_time'] > 300:  # >5 minutes average
                        issues.append("Very time-consuming")
                    if row['std_time'] > row['avg_time']:  # High variance
                        issues.append("Inconsistent timing")
                    if accuracy_rate < 0.3:
                        issues.append("Low accuracy")
                    
                    question_timing.append({
                        'question_id': row['question_id'],
                        'question_type': row['question_type'],
                        'average_time_seconds': round(float(row['avg_time']), 2),
                        'std_dev_seconds': round(float(row['std_time']) if row['std_time'] else 0, 2),
                        'min_time_seconds': round(float(row['min_time']), 2),
                        'max_time_seconds': round(float(row['max_time']), 2),
                        'total_responses': row['total_responses'],
                        'accuracy_rate': round(accuracy_rate, 3),
                        'issues': issues
                    })
                
                # Calculate recommended exam duration
                total_avg_time = sum(q['average_time_seconds'] for q in question_timing)
                buffer_factor = 1.3  # 30% buffer for reading instructions, navigation, etc.
                recommended_duration = int(total_avg_time * buffer_factor / 60)  # Convert to minutes
                
                return {
                    'exam_id': exam_id,
                    'question_timing': question_timing,
                    'total_questions': len(question_timing),
                    'total_average_time_seconds': round(total_avg_time, 2),
                    'recommended_duration_minutes': recommended_duration,
                    'questions_with_issues': len([q for q in question_timing if q['issues']]),
                    'analyzed_at': datetime.utcnow().isoformat()
                }
                
        except Exception as e:
            logger.error(f"Error analyzing exam timing patterns: {e}")
            raise
    
    async def _get_student_responses(
        self,
        student_id: str,
        exam_id: Optional[str]
    ) -> List[Dict]:
        """Get student's response time data"""
        async with self.db_pool.acquire() as conn:
            if exam_id:
                query = """
                    SELECT 
                        r.question_id,
                        r.is_correct,
                        r.time_taken_seconds,
                        r.selected_answer,
                        q.type as question_type,
                        q.content as question_text
                    FROM question_responses r
                    JOIN exam_attempts a ON r.attempt_id = a.id
                    JOIN questions q ON r.question_id = q.id
                    WHERE a.student_id = $1 AND a.exam_id = $2 
                      AND a.status = 'completed'
                      AND r.time_taken_seconds IS NOT NULL
                    ORDER BY r.answered_at ASC
                """
                rows = await conn.fetch(query, student_id, exam_id)
            else:
                query = """
                    SELECT 
                        r.question_id,
                        r.is_correct,
                        r.time_taken_seconds,
                        r.selected_answer,
                        q.type as question_type,
                        q.content as question_text
                    FROM question_responses r
                    JOIN exam_attempts a ON r.attempt_id = a.id
                    JOIN questions q ON r.question_id = q.id
                    WHERE a.student_id = $1 AND a.status = 'completed'
                      AND r.time_taken_seconds IS NOT NULL
                    ORDER BY r.answered_at ASC
                """
                rows = await conn.fetch(query, student_id)
            
            return [dict(row) for row in rows]
    
    async def _calculate_speed_accuracy_correlation(
        self,
        responses: List[Dict]
    ) -> SpeedAccuracyMetrics:
        """
        Calculate correlation between speed and accuracy
        
        Buckets responses into time ranges and calculates accuracy for each
        """
        # Sort responses by time
        sorted_responses = sorted(responses, key=lambda r: r['time_taken_seconds'])
        
        # Create time buckets (quartiles)
        n = len(sorted_responses)
        q1 = sorted_responses[:n//4]
        q2 = sorted_responses[n//4:n//2]
        q3 = sorted_responses[n//2:3*n//4]
        q4 = sorted_responses[3*n//4:]
        
        def calc_accuracy(bucket):
            if not bucket:
                return 0
            correct = sum(1 for r in bucket if r['is_correct'])
            return correct / len(bucket)
        
        fastest_quarter_accuracy = calc_accuracy(q1)
        fast_quarter_accuracy = calc_accuracy(q2)
        slow_quarter_accuracy = calc_accuracy(q3)
        slowest_quarter_accuracy = calc_accuracy(q4)
        
        # Calculate correlation coefficient (simplified)
        times = [r['time_taken_seconds'] for r in responses]
        accuracies = [1 if r['is_correct'] else 0 for r in responses]
        
        if len(times) > 1:
            # Pearson correlation
            mean_time = statistics.mean(times)
            mean_acc = statistics.mean(accuracies)
            
            numerator = sum((times[i] - mean_time) * (accuracies[i] - mean_acc) for i in range(len(times)))
            denom_time = sum((t - mean_time) ** 2 for t in times)
            denom_acc = sum((a - mean_acc) ** 2 for a in accuracies)
            
            if denom_time > 0 and denom_acc > 0:
                correlation = numerator / (denom_time * denom_acc) ** 0.5
            else:
                correlation = 0
        else:
            correlation = 0
        
        # Determine pattern
        if fastest_quarter_accuracy > slowest_quarter_accuracy + 0.1:
            pattern = "Accuracy decreases with time (possible overthinking)"
        elif slowest_quarter_accuracy > fastest_quarter_accuracy + 0.1:
            pattern = "Accuracy increases with time (rushing when quick)"
        else:
            pattern = "Consistent accuracy across speeds"
        
        return SpeedAccuracyMetrics(
            fastest_quarter_accuracy=round(fastest_quarter_accuracy, 3),
            fast_quarter_accuracy=round(fast_quarter_accuracy, 3),
            slow_quarter_accuracy=round(slow_quarter_accuracy, 3),
            slowest_quarter_accuracy=round(slowest_quarter_accuracy, 3),
            correlation_coefficient=round(correlation, 3),
            pattern_description=pattern
        )
    
    async def _detect_timing_anomalies(
        self,
        responses: List[Dict],
        avg_time: float,
        std_time: float
    ) -> List[TimingAnomaly]:
        """Detect unusual timing patterns"""
        anomalies = []
        
        # Define thresholds
        very_fast_threshold = max(5, avg_time - 2 * std_time)  # At least 5 seconds
        very_slow_threshold = avg_time + 2 * std_time
        
        for response in responses:
            time_taken = response['time_taken_seconds']
            
            if time_taken < very_fast_threshold:
                anomalies.append(
                    TimingAnomaly(
                        question_id=response['question_id'],
                        time_taken_seconds=time_taken,
                        expected_time_seconds=avg_time,
                        anomaly_type="very_fast",
                        severity="medium" if response['is_correct'] else "high",
                        description=f"Answered in {time_taken:.1f}s (expected ~{avg_time:.1f}s)"
                    )
                )
            elif time_taken > very_slow_threshold:
                anomalies.append(
                    TimingAnomaly(
                        question_id=response['question_id'],
                        time_taken_seconds=time_taken,
                        expected_time_seconds=avg_time,
                        anomaly_type="very_slow",
                        severity="low",
                        description=f"Took {time_taken:.1f}s (expected ~{avg_time:.1f}s)"
                    )
                )
        
        return anomalies
    
    async def _calculate_effort_score(self, responses: List[Dict]) -> float:
        """
        Calculate effort indicator (0-1 scale)
        
        Based on:
        - Time invested
        - Consistency in time allocation
        - Correlation with performance
        """
        if not responses:
            return 0.5
        
        times = [r['time_taken_seconds'] for r in responses]
        accuracies = [1 if r['is_correct'] else 0 for r in responses]
        
        # Component 1: Average time relative to expected (normalize to 0-0.33)
        avg_time = statistics.mean(times)
        time_component = min(avg_time / 120, 1.0) * 0.33  # 120s = full effort
        
        # Component 2: Consistency (inverse of coefficient of variation) (0-0.33)
        if avg_time > 0:
            cv = statistics.stdev(times) / avg_time if len(times) > 1 else 0
            consistency_component = (1 - min(cv, 1.0)) * 0.33
        else:
            consistency_component = 0
        
        # Component 3: Time-accuracy correlation (0-0.34)
        mean_time = statistics.mean(times)
        mean_acc = statistics.mean(accuracies)
        
        if len(times) > 1:
            numerator = sum((times[i] - mean_time) * (accuracies[i] - mean_acc) for i in range(len(times)))
            denom = (sum((t - mean_time) ** 2 for t in times) * sum((a - mean_acc) ** 2 for a in accuracies)) ** 0.5
            correlation = numerator / denom if denom > 0 else 0
            correlation_component = (correlation + 1) / 2 * 0.34  # Normalize to 0-0.34
        else:
            correlation_component = 0.17
        
        effort_score = time_component + consistency_component + correlation_component
        return max(0, min(1, effort_score))
    
    async def _find_optimal_time_range(self, responses: List[Dict]) -> Dict[str, float]:
        """Find time range with best accuracy"""
        # Group by time buckets
        buckets = defaultdict(list)
        
        for response in responses:
            time = response['time_taken_seconds']
            bucket_index = int(time // 30)  # 30-second buckets
            buckets[bucket_index].append(response['is_correct'])
        
        # Find bucket with highest accuracy
        best_bucket = None
        best_accuracy = 0
        
        for bucket_idx, correct_list in buckets.items():
            accuracy = sum(correct_list) / len(correct_list)
            if accuracy > best_accuracy:
                best_accuracy = accuracy
                best_bucket = bucket_idx
        
        if best_bucket is not None:
            return {
                'min_seconds': best_bucket * 30,
                'max_seconds': (best_bucket + 1) * 30,
                'accuracy_in_range': round(best_accuracy, 3)
            }
        else:
            return {'min_seconds': 30, 'max_seconds': 60, 'accuracy_in_range': 0}
    
    async def _analyze_difficulty_timing(self, responses: List[Dict]) -> Dict[str, Any]:
        """Analyze timing patterns by question difficulty (inferred from accuracy)"""
        # Placeholder - in production, would get actual difficulty ratings
        return {
            'easy_questions_avg_time': 0,
            'medium_questions_avg_time': 0,
            'hard_questions_avg_time': 0
        }
    
    def _calculate_consistency(self, response_times: List[float]) -> float:
        """
        Calculate consistency score (0-1)
        
        Higher score = more consistent timing
        """
        if len(response_times) < 2:
            return 1.0
        
        avg = statistics.mean(response_times)
        std = statistics.stdev(response_times)
        
        # Coefficient of variation
        cv = std / avg if avg > 0 else 0
        
        # Convert to 0-1 score (lower CV = higher consistency)
        consistency = 1 - min(cv, 1.0)
        
        return round(consistency, 3)
    
    def _generate_timing_recommendations(
        self,
        speed_accuracy: SpeedAccuracyMetrics,
        anomalies: List[TimingAnomaly],
        effort_score: float
    ) -> List[str]:
        """Generate actionable recommendations"""
        recommendations = []
        
        # Analyze speed-accuracy pattern
        if speed_accuracy.fastest_quarter_accuracy < speed_accuracy.slowest_quarter_accuracy - 0.15:
            recommendations.append(
                "Take more time on questions - you perform better when not rushing"
            )
        elif speed_accuracy.fastest_quarter_accuracy > speed_accuracy.slowest_quarter_accuracy + 0.15:
            recommendations.append(
                "Trust your first instinct - overthinking may reduce accuracy"
            )
        
        # Analyze anomalies
        very_fast_count = sum(1 for a in anomalies if a.anomaly_type == "very_fast")
        if very_fast_count > 3:
            recommendations.append(
                f"You answered {very_fast_count} questions very quickly - ensure you read carefully"
            )
        
        very_slow_count = sum(1 for a in anomalies if a.anomaly_type == "very_slow")
        if very_slow_count > 3:
            recommendations.append(
                f"You spent excessive time on {very_slow_count} questions - practice time management"
            )
        
        # Analyze effort
        if effort_score < 0.4:
            recommendations.append(
                "Low effort detected - try to invest more time in each question"
            )
        elif effort_score > 0.8:
            recommendations.append(
                "High effort detected - excellent engagement!"
            )
        
        return recommendations if recommendations else ["Timing patterns look good overall"]
    
    def _baseline_analysis(self, student_id: str) -> ResponseTimeAnalysis:
        """Return baseline when insufficient data"""
        return ResponseTimeAnalysis(
            student_id=student_id,
            exam_id=None,
            total_questions_analyzed=0,
            average_response_time_seconds=0,
            response_time_std_dev=0,
            speed_accuracy_metrics=SpeedAccuracyMetrics(
                fastest_quarter_accuracy=0,
                fast_quarter_accuracy=0,
                slow_quarter_accuracy=0,
                slowest_quarter_accuracy=0,
                correlation_coefficient=0,
                pattern_description="Insufficient data"
            ),
            timing_anomalies=[],
            effort_score=0.5,
            optimal_time_range_seconds={'min_seconds': 30, 'max_seconds': 60, 'accuracy_in_range': 0},
            consistency_score=0,
            recommendations=["Complete more exams for detailed timing analysis"],
            analyzed_at=datetime.utcnow()
        )


# Global service instance
response_time_service = ResponseTimeAnalyticsService()


async def get_response_time_service() -> ResponseTimeAnalyticsService:
    """Get the response time analytics service instance"""
    return response_time_service
