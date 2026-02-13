"""
🎓 Academic Intelligence Platform - Trend Analysis Service

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
    """
    Analyzes performance trends over time using time-series analysis.
    """
    
    def __init__(self):
        self.pool = None
        self.min_data_points = settings.min_attempts_for_trend
    
    async def initialize(self):
        """Initialize database connection."""
        self.pool = db.pg_pool
    
    async def analyze_performance_trend(
        self,
        student_id: int,
        course_id: int,
        window_size: int = 5
    ) -> PerformanceTrend:
        """
        Analyze performance trend for a student.
        
        Args:
            student_id: Student's ID
            course_id: Course ID
            window_size: Number of exams for moving average
        
        Returns:
            PerformanceTrend with trend analysis
        """
        logger.info(f"Analyzing trend for student {student_id}, course {course_id}")
        
        try:
            # Get all exam attempts
            data_points = await self._get_exam_history(student_id, course_id)
            
            if len(data_points) < 2:
                return PerformanceTrend(
                    student_id=student_id,
                    course_id=course_id,
                    analysis_date=datetime.utcnow(),
                    direction=TrendDirection.INSUFFICIENT_DATA,
                    slope=0.0,
                    avg_score=data_points[0].score if data_points else 0.0,
                    min_score=data_points[0].score if data_points else 0.0,
                    max_score=data_points[0].score if data_points else 0.0,
                    consistency_score=100.0,
                    volatility=0.0,
                    data_points=data_points,
                    moving_average=[],
                    predicted_next=None,
                    confidence_level=0.0
                )
            
            scores = [dp.score for dp in data_points]
            
            # Calculate statistics
            avg_score = calculate_average(scores)
            min_score = min(scores)
            max_score = max(scores)
            volatility = calculate_std_dev(scores)
            consistency = calculate_consistency_score(scores)
            
            # Calculate trend
            slope = calculate_linear_regression_slope(scores)
            direction = self._determine_direction(slope, volatility)
            
            # Calculate moving average
            moving_avg = calculate_moving_average(scores, min(window_size, len(scores)))
            
            # Predict next score
            prediction, confidence = self._predict_next_score(scores, slope)
            
            return PerformanceTrend(
                student_id=student_id,
                course_id=course_id,
                analysis_date=datetime.utcnow(),
                direction=direction,
                slope=slope,
                avg_score=avg_score,
                min_score=min_score,
                max_score=max_score,
                consistency_score=consistency,
                volatility=volatility,
                data_points=data_points,
                moving_average=moving_avg,
                predicted_next=prediction,
                confidence_level=confidence
            )
            
        except Exception as e:
            logger.error(f"Error analyzing trend: {e}")
            raise
    
    async def _get_exam_history(
        self,
        student_id: int,
        course_id: int
    ) -> List[TrendDataPoint]:
        """Get exam history for trend analysis."""
        
        query = """
            SELECT 
                ea.exam_id,
                e.title as exam_title,
                ea.submitted_at,
                ea.percentage
            FROM exam_attempts ea
            JOIN exams e ON ea.exam_id = e.id
            WHERE ea.student_id = $1 
                AND e.course_id = $2
                AND ea.status = 'evaluated'
            ORDER BY ea.submitted_at ASC
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            
            return [
                TrendDataPoint(
                    exam_id=row['exam_id'],
                    exam_date=row['submitted_at'],
                    score=float(row['percentage']) if row['percentage'] else 0,
                    exam_title=row['exam_title']
                )
                for row in rows
            ]
    
    def _determine_direction(
        self,
        slope: float,
        volatility: float
    ) -> TrendDirection:
        """
        Determine trend direction based on slope and volatility.
        
        A slope threshold is used to distinguish between improving/declining
        and stable trends. Volatility can affect interpretation.
        """
        # Adjust threshold based on volatility
        # Higher volatility means we need a larger slope to be confident
        threshold = 0.5 + (volatility / 100)
        
        if slope > threshold:
            return TrendDirection.IMPROVING
        elif slope < -threshold:
            return TrendDirection.DECLINING
        else:
            return TrendDirection.STABLE
    
    def _predict_next_score(
        self,
        scores: List[float],
        slope: float
    ) -> tuple[Optional[float], float]:
        """
        Predict next score using trend analysis.
        Returns (predicted_score, confidence_level).
        """
        if len(scores) < 3:
            return None, 0.0
        
        # Simple linear prediction
        last_score = scores[-1]
        predicted = last_score + slope
        
        # Bound prediction to valid range
        predicted = max(0, min(100, predicted))
        
        # Calculate confidence based on consistency
        consistency = calculate_consistency_score(scores)
        
        # If recent trend matches overall trend, higher confidence
        recent_scores = scores[-3:]
        recent_slope = calculate_linear_regression_slope(recent_scores)
        
        if (slope > 0 and recent_slope > 0) or (slope < 0 and recent_slope < 0):
            # Trends align
            confidence = min(90, consistency)
        else:
            # Trends diverge, lower confidence
            confidence = min(60, consistency * 0.7)
        
        return round(predicted, 2), round(confidence, 2)
    
    async def get_multi_dimension_trend(
        self,
        student_id: int,
        course_id: int
    ) -> Dict[str, Any]:
        """
        Analyze trends across multiple dimensions:
        - Overall score trend
        - Chapter-wise trends
        - Difficulty-wise trends
        - Time efficiency trend
        """
        result = {
            "student_id": student_id,
            "course_id": course_id,
            "analysis_date": datetime.utcnow().isoformat()
        }
        
        # Overall trend
        overall = await self.analyze_performance_trend(student_id, course_id)
        result["overall"] = {
            "direction": overall.direction.value,
            "slope": overall.slope,
            "consistency": overall.consistency_score,
            "predicted_next": overall.predicted_next
        }
        
        # Chapter trends
        chapter_trends = await self._get_chapter_trends(student_id, course_id)
        result["by_chapter"] = chapter_trends
        
        # Difficulty trends
        difficulty_trends = await self._get_difficulty_trends(student_id, course_id)
        result["by_difficulty"] = difficulty_trends
        
        # Time efficiency trend
        time_trend = await self._get_time_efficiency_trend(student_id, course_id)
        result["time_efficiency"] = time_trend
        
        return result
    
    async def _get_chapter_trends(
        self,
        student_id: int,
        course_id: int
    ) -> List[Dict[str, Any]]:
        """Get performance trends by chapter."""
        
        query = """
            SELECT 
                ch.id as chapter_id,
                ch.name as chapter_name,
                DATE_TRUNC('week', ea.submitted_at) as week,
                COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 as accuracy
            FROM chapters ch
            JOIN questions q ON q.chapter_id = ch.id
            JOIN student_answers sa ON q.id = sa.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            WHERE ch.course_id = $1 
                AND ea.student_id = $2
                AND ea.status = 'evaluated'
            GROUP BY ch.id, ch.name, DATE_TRUNC('week', ea.submitted_at)
            ORDER BY ch.name, week
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id, student_id)
            
            # Group by chapter
            chapters = {}
            for row in rows:
                chapter_id = row['chapter_id']
                if chapter_id not in chapters:
                    chapters[chapter_id] = {
                        "chapter_id": chapter_id,
                        "chapter_name": row['chapter_name'],
                        "data_points": []
                    }
                
                chapters[chapter_id]["data_points"].append({
                    "week": row['week'].isoformat() if row['week'] else None,
                    "accuracy": round(float(row['accuracy']), 2) if row['accuracy'] else 0
                })
            
            # Calculate trend for each chapter
            result = []
            for chapter_data in chapters.values():
                scores = [dp['accuracy'] for dp in chapter_data['data_points']]
                
                if len(scores) >= 2:
                    slope = calculate_linear_regression_slope(scores)
                    direction = self._determine_direction(slope, calculate_std_dev(scores))
                else:
                    slope = 0
                    direction = TrendDirection.INSUFFICIENT_DATA
                
                chapter_data["trend"] = {
                    "direction": direction.value,
                    "slope": slope
                }
                result.append(chapter_data)
            
            return result
    
    async def _get_difficulty_trends(
        self,
        student_id: int,
        course_id: int
    ) -> Dict[str, Any]:
        """Get performance trends by difficulty level."""
        
        query = """
            SELECT 
                q.difficulty_level,
                DATE_TRUNC('week', ea.submitted_at) as week,
                COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 as accuracy
            FROM questions q
            JOIN student_answers sa ON q.id = sa.question_id
            JOIN exam_attempts ea ON sa.attempt_id = ea.id
            JOIN exams e ON ea.exam_id = e.id
            WHERE e.course_id = $1 
                AND ea.student_id = $2
                AND ea.status = 'evaluated'
            GROUP BY q.difficulty_level, DATE_TRUNC('week', ea.submitted_at)
            ORDER BY q.difficulty_level, week
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id, student_id)
            
            # Group by difficulty
            difficulties = {}
            for row in rows:
                level = row['difficulty_level']
                if level not in difficulties:
                    difficulties[level] = []
                
                difficulties[level].append({
                    "week": row['week'].isoformat() if row['week'] else None,
                    "accuracy": round(float(row['accuracy']), 2) if row['accuracy'] else 0
                })
            
            # Calculate trend for each difficulty
            result = {}
            for level, data_points in difficulties.items():
                scores = [dp['accuracy'] for dp in data_points]
                
                if len(scores) >= 2:
                    slope = calculate_linear_regression_slope(scores)
                    direction = self._determine_direction(slope, calculate_std_dev(scores))
                else:
                    slope = 0
                    direction = TrendDirection.INSUFFICIENT_DATA
                
                result[level] = {
                    "data_points": data_points,
                    "trend": {
                        "direction": direction.value,
                        "slope": slope
                    }
                }
            
            return result
    
    async def _get_time_efficiency_trend(
        self,
        student_id: int,
        course_id: int
    ) -> Dict[str, Any]:
        """Get time efficiency trend over time."""
        
        query = """
            SELECT 
                ea.submitted_at,
                AVG(sa.time_spent) as avg_time,
                COUNT(CASE WHEN sa.is_correct THEN 1 END)::float / 
                    NULLIF(COUNT(*), 0) * 100 as accuracy
            FROM exam_attempts ea
            JOIN student_answers sa ON ea.id = sa.attempt_id
            JOIN exams e ON ea.exam_id = e.id
            WHERE ea.student_id = $1 
                AND e.course_id = $2
                AND ea.status = 'evaluated'
                AND sa.time_spent IS NOT NULL
            GROUP BY ea.submitted_at
            ORDER BY ea.submitted_at
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, student_id, course_id)
            
            if not rows:
                return {"trend": "insufficient_data"}
            
            data_points = []
            for row in rows:
                avg_time = float(row['avg_time']) if row['avg_time'] else 0
                accuracy = float(row['accuracy']) if row['accuracy'] else 0
                
                # Efficiency = accuracy / time (higher is better)
                efficiency = accuracy / avg_time if avg_time > 0 else 0
                
                data_points.append({
                    "date": row['submitted_at'].isoformat() if row['submitted_at'] else None,
                    "avg_time": round(avg_time, 2),
                    "accuracy": round(accuracy, 2),
                    "efficiency": round(efficiency, 4)
                })
            
            # Calculate efficiency trend
            efficiencies = [dp['efficiency'] for dp in data_points]
            
            if len(efficiencies) >= 2:
                slope = calculate_linear_regression_slope(efficiencies)
                direction = self._determine_direction(slope, calculate_std_dev(efficiencies))
            else:
                slope = 0
                direction = TrendDirection.INSUFFICIENT_DATA
            
            return {
                "data_points": data_points,
                "trend": {
                    "direction": direction.value,
                    "slope": round(slope, 4)
                },
                "interpretation": (
                    "Getting faster while maintaining accuracy" if direction == TrendDirection.IMPROVING else
                    "Speed or accuracy declining" if direction == TrendDirection.DECLINING else
                    "Consistent time efficiency"
                )
            }
    
    async def compare_with_class(
        self,
        student_id: int,
        course_id: int
    ) -> Dict[str, Any]:
        """
        Compare student's trend with class average trend.
        """
        # Get student trend
        student_trend = await self.analyze_performance_trend(student_id, course_id)
        
        # Get class average trend
        query = """
            SELECT 
                DATE_TRUNC('week', ea.submitted_at) as week,
                AVG(ea.percentage) as avg_score
            FROM exam_attempts ea
            JOIN exams e ON ea.exam_id = e.id
            JOIN course_enrollments ce ON ea.student_id = ce.student_id
            WHERE e.course_id = $1
                AND ea.status = 'evaluated'
            GROUP BY DATE_TRUNC('week', ea.submitted_at)
            ORDER BY week
        """
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, course_id)
            
            class_scores = [float(row['avg_score']) for row in rows if row['avg_score']]
            
            if len(class_scores) >= 2:
                class_slope = calculate_linear_regression_slope(class_scores)
                class_direction = self._determine_direction(
                    class_slope, calculate_std_dev(class_scores)
                )
                class_avg = calculate_average(class_scores)
            else:
                class_slope = 0
                class_direction = TrendDirection.INSUFFICIENT_DATA
                class_avg = class_scores[0] if class_scores else 0
            
            # Compare
            comparison = {
                "student_id": student_id,
                "course_id": course_id,
                "student_trend": {
                    "direction": student_trend.direction.value,
                    "slope": student_trend.slope,
                    "avg_score": student_trend.avg_score
                },
                "class_trend": {
                    "direction": class_direction.value,
                    "slope": class_slope,
                    "avg_score": class_avg
                },
                "comparison": {
                    "trend_comparison": self._compare_trends(
                        student_trend.direction, class_direction
                    ),
                    "score_difference": round(student_trend.avg_score - class_avg, 2),
                    "slope_difference": round(student_trend.slope - class_slope, 4)
                }
            }
            
            return comparison
    
    def _compare_trends(
        self,
        student_direction: TrendDirection,
        class_direction: TrendDirection
    ) -> str:
        """Compare student and class trends."""
        if student_direction == TrendDirection.IMPROVING:
            if class_direction == TrendDirection.IMPROVING:
                return "Improving with the class"
            else:
                return "Outpacing the class"
        elif student_direction == TrendDirection.DECLINING:
            if class_direction == TrendDirection.DECLINING:
                return "Declining with the class"
            else:
                return "Falling behind the class"
        else:
            if class_direction == TrendDirection.IMPROVING:
                return "Stable while class improves"
            elif class_direction == TrendDirection.DECLINING:
                return "Stable while class declines"
            else:
                return "Both student and class are stable"
    
    async def store_trend(
        self,
        trend: PerformanceTrend
    ) -> bool:
        """Store trend analysis in database."""
        
        try:
            async with self.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO performance_trends (
                        student_id, course_id, trend_direction,
                        slope, avg_score, consistency_score,
                        volatility, predicted_next, confidence_level,
                        analyzed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                    trend.student_id,
                    trend.course_id,
                    trend.direction.value,
                    trend.slope,
                    trend.avg_score,
                    trend.consistency_score,
                    trend.volatility,
                    trend.predicted_next,
                    trend.confidence_level,
                    trend.analysis_date
                )
            
            logger.info(f"Stored trend analysis for student {trend.student_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing trend analysis: {e}")
            return False


# Singleton instance
trend_analyzer = TrendAnalyzer()
