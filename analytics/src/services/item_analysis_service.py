"""
Item Analysis Service

Provides statistical analysis of assessment items including:
- Facility index (difficulty)
- Discrimination index
- Distractor analysis
- Item response patterns
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from collections import defaultdict
import statistics

from ..config.database import get_db_pool
from ..models.enhanced_models import (
    ItemAnalysis,
    ItemStatistics,
    DifficultLevel,
    DiscriminationLevel,
    DistractorAnalysis,
    DistractorOption,
    ItemRecommendation
)
from ..utils.logger import get_logger

logger = get_logger(__name__)


class ItemAnalysisService:
    """
    Service for analyzing individual assessment items
    
    Features:
    - Facility index calculation (item difficulty)
    - Discrimination index (point-biserial correlation)
    - Distractor effectiveness analysis
    - Item revision recommendations
    """
    
    def __init__(self):
        self.db_pool = None
        self.cache = {}
        self.cache_ttl = 3600  # 1 hour
        
    async def initialize(self):
        """Initialize service and database connections"""
        try:
            self.db_pool = await get_db_pool()
            logger.info("ItemAnalysisService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize ItemAnalysisService: {e}")
            raise
    
    async def analyze_exam_items(
        self,
        exam_id: str,
        min_responses: int = 10
    ) -> List[ItemAnalysis]:
        """
        Analyze all items in an exam
        
        Args:
            exam_id: Exam identifier
            min_responses: Minimum responses required for analysis
            
        Returns:
            List of item analyses
        """
        try:
            logger.info(f"Analyzing items for exam: {exam_id}")
            
            # Get all questions for the exam
            questions = await self._get_exam_questions(exam_id)
            
            if not questions:
                logger.warning(f"No questions found for exam: {exam_id}")
                return []
            
            # Analyze each question
            analyses = []
            for question in questions:
                analysis = await self.analyze_single_item(
                    exam_id=exam_id,
                    question_id=question['id'],
                    min_responses=min_responses
                )
                if analysis:
                    analyses.append(analysis)
            
            logger.info(f"Completed analysis for {len(analyses)} items")
            return analyses
            
        except Exception as e:
            logger.error(f"Error analyzing exam items: {e}")
            raise
    
    async def analyze_single_item(
        self,
        exam_id: str,
        question_id: str,
        min_responses: int = 10
    ) -> Optional[ItemAnalysis]:
        """
        Perform complete analysis on a single item
        
        Args:
            exam_id: Exam identifier
            question_id: Question identifier
            min_responses: Minimum responses required
            
        Returns:
            ItemAnalysis or None if insufficient data
        """
        try:
            # Get response data
            responses = await self._get_item_responses(exam_id, question_id)
            
            if len(responses) < min_responses:
                logger.warning(
                    f"Insufficient responses ({len(responses)}) for question {question_id}"
                )
                return None
            
            # Calculate facility index
            facility_index = await self._calculate_facility_index(responses)
            
            # Calculate discrimination index
            discrimination_index = await self._calculate_discrimination_index(
                exam_id, question_id, responses
            )
            
            # Perform distractor analysis
            distractor_analysis = await self._analyze_distractors(responses)
            
            # Generate recommendations
            recommendations = self._generate_item_recommendations(
                facility_index,
                discrimination_index,
                distractor_analysis
            )
            
            # Determine difficulty and discrimination levels
            difficulty_level = self._classify_difficulty(facility_index)
            discrimination_level = self._classify_discrimination(discrimination_index)
            
            # Create analysis object
            analysis = ItemAnalysis(
                item_id=question_id,
                exam_id=exam_id,
                facility_index=facility_index,
                difficulty_level=difficulty_level,
                discrimination_index=discrimination_index,
                discrimination_level=discrimination_level,
                total_responses=len(responses),
                correct_responses=sum(1 for r in responses if r['is_correct']),
                distractor_analysis=distractor_analysis,
                recommendations=recommendations,
                analysis_date=datetime.utcnow()
            )
            
            logger.info(f"Completed analysis for item {question_id}")
            return analysis
            
        except Exception as e:
            logger.error(f"Error analyzing item {question_id}: {e}")
            return None
    
    async def _get_exam_questions(self, exam_id: str) -> List[Dict[str, Any]]:
        """Retrieve all questions for an exam"""
        async with self.db_pool.acquire() as conn:
            query = """
                SELECT id, content, correct_answer, options, type
                FROM questions
                WHERE exam_id = $1
                ORDER BY position
            """
            rows = await conn.fetch(query, exam_id)
            return [dict(row) for row in rows]
    
    async def _get_item_responses(
        self,
        exam_id: str,
        question_id: str
    ) -> List[Dict[str, Any]]:
        """
        Get all student responses for a specific item
        
        Returns list with:
        - student_id
        - selected_answer
        - is_correct
        - total_score (student's overall exam score)
        """
        async with self.db_pool.acquire() as conn:
            query = """
                SELECT 
                    r.student_id,
                    r.selected_answer,
                    r.is_correct,
                    a.score as total_score
                FROM question_responses r
                JOIN exam_attempts a ON r.attempt_id = a.id
                WHERE r.question_id = $1 AND a.exam_id = $2 AND a.status = 'completed'
                ORDER BY a.score DESC
            """
            rows = await conn.fetch(query, question_id, exam_id)
            return [dict(row) for row in rows]
    
    async def _calculate_facility_index(
        self,
        responses: List[Dict[str, Any]]
    ) -> float:
        """
        Calculate facility index (p-value)
        
        Formula: p = (number correct) / (total responses)
        
        Range: 0.0 to 1.0
        - 0.0 = no one got it correct (very difficult)
        - 1.0 = everyone got it correct (very easy)
        - 0.5 = ideal difficulty
        """
        if not responses:
            return 0.0
        
        correct_count = sum(1 for r in responses if r['is_correct'])
        facility_index = correct_count / len(responses)
        
        return round(facility_index, 3)
    
    async def _calculate_discrimination_index(
        self,
        exam_id: str,
        question_id: str,
        responses: List[Dict[str, Any]]
    ) -> float:
        """
        Calculate discrimination index using upper/lower 27% groups
        
        Formula: D = (P_upper - P_lower)
        
        Range: -1.0 to 1.0
        - > 0.40 = excellent discrimination
        - 0.30-0.39 = good
        - 0.20-0.29 = fair (needs improvement)
        - < 0.20 = poor (revise or discard)
        - Negative = poor performers do better (major problem)
        """
        if len(responses) < 10:
            return 0.0
        
        # Sort by total score (already sorted from query)
        # Take upper and lower 27% groups
        group_size = max(1, int(len(responses) * 0.27))
        upper_group = responses[:group_size]
        lower_group = responses[-group_size:]
        
        # Calculate proportion correct in each group
        upper_correct = sum(1 for r in upper_group if r['is_correct'])
        lower_correct = sum(1 for r in lower_group if r['is_correct'])
        
        p_upper = upper_correct / len(upper_group)
        p_lower = lower_correct / len(lower_group)
        
        discrimination = p_upper - p_lower
        
        return round(discrimination, 3)
    
    async def _analyze_distractors(
        self,
        responses: List[Dict[str, Any]]
    ) -> Optional[DistractorAnalysis]:
        """
        Analyze effectiveness of distractor options
        
        Good distractors:
        - Are selected by some students (not ignored)
        - Are selected more by low performers than high performers
        - Have negative discrimination (attract weak students)
        """
        if not responses:
            return None
        
        # Count selections for each option
        option_counts = defaultdict(int)
        option_scores = defaultdict(list)  # track who selected each option
        
        for response in responses:
            selected = response['selected_answer']
            option_counts[selected] += 1
            option_scores[selected].append(response['total_score'])
        
        # Analyze each option
        distractor_options = []
        total_responses = len(responses)
        
        for option, count in option_counts.items():
            if option is None:
                continue
                
            selection_rate = count / total_responses
            avg_score = statistics.mean(option_scores[option]) if option_scores[option] else 0
            
            # Check if it's plausible (selected by 5%+ of students)
            is_plausible = selection_rate >= 0.05
            
            distractor_options.append(
                DistractorOption(
                    option_value=str(option),
                    selection_count=count,
                    selection_rate=round(selection_rate, 3),
                    average_score_of_selectors=round(avg_score, 2),
                    is_plausible=is_plausible
                )
            )
        
        # Sort by selection rate
        distractor_options.sort(key=lambda x: x.selection_rate, reverse=True)
        
        # Identify correct answer
        correct_responses = [r for r in responses if r['is_correct']]
        correct_answer = correct_responses[0]['selected_answer'] if correct_responses else None
        
        # Count non-functional distractors (selected by <5%)
        non_functional = sum(1 for d in distractor_options if not d.is_plausible)
        
        return DistractorAnalysis(
            correct_answer=str(correct_answer) if correct_answer else "unknown",
            distractor_options=distractor_options,
            non_functional_distractors=non_functional,
            total_options=len(distractor_options)
        )
    
    def _classify_difficulty(self, facility_index: float) -> DifficultLevel:
        """Classify item difficulty based on facility index"""
        if facility_index >= 0.85:
            return DifficultLevel.VERY_EASY
        elif facility_index >= 0.70:
            return DifficultLevel.EASY
        elif facility_index >= 0.30:
            return DifficultLevel.MODERATE
        elif facility_index >= 0.15:
            return DifficultLevel.DIFFICULT
        else:
            return DifficultLevel.VERY_DIFFICULT
    
    def _classify_discrimination(self, discrimination_index: float) -> DiscriminationLevel:
        """Classify discrimination quality"""
        if discrimination_index >= 0.40:
            return DiscriminationLevel.EXCELLENT
        elif discrimination_index >= 0.30:
            return DiscriminationLevel.GOOD
        elif discrimination_index >= 0.20:
            return DiscriminationLevel.FAIR
        elif discrimination_index >= 0.0:
            return DiscriminationLevel.POOR
        else:
            return DiscriminationLevel.NEGATIVE
    
    def _generate_item_recommendations(
        self,
        facility_index: float,
        discrimination_index: float,
        distractor_analysis: Optional[DistractorAnalysis]
    ) -> List[ItemRecommendation]:
        """Generate actionable recommendations for item improvement"""
        recommendations = []
        
        # Check difficulty
        if facility_index < 0.15:
            recommendations.append(
                ItemRecommendation(
                    category="difficulty",
                    severity="high",
                    message="Item is too difficult - consider revising or removing",
                    action="Review item content and reduce complexity"
                )
            )
        elif facility_index > 0.95:
            recommendations.append(
                ItemRecommendation(
                    category="difficulty",
                    severity="medium",
                    message="Item is too easy - most students answer correctly",
                    action="Increase difficulty or use as warm-up question"
                )
            )
        
        # Check discrimination
        if discrimination_index < 0.0:
            recommendations.append(
                ItemRecommendation(
                    category="discrimination",
                    severity="critical",
                    message="Negative discrimination - weak students outperform strong students",
                    action="REVISE IMMEDIATELY - check answer key and item wording"
                )
            )
        elif discrimination_index < 0.20:
            recommendations.append(
                ItemRecommendation(
                    category="discrimination",
                    severity="high",
                    message="Poor discrimination - item doesn't differentiate ability levels",
                    action="Revise distractors or clarify item stem"
                )
            )
        elif discrimination_index < 0.30:
            recommendations.append(
                ItemRecommendation(
                    category="discrimination",
                    severity="medium",
                    message="Fair discrimination - item could be improved",
                    action="Consider enhancing distractors"
                )
            )
        
        # Check distractors
        if distractor_analysis:
            if distractor_analysis.non_functional_distractors > 0:
                recommendations.append(
                    ItemRecommendation(
                        category="distractors",
                        severity="medium",
                        message=f"{distractor_analysis.non_functional_distractors} non-functional distractor(s) found",
                        action="Replace distractors selected by <5% of students"
                    )
                )
        
        # If everything is good
        if not recommendations:
            recommendations.append(
                ItemRecommendation(
                    category="quality",
                    severity="info",
                    message="Item is performing well",
                    action="No changes needed - keep as is"
                )
            )
        
        return recommendations
    
    async def get_exam_quality_summary(self, exam_id: str) -> Dict[str, Any]:
        """
        Get overall quality metrics for an exam
        
        Returns summary statistics for all items
        """
        try:
            analyses = await self.analyze_exam_items(exam_id)
            
            if not analyses:
                return {
                    "exam_id": exam_id,
                    "total_items": 0,
                    "message": "No items analyzed"
                }
            
            # Calculate summary statistics
            avg_facility = statistics.mean([a.facility_index for a in analyses])
            avg_discrimination = statistics.mean([a.discrimination_index for a in analyses])
            
            # Count items by difficulty
            difficulty_distribution = defaultdict(int)
            for a in analyses:
                difficulty_distribution[a.difficulty_level.value] += 1
            
            # Count items by discrimination
            discrimination_distribution = defaultdict(int)
            for a in analyses:
                discrimination_distribution[a.discrimination_level.value] += 1
            
            # Count items needing revision
            items_needing_revision = sum(
                1 for a in analyses
                if any(r.severity in ["critical", "high"] for r in a.recommendations)
            )
            
            return {
                "exam_id": exam_id,
                "total_items": len(analyses),
                "average_facility_index": round(avg_facility, 3),
                "average_discrimination_index": round(avg_discrimination, 3),
                "difficulty_distribution": dict(difficulty_distribution),
                "discrimination_distribution": dict(discrimination_distribution),
                "items_needing_revision": items_needing_revision,
                "quality_score": round(avg_discrimination * 100, 1),  # 0-100 scale
                "analyzed_at": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error generating quality summary: {e}")
            raise


# Global service instance
item_analysis_service = ItemAnalysisService()


async def get_item_analysis_service() -> ItemAnalysisService:
    """Get the item analysis service instance"""
    return item_analysis_service
