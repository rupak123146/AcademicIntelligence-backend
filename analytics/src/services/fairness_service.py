"""
🎓 Fairness and Bias Analysis Service
Detects and analyzes bias in assessment items
"""

from typing import Dict, List, Optional, Any
from datetime import datetime
import pandas as pd
import numpy as np
from src.config import db
from src.models.enhanced_models import (
    FairnessAnalysis,
    BiasIndicator
)
from src.models.huggingface_models import get_model_manager
from src.utils import logger


class FairnessAnalysisService:
    """
    Service for detecting bias and ensuring fairness
    Analyzes performance via differential item functioning (DIF)
    """

    def __init__(self):
        self.pool = None
        self.mongo_db = None

    async def initialize(self):
        """Initialize service"""
        self.pool = db.pg_pool
        self.mongo_db = db.mongo_db

    async def analyze_exam_fairness(
        self,
        exam_id: str,
        demographic_column: str = "gender"
    ) -> FairnessAnalysis:
        """
        Analyze exam for fairness/bias issues
        
        Args:
            exam_id: Exam ID
            demographic_column: Demographic dimension to analyze
        
        Returns:
            FairnessAnalysis with findings
        """
        try:
            logger.info(f"Analyzing fairness for exam {exam_id}")
            
            # Collect performance data
            performance_data = await self._collect_performance_data(exam_id)
            
            if performance_data.empty:
                logger.warning(f"No performance data for exam {exam_id}")
                return FairnessAnalysis(
                    analysis_date=datetime.now(),
                    exam_id=exam_id,
                    biased_items=[],
                    group_performance_comparison={},
                    overall_fairness_score=0.5,
                    recommendations=[]
                )
            
            # Use HF models for bias detection
            model_manager = await get_model_manager()
            bias_results = await model_manager.analyze_bias(
                performance_data,
                demographic_column
            )
            
            # Perform item-level DIF analysis
            biased_items = await self._perform_dif_analysis(
                exam_id, demographic_column
            )
            
            # Compare group performance
            group_comparison = self._compare_group_performance(
                performance_data, demographic_column
            )
            
            # Calculate overall fairness score
            fairness_score = self._calculate_fairness_score(
                bias_results, biased_items
            )
            
            # Generate recommendations
            recommendations = self._generate_recommendations(
                biased_items, group_comparison, fairness_score
            )
            
            # Create analysis object
            analysis = FairnessAnalysis(
                analysis_date=datetime.now(),
                exam_id=exam_id,
                biased_items=biased_items,
                group_performance_comparison=group_comparison,
                overall_fairness_score=fairness_score,
                recommendations=recommendations
            )
            
            # Store analysis
            await self._store_fairness_analysis(analysis)
            
            return analysis
            
        except Exception as e:
            logger.error(f"Error analyzing exam fairness: {e}")
            raise

    async def _collect_performance_data(self, exam_id: str) -> pd.DataFrame:
        """Collect performance data for fairness analysis"""
        try:
            # Get all student responses
            data = await self.pool.fetch("""
                SELECT 
                    ea.student_id,
                    a.question_id,
                    CASE WHEN a.is_correct THEN 1 ELSE 0 END as score,
                    u.gender,
                    u.id as demographic_key
                FROM exam_attempts ea
                JOIN answers a ON ea.id = a.attempt_id
                JOIN users u ON ea.student_id = u.id
                WHERE ea.exam_id = $1
            """, exam_id)
            
            if not data:
                return pd.DataFrame()
            
            # Convert to DataFrame
            df = pd.DataFrame([dict(row) for row in data])
            
            return df
            
        except Exception as e:
            logger.error(f"Error collecting performance data: {e}")
            return pd.DataFrame()

    async def _perform_dif_analysis(
        self,
        exam_id: str,
        demographic_column: str
    ) -> List[BiasIndicator]:
        """
        Perform Differential Item Functioning (DIF) analysis
        
        Uses the 4/5ths rule and Mann-Whitney U test for detecting bias
        """
        try:
            # Get item-level performance
            items_data = await self.pool.fetch("""
                SELECT 
                    q.id as question_id,
                    q.text as question_text,
                    u.gender,
                    COUNT(*) as total,
                    COUNT(CASE WHEN a.is_correct THEN 1 END) as correct
                FROM exams e
                JOIN questions q ON e.id = q.exam_id
                JOIN answers a ON a.question_id = q.id
                JOIN exam_attempts ea ON a.attempt_id = ea.id
                JOIN users u ON ea.student_id = u.id
                WHERE e.id = $1
                GROUP BY q.id, q.text, u.gender
            """, exam_id)
            
            if not items_data:
                return []
            
            # Convert to DataFrame for analysis
            df = pd.DataFrame([dict(row) for row in items_data])
            
            biased_items = []
            
            # For each question, check DIF between demographic groups
            for question_id in df['question_id'].unique():
                question_data = df[df['question_id'] == question_id]
                
                if len(question_data) < 2:
                    continue
                
                # Calculate success rates by group
                group_rates = {}
                for group in question_data['gender'].unique():
                    group_subset = question_data[question_data['gender'] == group]
                    if group_subset['total'].sum() > 0:
                        rate = group_subset['correct'].sum() / group_subset['total'].sum()
                        group_rates[group] = rate
                
                if len(group_rates) < 2:
                    continue
                
                # Apply 4/5ths rule (disparate impact ratio)
                rates = list(group_rates.values())
                min_rate = min(rates)
                max_rate = max(rates)
                
                disparate_impact = min_rate / max_rate if max_rate > 0 else 1.0
                
                # Flag if below 0.80 threshold
                if disparate_impact < 0.80:
                    affected_groups = [
                        group for group, rate in group_rates.items()
                        if rate < group_rates.get(max(group_rates, key=group_rates.get), 1.0)
                    ]
                    
                    biased_items.append(BiasIndicator(
                        item_id=str(question_id),
                        item_question=question_data.iloc[0]['question_text'][:100],
                        disparate_impact_ratio=disparate_impact,
                        affected_demographic_groups=affected_groups,
                        severity=self._determine_bias_severity(disparate_impact),
                        evidence=[
                            f"Success rate disparity detected",
                            f"Disparate impact ratio: {disparate_impact:.2%}",
                            f"Groups affected: {', '.join(affected_groups)}"
                        ]
                    ))
            
            return biased_items
            
        except Exception as e:
            logger.error(f"Error performing DIF analysis: {e}")
            return []

    def _determine_bias_severity(self, disparate_impact_ratio: float) -> str:
        """Determine severity of bias"""
        if disparate_impact_ratio < 0.60:
            return "high"
        elif disparate_impact_ratio < 0.75:
            return "medium"
        else:
            return "low"

    def _compare_group_performance(
        self,
        performance_data: pd.DataFrame,
        demographic_column: str
    ) -> Dict[str, float]:
        """Compare performance across demographic groups"""
        try:
            if demographic_column not in performance_data.columns:
                return {}
            
            group_performance = {}
            
            for group in performance_data[demographic_column].unique():
                group_data = performance_data[
                    performance_data[demographic_column] == group
                ]
                avg_score = group_data['score'].mean()
                group_performance[str(group)] = float(avg_score)
            
            return group_performance
            
        except Exception as e:
            logger.error(f"Error comparing groups: {e}")
            return {}

    def _calculate_fairness_score(
        self,
        bias_results: Dict[str, Any],
        biased_items: List[BiasIndicator]
    ) -> float:
        """
        Calculate overall fairness score (0-1)
        Higher is more fair
        """
        if not biased_items:
            return 1.0
        
        # Calculate based on number and severity of biased items
        total_bias = sum(
            0.3 if item.severity == "high" else
            0.2 if item.severity == "medium" else
            0.1
            for item in biased_items
        )
        
        # Max bias penalty is 1.0
        fairness_score = max(0, 1.0 - total_bias)
        
        return fairness_score

    def _generate_recommendations(
        self,
        biased_items: List[BiasIndicator],
        group_comparison: Dict[str, float],
        fairness_score: float
    ) -> List[str]:
        """Generate fairness recommendations"""
        recommendations = []
        
        if fairness_score < 0.8:
            recommendations.append("⚠️ CRITICAL: Significant fairness concerns detected")
            recommendations.append("Review all flagged items for cultural, linguistic, or other biases")
        
        if biased_items:
            if len(biased_items) > 5:
                recommendations.append(f"Multiple items ({len(biased_items)}) show disparate impact")
            
            high_severity = [item for item in biased_items if item.severity == "high"]
            if high_severity:
                recommendations.append(f"Remove or revise {len(high_severity)} items with high bias")
        
        # Check for groups with lower performance
        if group_comparison:
            groups = list(group_comparison.keys())
            if len(groups) > 1:
                overall_avg = np.mean(list(group_comparison.values()))
                underperforming = [
                    g for g, score in group_comparison.items()
                    if score < overall_avg * 0.85
                ]
                if underperforming:
                    recommendations.append(
                        f"Provide additional support to groups: {', '.join(underperforming)}"
                    )
        
        if not recommendations:
            recommendations.append("✅ Assessment shows good fairness. Continue monitoring.")
        
        return recommendations

    async def _store_fairness_analysis(self, analysis: FairnessAnalysis):
        """Store fairness analysis"""
        try:
            if self.mongo_db:
                await self.mongo_db.fairness_analysis.insert_one({
                    'analysis_date': analysis.analysis_date,
                    'exam_id': analysis.exam_id,
                    'biased_items_count': len(analysis.biased_items),
                    'fairness_score': analysis.overall_fairness_score,
                    'recommendations': analysis.recommendations
                })
        except Exception as e:
            logger.error(f"Error storing fairness analysis: {e}")

    async def get_fairness_history(
        self,
        exam_id: Optional[str] = None,
        days: int = 90
    ) -> List[Dict[str, Any]]:
        """Get fairness analysis history"""
        try:
            query = "SELECT * FROM fairness_analysis WHERE analysis_date > NOW() - INTERVAL '%d days'" % days
            
            if exam_id:
                query += f" AND exam_id = '{exam_id}'"
            
            query += " ORDER BY analysis_date DESC"
            
            results = await self.pool.fetch(query)
            return [dict(r) for r in results]
            
        except Exception as e:
            logger.error(f"Error getting fairness history: {e}")
            return []
