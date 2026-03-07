"""
🎓 Model Evaluator
Comprehensive evaluation of fine-tuned models
"""

import numpy as np
from typing import Dict, List, Any, Tuple
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix,
    roc_auc_score,
    roc_curve
)
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import logging
import json

logger = logging.getLogger(__name__)


class ModelEvaluator:
    """
    Evaluates trained models and generates performance reports
    """
    
    def __init__(self, output_dir: str = "./evaluation_results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def evaluate_risk_model(
        self,
        y_true: List[int],
        y_pred: List[int],
        y_probs: List[float],
        save_plots: bool = True
    ) -> Dict[str, Any]:
        """
        Comprehensive evaluation of risk detection model
        """
        logger.info("Evaluating risk detection model...")
        
        # Calculate metrics
        accuracy = accuracy_score(y_true, y_pred)
        precision, recall, f1, support = precision_recall_fscore_support(
            y_true, y_pred, average='binary'
        )
        auc_roc = roc_auc_score(y_true, y_probs)
        
        # Confusion matrix
        cm = confusion_matrix(y_true, y_pred)
        
        # Calculate specificity and sensitivity
        tn, fp, fn, tp = cm.ravel()
        specificity = tn / (tn + fp) if (tn + fp) > 0 else 0
        sensitivity = tp / (tp + fn) if (tp + fn) > 0 else 0
        
        results = {
            'accuracy': float(accuracy),
            'precision': float(precision),
            'recall': float(recall),
            'f1_score': float(f1),
            'auc_roc': float(auc_roc),
            'specificity': float(specificity),
            'sensitivity': float(sensitivity),
            'confusion_matrix': cm.tolist(),
            'support': support.tolist()
        }
        
        # Save metrics
        with open(self.output_dir / 'risk_model_metrics.json', 'w') as f:
            json.dump(results, f, indent=2)
        
        logger.info(f"Risk Model Evaluation Results:")
        logger.info(f"  Accuracy: {accuracy:.4f}")
        logger.info(f"  Precision: {precision:.4f}")
        logger.info(f"  Recall: {recall:.4f}")
        logger.info(f"  F1-Score: {f1:.4f}")
        logger.info(f"  AUC-ROC: {auc_roc:.4f}")
        
        if save_plots:
            self._plot_confusion_matrix(cm, ['Not At Risk', 'At Risk'], 'risk_confusion_matrix.png')
            self._plot_roc_curve(y_true, y_probs, 'risk_roc_curve.png')
        
        return results
    
    def _plot_confusion_matrix(
        self,
        cm: np.ndarray,
        class_names: List[str],
        filename: str
    ):
        """Plot confusion matrix"""
        plt.figure(figsize=(8, 6))
        sns.heatmap(
            cm,
            annot=True,
            fmt='d',
            cmap='Blues',
            xticklabels=class_names,
            yticklabels=class_names
        )
        plt.title('Confusion Matrix')
        plt.ylabel('True Label')
        plt.xlabel('Predicted Label')
        plt.tight_layout()
        plt.savefig(self.output_dir / filename, dpi=300, bbox_inches='tight')
        plt.close()
        logger.info(f"Saved confusion matrix to {filename}")
    
    def _plot_roc_curve(
        self,
        y_true: List[int],
        y_probs: List[float],
        filename: str
    ):
        """Plot ROC curve"""
        fpr, tpr, thresholds = roc_curve(y_true, y_probs)
        auc = roc_auc_score(y_true, y_probs)
        
        plt.figure(figsize=(8, 6))
        plt.plot(fpr, tpr, label=f'ROC Curve (AUC = {auc:.4f})', linewidth=2)
        plt.plot([0, 1], [0, 1], 'k--', label='Random Classifier')
        plt.xlabel('False Positive Rate')
        plt.ylabel('True Positive Rate')
        plt.title('ROC Curve - Risk Detection Model')
        plt.legend()
        plt.grid(alpha=0.3)
        plt.tight_layout()
        plt.savefig(self.output_dir / filename, dpi=300, bbox_inches='tight')
        plt.close()
        logger.info(f"Saved ROC curve to {filename}")
    
    def evaluate_feedback_quality(
        self,
        generated_feedback: List[str],
        reference_feedback: List[str]
    ) -> Dict[str, float]:
        """
        Evaluate feedback generation quality
        Uses simple metrics (in production, consider BLEU, ROUGE, BERTScore)
        """
        logger.info("Evaluating feedback generation quality...")
        
        # Simple length-based quality metrics
        avg_length_generated = np.mean([len(f.split()) for f in generated_feedback])
        avg_length_reference = np.mean([len(f.split()) for f in reference_feedback])
        
        # Check if key phrases are present
        key_phrases = ['strength', 'improve', 'recommend', 'practice', 'study']
        coverage_scores = []
        
        for feedback in generated_feedback:
            feedback_lower = feedback.lower()
            coverage = sum(1 for phrase in key_phrases if phrase in feedback_lower) / len(key_phrases)
            coverage_scores.append(coverage)
        
        results = {
            'avg_length_generated': float(avg_length_generated),
            'avg_length_reference': float(avg_length_reference),
            'avg_key_phrase_coverage': float(np.mean(coverage_scores)),
            'total_samples': len(generated_feedback)
        }
        
        # Save metrics
        with open(self.output_dir / 'feedback_quality_metrics.json', 'w') as f:
            json.dump(results, f, indent=2)
        
        logger.info(f"Feedback Quality Results:")
        logger.info(f"  Avg Length (Generated): {avg_length_generated:.1f} words")
        logger.info(f"  Avg Length (Reference): {avg_length_reference:.1f} words")
        logger.info(f"  Key Phrase Coverage: {np.mean(coverage_scores):.2%}")
        
        return results
    
    def generate_model_report(
        self,
        model_name: str,
        metrics: Dict[str, Any],
        training_time: float = None,
        dataset_size: int = None
    ):
        """Generate comprehensive model evaluation report"""
        report = f"""
# Model Evaluation Report: {model_name}
Generated: {Path(__file__).stem}

## Dataset Information
- Training Samples: {dataset_size or 'N/A'}
- Training Time: {training_time or 'N/A'} seconds

## Performance Metrics
"""
        for metric, value in metrics.items():
            if isinstance(value, (int, float)):
                report += f"- **{metric}**: {value:.4f}\n"
            else:
                report += f"- **{metric}**: {value}\n"
        
        report += f"""
## Model Configuration
- Base Model: {model_name}
- Fine-tuning Approach: Full model fine-tuning
- Optimization: AdamW with weight decay

## Recommendations
"""
        
        if 'accuracy' in metrics and metrics['accuracy'] < 0.80:
            report += "- ⚠️ Accuracy below 80%. Consider collecting more training data.\n"
        if 'f1_score' in metrics and metrics['f1_score'] < 0.75:
            report += "- ⚠️ F1-score below 75%. Model may need better class balancing.\n"
        
        # Save report
        with open(self.output_dir / f'{model_name}_report.md', 'w') as f:
            f.write(report)
        
        logger.info(f"Generated evaluation report for {model_name}")
