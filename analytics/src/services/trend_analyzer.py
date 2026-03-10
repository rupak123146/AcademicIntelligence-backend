"""
Academic Intelligence Platform - Trend Analysis Service
Tracks performance changes over time to identify improvement or decline.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
import numpy as np

from src.config import db, settings
from src.models import (
    TrendDataPoint,
    PerformanceTrend,
    TrendDirection
)
from src.utils import (
    logger,
    calculate_average,
    calculate_std_dev,
    calculate_moving_average,
    calculate_linear_regression_slope,
    calculate_consistency_score
)


class TrendAnalyzer:
    """Analyzes performance trends over time using time-series analysis."""
    
    def __init__(self):
        self.pool = None
        self.min_data_points = settings.min_attempts_for_trend
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_performance_trend(
        self, student_id: str, course_id: str, window_size: int = 5
    ) -> PerformanceTrend:
        """Analyze performance trend for a student."""
        logger.info(f"Analyzing trend for student {student_id}, course {course_id}")
        
        try:
            data_points = await self._get_exam_history(student_id, course_id)
            
            if len(data_points) < 2:
                return PerformanceTrend(
                    student_id=student_id, course_id=course_id,
                    analysis_date=datetime.utcnow(),
                    direction=TrendDirection.INSUFFICIENT_DATA,
                    slope=0.0,
                    avg_score=data_points[0].score if data_points else 0.0,
                    min_score=data_points[0].score if data_points else 0.0,
                    max_score=data_points[0].score if data_points else 0.0,
                    consistency_score=100.0, volatility=0.0,
                    data_points=data_points, moving_average=[],
                    predicted_next=None, confidence_level=0.0
                )
            
            scores = [dp.score for dp in data_points]
            avg_score = calculate_average(scores)
            min_score = min(scores)
            max_score = max(scores)
            volatility = calculate_std_dev(scores)
            consistency = calculate_consistency_score(scores)
            slope = calculate_linear_regression_slope(scores)
            direction = self._determine_direction(slope, volatility)
            moving_avg = calculate_moving_average(scores, min(window_size, len(scores)))
            prediction, confidence = self._predict_next_score(scores, slope)
            
            return PerformanceTrend(
                student_id=student_id, course_id=course_id,
                analysis_date=datetime.utcnow(),
                direction=direction, slope=slope,
                avg_score=avg_score, min_score=min_score, max_score=max_score,
                consistency_score=consistency, volatility=volatility,
                data_points=data_points, moving_average=moving_avg,
                predicted_next=prediction, confidence_level=confidence
            )
        except Exception as e:
            logger.error(f"Error analyzing trend: {e}")
            raise
    
    async def _get_exam_history(self, student_id: str, course_id: str) -> List[TrendDataPoint]:
        """Get exam history for trend analysis."""
        query = """
            SELECT 
                ea.examId as exam_id,
                e.title as exam_title,
                ea.submittedAt,
                ea.percentage
            FROM exam_attempts ea
            JOIN exams e ON ea.examId = e.id
            WHERE ea.studentId = %s
                AND e.courseId = %s
                AND ea.status IN ('submitted', 'auto_submitted', 'graded')
                AND ea.submittedAt IS NOT NULL
            ORDER BY ea.submittedAt ASC
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            return [
                TrendDataPoint(
                    exam_id=row['exam_id'],
                    exam_date=row['submittedAt'],
                    score=float(row['percentage']) if row.get('percentage') else 0,
                    exam_title=row.get('exam_title')
                )
                for row in rows
            ]
    
    def _determine_direction(self, slope: float, volatility: float) -> TrendDirection:
        """Determine trend direction based on slope and volatility."""
        threshold = 0.5 + (volatility / 100)
        if slope > threshold:
            return TrendDirection.IMPROVING
        elif slope < -threshold:
            return TrendDirection.DECLINING
        return TrendDirection.STABLE
    
    def _predict_next_score(self, scores: List[float], slope: float) -> tuple:
        """Predict next score using trend analysis."""
        if len(scores) < 3:
            return None, 0.0
        predicted = max(0, min(100, scores[-1] + slope))
        consistency = calculate_consistency_score(scores)
        recent_scores = scores[-3:]
        recent_slope = calculate_linear_regression_slope(recent_scores)
        if (slope > 0 and recent_slope > 0) or (slope < 0 and recent_slope < 0):
            confidence = min(90, consistency * 0.7 + 20)
        else:
            confidence = min(60, consistency * 0.4)
        return round(predicted, 2), round(confidence, 2)

    async def store_trend(self, trend: PerformanceTrend) -> bool:
        """Store trend analysis in MongoDB."""
        try:
            mongo_db = db.mongo_db
            if mongo_db:
                await mongo_db.trend_analytics.update_one(
                    {"student_id": trend.student_id, "course_id": trend.course_id},
                    {"$set": trend.model_dump(mode='json')},
                    upsert=True
                )
            return True
        except Exception as e:
            logger.error(f"Error storing trend: {e}")
            return False


# Singleton instance
trend_analyzer = TrendAnalyzer()
