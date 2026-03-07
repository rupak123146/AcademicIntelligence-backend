"""
🎓 Feedback Generation Model Trainer
Fine-tunes T5 for educational feedback generation
"""

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoTokenizer,
    AutoModelForSeq2SeqLM,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
    DataCollatorForSeq2Seq
)
from sklearn.model_selection import train_test_split
import numpy as np
from typing import List, Dict, Any, Tuple
import logging
from pathlib import Path
import json

logger = logging.getLogger(__name__)


class FeedbackDataset(Dataset):
    """PyTorch Dataset for feedback generation"""
    
    def __init__(
        self,
        inputs: List[Dict[str, str]],
        outputs: List[Dict[str, Any]],
        tokenizer,
        max_input_length: int = 256,
        max_target_length: int = 256
    ):
        self.tokenizer = tokenizer
        self.max_input_length = max_input_length
        self.max_target_length = max_target_length
        
        # Prepare input texts
        self.input_texts = [
            f"Generate feedback for: {inp['context']}. {inp['summary']}"
            for inp in inputs
        ]
        
        # Prepare target texts (combine all feedback components)
        self.target_texts = [
            self._format_feedback(out)
            for out in outputs
        ]
    
    def _format_feedback(self, feedback: Dict[str, Any]) -> str:
        """Format feedback dict into text"""
        parts = []
        
        if 'strengths' in feedback:
            parts.append("Strengths: " + "; ".join(feedback['strengths']))
        
        if 'improvements' in feedback:
            parts.append("Areas to improve: " + "; ".join(feedback['improvements']))
        
        if 'recommendations' in feedback:
            parts.append("Recommendations: " + "; ".join(feedback['recommendations']))
        
        if 'overall' in feedback:
            parts.append("Overall: " + feedback['overall'])
        
        return " | ".join(parts)
    
    def __len__(self):
        return len(self.input_texts)
    
    def __getitem__(self, idx):
        input_text = self.input_texts[idx]
        target_text = self.target_texts[idx]
        
        # Tokenize input
        model_inputs = self.tokenizer(
            input_text,
            max_length=self.max_input_length,
            truncation=True,
            padding='max_length',
            return_tensors='pt'
        )
        
        # Tokenize target
        with self.tokenizer.as_target_tokenizer():
            labels = self.tokenizer(
                target_text,
                max_length=self.max_target_length,
                truncation=True,
                padding='max_length',
                return_tensors='pt'
            )
        
        model_inputs['labels'] = labels['input_ids']
        
        # Convert to dict and remove batch dimension
        return {k: v.squeeze(0) for k, v in model_inputs.items()}


class FeedbackGenerationTrainer:
    """
    Trainer for fine-tuning T5 model on educational feedback data
    """
    
    def __init__(
        self,
        base_model: str = "google/flan-t5-base",
        output_dir: str = "./models/feedback_generation_finetuned",
        device: str = None
    ):
        self.base_model = base_model
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = None
        self.model = None
        
        logger.info(f"Initializing FeedbackGenerationTrainer with device: {self.device}")
    
    def prepare_data(
        self,
        inputs: List[Dict[str, str]],
        outputs: List[Dict[str, Any]],
        test_size: float = 0.2,
        val_size: float = 0.1
    ) -> Tuple[Dataset, Dataset, Dataset]:
        """
        Prepare train/val/test datasets
        """
        logger.info(f"Preparing datasets from {len(inputs)} samples...")
        
        # Initialize tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(self.base_model)
        
        # Split data
        inputs_temp, inputs_test, outputs_temp, outputs_test = train_test_split(
            inputs, outputs, test_size=test_size, random_state=42
        )
        
        val_size_adjusted = val_size / (1 - test_size)
        inputs_train, inputs_val, outputs_train, outputs_val = train_test_split(
            inputs_temp, outputs_temp, test_size=val_size_adjusted, random_state=42
        )
        
        logger.info(f"Train: {len(inputs_train)}, Val: {len(inputs_val)}, Test: {len(inputs_test)}")
        
        # Create datasets
        train_dataset = FeedbackDataset(inputs_train, outputs_train, self.tokenizer)
        val_dataset = FeedbackDataset(inputs_val, outputs_val, self.tokenizer)
        test_dataset = FeedbackDataset(inputs_test, outputs_test, self.tokenizer)
        
        return train_dataset, val_dataset, test_dataset
    
    def train(
        self,
        train_dataset: Dataset,
        val_dataset: Dataset,
        num_epochs: int = 3,
        batch_size: int = 8,
        learning_rate: float = 5e-5,
        warmup_steps: int = 500,
        weight_decay: float = 0.01
    ) -> Dict[str, Any]:
        """
        Fine-tune the T5 model
        """
        logger.info("Starting model training...")
        
        # Initialize model
        self.model = AutoModelForSeq2SeqLM.from_pretrained(self.base_model)
        self.model.to(self.device)
        
        # Data collator
        data_collator = DataCollatorForSeq2Seq(
            self.tokenizer,
            model=self.model,
            padding=True
        )
        
        # Training arguments
        training_args = Seq2SeqTrainingArguments(
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
            save_total_limit=2,
            predict_with_generate=True,
            generation_max_length=256,
            report_to=["tensorboard"],
            fp16=torch.cuda.is_available(),
        )
        
        # Initialize trainer
        trainer = Seq2SeqTrainer(
            model=self.model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=val_dataset,
            data_collator=data_collator,
            tokenizer=self.tokenizer,
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
    
    def generate_feedback(
        self,
        context: str,
        performance_summary: str,
        max_length: int = 256
    ) -> str:
        """
        Generate feedback for given input
        """
        if self.model is None or self.tokenizer is None:
            raise ValueError("Model not trained or loaded")
        
        self.model.eval()
        
        # Prepare input
        input_text = f"Generate feedback for: {context}. {performance_summary}"
        inputs = self.tokenizer(
            input_text,
            max_length=256,
            truncation=True,
            padding=True,
            return_tensors='pt'
        ).to(self.device)
        
        # Generate
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_length=max_length,
                num_beams=4,
                early_stopping=True,
                temperature=0.7,
                top_p=0.9
            )
        
        feedback_text = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        return feedback_text
    
    def load_trained_model(self, model_path: str = None):
        """Load a previously trained model"""
        model_path = model_path or str(self.output_dir / "best_model")
        
        logger.info(f"Loading model from {model_path}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(model_path)
        self.model.to(self.device)
        self.model.eval()
        
        logger.info("Model loaded successfully")
