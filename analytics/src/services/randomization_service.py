"""
Question Randomization Service

Provides exam integrity features:
- Question order randomization
- Answer option shuffling
- Different exam versions for each student
- Anti-cheating measures
"""

import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Any
import random
import hashlib
import json

from ..config.database import get_db_pool
from ..utils.logger import get_logger

logger = get_logger(__name__)


class QuestionRandomizationService:
    """
    Service for randomizing exam questions and options
    
    Features:
    - Shuffle question order per student
    - Randomize answer options
    - Generate unique exam versions
    - Track randomization patterns for grading
    """
    
    def __init__(self):
        self.db_pool = None
        
    async def initialize(self):
        """Initialize service"""
        try:
            self.db_pool = await get_db_pool()
            logger.info("QuestionRandomizationService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize QuestionRandomizationService: {e}")
            raise
    
    async def generate_randomized_exam(
        self,
        exam_id: str,
        student_id: str,
        randomize_questions: bool = True,
        randomize_options: bool = True,
        seed: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Generate a randomized version of exam for a specific student
        
        Args:
            exam_id: Exam identifier
            student_id: Student identifier
            randomize_questions: Whether to shuffle question order
            randomize_options: Whether to shuffle answer options
            seed: Random seed for reproducibility (uses student_id hash if None)
            
        Returns:
            Randomized exam structure with mapping for grading
        """
        try:
            logger.info(f"Generating randomized exam {exam_id} for student {student_id}")
            
            # Get original exam questions
            questions = await self._get_exam_questions(exam_id)
            
            if not questions:
                raise ValueError(f"No questions found for exam {exam_id}")
            
            # Generate deterministic seed from student_id if not provided
            if seed is None:
                seed = self._generate_student_seed(student_id, exam_id)
            
            # Set random seed for reproducibility
            random.seed(seed)
            
            # Randomize question order
            randomized_questions = questions.copy()
            if randomize_questions:
                random.shuffle(randomized_questions)
            
            # Randomize answer options for each question
            question_mappings = []
            for idx, question in enumerate(randomized_questions):
                original_position = questions.index(question)
                
                # Randomize options if applicable
                if randomize_options and question.get('options'):
                    question, option_mapping = self._randomize_options(question)
                else:
                    option_mapping = None
                
                question_mappings.append({
                    'randomized_position': idx,
                    'original_position': original_position,
                    'original_question_id': question['id'],
                    'option_mapping': option_mapping
                })
            
            # Save randomization pattern
            await self._save_randomization_pattern(
                exam_id,
                student_id,
                seed,
                question_mappings
            )
            
            result = {
                'exam_id': exam_id,
                'student_id': student_id,
                'randomization_seed': seed,
                'questions': randomized_questions,
                'question_count': len(randomized_questions),
                'randomization_applied': {
                    'questions_shuffled': randomize_questions,
                    'options_shuffled': randomize_options
                }
            }
            
            logger.info(f"Generated randomized exam with {len(questions)} questions")
            return result
            
        except Exception as e:
            logger.error(f"Error generating randomized exam: {e}")
            raise
    
    async def verify_answer(
        self,
        exam_id: str,
        student_id: str,
        question_position: int,
        selected_option: str
    ) -> Dict[str, Any]:
        """
        Verify student's answer accounting for randomization
        
        Args:
            exam_id: Exam identifier
            student_id: Student identifier
            question_position: Position in randomized exam
            selected_option: Student's selected option (may be randomized index)
            
        Returns:
            Verification result with correct answer mapping
        """
        try:
            # Get randomization pattern
            pattern = await self._get_randomization_pattern(exam_id, student_id)
            
            if not pattern:
                raise ValueError(f"No randomization pattern found for student {student_id}")
            
            # Find mapping for this question
            question_map = None
            for mapping in pattern['question_mappings']:
                if mapping['randomized_position'] == question_position:
                    question_map = mapping
                    break
            
            if not question_map:
                raise ValueError(f"No mapping found for position {question_position}")
            
            # Get original question
            original_question_id = question_map['original_question_id']
            original_question = await self._get_question_by_id(original_question_id)
            
            # Map selected option back to original
            if question_map['option_mapping']:
                original_option = self._map_option_to_original(
                    selected_option,
                    question_map['option_mapping']
                )
            else:
                original_option = selected_option
            
            # Check correctness
            is_correct = str(original_option) == str(original_question['correct_answer'])
            
            return {
                'is_correct': is_correct,
                'original_question_id': original_question_id,
                'original_correct_answer': original_question['correct_answer'],
                'student_answer_original': original_option,
                'student_answer_randomized': selected_option
            }
            
        except Exception as e:
            logger.error(f"Error verifying answer: {e}")
            raise
    
    def _generate_student_seed(self, student_id: str, exam_id: str) -> int:
        """Generate deterministic seed from student and exam IDs"""
        combined = f"{student_id}_{exam_id}"
        hash_value = hashlib.md5(combined.encode()).hexdigest()
        return int(hash_value[:8], 16)  # Use first 8 hex chars as seed
    
    def _randomize_options(self, question: Dict) -> tuple:
        """
        Randomize answer options for a question
        
        Returns:
            (modified_question, option_mapping)
        """
        if not question.get('options'):
            return question, None
        
        options = question['options'].copy()
        original_indices = list(range(len(options)))
        
        # Shuffle options
        shuffled = list(zip(options, original_indices))
        random.shuffle(shuffled)
        shuffled_options, new_to_old_mapping = zip(*shuffled)
        
        # Create reverse mapping (old index -> new index)
        old_to_new_mapping = {}
        for new_idx, old_idx in enumerate(new_to_old_mapping):
            old_to_new_mapping[old_idx] = new_idx
        
        # Update question
        modified_question = question.copy()
        modified_question['options'] = list(shuffled_options)
        
        # Map correct answer to new position
        if 'correct_answer' in question:
            try:
                old_correct_idx = int(question['correct_answer'])
                new_correct_idx = old_to_new_mapping.get(old_correct_idx)
                if new_correct_idx is not None:
                    modified_question['correct_answer'] = str(new_correct_idx)
            except (ValueError, KeyError):
                # If correct_answer is not an index, keep as is
                pass
        
        option_mapping = {
            'original_to_randomized': old_to_new_mapping,
            'randomized_to_original': {v: k for k, v in old_to_new_mapping.items()}
        }
        
        return modified_question, option_mapping
    
    def _map_option_to_original(
        self,
        randomized_option: str,
        option_mapping: Dict
    ) -> str:
        """Map randomized option back to original position"""
        try:
            randomized_idx = int(randomized_option)
            original_idx = option_mapping['randomized_to_original'].get(randomized_idx)
            return str(original_idx) if original_idx is not None else randomized_option
        except (ValueError, KeyError):
            return randomized_option
    
    async def _get_exam_questions(self, exam_id: str) -> List[Dict]:
        """Get all questions for an exam"""
        async with self.db_pool.acquire() as conn:
            query = """
                SELECT 
                    id,
                    content,
                    type,
                    options,
                    correct_answer,
                    points,
                    position
                FROM questions
                WHERE exam_id = $1
                ORDER BY position ASC
            """
            rows = await conn.fetch(query, exam_id)
            
            questions = []
            for row in rows:
                question = dict(row)
                # Parse JSON options if stored as string
                if question.get('options') and isinstance(question['options'], str):
                    try:
                        question['options'] = json.loads(question['options'])
                    except:
                        pass
                questions.append(question)
            
            return questions
    
    async def _get_question_by_id(self, question_id: str) -> Dict:
        """Get a specific question by ID"""
        async with self.db_pool.acquire() as conn:
            query = """
                SELECT id, content, type, options, correct_answer, points
                FROM questions
                WHERE id = $1
            """
            row = await conn.fetchrow(query, question_id)
            
            if not row:
                raise ValueError(f"Question {question_id} not found")
            
            question = dict(row)
            if question.get('options') and isinstance(question['options'], str):
                try:
                    question['options'] = json.loads(question['options'])
                except:
                    pass
            
            return question
    
    async def _save_randomization_pattern(
        self,
        exam_id: str,
        student_id: str,
        seed: int,
        question_mappings: List[Dict]
    ):
        """Save randomization pattern for later verification"""
        async with self.db_pool.acquire() as conn:
            # Check if pattern already exists
            check_query = """
                SELECT id FROM exam_randomization_patterns
                WHERE exam_id = $1 AND student_id = $2
            """
            existing = await conn.fetchrow(check_query, exam_id, student_id)
            
            pattern_data = json.dumps(question_mappings)
            
            if existing:
                # Update existing
                update_query = """
                    UPDATE exam_randomization_patterns
                    SET seed = $1, question_mappings = $2, updated_at = NOW()
                    WHERE exam_id = $3 AND student_id = $4
                """
                await conn.execute(update_query, seed, pattern_data, exam_id, student_id)
            else:
                # Insert new
                insert_query = """
                    INSERT INTO exam_randomization_patterns
                    (exam_id, student_id, seed, question_mappings, created_at)
                    VALUES ($1, $2, $3, $4, NOW())
                """
                await conn.execute(insert_query, exam_id, student_id, seed, pattern_data)
    
    async def _get_randomization_pattern(
        self,
        exam_id: str,
        student_id: str
    ) -> Optional[Dict]:
        """Retrieve saved randomization pattern"""
        async with self.db_pool.acquire() as conn:
            query = """
                SELECT seed, question_mappings
                FROM exam_randomization_patterns
                WHERE exam_id = $1 AND student_id = $2
            """
            row = await conn.fetchrow(query, exam_id, student_id)
            
            if not row:
                return None
            
            return {
                'seed': row['seed'],
                'question_mappings': json.loads(row['question_mappings'])
            }
    
    async def get_exam_version_stats(self, exam_id: str) -> Dict[str, Any]:
        """
        Get statistics about different exam versions
        
        Useful for detecting if randomization is working
        """
        async with self.db_pool.acquire() as conn:
            query = """
                SELECT 
                    COUNT(DISTINCT student_id) as total_students,
                    COUNT(DISTINCT seed) as unique_versions
                FROM exam_randomization_patterns
                WHERE exam_id = $1
            """
            row = await conn.fetchrow(query, exam_id)
            
            return {
                'exam_id': exam_id,
                'total_students': row['total_students'] if row else 0,
                'unique_versions': row['unique_versions'] if row else 0,
                'randomization_effectiveness': (
                    row['unique_versions'] / row['total_students']
                    if row and row['total_students'] > 0
                    else 0
                )
            }


# Global service instance
randomization_service = QuestionRandomizationService()


async def get_randomization_service() -> QuestionRandomizationService:
    """Get the question randomization service instance"""
    return randomization_service
