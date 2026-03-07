"""
🎓 Risk Detection Model Trainer
Fine-tunes DistilBERT for academic risk prediction
"""

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    Trainer,
    TrainingArguments,
    EvalPrediction
)
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, roc_auc_score
import numpy as np
from typing import List, Dict, Any, Tuple
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class RiskDetectionDataset(Dataset):
    """PyTorch Dataset for risk detection"""
    
    def __init__(self, texts: List[str], labels: List[int], tokenizer, max_length: int = 128):
        self.encodings = tokenizer(
            texts,
            truncation=True,
            padding=True,
            max_length=max_length,
            return_tensors='pt'
        )
        self.labels = torch.tensor(labels)
    
    def __getitem__(self, idx):
        item = {key: val[idx] for key, val in self.encodings.items()}
        item['labels'] = self.labels[idx]
        return item
    
    def __len__(self):
        return len(self.labels)


class RiskDetectionTrainer:
    """
    Trainer for fine-tuning risk detection model on academic data
    """
    
    def __init__(
        self,
        base_model: str = "distilbert-base-uncased",
        output_dir: str = "./models/risk_detection_finetuned",
        device: str = None
    ):
        self.base_model = base_model
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = None
        self.model = None
        
        logger.info(f"Initializing RiskDetectionTrainer with device: {self.device}")
    
    def prepare_data(
        self,
        texts: List[str],
        labels: List[int],
        test_size: float = 0.2,
        val_size: float = 0.1
    ) -> Tuple[Dataset, Dataset, Dataset]:
        """
        Prepare train/val/test datasets
        """
        logger.info(f"Preparing datasets from {len(texts)} samples...")
        
        # Initialize tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(self.base_model)
        
        # Split data
        X_temp, X_test, y_temp, y_test = train_test_split(
            texts, labels, test_size=test_size, random_state=42, stratify=labels
        )
        
        val_size_adjusted = val_size / (1 - test_size)
        X_train, X_val, y_train, y_val = train_test_split(
            X_temp, y_temp, test_size=val_size_adjusted, random_state=42, stratify=y_temp
        )
        
        logger.info(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")
        
        # Create datasets
        train_dataset = RiskDetectionDataset(X_train, y_train, self.tokenizer)
        val_dataset = RiskDetectionDataset(X_val, y_val, self.tokenizer)
        test_dataset = RiskDetectionDataset(X_test, y_test, self.tokenizer)
        
        return train_dataset, val_dataset, test_dataset
    
    def compute_metrics(self, pred: EvalPrediction) -> Dict[str, float]:
        """Compute evaluation metrics"""
        labels = pred.label_ids
        preds = pred.predictions.argmax(-1)
        probs = torch.softmax(torch.tensor(pred.predictions), dim=-1)[:, 1].numpy()
        
        precision, recall, f1, _ = precision_recall_fscore_support(
            labels, preds, average='binary'
        )
        acc = accuracy_score(labels, preds)
        auc = roc_auc_score(labels, probs)
        
        return {
            'accuracy': acc,
            'precision': precision,
            'recall': recall,
            'f1': f1,
            'auc_roc': auc
        }
    
    def train(
        self,
        train_dataset: Dataset,
        val_dataset: Dataset,
        num_epochs: int = 3,
        batch_size: int = 16,
        learning_rate: float = 2e-5,
        warmup_steps: int = 500,
        weight_decay: float = 0.01
    ) -> Dict[str, Any]:
        """
        Fine-tune the model
        """
        logger.info("Starting model training...")
        
        # Initialize model
        self.model = AutoModelForSequenceClassification.from_pretrained(
            self.base_model,
            num_labels=2  # Binary classification: at-risk vs not at-risk
        )
        self.model.to(self.device)
        
        # Training arguments
        training_args = TrainingArguments(
            output_dir=str(self.output_dir),
            num_train_epochs=num_epochs,
            per_device_train_batch_size=batch_size,
            per_device_eval_batch_size=batch_size,
            warmup_steps=warmup_steps,
            weight_decay=weight_decay,
            learning_rate=learning_rate,
            logging_dir=str(self.output_dir / 'logs'),
            logging_steps=50,
            eval_strategy="epoch",
            save_strategy="epoch",
            load_best_model_at_end=True,
            metric_for_best_model="f1",
            greater_is_better=True,
            save_total_limit=2,
            report_to=["tensorboard"],
            fp16=torch.cuda.is_available(),  # Use mixed precision if GPU available
        )
        
        # Initialize trainer
        trainer = Trainer(
            model=self.model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=val_dataset,
            compute_metrics=self.compute_metrics,
        )
        
        # Train
        logger.info("Training started...")
        train_result = trainer.train()
        
        # Save model
        trainer.save_model(str(self.output_dir / "best_model"))
        self.tokenizer.save_pretrained(str(self.output_dir / "best_model"))
        
        logger.info("Training completed!")
        logger.info(f"Training metrics: {train_result.metrics}")
        
        return train_result.metrics
    
    def evaluate(self, test_dataset: Dataset) -> Dict[str, float]:
        """Evaluate model on test set"""
        logger.info("Evaluating model on test set...")
        
        trainer = Trainer(
            model=self.model,
            compute_metrics=self.compute_metrics,
        )
        
        eval_results = trainer.evaluate(test_dataset)
        logger.info(f"Test metrics: {eval_results}")
        
        return eval_results
    
    def predict(self, texts: List[str]) -> Tuple[List[int], List[float]]:
        """
        Predict risk labels and probabilities
        """
        if self.model is None or self.tokenizer is None:
            raise ValueError("Model not trained or loaded")
        
        self.model.eval()
        
        # Tokenize
        encodings = self.tokenizer(
            texts,
            truncation=True,
            padding=True,
            max_length=128,
            return_tensors='pt'
        ).to(self.device)
        
        # Predict
        with torch.no_grad():
            outputs = self.model(**encodings)
            probs = torch.softmax(outputs.logits, dim=-1)
            predictions = probs.argmax(dim=-1).cpu().numpy()
            confidence_scores = probs[:, 1].cpu().numpy()  # Probability of at-risk
        
        return predictions.tolist(), confidence_scores.tolist()
    
    def load_trained_model(self, model_path: str = None):
        """Load a previously trained model"""
        model_path = model_path or str(self.output_dir / "best_model")
        
        logger.info(f"Loading model from {model_path}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_path)
        self.model.to(self.device)
        self.model.eval()
        
        logger.info("Model loaded successfully")
