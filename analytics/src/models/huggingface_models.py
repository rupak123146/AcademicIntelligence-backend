"""
🎓 Hugging Face Model Integration
Integrates HF models for ML-powered analytics features
"""

import torch
import numpy as np
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from enum import Enum
import asyncio
from functools import lru_cache
import logging

from transformers import (
    pipeline,
    AutoTokenizer,
    AutoModelForSequenceClassification,
    AutoModelForCausalLM,
    AutoModelForTableQuestionAnswering,
)
from sentence_transformers import SentenceTransformer, CrossEncoder
from sklearn.preprocessing import StandardScaler
import pandas as pd

logger = logging.getLogger(__name__)


class ModelType(Enum):
    """Available model types"""
    RISK_DETECTION = "risk_detection"
    FEEDBACK_GENERATION = "feedback_generation"
    RESOURCE_RECOMMENDATION = "resource_recommendation"
    ANOMALY_DETECTION = "anomaly_detection"
    BIAS_DETECTION = "bias_detection"
    SENTIMENT_ANALYSIS = "sentiment_analysis"


@dataclass
class RiskPrediction:
    """Risk detection result"""
    student_id: str
    risk_score: float  # 0-1
    risk_level: str  # "low", "medium", "high", "critical"
    contributing_factors: List[str]
    recommended_interventions: List[str]
    confidence: float


@dataclass
class GeneratedFeedback:
    """Generated feedback result"""
    strengths: List[str]
    improvements: List[str]
    recommendations: List[str]
    resources: List[Dict[str, Any]]
    overall_message: str


@dataclass
class AnomalyIndicator:
    """Anomaly detection result"""
    student_id: str
    exam_id: str
    anomaly_type: str  # "timing", "patterns", "behavior"
    anomaly_score: float  # 0-1
    indicators: List[str]
    severity: str  # "low", "medium", "high"


