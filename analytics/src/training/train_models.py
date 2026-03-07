"""
🎓 Main Training Script
Orchestrates the complete training pipeline for all models
"""

import asyncio
import logging
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.training.data_collector import TrainingDataCollector
from src.training.risk_trainer import RiskDetectionTrainer
from src.training.feedback_trainer import FeedbackGenerationTrainer
from src.training.model_evaluator import ModelEvaluator
from src.config.database import DatabaseConfig

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def train_risk_detection_model():
    """
    Train risk detection model with academic data
    """
    logger.info("=" * 60)
    logger.info("TRAINING RISK DETECTION MODEL")
    logger.info("=" * 60)
    
    # Initialize data collector
    collector = TrainingDataCollector()
    await collector.initialize()
    
    # Collect training data
    logger.info("Collecting training data from database...")
    texts, labels = await collector.collect_risk_detection_data(
        min_samples=1000,
        time_window_days=180
    )
    
    if len(texts) < 100:
        logger.warning(f"Only {len(texts)} samples available. Recommend at least 1000 samples.")
        logger.info("Consider using synthetic data augmentation or waiting for more production data.")
        return None
    
    # Initialize trainer
    trainer = RiskDetectionTrainer(
        base_model="distilbert-base-uncased",
        output_dir="./models/risk_detection_finetuned"
    )
    
    # Prepare datasets
    train_dataset, val_dataset, test_dataset = trainer.prepare_data(
        texts, labels, test_size=0.2, val_size=0.1
    )
    
    # Train model
    training_metrics = trainer.train(
        train_dataset,
        val_dataset,
        num_epochs=3,
        batch_size=16,
        learning_rate=2e-5
    )
    
    # Evaluate on test set
    test_metrics = trainer.evaluate(test_dataset)
    
    # Generate predictions for evaluation
    test_texts = [texts[i] for i in range(len(texts)) if i % 5 == 0]  # Sample for speed
    test_labels = [labels[i] for i in range(len(labels)) if i % 5 == 0]
    predictions, probabilities = trainer.predict(test_texts)
    
    # Evaluate with detailed metrics
    evaluator = ModelEvaluator(output_dir="./evaluation_results/risk_detection")
    eval_results = evaluator.evaluate_risk_model(
        test_labels,
        predictions,
        probabilities,
        save_plots=True
    )
    
    evaluator.generate_model_report(
        "risk_detection",
        eval_results,
        dataset_size=len(texts)
    )
    
    logger.info("✅ Risk detection model training completed!")
    return trainer


async def train_feedback_generation_model():
    """
    Train feedback generation model with academic data
    """
    logger.info("=" * 60)
    logger.info("TRAINING FEEDBACK GENERATION MODEL")
    logger.info("=" * 60)
    
    # Initialize data collector
    collector = TrainingDataCollector()
    await collector.initialize()
    
    # Collect training data
    logger.info("Collecting feedback data from database...")
    inputs, outputs = await collector.collect_feedback_data(min_samples=500)
    
    if len(inputs) < 50:
        logger.warning(f"Only {len(inputs)} samples available. Recommend at least 500 samples.")
        return None
    
    # Initialize trainer
    trainer = FeedbackGenerationTrainer(
        base_model="google/flan-t5-base",
        output_dir="./models/feedback_generation_finetuned"
    )
    
    # Prepare datasets
    train_dataset, val_dataset, test_dataset = trainer.prepare_data(
        inputs, outputs, test_size=0.2, val_size=0.1
    )
    
    # Train model
    training_metrics = trainer.train(
        train_dataset,
        val_dataset,
        num_epochs=3,
        batch_size=8,
        learning_rate=5e-5
    )
    
    logger.info("✅ Feedback generation model training completed!")
    return trainer


async def main():
    """
    Main training pipeline
    """
    logger.info("🎓 Academic Intelligence Platform - Model Training Pipeline")
    logger.info("Starting comprehensive model training...")
    
    try:
        # Initialize database connection
        db_config = DatabaseConfig()
        await db_config.connect()
        
        # Train risk detection model
        risk_model = await train_risk_detection_model()
        
        # Train feedback generation model
        feedback_model = await train_feedback_generation_model()
        
        logger.info("=" * 60)
        logger.info("✅ ALL MODELS TRAINED SUCCESSFULLY!")
        logger.info("=" * 60)
        logger.info("\nTrained models saved to:")
        logger.info("  - ./models/risk_detection_finetuned/best_model")
        logger.info("  - ./models/feedback_generation_finetuned/best_model")
        logger.info("\nEvaluation results saved to:")
        logger.info("  - ./evaluation_results/")
        logger.info("\nTo use these models in production:")
        logger.info("  1. Update huggingface_models.py to load from ./models/ instead of HuggingFace Hub")
        logger.info("  2. Restart the analytics service")
        logger.info("  3. Monitor performance and retrain periodically with new data")
        
    except Exception as e:
        logger.error(f"Training pipeline failed: {e}", exc_info=True)
        raise
    finally:
        await db_config.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
