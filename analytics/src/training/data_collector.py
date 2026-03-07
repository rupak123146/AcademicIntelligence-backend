"""
🎓 Training Data Collector
Collects and prepares training data from the academic platform
"""

import asyncio
from typing import List, Dict, Any, Tuple
import pandas as pd
from datetime import datetime, timedelta
import json
import logging

from src.config import db

logger = logging.getLogger(__name__)


class TrainingDataCollector:
    """
    Collects training data from production database for model fine-tuning
    """

    def __init__(self):
        self.pool = None
        self.mongo_db = None

    async def initialize(self):
        """Initialize database connections"""
        self.pool = db.pg_pool
        self.mongo_db = db.mongo_db

    async def collect_risk_detection_data(
        self,
        min_samples: int = 1000,
        time_window_days: int = 180
    ) -> Tuple[List[str], List[int]]:
        """
        Collect labeled data for risk detection model
        
        Returns:
            (texts, labels) where:
            - texts: List of student performance descriptions
            - labels: List of risk labels (0=low_risk, 1=at_risk)
        """
        logger.info("Collecting risk detection training data...")
        
        try:
            cutoff_date = datetime.now() - timedelta(days=time_window_days)
            
            # Query students with their performance metrics
            query = """
                WITH student_performance AS (
                    SELECT 
                        u.id as student_id,
                        u.first_name || ' ' || u.last_name as student_name,
                        COUNT(DISTINCT ea.id) as total_attempts,
                        AVG(ea.score) as avg_score,
                        STDDEV(ea.score) as score_variance,
                        MIN(ea.score) as min_score,
                        MAX(ea.score) as max_score,
                        COUNT(DISTINCT CASE WHEN ea.score < 50 THEN ea.id END) as failed_attempts,
                        AVG(EXTRACT(EPOCH FROM (ea.submitted_at - ea.started_at))/60) as avg_time_minutes,
                        COUNT(DISTINCT ea.exam_id) as unique_exams_taken
                    FROM users u
                    LEFT JOIN exam_attempts ea ON u.id = ea.student_id
                    WHERE u.role = 'student'
                        AND ea.status IN ('submitted', 'auto_submitted', 'graded')
                        AND ea.created_at >= $1
                    GROUP BY u.id, u.first_name, u.last_name
                    HAVING COUNT(DISTINCT ea.id) >= 3
                ),
                student_trends AS (
                    SELECT 
                        ea.student_id,
                        CASE 
                            WHEN COUNT(*) >= 2 THEN
                                REGR_SLOPE(ea.score, EXTRACT(EPOCH FROM ea.submitted_at))
                            ELSE 0
                        END as score_trend
                    FROM exam_attempts ea
                    WHERE ea.status IN ('submitted', 'auto_submitted', 'graded')
                        AND ea.created_at >= $1
                    GROUP BY ea.student_id
                )
                SELECT 
                    sp.*,
                    COALESCE(st.score_trend, 0) as score_trend,
                    CASE 
                        WHEN sp.avg_score < 50 
                            OR sp.failed_attempts::float / NULLIF(sp.total_attempts, 0) > 0.5
                            OR st.score_trend < -2 
                        THEN 1
                        ELSE 0
                    END as is_at_risk
                FROM student_performance sp
                LEFT JOIN student_trends st ON sp.student_id = st.student_id
                ORDER BY sp.student_id;
            """
            
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(query, cutoff_date)
            
            texts = []
            labels = []
            
            for row in rows:
                # Create descriptive text about student performance
                text = self._create_performance_description(dict(row))
                texts.append(text)
                labels.append(int(row['is_at_risk']))
            
            logger.info(f"Collected {len(texts)} samples for risk detection")
            logger.info(f"At-risk: {sum(labels)}, Not at-risk: {len(labels) - sum(labels)}")
            
            return texts, labels
            
        except Exception as e:
            logger.error(f"Error collecting risk detection data: {e}")
            raise

    def _create_performance_description(self, student_data: Dict) -> str:
        """Create natural language description of student performance"""
        avg_score = student_data.get('avg_score', 0)
        total_attempts = student_data.get('total_attempts', 0)
        failed_attempts = student_data.get('failed_attempts', 0)
        score_trend = student_data.get('score_trend', 0)
        
        desc_parts = [
            f"Student has completed {total_attempts} exams",
            f"with an average score of {avg_score:.1f}%.",
        ]
        
        if failed_attempts > 0:
            desc_parts.append(f"Failed {failed_attempts} assessments.")
        
        if score_trend > 1:
            desc_parts.append("Performance is improving over time.")
        elif score_trend < -1:
            desc_parts.append("Performance is declining over time.")
        else:
            desc_parts.append("Performance is stable.")
        
        if avg_score >= 80:
            desc_parts.append("Demonstrates strong understanding.")
        elif avg_score >= 60:
            desc_parts.append("Shows moderate understanding.")
        else:
            desc_parts.append("Struggling with course material.")
        
        return " ".join(desc_parts)

    async def collect_feedback_data(
        self,
        min_samples: int = 500
    ) -> Tuple[List[Dict[str, str]], List[Dict[str, Any]]]:
        """
        Collect data for feedback generation model
        
        Returns:
            (inputs, outputs) where:
            - inputs: List of dicts with context and performance
            - outputs: List of dicts with strengths, improvements, recommendations
        """
        logger.info("Collecting feedback generation training data...")
        
        try:
            # Query existing feedback from educators
            query = """
                SELECT 
                    u.id as student_id,
                    u.first_name || ' ' || u.last_name as student_name,
                    ea.score,
                    ea.exam_id,
                    e.title as exam_title,
                    -- Simulated feedback (in production, get from actual educator comments)
                    CASE 
                        WHEN ea.score >= 90 THEN 'Excellent work! Keep maintaining high standards.'
                        WHEN ea.score >= 75 THEN 'Good performance. Focus on areas of weakness.'
                        WHEN ea.score >= 60 THEN 'Satisfactory. More practice needed in key concepts.'
                        ELSE 'Needs significant improvement. Seek additional help.'
                    END as educator_feedback,
                    COUNT(DISTINCT sa.id) as total_questions,
                    SUM(CASE WHEN sa.is_correct THEN 1 ELSE 0 END) as correct_answers
                FROM exam_attempts ea
                JOIN users u ON ea.student_id = u.id
                JOIN exams e ON ea.exam_id = e.id
                LEFT JOIN student_answers sa ON ea.id = sa.attempt_id
                WHERE ea.status IN ('submitted', 'graded')
                    AND ea.score IS NOT NULL
                GROUP BY u.id, u.first_name, u.last_name, ea.score, ea.exam_id, e.title, ea.id
                HAVING COUNT(DISTINCT sa.id) > 0
                LIMIT $1;
            """
            
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(query, min_samples)
            
            inputs = []
            outputs = []
            
            for row in rows:
                # Create input context
                input_dict = {
                    "context": f"Student performance on {row['exam_title']}",
                    "summary": f"Score: {row['score']}%. Answered {row['correct_answers']}/{row['total_questions']} correctly."
                }
                
                # Create output feedback structure
                output_dict = self._generate_feedback_structure(dict(row))
                
                inputs.append(input_dict)
                outputs.append(output_dict)
            
            logger.info(f"Collected {len(inputs)} feedback samples")
            return inputs, outputs
            
        except Exception as e:
            logger.error(f"Error collecting feedback data: {e}")
            raise

    def _generate_feedback_structure(self, exam_data: Dict) -> Dict[str, Any]:
        """Generate structured feedback based on performance"""
        score = exam_data.get('score', 0)
        
        if score >= 90:
            return {
                "strengths": [
                    "Excellent grasp of core concepts",
                    "Consistent high performance",
                    "Strong problem-solving skills"
                ],
                "improvements": [
                    "Challenge yourself with advanced topics",
                    "Help peers who are struggling"
                ],
                "recommendations": [
                    "Explore enrichment materials",
                    "Consider tutoring opportunities",
                    "Maintain study habits"
                ],
                "overall": "Outstanding performance! Continue your excellent work."
            }
        elif score >= 75:
            return {
                "strengths": [
                    "Good understanding of main concepts",
                    "Solid performance overall"
                ],
                "improvements": [
                    "Focus on specific weak areas",
                    "Practice more challenging problems",
                    "Review incorrect answers"
                ],
                "recommendations": [
                    "Join study groups for difficult topics",
                    "Seek clarification on unclear concepts",
                    "Practice with additional resources"
                ],
                "overall": "Good performance with room for improvement. Keep up the effort!"
            }
        elif score >= 60:
            return {
                "strengths": [
                    "Shows effort and engagement",
                    "Grasps some fundamental concepts"
                ],
                "improvements": [
                    "Need stronger foundation in core areas",
                    "More consistent study habits required",
                    "Better time management needed"
                ],
                "recommendations": [
                    "Attend office hours regularly",
                    "Form study groups with peers",
                    "Complete all practice exercises",
                    "Review course materials systematically"
                ],
                "overall": "Satisfactory but needs more focused effort to improve."
            }
        else:
            return {
                "strengths": [
                    "Attempting all assessments"
                ],
                "improvements": [
                    "Fundamental concepts need attention",
                    "Study habits must be strengthened",
                    "Seek immediate academic support"
                ],
                "recommendations": [
                    "Meet with instructor immediately",
                    "Consider peer tutoring",
                    "Develop structured study plan",
                    "Utilize all available learning resources",
                    "Practice basic concepts daily"
                ],
                "overall": "Significant improvement needed. Please seek help immediately."
            }

    async def collect_resource_matching_data(
        self,
        min_samples: int = 300
    ) -> Tuple[List[str], List[List[str]]]:
        """
        Collect data for resource recommendation
        
        Returns:
            (learning_needs, matched_resources)
        """
        logger.info("Collecting resource matching data...")
        
        # Simulated data - in production, track which resources students accessed after feedback
        learning_needs = [
            "struggling with calculus derivatives",
            "need help with probability distributions",
            "difficulty understanding data structures",
            "weak in organic chemistry reactions",
            "need practice with essay writing",
            "struggling with physics kinematics",
            "need help with financial accounting",
            "difficulty with programming loops",
        ]
        
        matched_resources = [
            ["Khan Academy Calculus", "MIT OCW Derivatives Tutorial", "Calculus Practice Problems"],
            ["Statistics Textbook Ch. 4", "Probability Video Lectures", "Practice Problem Sets"],
            ["Data Structures Visualizer", "Algorithm Textbook", "Coding Practice Platform"],
            ["Organic Chemistry Tutor Videos", "Reaction Mechanism Guide", "Practice Problems"],
            ["Essay Writing Guide", "Academic Writing Workshop", "Peer Review Sessions"],
            ["Physics Fundamentals Videos", "Kinematics Problem Sets", "Interactive Simulations"],
            ["Accounting Principles Textbook", "Financial Statement Tutorial", "Practice Exercises"],
            ["Programming Basics Tutorial", "Loop Practice Problems", "Interactive Coding Platform"],
        ]
        
        logger.info(f"Collected {len(learning_needs)} resource matching samples")
        return learning_needs, matched_resources

    async def export_to_csv(
        self,
        data_type: str,
        output_path: str
    ):
        """Export collected data to CSV for external training"""
        logger.info(f"Exporting {data_type} data to {output_path}")
        
        if data_type == "risk_detection":
            texts, labels = await self.collect_risk_detection_data()
            df = pd.DataFrame({
                'text': texts,
                'label': labels
            })
        elif data_type == "feedback":
            inputs, outputs = await self.collect_feedback_data()
            df = pd.DataFrame({
                'context': [i['context'] for i in inputs],
                'summary': [i['summary'] for i in inputs],
                'feedback_json': [json.dumps(o) for o in outputs]
            })
        else:
            raise ValueError(f"Unknown data type: {data_type}")
        
        df.to_csv(output_path, index=False)
        logger.info(f"Exported {len(df)} samples to {output_path}")