class HuggingFaceModelManager:
    """
    Manages Hugging Face models for the analytics platform.
    Handles model loading, caching, and inference.
    """

    def __init__(self, use_finetuned: bool = True):
        self.models = {}
        self.tokenizers = {}
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.use_finetuned = use_finetuned
        logger.info(f"Using device: {self.device}")
        logger.info(f"Fine-tuned models: {'ENABLED' if use_finetuned else 'DISABLED'}")
        
        # Model configurations
        # If fine-tuned models exist, use them; otherwise fall back to pre-trained
        from pathlib import Path
        base_path = Path(__file__).parent.parent.parent / "models"
        
        self.model_configs = {
            ModelType.RISK_DETECTION: {
                "model_id": str(base_path / "risk_detection_finetuned" / "best_model") 
                    if use_finetuned and (base_path / "risk_detection_finetuned" / "best_model").exists()
                    else "distilbert-base-uncased-finetuned-sst-2-english",
                "task": "text-classification",
                "description": "Risk detection classifier (fine-tuned on academic data)" 
                    if use_finetuned else "Risk detection classifier (pre-trained)"
            },
            ModelType.FEEDBACK_GENERATION: {
                "model_id": str(base_path / "feedback_generation_finetuned" / "best_model")
                    if use_finetuned and (base_path / "feedback_generation_finetuned" / "best_model").exists()
                    else "google/flan-t5-base",
                "task": "text2text-generation",
                "description": "Feedback generation model (fine-tuned on educational feedback)"
                    if use_finetuned else "Feedback generation model (pre-trained)"
            },
            ModelType.RESOURCE_RECOMMENDATION: {
                "model_id": "sentence-transformers/all-MiniLM-L6-v2",
                "task": "feature-extraction",
                "description": "Semantic resource matcher"
            },
            ModelType.SENTIMENT_ANALYSIS: {
                "model_id": "distilbert-base-uncased-finetuned-sst-2-english",
                "task": "text-classification",
                "description": "Sentiment analyzer"
            },
        }
        
        # Log which models are being used
        for model_type, config in self.model_configs.items():
            logger.info(f"{model_type.value}: {config['model_id']}")

    async def initialize(self):
        """Initialize models asynchronously"""
        logger.info("Initializing Hugging Face models...")
        try:
            # Load models in separate threads to avoid blocking
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                self._load_models_sync
            )
            logger.info("✅ All models loaded successfully")
        except Exception as e:
            logger.error(f"❌ Error initializing models: {e}")
            raise

    def _load_models_sync(self):
        """Synchronous model loading with graceful fallback."""
        loaded = 0
        total = 4

        try:
            # Risk detection pipeline
            logger.info("Loading risk detection model...")
            risk_model_id = self.model_configs[ModelType.RISK_DETECTION]["model_id"]
            self.models[ModelType.RISK_DETECTION] = pipeline(
                "text-classification",
                model=risk_model_id,
                device=0 if self.device == "cuda" else -1
            )
            loaded += 1
            logger.info(f"Loaded: {risk_model_id}")
        except Exception as e:
            logger.warning(f"Risk detection model failed to load (metrics-based fallback active): {e}")

        try:
            # Feedback generation pipeline
            logger.info("Loading feedback generation model...")
            feedback_model_id = self.model_configs[ModelType.FEEDBACK_GENERATION]["model_id"]
            self.models[ModelType.FEEDBACK_GENERATION] = pipeline(
                "text2text-generation",
                model=feedback_model_id,
                device=0 if self.device == "cuda" else -1
            )
            loaded += 1
            logger.info(f"Loaded: {feedback_model_id}")
        except Exception as e:
            logger.warning(f"Feedback generation model failed to load (rule-based fallback active): {e}")

        try:
            # Resource recommendation model
            logger.info("Loading resource recommendation model...")
            self.models[ModelType.RESOURCE_RECOMMENDATION] = SentenceTransformer(
                'sentence-transformers/all-MiniLM-L6-v2',
                device=self.device
            )
            loaded += 1
            logger.info("Loaded: sentence-transformers/all-MiniLM-L6-v2")
        except Exception as e:
            logger.warning(f"Resource recommendation model failed to load: {e}")

        try:
            # Sentiment analysis
            logger.info("Loading sentiment analyzer...")
            self.models[ModelType.SENTIMENT_ANALYSIS] = pipeline(
                "text-classification",
                model="distilbert-base-uncased-finetuned-sst-2-english",
                device=0 if self.device == "cuda" else -1
            )
            loaded += 1
            logger.info("Loaded: distilbert-base-uncased-finetuned-sst-2-english")
        except Exception as e:
            logger.warning(f"Sentiment analysis model failed to load: {e}")

        logger.info(f"Models loaded: {loaded}/{total} (fallbacks active for missing models)")

    async def predict_at_risk(
        self,
        student_performance_text: str,
        performance_metrics: Dict[str, float]
    ) -> RiskPrediction:
        """
        Predict if student is at risk using HF classifier
        
        Args:
            student_performance_text: Descriptive text of student performance
            performance_metrics: Dict with scores, attempts, trends
        
        Returns:
            RiskPrediction with risk score and factors
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._predict_at_risk_sync,
                student_performance_text,
                performance_metrics
            )
            return result
        except Exception as e:
            logger.error(f"Error in at-risk prediction: {e}")
            raise

    def _predict_at_risk_sync(
        self,
        text: str,
        metrics: Dict[str, float]
    ) -> RiskPrediction:
        """Synchronous at-risk prediction using metrics-driven scoring."""
        try:
            # Primary: calculate risk score from academic metrics (reliable)
            risk_factors = []
            metric_score = 0.0
            weight_sum = 0.0

            avg_score = metrics.get("avg_score", None)
            if avg_score is not None:
                weight_sum += 0.35
                if avg_score < 30:
                    metric_score += 0.35
                    risk_factors.append(f"Very low average score ({avg_score:.0f}%)")
                elif avg_score < 50:
                    metric_score += 0.25
                    risk_factors.append(f"Low average score ({avg_score:.0f}%)")
                elif avg_score < 65:
                    metric_score += 0.12
                    risk_factors.append(f"Below-average score ({avg_score:.0f}%)")

            trend = metrics.get("recent_trend", None)
            if trend is not None:
                weight_sum += 0.25
                if trend < -15:
                    metric_score += 0.25
                    risk_factors.append(f"Sharp performance decline (trend {trend:+.1f})")
                elif trend < -5:
                    metric_score += 0.15
                    risk_factors.append(f"Declining performance (trend {trend:+.1f})")

            fail_rate = metrics.get("fail_rate", None)
            if fail_rate is not None:
                weight_sum += 0.20
                if fail_rate > 0.6:
                    metric_score += 0.20
                    risk_factors.append(f"High failure rate ({fail_rate*100:.0f}%)")
                elif fail_rate > 0.4:
                    metric_score += 0.12
                    risk_factors.append(f"Moderate failure rate ({fail_rate*100:.0f}%)")

            engagement = metrics.get("time_spent", None)
            if engagement is not None:
                weight_sum += 0.10
                if engagement < 10:
                    metric_score += 0.10
                    risk_factors.append("Minimal effort/engagement")

            attendance = metrics.get("attendance_rate", None)
            if attendance is not None:
                weight_sum += 0.10
                if attendance < 60:
                    metric_score += 0.10
                    risk_factors.append(f"Very low attendance ({attendance:.0f}%)")
                elif attendance < 75:
                    metric_score += 0.05
                    risk_factors.append(f"Low attendance ({attendance:.0f}%)")

            # Normalize score based on available metrics
            risk_score = metric_score / max(weight_sum, 0.01) if weight_sum > 0 else 0.3

            # Secondary: use NLP model as supplementary signal (small weight)
            try:
                classifier = self.models.get(ModelType.RISK_DETECTION)
                if classifier:
                    prediction = classifier(text[:512], top_k=2)
                    confidence = prediction[0]["score"]
                    risk_label = prediction[0]["label"]
                    nlp_signal = confidence if risk_label == "NEGATIVE" else (1 - confidence)
                    # NLP contributes at most 15% to final score
                    risk_score = risk_score * 0.85 + nlp_signal * 0.15
            except Exception as nlp_err:
                logger.debug(f"NLP risk signal skipped: {nlp_err}")

            risk_score = max(0.0, min(risk_score, 1.0))
            confidence = risk_score
            
            # Determine risk level
            if risk_score >= 0.8:
                risk_level = "critical"
                interventions = [
                    "Immediate one-on-one counseling",
                    "Increased monitoring and support",
                    "Family/guardian notification",
                    "Peer tutoring assignment"
                ]
            elif risk_score >= 0.6:
                risk_level = "high"
                interventions = [
                    "Scheduled support sessions",
                    "Regular progress monitoring",
                    "Additional study materials",
                    "Targeted practice problems"
                ]
            elif risk_score >= 0.4:
                risk_level = "medium"
                interventions = [
                    "General support availability",
                    "Study group recommendations",
                    "Resource links",
                    "Feedback on improvement areas"
                ]
            else:
                risk_level = "low"
                interventions = [
                    "Continue current approach",
                    "Optional enrichment opportunities",
                    "Peer mentoring opportunities"
                ]
                
            return RiskPrediction(
                student_id="",  # Set by caller
                risk_score=float(risk_score),
                risk_level=risk_level,
                contributing_factors=risk_factors,
                recommended_interventions=interventions,
                confidence=float(confidence)
            )
        except Exception as e:
            logger.error(f"Error in at-risk sync prediction: {e}")
            raise

    async def generate_feedback(
        self,
        student_context: str,
        performance_summary: str
    ) -> GeneratedFeedback:
        """
        Generate personalized feedback using T5 model
        
        Args:
            student_context: Context about student's background
            performance_summary: Summary of performance data
        
        Returns:
            GeneratedFeedback with strengths, improvements, recommendations
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._generate_feedback_sync,
                student_context,
                performance_summary
            )
            return result
        except Exception as e:
            logger.error(f"Error generating feedback: {e}")
            raise

    def _generate_feedback_sync(
        self,
        context: str,
        summary: str
    ) -> GeneratedFeedback:
        """Synchronous feedback generation with education-specific prompting."""
        try:
            generator = self.models.get(ModelType.FEEDBACK_GENERATION)
            if not generator:
                return self._fallback_feedback(context, summary)

            # Education-focused prompt for strengths
            prompt_strengths = (
                "You are an academic advisor. Based on the student performance data below, "
                "identify exactly 3 academic strengths this student demonstrates. "
                "Be specific and encouraging.\n\n"
                f"Student Profile: {context}\n"
                f"Performance Data: {summary}\n\n"
                "List 3 strengths (one per line):"
            )
            strengths_response = generator(prompt_strengths, max_length=150, num_beams=2)[0]["generated_text"]
            strengths = [s.strip().lstrip("0123456789.-) ") for s in strengths_response.split("\n") if s.strip()][:3]
            if not strengths:
                strengths = [strengths_response.strip()]

            # Education-focused prompt for improvements
            prompt_improvements = (
                "You are an academic advisor. Based on the student performance data below, "
                "identify exactly 3 specific areas where this student needs improvement. "
                "Be constructive and actionable.\n\n"
                f"Student Profile: {context}\n"
                f"Performance Data: {summary}\n\n"
                "List 3 areas to improve (one per line):"
            )
            improvements_response = generator(prompt_improvements, max_length=150, num_beams=2)[0]["generated_text"]
            improvements = [i.strip().lstrip("0123456789.-) ") for i in improvements_response.split("\n") if i.strip()][:3]
            if not improvements:
                improvements = [improvements_response.strip()]

            # Education-focused prompt for recommendations
            prompt_recommendations = (
                "You are an academic advisor. Based on the student performance data below, "
                "provide exactly 3 specific, actionable study recommendations. "
                "Include concrete steps the student can take.\n\n"
                f"Student Profile: {context}\n"
                f"Performance Data: {summary}\n\n"
                "Suggest 3 study actions (one per line):"
            )
            recommendations_response = generator(prompt_recommendations, max_length=180, num_beams=2)[0]["generated_text"]
            recommendations = [r.strip().lstrip("0123456789.-) ") for r in recommendations_response.split("\n") if r.strip()][:3]
            if not recommendations:
                recommendations = [recommendations_response.strip()]

            # Overall encouraging summary
            prompt_overall = (
                "You are a supportive academic advisor. Write a brief 2-sentence encouraging "
                "summary for a student.\n\n"
                f"Performance: {summary}\n\n"
                "Encouraging summary:"
            )
            overall_response = generator(prompt_overall, max_length=100, num_beams=2)[0]["generated_text"]

            return GeneratedFeedback(
                strengths=strengths,
                improvements=improvements,
                recommendations=recommendations,
                resources=[],
                overall_message=overall_response.strip()
            )
        except Exception as e:
            logger.error(f"Error in feedback sync generation: {e}")
            return self._fallback_feedback(context, summary)

    def _fallback_feedback(
        self,
        context: str,
        summary: str
    ) -> GeneratedFeedback:
        """Rule-based fallback when ML model is unavailable."""
        # Parse basic metrics from summary text
        import re
        avg_match = re.search(r'Average[:\s]+(\d+\.?\d*)%', summary, re.IGNORECASE)
        avg_score = float(avg_match.group(1)) if avg_match else 50.0

        if avg_score >= 80:
            strengths = [
                "Strong overall academic performance across subjects",
                "Consistent high scores demonstrating solid understanding",
                "Good time management and exam completion"
            ]
            improvements = [
                "Challenge yourself with advanced-level questions",
                "Explore topics beyond the syllabus for deeper understanding",
                "Help peers to reinforce your own knowledge"
            ]
            overall = "Excellent work! Your consistent performance shows strong mastery. Keep challenging yourself to reach even greater heights."
        elif avg_score >= 60:
            strengths = [
                "Solid foundational understanding of core concepts",
                "Consistent effort and engagement with coursework",
                "Good grasp of fundamental topics"
            ]
            improvements = [
                "Focus on weak chapters with targeted practice",
                "Review mistakes from previous exams to identify patterns",
                "Allocate more time to difficult question types"
            ]
            overall = "You have a good foundation to build on. With focused practice on weaker areas, you can significantly improve your scores."
        else:
            strengths = [
                "Willingness to attempt exams shows commitment",
                "Room for significant growth with the right approach",
                "Every attempt is a learning opportunity"
            ]
            improvements = [
                "Start with basic concepts and build understanding step by step",
                "Create a structured study schedule covering all chapters",
                "Seek help from educators on topics you find most challenging"
            ]
            overall = "Don't be discouraged by current scores. With a structured study plan and consistent effort, you can make significant progress."

        recommendations = [
            "Set specific weekly study goals and track your progress",
            "Practice with past exam questions to build confidence",
            "Review incorrect answers to understand your mistake patterns"
        ]

        return GeneratedFeedback(
            strengths=strengths,
            improvements=improvements,
            recommendations=recommendations,
            resources=[],
            overall_message=overall
        )

    async def recommend_resources(
        self,
        learning_need: str,
        available_resources: List[Dict[str, str]],
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Recommend resources using semantic similarity
        
        Args:
            learning_need: Description of learning need
            available_resources: List of resources with title, description, url
            top_k: Number of recommendations
        
        Returns:
            List of recommended resources with scores
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._recommend_resources_sync,
                learning_need,
                available_resources,
                top_k
            )
            return result
        except Exception as e:
            logger.error(f"Error recommending resources: {e}")
            raise

    def _recommend_resources_sync(
        self,
        need: str,
        resources: List[Dict[str, str]],
        top_k: int
    ) -> List[Dict[str, Any]]:
        """Synchronous resource recommendation"""
        try:
            model = self.models[ModelType.RESOURCE_RECOMMENDATION]
            
            # Encode learning need
            need_embedding = model.encode(need)
            
            # Encode resource descriptions
            resource_texts = [
                f"{r.get('title', '')} {r.get('description', '')}"
                for r in resources
            ]
            resource_embeddings = model.encode(resource_texts)
            
            # Calculate similarities
            similarities = np.dot(resource_embeddings, need_embedding) / (
                np.linalg.norm(resource_embeddings, axis=1) * np.linalg.norm(need_embedding) + 1e-10
            )
            
            # Get top-k resources
            top_indices = np.argsort(similarities)[::-1][:top_k]
            
            recommended = []
            for idx in top_indices:
                if similarities[idx] > 0.3:  # Relevance threshold
                    resource = resources[idx].copy()
                    resource["relevance_score"] = float(similarities[idx])
                    recommended.append(resource)
            
            return recommended
        except Exception as e:
            logger.error(f"Error in resource sync recommendation: {e}")
            raise

    async def detect_anomalies(
        self,
        exam_activities: List[Dict[str, Any]]
    ) -> List[AnomalyIndicator]:
        """
        Detect anomalous behavior during exams
        
        Args:
            exam_activities: List of student exam activities
        
        Returns:
            List of detected anomalies
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._detect_anomalies_sync,
                exam_activities
            )
            return result
        except Exception as e:
            logger.error(f"Error detecting anomalies: {e}")
            raise

    def _detect_anomalies_sync(
        self,
        activities: List[Dict[str, Any]]
    ) -> List[AnomalyIndicator]:
        """Synchronous anomaly detection"""
        anomalies = []
        
        try:
            # Convert to DataFrame for analysis
            df = pd.DataFrame(activities)
            
            # Timing anomalies
            if "time_spent" in df.columns and "average_time" in df.columns:
                # Find students with unusual time patterns
                time_std = df["time_spent"].std()
                time_mean = df["time_spent"].mean()
                
                unusual_time = df[
                    (df["time_spent"] < time_mean - 2*time_std) |
                    (df["time_spent"] > time_mean + 2*time_std)
                ]
                
                for idx, row in unusual_time.iterrows():
                    anomaly_type = "too_fast" if row["time_spent"] < time_mean - 2*time_std else "too_slow"
                    anomalies.append(AnomalyIndicator(
                        student_id=str(row.get("student_id", "")),
                        exam_id=str(row.get("exam_id", "")),
                        anomaly_type="timing",
                        anomaly_score=0.65,
                        indicators=[f"Unusual spending time ({anomaly_type})"],
                        severity="medium"
                    ))
            
            # Pattern anomalies (too many tab switches, rapid answers)
            if "tab_switches" in df.columns:
                tab_std = df["tab_switches"].std()
                tab_mean = df["tab_switches"].mean()
                
                unusual_tabs = df[df["tab_switches"] > tab_mean + 2*tab_std]
                for idx, row in unusual_tabs.iterrows():
                    anomalies.append(AnomalyIndicator(
                        student_id=str(row.get("student_id", "")),
                        exam_id=str(row.get("exam_id", "")),
                        anomaly_type="patterns",
                        anomaly_score=0.70,
                        indicators=["Excessive tab switching - possible unauthorized access"],
                        severity="high"
                    ))
            
            return anomalies
        except Exception as e:
            logger.error(f"Error in anomaly sync detection: {e}")
            return []

    async def analyze_bias(
        self,
        item_performance: pd.DataFrame,
        group_column: str = "demographic_group"
    ) -> Dict[str, Any]:
        """
        Analyze for bias/fairness issues using performance patterns
        
        Args:
            item_performance: DataFrame with item scores by group
            group_column: Column name for demographic groups
        
        Returns:
            Fairness analysis results
        """
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._analyze_bias_sync,
                item_performance,
                group_column
            )
            return result
        except Exception as e:
            logger.error(f"Error analyzing bias: {e}")
            raise

    def _analyze_bias_sync(
        self,
        item_perf: pd.DataFrame,
        group_col: str
    ) -> Dict[str, Any]:
        """Synchronous bias analysis"""
        try:
            if group_col not in item_perf.columns:
                return {"bias_detected": False, "message": "Insufficient data for bias analysis"}
            
            # Calculate performance by group
            group_stats = item_perf.groupby(group_col).agg({
                "score": ["mean", "std", "count"]
            })
            
            # Detect disparate impact (4/5 rule)
            means = item_perf.groupby(group_col)["score"].mean()
            min_mean = means.min()
            max_mean = means.max()
            
            disparate_impact_ratio = min_mean / max_mean if max_mean > 0 else 1.0
            
            biased_items = []
            if disparate_impact_ratio < 0.80:
                biased_items = [
                    {
                        "item": "Overall performance",
                        "disparate_impact_ratio": float(disparate_impact_ratio),
                        "affected_groups": [
                            str(g) for g in means.index[means < means.mean()]
                        ]
                    }
                ]
            
            return {
                "bias_detected": len(biased_items) > 0,
                "disparate_impact_ratio": float(disparate_impact_ratio),
                "biased_items": biased_items,
                "recommendations": [
                    "Review flagged items for cultural bias",
                    "Consider item bank revision",
                    "Provide additional support to disadvantaged groups"
                ] if len(biased_items) > 0 else []
            }
        except Exception as e:
            logger.error(f"Error in bias sync analysis: {e}")
            return {}

    async def analyze_sentiment(self, text: str) -> Dict[str, Any]:
        """Generic sentiment analysis"""
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self._analyze_sentiment_sync,
                text
            )
            return result
        except Exception as e:
            logger.error(f"Error in sentiment analysis: {e}")
            raise

    def _analyze_sentiment_sync(self, text: str) -> Dict[str, Any]:
        """Synchronous sentiment analysis"""
        try:
            classifier = self.models[ModelType.SENTIMENT_ANALYSIS]
            result = classifier(text)
            return {
                "label": result[0]["label"],
                "score": float(result[0]["score"])
            }
        except Exception as e:
            logger.error(f"Error in sentiment sync analysis: {e}")
            return {"label": "NEUTRAL", "score": 0.5}


# =====================================================
# Global model manager singleton
# =====================================================

_model_manager: Optional[HuggingFaceModelManager] = None


async def get_model_manager(
    use_finetuned: bool = True
) -> HuggingFaceModelManager:
    """Get or create global model manager."""
    global _model_manager
    if _model_manager is None:
        _model_manager = HuggingFaceModelManager(use_finetuned=use_finetuned)
        await _model_manager.initialize()
    return _model_manager


def get_model_manager_sync() -> Optional[HuggingFaceModelManager]:
    """Get model manager synchronously (must initialize first)."""
    return _model_manager
