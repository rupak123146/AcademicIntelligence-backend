"""
🎓 Enhanced Feedback Generation Service
Generates personalized feedback with resource recommendations
"""

from typing import List, Dict, Optional, Any
from datetime import datetime
import asyncio
from src.config import db
from src.models.enhanced_models import (
    PersonalizedFeedback,
    FeedbackItem,
    FeedbackType,
    Resource,
    ResourceRecommendation
)
from src.models.huggingface_models import get_model_manager
from src.utils import logger


class EnhancedFeedbackService:
    """
    Service for generating enhanced personalized feedback
    with resource recommendations using HF models
    """

    def __init__(self):
        self.pool = None
        self.mongo_db = None
        self.resource_cache = {}

    async def initialize(self):
        """Initialize service"""
        self.pool = db.pg_pool
        self.mongo_db = db.mongo_db
        await self._load_resources_cache()

    async def generate_personalized_feedback(
        self,
        student_id: str,
        course_id: str,
        exam_id: Optional[str] = None
    ) -> PersonalizedFeedback:
        """
        Generate comprehensive personalized feedback with resources
        
        Args:
            student_id: Student ID
            course_id: Course ID
            exam_id: Optional specific exam
        
        Returns:
            PersonalizedFeedback with items and resources
        """
        try:
            logger.info(f"Generating feedback for student {student_id}, course {course_id}")
            
            # Collect student data
            student_data = await self._collect_student_data(student_id, course_id, exam_id)
            
            # Get HF model manager
            model_manager = await get_model_manager()
            
            # Format context for models
            context = self._prepare_context(student_data)
            performance_summary = self._prepare_summary(student_data)
            
            # Generate feedback items using HF
            feedback_items = await self._generate_feedback_items(
                model_manager, context, performance_summary, student_data
            )
            
            # Recommend resources for each feedback item
            feedback_with_resources = await self._attach_resources(
                feedback_items, student_data
            )
            
            # Generate improvement pathway
            improvement_pathway = self._create_improvement_pathway(
                student_data, feedback_with_resources
            )
            
            # Create learning goals
            learning_goals = self._create_learning_goals(student_data)
            
            # Get overall assessment
            overall_assessment = await self._generate_overall_assessment(
                model_manager, context, student_data
            )
            
            # Create feedback object
            feedback = PersonalizedFeedback(
                student_id=student_id,
                exam_id=exam_id,
                course_id=course_id,
                feedback_items=feedback_with_resources,
                overall_assessment=overall_assessment,
                improvement_pathway=improvement_pathway,
                learning_goals=learning_goals,
                generated_at=datetime.now()
            )
            
            # Cache feedback
            await self._cache_feedback(feedback)
            
            return feedback
            
        except Exception as e:
            logger.error(f"Error generating feedback: {e}")
            raise

    async def _generate_feedback_items(
        self,
        model_manager,
        context: str,
        summary: str,
        student_data: Dict[str, Any]
    ) -> List[FeedbackItem]:
        """Generate feedback items using HF models"""
        try:
            items = []
            
            # Generate using HF model
            hf_feedback = await model_manager.generate_feedback(context, summary)
            
            # Strengths (high priority)
            for strength in hf_feedback.strengths:
                items.append(FeedbackItem(
                    type=FeedbackType.STRENGTH,
                    message=strength,
                    priority=5,
                    related_concept=None
                ))
            
            # Improvements (high priority)
            for improvement in hf_feedback.improvements:
                items.append(FeedbackItem(
                    type=FeedbackType.IMPROVEMENT,
                    message=improvement,
                    priority=4,
                    related_concept=None
                ))
            
            # Recommendations (medium priority)
            for recommendation in hf_feedback.recommendations:
                items.append(FeedbackItem(
                    type=FeedbackType.RECOMMENDATION,
                    message=recommendation,
                    priority=3,
                    related_concept=None
                ))
            
            return items
            
        except Exception as e:
            logger.error(f"Error generating feedback items: {e}")
            return []

    async def _attach_resources(
        self,
        feedback_items: List[FeedbackItem],
        student_data: Dict[str, Any]
    ) -> List[FeedbackItem]:
        """Find and attach resources to feedback items"""
        try:
            model_manager = await get_model_manager()
            
            for item in feedback_items:
                if item.type != FeedbackType.STRENGTH:  # Attach resources to improvements/recommendations
                    # Get recommended resources
                    resources = await model_manager.recommend_resources(
                        learning_need=item.message,
                        available_resources=self._get_available_resources(student_data),
                        top_k=3
                    )
                    
                    # Attach to feedback item
                    item.resource_links = [
                        {
                            "title": r.get("title", "Resource"),
                            "url": r.get("url", ""),
                            "type": r.get("resource_type", "article"),
                            "relevance_score": r.get("relevance_score", 0)
                        }
                        for r in resources
                    ]
            
            return feedback_items
            
        except Exception as e:
            logger.error(f"Error attaching resources: {e}")
            return feedback_items

    def _get_available_resources(self, student_data: Dict[str, Any]) -> List[Dict[str, str]]:
        """Get available resources for student"""
        course_id = student_data.get('course_id', '')
        
        # For now, return some resources
        # In production, query from resource database
        base_resources = [
            {
                "id": "res_1",
                "title": "Chapter Overview",
                "description": "Introduction to key concepts",
                "resource_type": "article",
                "url": "https://example.com/chapters/1",
                "difficulty_level": "entry"
            },
            {
                "id": "res_2",
                "title": "Tutorial Video",
                "description": "Step-by-step video explanation",
                "resource_type": "video",
                "url": "https://example.com/videos/tutorial",
                "difficulty_level": "entry"
            },
            {
                "id": "res_3",
                "title": "Practice Problems",
                "description": "Worked examples and exercises",
                "resource_type": "practice",
                "url": "https://example.com/practice/set1",
                "difficulty_level": "intermediate"
            }
        ]
        
        return base_resources

    def _create_improvement_pathway(
        self,
        student_data: Dict[str, Any],
        feedback_items: List[FeedbackItem]
    ) -> List[Dict[str, Any]]:
        """Create structured improvement pathway"""
        pathway = []
        
        # Phase 1: Review basics
        pathway.append({
            "phase": 1,
            "name": "Foundation Review",
            "duration_days": 7,
            "activities": ["Review core concepts", "Watch tutorial videos"],
            "success_criteria": "Score 70% on practice quiz"
        })
        
        # Phase 2: Focused practice
        pathway.append({
            "phase": 2,
            "name": "Targeted Practice",
            "duration_days": 10,
            "activities": ["Solve practice problems", "Peer discussion"],
            "success_criteria": "Complete 20 practice problems with 80% accuracy"
        })
        
        # Phase 3: Assessment
        pathway.append({
            "phase": 3,
            "name": "Self-Assessment",
            "duration_days": 7,
            "activities": ["Take practice exam", "Review weak areas"],
            "success_criteria": "Score improvement of 15% or more"
        })
        
        return pathway

    def _create_learning_goals(self, student_data: Dict[str, Any]) -> List[str]:
        """Create personalized learning goals"""
        goals = []
        
        avg_score = student_data.get('avg_score', 50)
        
        if avg_score < 40:
            goals.append("Achieve 50% or above on next attempt")
            goals.append("Complete all foundational practice problems")
        elif avg_score < 60:
            goals.append("Improve score to 70% within two attempts")
            goals.append("Master key concepts in weak areas")
        elif avg_score < 80:
            goals.append("Achieve 85% or above")
            goals.append("Help peers with challenging concepts")
        
        goals.append(f"Maintain consistent engagement (5+ hours/week)")
        
        return goals

    async def _generate_overall_assessment(
        self,
        model_manager,
        context: str,
        student_data: Dict[str, Any]
    ) -> str:
        """Generate overall assessment message"""
        try:
            # Use HF model to generate encouraging message
            hf_feedback = await model_manager.generate_feedback(
                context,
                f"Overall score: {student_data.get('avg_score', 0):.1f}%"
            )
            
            return hf_feedback.overall_message
            
        except Exception as e:
            logger.error(f"Error generating assessment: {e}")
            return "Your performance shows promise. Continue working on core concepts."

    async def _collect_student_data(
        self,
        student_id: str,
        course_id: str,
        exam_id: Optional[str]
    ) -> Dict[str, Any]:
        """Collect all student performance data"""
        try:
            data = {
                'student_id': student_id,
                'course_id': course_id,
                'exam_id': exam_id
            }
            
            # Get exam attempts
            if exam_id:
                attempt = await self.pool.fetchrow("""
                    SELECT * FROM exam_attempts 
                    WHERE student_id = $1 AND exam_id = $2
                """, student_id, exam_id)
                data['attempt'] = dict(attempt) if attempt else {}
            
            # Get course performance
            performance = await self.pool.fetchrow("""
                SELECT 
                    AVG(percentage) as avg_score,
                    COUNT(*) as total_exams,
                    COUNT(CASE WHEN percentage >= 40 THEN 1 END) as passed,
                    MIN(percentage) as min_score,
                    MAX(percentage) as max_score
                FROM exam_attempts
                WHERE student_id = $1 AND exam_id IN (
                    SELECT id FROM exams WHERE course_id = $2
                )
            """, student_id, course_id)
            
            if performance:
                data.update(dict(performance))
            
            # Get weak subjects
            weak_areas = await self.pool.fetch("""
                SELECT c.name, AVG(CASE WHEN ca.correct THEN 1 ELSE 0 END * 100) as accuracy
                FROM chapter_attempts ca
                JOIN chapters c ON ca.chapter_id = c.id
                WHERE ca.student_id = $1 AND ca.course_id = $2
                GROUP BY c.id, c.name
                HAVING AVG(CASE WHEN ca.correct THEN 1 ELSE 0 END * 100) < 70
                ORDER BY accuracy ASC
                LIMIT 5
            """, student_id, course_id)
            
            data['weak_areas'] = [dict(w) for w in weak_areas]
            
            return data
            
        except Exception as e:
            logger.error(f"Error collecting student data: {e}")
            return {'student_id': student_id, 'course_id': course_id}

    def _prepare_context(self, student_data: Dict[str, Any]) -> str:
        """Prepare context string for HF models"""
        weak_areas = ", ".join([w.get('name', 'Unknown') for w in student_data.get('weak_areas', [])])
        
        return f"""
        Student context:
        - Average performance: {student_data.get('avg_score', 'N/A')}%
        - Exams taken: {student_data.get('total_exams', 0)}
        - Passed: {student_data.get('passed', 0)}
        - Weak areas: {weak_areas}
        """

    def _prepare_summary(self, student_data: Dict[str, Any]) -> str:
        """Prepare performance summary for HF models"""
        return f"""
        Performance summary:
        Score range: {student_data.get('min_score', 0):.1f}% to {student_data.get('max_score', 100):.1f}%
        Average: {student_data.get('avg_score', 0):.1f}%
        Pass rate: {(student_data.get('passed', 0) / max(1, student_data.get('total_exams', 1))) * 100:.1f}%
        """

    async def _cache_feedback(self, feedback: PersonalizedFeedback):
        """Cache generated feedback"""
        try:
            if self.mongo_db:
                collection = self.mongo_db.feedback
                
                feedback_dict = {
                    'student_id': feedback.student_id,
                    'course_id': feedback.course_id,
                    'exam_id': feedback.exam_id,
                    'items': [
                        {
                            'type': item.type.value,
                            'message': item.message,
                            'priority': item.priority,
                            'resources': item.resource_links
                        }
                        for item in feedback.feedback_items
                    ],
                    'overall_assessment': feedback.overall_assessment,
                    'learning_goals': feedback.learning_goals,
                    'generated_at': feedback.generated_at
                }
                
                # Upsert
                await collection.update_one(
                    {
                        'student_id': feedback.student_id,
                        'course_id': feedback.course_id
                    },
                    {'$set': feedback_dict},
                    upsert=True
                )
                
        except Exception as e:
            logger.error(f"Error caching feedback: {e}")

    async def _load_resources_cache(self):
        """Load resources into memory cache"""
        try:
            # In production, load from database
            # For now, initialize empty
            logger.info("Resources cache initialized")
        except Exception as e:
            logger.error(f"Error loading resources cache: {e}")
