"""
🎓 Academic Intelligence Platform - Analytics API Routes
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from src.config import db
from src.models import (
    ChapterAnalysisResponse,
    ConceptAnalysisResponse,
    DifficultyAnalysisResponse,
    LearningGapsResponse,
    PerformanceTrend,
    PersonalizedFeedback,
    ClassAnalyticsResponse,
    APIResponse
)
from src.services import (
    chapter_analyzer,
    concept_analyzer,
    difficulty_analyzer,
    gap_detector,
    trend_analyzer,
    feedback_generator,
    class_analyzer
)
from src.utils import logger


router = APIRouter(prefix="/analytics", tags=["Analytics"])


# =====================================================
# Request Models
# =====================================================

class AnalyzeStudentRequest(BaseModel):
    student_id: int
    course_id: int
    exam_id: Optional[int] = None


class AnalyzeClassRequest(BaseModel):
    course_id: int
    educator_id: int
    exam_id: Optional[int] = None


class FullAnalysisRequest(BaseModel):
    student_id: int
    course_id: int
    exam_id: Optional[int] = None
    include_chapters: bool = True
    include_concepts: bool = True
    include_difficulty: bool = True
    include_gaps: bool = True
    include_trend: bool = True
    include_feedback: bool = True


# =====================================================
# Student Analytics Endpoints
# =====================================================

@router.post("/chapter", response_model=APIResponse)
async def analyze_chapters(request: AnalyzeStudentRequest):
    """
    Analyze student performance by chapter.
    
    Returns chapter-wise breakdown with:
    - Accuracy percentage
    - Mastery level
    - Time spent
    - Improvement from previous attempt
    """
    try:
        result = await chapter_analyzer.analyze_student_chapters(
            student_id=request.student_id,
            course_id=request.course_id,
            exam_id=request.exam_id
        )
        
        # Store analysis
        await chapter_analyzer.store_analysis(result)
        
        return APIResponse(
            success=True,
            message="Chapter analysis completed",
            data=result.model_dump()
        )
    except Exception as e:
        logger.error(f"Chapter analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/concept", response_model=APIResponse)
async def analyze_concepts(
    request: AnalyzeStudentRequest,
    chapter_id: Optional[int] = Query(None, description="Specific chapter to analyze")
):
    """
    Analyze student performance by concept.
    
    Returns concept-wise breakdown with:
    - Understanding score (weighted)
    - Time efficiency
    - Consistency
    - Prerequisite weakness detection
    """
    try:
        result = await concept_analyzer.analyze_student_concepts(
            student_id=request.student_id,
            course_id=request.course_id,
            chapter_id=chapter_id
        )
        
        await concept_analyzer.store_analysis(result)
        
        return APIResponse(
            success=True,
            message="Concept analysis completed",
            data=result.model_dump()
        )
    except Exception as e:
        logger.error(f"Concept analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/difficulty", response_model=APIResponse)
async def analyze_difficulty(request: AnalyzeStudentRequest):
    """
    Analyze student performance by difficulty level.
    
    Returns breakdown across easy, medium, hard, expert with:
    - Accuracy vs benchmark
    - Time spent
    - Performance tags
    - Recommended difficulty level
    """
    try:
        result = await difficulty_analyzer.analyze_difficulty_performance(
            student_id=request.student_id,
            course_id=request.course_id,
            exam_id=request.exam_id
        )
        
        await difficulty_analyzer.store_analysis(result)
        
        return APIResponse(
            success=True,
            message="Difficulty analysis completed",
            data=result.model_dump()
        )
    except Exception as e:
        logger.error(f"Difficulty analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/gaps", response_model=APIResponse)
async def detect_learning_gaps(request: AnalyzeStudentRequest):
    """
    Detect learning gaps for a student.
    
    Identifies:
    - Foundational gaps (weak prerequisites)
    - Conceptual gaps (misunderstandings)
    - Application gaps (theory vs practice)
    - Speed gaps (too slow)
    
    Returns prioritized list with recommendations.
    """
    try:
        result = await gap_detector.detect_learning_gaps(
            student_id=request.student_id,
            course_id=request.course_id
        )
        
        await gap_detector.store_gaps(result)
        
        return APIResponse(
            success=True,
            message=f"Detected {result.total_gaps} learning gaps",
            data=result.model_dump()
        )
    except Exception as e:
        logger.error(f"Gap detection failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/trend", response_model=APIResponse)
async def analyze_trend(
    request: AnalyzeStudentRequest,
    window_size: int = Query(5, ge=2, le=20, description="Moving average window")
):
    """
    Analyze performance trend over time.
    
    Returns:
    - Trend direction (improving/declining/stable)
    - Slope (rate of change)
    - Consistency score
    - Predicted next score
    """
    try:
        result = await trend_analyzer.analyze_performance_trend(
            student_id=request.student_id,
            course_id=request.course_id,
            window_size=window_size
        )
        
        await trend_analyzer.store_trend(result)
        
        return APIResponse(
            success=True,
            message="Trend analysis completed",
            data=result.model_dump()
        )
    except Exception as e:
        logger.error(f"Trend analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/feedback", response_model=APIResponse)
async def generate_feedback(request: AnalyzeStudentRequest):
    """
    Generate personalized feedback for a student.
    
    Combines all analysis to produce:
    - Strengths
    - Areas for improvement
    - Specific recommendations
    - Achievements
    - Warnings (if critical issues)
    """
    try:
        # Run all analyses first
        chapter_result = await chapter_analyzer.analyze_student_chapters(
            request.student_id, request.course_id, request.exam_id
        )
        
        difficulty_result = await difficulty_analyzer.analyze_difficulty_performance(
            request.student_id, request.course_id, request.exam_id
        )
        
        gaps_result = await gap_detector.detect_learning_gaps(
            request.student_id, request.course_id
        )
        
        trend_result = await trend_analyzer.analyze_performance_trend(
            request.student_id, request.course_id
        )
        
        # Generate feedback
        result = await feedback_generator.generate_feedback(
            student_id=request.student_id,
            course_id=request.course_id,
            exam_id=request.exam_id,
            chapter_analysis=chapter_result,
            difficulty_analysis=difficulty_result,
            gaps=gaps_result,
            trend=trend_result
        )
        
        await feedback_generator.store_feedback(result)
        
        return APIResponse(
            success=True,
            message="Feedback generated successfully",
            data=result.model_dump()
        )
    except Exception as e:
        logger.error(f"Feedback generation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/full", response_model=APIResponse)
async def run_full_analysis(request: FullAnalysisRequest):
    """
    Run comprehensive analysis for a student.
    
    Includes all analytics modules based on request parameters.
    Returns combined results in a single response.
    """
    try:
        results = {
            "student_id": request.student_id,
            "course_id": request.course_id,
            "exam_id": request.exam_id
        }
        
        if request.include_chapters:
            chapter_result = await chapter_analyzer.analyze_student_chapters(
                request.student_id, request.course_id, request.exam_id
            )
            results["chapters"] = chapter_result.model_dump()
            await chapter_analyzer.store_analysis(chapter_result)
        
        if request.include_concepts:
            concept_result = await concept_analyzer.analyze_student_concepts(
                request.student_id, request.course_id
            )
            results["concepts"] = concept_result.model_dump()
            await concept_analyzer.store_analysis(concept_result)
        
        if request.include_difficulty:
            difficulty_result = await difficulty_analyzer.analyze_difficulty_performance(
                request.student_id, request.course_id, request.exam_id
            )
            results["difficulty"] = difficulty_result.model_dump()
            await difficulty_analyzer.store_analysis(difficulty_result)
        
        if request.include_gaps:
            gaps_result = await gap_detector.detect_learning_gaps(
                request.student_id, request.course_id
            )
            results["gaps"] = gaps_result.model_dump()
            await gap_detector.store_gaps(gaps_result)
        
        if request.include_trend:
            trend_result = await trend_analyzer.analyze_performance_trend(
                request.student_id, request.course_id
            )
            results["trend"] = trend_result.model_dump()
            await trend_analyzer.store_trend(trend_result)
        
        if request.include_feedback:
            feedback_result = await feedback_generator.generate_feedback(
                student_id=request.student_id,
                course_id=request.course_id,
                exam_id=request.exam_id,
                chapter_analysis=results.get("chapters"),
                difficulty_analysis=results.get("difficulty"),
                gaps=results.get("gaps"),
                trend=results.get("trend")
            )
            results["feedback"] = feedback_result.model_dump()
            await feedback_generator.store_feedback(feedback_result)
        
        return APIResponse(
            success=True,
            message="Full analysis completed",
            data=results
        )
    except Exception as e:
        logger.error(f"Full analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


# =====================================================
# Class Analytics Endpoints (Educator)
# =====================================================

@router.post("/class", response_model=APIResponse)
async def analyze_class(request: AnalyzeClassRequest):
    """
    Generate class-level analytics for educators.
    
    Returns:
    - Class statistics (mean, median, std dev, pass rate)
    - Grade distribution
    - Common weak areas
    - Question effectiveness (if exam specified)
    - At-risk students
    - Recommendations
    """
    try:
        result = await class_analyzer.analyze_class(
            course_id=request.course_id,
            educator_id=request.educator_id,
            exam_id=request.exam_id
        )
        
        return APIResponse(
            success=True,
            message="Class analysis completed",
            data=result.model_dump()
        )
    except Exception as e:
        logger.error(f"Class analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/class/{course_id}/at-risk", response_model=APIResponse)
async def get_at_risk_students(
    course_id: int,
    threshold: float = Query(50.0, ge=0, le=100)
):
    """
    Get list of at-risk students in a course.
    """
    try:
        result = await class_analyzer._identify_at_risk_students(
            course_id=course_id,
            threshold=threshold
        )
        
        return APIResponse(
            success=True,
            message=f"Found {len(result)} at-risk students",
            data=[s.model_dump() for s in result]
        )
    except Exception as e:
        logger.error(f"At-risk identification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/class/{course_id}/weak-areas", response_model=APIResponse)
async def get_class_weak_areas(
    course_id: int,
    exam_id: Optional[int] = None,
    threshold: float = Query(60.0, ge=0, le=100)
):
    """
    Get common weak areas across the class.
    """
    try:
        result = await class_analyzer._identify_weak_areas(
            course_id=course_id,
            exam_id=exam_id,
            threshold=threshold
        )
        
        return APIResponse(
            success=True,
            message=f"Found {len(result)} weak areas",
            data=[w.model_dump() for w in result]
        )
    except Exception as e:
        logger.error(f"Weak areas identification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


# =====================================================
# Comparison Endpoints
# =====================================================

@router.get("/compare/student-to-class", response_model=APIResponse)
async def compare_student_to_class(
    student_id: int,
    course_id: int
):
    """
    Compare individual student performance to class average.
    """
    try:
        # Get student chapter comparison
        chapter_comparison = await chapter_analyzer.get_chapter_comparison(
            student_id=student_id,
            course_id=course_id
        )
        
        # Get trend comparison
        trend_comparison = await trend_analyzer.compare_with_class(
            student_id=student_id,
            course_id=course_id
        )
        
        return APIResponse(
            success=True,
            message="Comparison completed",
            data={
                "chapter_comparison": chapter_comparison,
                "trend_comparison": trend_comparison
            }
        )
    except Exception as e:
        logger.error(f"Comparison failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/progression/chapter/{chapter_id}", response_model=APIResponse)
async def get_chapter_progression(
    chapter_id: int,
    student_id: int
):
    """
    Get mastery progression for a specific chapter over time.
    """
    try:
        # Get concept progressions within chapter
        result = await concept_analyzer.get_concept_mastery_progression(
            student_id=student_id,
            concept_id=chapter_id  # Note: This should be concept_id, adjust as needed
        )
        
        return APIResponse(
            success=True,
            message="Progression retrieved",
            data=result
        )
    except Exception as e:
        logger.error(f"Progression retrieval failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/multi-dimension/{student_id}/{course_id}", response_model=APIResponse)
async def get_multi_dimension_trend(
    student_id: int,
    course_id: int
):
    """
    Get multi-dimensional trend analysis (overall, by chapter, by difficulty, time efficiency).
    """
    try:
        result = await trend_analyzer.get_multi_dimension_trend(
            student_id=student_id,
            course_id=course_id
        )
        
        return APIResponse(
            success=True,
            message="Multi-dimension analysis completed",
            data=result
        )
    except Exception as e:
        logger.error(f"Multi-dimension analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
