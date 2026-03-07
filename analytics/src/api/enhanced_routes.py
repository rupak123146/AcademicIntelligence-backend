"""
🎓 Enhanced Analytics API Routes
Routes for ML-powered analytics features
"""

from fastapi import APIRouter, Query, Depends, HTTPException
from typing import Optional
from src.services import (
    at_risk_service,
    enhanced_feedback_service,
    exam_monitoring_service,
    audit_service,
    fairness_service,
    goal_tracking_service,
    notification_service,
    intervention_service
)
from src.utils import logger

router = APIRouter(prefix="/api/v1/analytics", tags=["Analytics"])


# ============================================================================
# AT-RISK DETECTION ENDPOINTS
# ============================================================================

@router.get("/at-risk/students")
async def get_at_risk_students(
    course_id: str = Query(..., description="Course ID"),
    threshold: float = Query(0.5, ge=0, le=1, description="Risk threshold")
):
    """
    Get all at-risk students in a course with risk profiles
    
    Returns students sorted by risk score (highest first)
    """
    try:
        at_risk_students = await at_risk_service.detect_at_risk_students(
            course_id=course_id,
            threshold=threshold
        )
        
        return {
            "success": True,
            "data": [
                {
                    "student_id": p.student_id,
                    "risk_score": p.risk_score,
                    "risk_level": p.risk_level.value,
                    "factor_count": len(p.risk_factors),
                    "factors": [
                        {"name": f.name, "weight": f.weight}
                        for f in p.risk_factors
                    ],
                    "interventions": p.recommended_interventions,
                    "confidence": p.confidence
                }
                for p in at_risk_students
            ],
            "count": len(at_risk_students)
        }
    except Exception as e:
        logger.error(f"Error getting at-risk students: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/at-risk/student/{student_id}")
async def analyze_student_risk(
    student_id: str,
    course_id: str = Query(..., description="Course ID")
):
    """Get detailed risk profile for a specific student"""
    try:
        profile = await at_risk_service.analyze_student_risk(
            student_id=student_id,
            course_id=course_id
        )
        
        return {
            "success": True,
            "data": {
                "student_id": profile.student_id,
                "risk_score": profile.risk_score,
                "risk_level": profile.risk_level.value,
                "factors": [
                    {
                        "name": f.name,
                        "description": f.description,
                        "weight": f.weight
                    }
                    for f in profile.risk_factors
                ],
                "interventions": profile.recommended_interventions,
                "confidence": profile.confidence,
                "calculated_at": profile.calculated_at
            }
        }
    except Exception as e:
        logger.error(f"Error analyzing student risk: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# ENHANCED FEEDBACK ENDPOINTS
# ============================================================================

@router.get("/feedback/personalized")
async def get_personalized_feedback(
    student_id: str = Query(..., description="Student ID"),
    course_id: str = Query(..., description="Course ID"),
    exam_id: Optional[str] = Query(None, description="Optional specific exam")
):
    """Generate comprehensive personalized feedback with resource recommendations"""
    try:
        feedback = await enhanced_feedback_service.generate_personalized_feedback(
            student_id=student_id,
            course_id=course_id,
            exam_id=exam_id
        )
        
        return {
            "success": True,
            "data": {
                "student_id": feedback.student_id,
                "exam_id": feedback.exam_id,
                "course_id": feedback.course_id,
                "overall_assessment": feedback.overall_assessment,
                "feedback_items": [
                    {
                        "type": item.type.value,
                        "message": item.message,
                        "priority": item.priority,
                        "resources": item.resource_links
                    }
                    for item in feedback.feedback_items
                ],
                "learning_goals": feedback.learning_goals,
                "improvement_pathway": feedback.improvement_pathway,
                "generated_at": feedback.generated_at
            }
        }
    except Exception as e:
        logger.error(f"Error generating feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# REAL-TIME EXAM MONITORING ENDPOINTS
# ============================================================================

@router.get("/exam/monitor/status")
async def get_exam_status(
    student_id: str = Query(..., description="Student ID"),
    exam_id: str = Query(..., description="Exam ID")
):
    """Get real-time status of an exam attempt"""
    try:
        status = await exam_monitoring_service.get_exam_status(
            student_id=student_id,
            exam_id=exam_id
        )
        
        return {
            "success": True,
            "data": {
                "student_id": status.student_id,
                "exam_id": status.exam_id,
                "status": status.status,
                "current_question": status.current_question,
                "total_questions": status.total_questions,
                "time_elapsed": status.time_elapsed,
                "time_remaining": status.time_remaining,
                "alerts_count": status.alerts_count,
                "last_activity": status.last_activity
            }
        }
    except Exception as e:
        logger.error(f"Error getting exam status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/exam/monitor/dashboard")
async def get_educator_dashboard(
    exam_id: str = Query(..., description="Exam ID")
):
    """Get real-time monitoring dashboard for educators"""
    try:
        dashboard = await exam_monitoring_service.get_educator_dashboard(exam_id)
        
        return {
            "success": True,
            "data": dashboard
        }
    except Exception as e:
        logger.error(f"Error getting educator dashboard: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/exam/activity/log")
async def log_exam_activity(
    student_id: str = Query(..., description="Student ID"),
    exam_id: str = Query(..., description="Exam ID"),
    event_type: str = Query(..., description="Type of event"),
    metadata: dict = {}
):
    """Record an exam activity and check for anomalies"""
    try:
        alert = await exam_monitoring_service.record_activity(
            student_id=student_id,
            exam_id=exam_id,
            event_type=event_type,
            metadata=metadata
        )
        
        return {
            "success": True,
            "alert_triggered": alert is not None,
            "alert": {
                "alert_type": alert.alert_type,
                "severity": alert.severity,
                "description": alert.description,
                "flagged_for_review": alert.flagged_for_review
            } if alert else None
        }
    except Exception as e:
        logger.error(f"Error logging activity: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# FAIRNESS ANALYSIS ENDPOINTS
# ============================================================================

@router.get("/fairness/analyze")
async def analyze_exam_fairness(
    exam_id: str = Query(..., description="Exam ID"),
    demographic: str = Query("gender", description="Demographic dimension to analyze")
):
    """Analyze exam for bias and fairness issues"""
    try:
        analysis = await fairness_service.analyze_exam_fairness(
            exam_id=exam_id,
            demographic_column=demographic
        )
        
        return {
            "success": True,
            "data": {
                "exam_id": analysis.exam_id,
                "analysis_date": analysis.analysis_date,
                "overall_fairness_score": analysis.overall_fairness_score,
                "biased_items_count": len(analysis.biased_items),
                "biased_items": [
                    {
                        "item_id": item.item_id,
                        "disparate_impact_ratio": item.disparate_impact_ratio,
                        "severity": item.severity,
                        "affected_groups": item.affected_demographic_groups,
                        "evidence": item.evidence
                    }
                    for item in analysis.biased_items
                ],
                "group_comparison": analysis.group_performance_comparison,
                "recommendations": analysis.recommendations
            }
        }
    except Exception as e:
        logger.error(f"Error analyzing fairness: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fairness/history")
async def get_fairness_history(
    exam_id: Optional[str] = Query(None, description="Filter by exam ID"),
    days: int = Query(90, description="Days to look back")
):
    """Get fairness analysis history"""
    try:
        history = await fairness_service.get_fairness_history(
            exam_id=exam_id,
            days=days
        )
        
        return {
            "success": True,
            "data": history,
            "count": len(history)
        }
    except Exception as e:
        logger.error(f"Error getting fairness history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# AUDIT & COMPLIANCE ENDPOINTS
# ============================================================================

@router.get("/audit/trail")
async def get_audit_trail(
    resource_type: Optional[str] = Query(None, description="Filter by resource type"),
    resource_id: Optional[str] = Query(None, description="Filter by resource ID"),
    user_id: Optional[str] = Query(None, description="Filter by user"),
    days: int = Query(90, description="Days to look back")
):
    """Get audit trail for compliance review"""
    try:
        logs = await audit_service.get_audit_trail(
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id,
            days=days
        )
        
        return {
            "success": True,
            "data": logs,
            "count": len(logs)
        }
    except Exception as e:
        logger.error(f"Error getting audit trail: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/audit/data-access/{student_id}")
async def get_data_access_log(
    student_id: str,
    days: int = Query(365, description="Days to look back")
):
    """Get who has accessed a specific student's data (FERPA)"""
    try:
        logs = await audit_service.get_user_data_access_log(
            student_id=student_id,
            days=days
        )
        
        return {
            "success": True,
            "student_id": student_id,
            "data_accesses": logs,
            "total_accesses": len(logs)
        }
    except Exception as e:
        logger.error(f"Error getting data access log: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/compliance/report")
async def get_compliance_report(
    report_type: str = Query("general", description="Report type: FERPA, GDPR, COPPA, general")
):
    """Generate compliance report"""
    try:
        report = await audit_service.generate_compliance_report(
            report_type=report_type
        )
        
        return {
            "success": True,
            "data": {
                "report_date": report.report_date,
                "report_type": report.report_type,
                "compliance_status": report.compliance_status,
                "violations": report.violations,
                "recommendations": report.recommendations
            }
        }
    except Exception as e:
        logger.error(f"Error generating compliance report: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/audit/export")
async def export_audit_logs(
    format: str = Query("csv", description="Export format: csv, json"),
    resource_type: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    days: int = Query(90)
):
    """Export audit logs for archival"""
    try:
        export_data = await audit_service.export_audit_logs(
            format=format,
            resource_type=resource_type,
            user_id=user_id,
            days=days
        )
        
        if export_data:
            from fastapi.responses import StreamingResponse
            return StreamingResponse(
                iter([export_data]),
                media_type="text/csv" if format == "csv" else "application/json",
                headers={"Content-Disposition": f"attachment; filename=audit_logs.{format}"}
            )
        else:
            raise HTTPException(status_code=500, detail="Export failed")
    except Exception as e:
        logger.error(f"Error exporting audit logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# ITEM ANALYSIS ENDPOINTS
# ============================================================================

@router.get("/item-analysis/exam/{exam_id}")
async def analyze_exam_items(
    exam_id: str,
    min_responses: int = Query(10, description="Minimum responses required")
):
    """
    Analyze all items in an exam
    
    Returns facility index, discrimination index, and distractor analysis
    for each question
    """
    try:
        from src.services.item_analysis_service import item_analysis_service
        
        analyses = await item_analysis_service.analyze_exam_items(
            exam_id=exam_id,
            min_responses=min_responses
        )
        
        return {
            "success": True,
            "data": [
                {
                    "item_id": a.item_id,
                    "facility_index": a.facility_index,
                    "difficulty_level": a.difficulty_level.value,
                    "discrimination_index": a.discrimination_index,
                    "discrimination_level": a.discrimination_level.value,
                    "total_responses": a.total_responses,
                    "correct_responses": a.correct_responses,
                    "recommendations": [
                        {
                            "category": r.category,
                            "severity": r.severity,
                            "message": r.message,
                            "action": r.action
                        }
                        for r in a.recommendations
                    ]
                }
                for a in analyses
            ],
            "count": len(analyses)
        }
    except Exception as e:
        logger.error(f"Error analyzing exam items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/item-analysis/item/{question_id}")
async def analyze_single_item(
    question_id: str,
    exam_id: str = Query(..., description="Exam ID"),
    min_responses: int = Query(10)
):
    """
    Detailed analysis of a single item
    
    Includes distractor analysis and recommendations
    """
    try:
        from src.services.item_analysis_service import item_analysis_service
        
        analysis = await item_analysis_service.analyze_single_item(
            exam_id=exam_id,
            question_id=question_id,
            min_responses=min_responses
        )
        
        if not analysis:
            raise HTTPException(status_code=404, detail="Insufficient data for analysis")
        
        return {
            "success": True,
            "data": {
                "item_id": analysis.item_id,
                "facility_index": analysis.facility_index,
                "difficulty_level": analysis.difficulty_level.value,
                "discrimination_index": analysis.discrimination_index,
                "discrimination_level": analysis.discrimination_level.value,
                "distractor_analysis": {
                    "correct_answer": analysis.distractor_analysis.correct_answer,
                    "options": [
                        {
                            "option": d.option_value,
                            "count": d.selection_count,
                            "rate": d.selection_rate,
                            "avg_score": d.average_score_of_selectors,
                            "plausible": d.is_plausible
                        }
                        for d in analysis.distractor_analysis.distractor_options
                    ],
                    "non_functional_count": analysis.distractor_analysis.non_functional_distractors
                } if analysis.distractor_analysis else None,
                "recommendations": [
                    {
                        "category": r.category,
                        "severity": r.severity,
                        "message": r.message,
                        "action": r.action
                    }
                    for r in analysis.recommendations
                ]
            }
        }
    except Exception as e:
        logger.error(f"Error analyzing item: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/item-analysis/quality-summary/{exam_id}")
async def get_exam_quality_summary(exam_id: str):
    """
    Get overall quality metrics for an exam
    
    Returns aggregate statistics and quality score
    """
    try:
        from src.services.item_analysis_service import item_analysis_service
        
        summary = await item_analysis_service.get_exam_quality_summary(exam_id)
        
        return {
            "success": True,
            "data": summary
        }
    except Exception as e:
        logger.error(f"Error generating quality summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PREDICTIVE ANALYTICS ENDPOINTS
# ============================================================================

@router.get("/predictive/performance-forecast")
async def predict_performance(
    student_id: str = Query(..., description="Student ID"),
    course_id: str = Query(..., description="Course ID"),
    confidence_level: float = Query(0.95, ge=0.90, le=0.99)
):
    """
    Predict student's next exam performance
    
    Uses historical data and ML to forecast score
    """
    try:
        from src.services.predictive_service import predictive_service
        
        forecast = await predictive_service.predict_next_exam_performance(
            student_id=student_id,
            course_id=course_id,
            confidence_level=confidence_level
        )
        
        return {
            "success": True,
            "data": {
                "student_id": forecast.student_id,
                "predicted_score": forecast.next_exam_predicted_score,
                "confidence_interval": {
                    "lower": forecast.confidence_interval[0],
                    "upper": forecast.confidence_interval[1]
                },
                "probability_passing": forecast.probability_of_passing,
                "probability_high_performance": forecast.probability_of_high_performance,
                "based_on_exams": forecast.forecast_based_on_exams,
                "generated_at": forecast.generated_at.isoformat()
            }
        }
    except Exception as e:
        logger.error(f"Error predicting performance: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predictive/dropout-risk")
async def predict_dropout(
    student_id: str = Query(..., description="Student ID"),
    course_id: str = Query(..., description="Course ID")
):
    """
    Predict student's risk of dropping the course
    
    Analyzes engagement, performance, and patterns
    """
    try:
        from src.services.predictive_service import predictive_service
        
        risk = await predictive_service.predict_dropout_risk(
            student_id=student_id,
            course_id=course_id
        )
        
        return {
            "success": True,
            "data": {
                "student_id": risk.student_id,
                "dropout_probability": risk.dropout_probability,
                "risk_level": "critical" if risk.dropout_probability >= 0.7 
                             else "high" if risk.dropout_probability >= 0.5 
                             else "medium" if risk.dropout_probability >= 0.3 
                             else "low",
                "risk_factors": risk.risk_factors,
                "protective_factors": risk.protective_factors,
                "recommended_interventions": risk.recommended_interventions,
                "confidence": risk.confidence
            }
        }
    except Exception as e:
        logger.error(f"Error predicting dropout risk: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# REPORT GENERATION ENDPOINTS
# ============================================================================

@router.get("/reports/student/{student_id}")
async def generate_student_report(
    student_id: str,
    course_id: Optional[str] = Query(None, description="Filter by course"),
    format: str = Query("pdf", description="Report format: pdf, excel, csv")
):
    """
    Generate comprehensive student performance report
    
    Available formats: pdf, excel, csv
    """
    try:
        from src.services.report_service import report_service
        
        report_bytes = await report_service.generate_student_report(
            student_id=student_id,
            course_id=course_id,
            format=format
        )
        
        from fastapi.responses import StreamingResponse
        media_types = {
            "pdf": "application/pdf",
            "excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "csv": "text/csv"
        }
        
        return StreamingResponse(
            iter([report_bytes]),
            media_type=media_types.get(format, "application/octet-stream"),
            headers={"Content-Disposition": f"attachment; filename=student_report_{student_id}.{format}"}
        )
    except Exception as e:
        logger.error(f"Error generating student report: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reports/class/{course_id}")
async def generate_class_report(
    course_id: str,
    exam_id: Optional[str] = Query(None, description="Filter by exam"),
    format: str = Query("pdf", description="Report format: pdf, excel")
):
    """
    Generate class analytics report
    
    Includes score distribution, performance metrics, and insights
    """
    try:
        from src.services.report_service import report_service
        
        report_bytes = await report_service.generate_class_report(
            course_id=course_id,
            exam_id=exam_id,
            format=format
        )
        
        from fastapi.responses import StreamingResponse
        media_types = {
            "pdf": "application/pdf",
            "excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
        
        return StreamingResponse(
            iter([report_bytes]),
            media_type=media_types.get(format, "application/pdf"),
            headers={"Content-Disposition": f"attachment; filename=class_report_{course_id}.{format}"}
        )
    except Exception as e:
        logger.error(f"Error generating class report: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reports/institution/{institution_id}")
async def generate_institution_report(
    institution_id: str,
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    format: str = Query("pdf", description="Report format: pdf, excel")
):
    """
    Generate institution-wide analytics report
    
    Includes overall trends, course comparisons, and outcomes
    """
    try:
        from src.services.report_service import report_service
        from datetime import datetime
        
        start = datetime.fromisoformat(start_date) if start_date else None
        end = datetime.fromisoformat(end_date) if end_date else None
        
        report_bytes = await report_service.generate_institution_report(
            institution_id=institution_id,
            start_date=start,
            end_date=end,
            format=format
        )
        
        from fastapi.responses import StreamingResponse
        media_types = {
            "pdf": "application/pdf",
            "excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
        
        return StreamingResponse(
            iter([report_bytes]),
            media_type=media_types.get(format, "application/pdf"),
            headers={"Content-Disposition": f"attachment; filename=institution_report_{institution_id}.{format}"}
        )
    except Exception as e:
        logger.error(f"Error generating institution report: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# QUESTION RANDOMIZATION ENDPOINTS (Phase 3)
# ============================================================================

@router.post("/randomization/generate")
async def generate_randomized_exam(
    exam_id: str = Query(..., description="Exam ID"),
    student_id: str = Query(..., description="Student ID"),
    randomize_questions: bool = Query(True, description="Shuffle question order"),
    randomize_options: bool = Query(True, description="Shuffle answer options"),
    seed: Optional[int] = Query(None, description="Custom randomization seed (optional)")
):
    """
    Generate a randomized version of an exam for a student
    
    Creates unique exam version with:
    - Randomized question order
    - Randomized answer option order
    - Deterministic per student (same version on reload)
    - Grading mapping preserved
    """
    try:
        from src.services.randomization_service import randomization_service
        
        result = await randomization_service.generate_randomized_exam(
            exam_id=exam_id,
            student_id=student_id,
            randomize_questions=randomize_questions,
            randomize_options=randomize_options,
            seed=seed
        )
        
        return {
            "success": True,
            "data": result,
            "message": "Randomized exam generated successfully"
        }
    except Exception as e:
        logger.error(f"Error generating randomized exam: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/randomization/verify")
async def verify_randomized_answer(
    exam_id: str = Query(..., description="Exam ID"),
    student_id: str = Query(..., description="Student ID"),
    question_position: int = Query(..., description="Position in randomized exam"),
    selected_option: int = Query(..., description="Selected option index")
):
    """
    Verify a student's answer for a randomized exam
    
    Maps randomized answer back to original for grading
    """
    try:
        from src.services.randomization_service import randomization_service
        
        result = await randomization_service.verify_answer(
            exam_id=exam_id,
            student_id=student_id,
            question_position=question_position,
            selected_option=selected_option
        )
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error verifying randomized answer: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/randomization/stats/{exam_id}")
async def get_exam_randomization_stats(exam_id: str):
    """
    Get randomization statistics for an exam
    
    Shows:
    - Total number of students
    - Number of unique exam versions
    - Randomization effectiveness
    """
    try:
        from src.services.randomization_service import randomization_service
        
        stats = await randomization_service.get_exam_version_stats(exam_id)
        
        return {
            "success": True,
            "data": stats
        }
    except Exception as e:
        logger.error(f"Error getting randomization stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# RESPONSE TIME ANALYTICS ENDPOINTS (Phase 3)
# ============================================================================

@router.get("/timing/student/{student_id}")
async def analyze_student_timing(
    student_id: str,
    exam_id: Optional[str] = Query(None, description="Optional specific exam ID")
):
    """
    Analyze student's response time patterns
    
    Provides multi-dimensional analysis:
    - Speed vs accuracy correlation
    - Timing anomalies (rushing, overthinking)
    - Effort indicators
    - Optimal pace recommendations
    """
    try:
        from src.services.response_time_service import response_time_service
        
        analysis = await response_time_service.analyze_student_timing(
            student_id=student_id,
            exam_id=exam_id
        )
        
        return {
            "success": True,
            "data": {
                "student_id": analysis.student_id,
                "exam_id": analysis.exam_id,
                "questions_analyzed": analysis.total_questions_analyzed,
                "average_time_seconds": analysis.average_response_time_seconds,
                "std_dev_seconds": analysis.response_time_std_dev,
                "speed_accuracy": {
                    "fastest_quarter_accuracy": analysis.speed_accuracy_metrics.fastest_quarter_accuracy,
                    "fast_quarter_accuracy": analysis.speed_accuracy_metrics.fast_quarter_accuracy,
                    "slow_quarter_accuracy": analysis.speed_accuracy_metrics.slow_quarter_accuracy,
                    "slowest_quarter_accuracy": analysis.speed_accuracy_metrics.slowest_quarter_accuracy,
                    "correlation": analysis.speed_accuracy_metrics.correlation_coefficient,
                    "pattern": analysis.speed_accuracy_metrics.pattern_description
                },
                "timing_anomalies": [
                    {
                        "question_id": a.question_id,
                        "time_taken": a.time_taken_seconds,
                        "expected_time": a.expected_time_seconds,
                        "type": a.anomaly_type,
                        "severity": a.severity,
                        "description": a.description
                    }
                    for a in analysis.timing_anomalies
                ],
                "effort_score": analysis.effort_score,
                "optimal_time_range": analysis.optimal_time_range_seconds,
                "consistency_score": analysis.consistency_score,
                "recommendations": analysis.recommendations,
                "analyzed_at": analysis.analyzed_at
            }
        }
    except Exception as e:
        logger.error(f"Error analyzing student timing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/timing/exam/{exam_id}")
async def analyze_exam_timing_patterns(exam_id: str):
    """
    Analyze timing patterns across all students for an exam
    
    Useful for:
    - Identifying problematic questions (too time-consuming)
    - Estimating appropriate time limits
    - Detecting systematic timing issues
    """
    try:
        from src.services.response_time_service import response_time_service
        
        patterns = await response_time_service.analyze_exam_timing_patterns(exam_id)
        
        return {
            "success": True,
            "data": patterns
        }
    except Exception as e:
        logger.error(f"Error analyzing exam timing patterns: {e}")
        raise HTTPException(status_code=500, detail=str(e))



# ============================================================================
# GOAL TRACKING ENDPOINTS (Phase 3)
# ============================================================================

@router.post("/goals/create")
async def create_student_goal(
    student_id: str = Query(..., description="Student ID"),
    course_id: str = Query(..., description="Course ID"),
    goal_type: str = Query(..., description="Type: performance, mastery, completion, speed, engagement"),
    target_metric: str = Query(..., description="What to measure: score, accuracy, time, etc."),
    target_value: float = Query(..., description="Target value"),
    target_date: str = Query(..., description="Target date (YYYY-MM-DD)"),
    priority: str = Query("medium", description="Priority: low, medium, high"),
    description: Optional[str] = Query(None, description="Goal description")
):
    """
    Create a new student goal with SMART criteria
    
    Automatically creates milestones at 25%, 50%, 75%, and 100%
    """
    try:
        from datetime import datetime
        
        target_dt = datetime.fromisoformat(target_date)
        
        goal = await goal_tracking_service.create_goal(
            student_id=student_id,
            course_id=course_id,
            goal_type=goal_type,
            target_metric=target_metric,
            target_value=target_value,
            target_date=target_dt,
            description=description,
            priority=priority
        )
        
        return {
            "success": True,
            "data": goal
        }
    except Exception as e:
        logger.error(f"Error creating goal: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/goals/student/{student_id}")
async def get_student_goals(
    student_id: str,
    course_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="Filter by status: active, achieved, missed, cancelled")
):
    """Get all goals for a student"""
    try:
        goals = await goal_tracking_service.get_student_goals(
            student_id=student_id,
            course_id=course_id,
            status=status
        )
        
        return {
            "success": True,
            "data": goals,
            "count": len(goals)
        }
    except Exception as e:
        logger.error(f"Error getting student goals: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/goals/{goal_id}/update-progress")
async def update_goal_progress(
    goal_id: int,
    current_value: float = Query(..., description="Current progress value"),
    notes: Optional[str] = Query(None, description="Progress notes")
):
    """
    Update goal progress
    
    Automatically:
    - Records progress history
    - Updates milestones
    - Marks goal as achieved/missed if threshold reached
    - Triggers notifications
    """
    try:
        result = await goal_tracking_service.update_goal_progress(
            goal_id=goal_id,
            current_value=current_value,
            notes=notes
        )
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error updating goal progress: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/goals/{goal_id}")
async def get_goal_progress(
    goal_id: int,
    include_history: bool = Query(True, description="Include progress history")
):
    """Get detailed goal progress including milestones and history"""
    try:
        progress = await goal_tracking_service.get_goal_progress(
            goal_id=goal_id,
            include_history=include_history
        )
        
        return {
            "success": True,
            "data": progress
        }
    except Exception as e:
        logger.error(f"Error getting goal progress: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/goals/course/{course_id}/summary")
async def get_course_goals_summary(course_id: str):
    """Get summary of all student goals in a course"""
    try:
        summary = await goal_tracking_service.get_course_goals_summary(course_id)
        
        return {
            "success": True,
            "data": summary
        }
    except Exception as e:
        logger.error(f"Error getting course goals summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# NOTIFICATION ENDPOINTS (Phase 3)
# ============================================================================

@router.post("/notifications/send")
async def send_notification(
    user_id: str = Query(..., description="User ID"),
    user_type: str = Query(..., description="User type: student, educator, admin"),
    notification_type: str = Query(..., description="Notification type"),
    title: str = Query(..., description="Notification title"),
    message: str = Query(..., description="Notification message"),
    priority: str = Query("normal", description="Priority: critical, high, normal, low"),
    channels: Optional[str] = Query(None, description="Channels (comma-separated): email,in_app,sms")
):
    """
    Create and send a notification
    
    Respects user preferences and quiet hours
    """
    try:
        from src.services.notification_service import DeliveryChannel
        
        # Parse channels if provided
        channel_list = None
        if channels:
            channel_list = [DeliveryChannel(c.strip()) for c in channels.split(",")]
        
        notification = await notification_service.create_notification(
            user_id=user_id,
            user_type=user_type,
            notification_type=notification_type,
            title=title,
            message=message,
            priority=priority,
            channels=channel_list
        )
        
        return {
            "success": True,
            "data": notification
        }
    except Exception as e:
        logger.error(f"Error sending notification: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/notifications/user/{user_id}")
async def get_user_notifications(
    user_id: str,
    unread_only: bool = Query(False),
    limit: int = Query(50),
    offset: int = Query(0)
):
    """Get user's notifications"""
    try:
        result = await notification_service.get_user_notifications(
            user_id=user_id,
            unread_only=unread_only,
            limit=limit,
            offset=offset
        )
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error getting notifications: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    user_id: str = Query(..., description="User ID")
):
    """Mark notification as read"""
    try:
        success = await notification_service.mark_as_read(
            notification_id=notification_id,
            user_id=user_id
        )
        
        return {
            "success": success,
            "data": {"notification_id": notification_id, "read": success}
        }
    except Exception as e:
        logger.error(f"Error marking notification as read: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notifications/preferences")
async def set_notification_preferences(
    user_id: str = Query(..., description="User ID"),
    user_type: str = Query(..., description="User type"),
    notification_type: str = Query(..., description="Notification type"),
    enabled_channels: str = Query(..., description="Channels (comma-separated): email,in_app,sms"),
    quiet_hours_start: Optional[str] = Query(None, description="Start time (HH:MM)"),
    quiet_hours_end: Optional[str] = Query(None, description="End time (HH:MM)"),
    frequency: str = Query("immediate", description="Frequency: immediate, daily_digest, weekly_digest")
):
    """Set user notification preferences"""
    try:
        from src.services.notification_service import DeliveryChannel
        
        channels = [DeliveryChannel(c.strip()) for c in enabled_channels.split(",")]
        
        prefs = await notification_service.set_user_preferences(
            user_id=user_id,
            user_type=user_type,
            notification_type=notification_type,
            enabled_channels=channels,
            quiet_hours_start=quiet_hours_start,
            quiet_hours_end=quiet_hours_end,
            frequency=frequency
        )
        
        return {
            "success": True,
            "data": prefs
        }
    except Exception as e:
        logger.error(f"Error setting notification preferences: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# INTERVENTION TRACKING ENDPOINTS (Phase 3)
# ============================================================================

@router.post("/interventions/create")
async def create_intervention(
    student_id: str = Query(..., description="Student ID"),
    educator_id: str = Query(..., description="Educator ID"),
    course_id: str = Query(..., description="Course ID"),
    intervention_type: str = Query(..., description="Type: tutoring, mentoring, resource_provision, etc."),
    description: str = Query(..., description="Intervention description"),
    trigger_reason: Optional[str] = Query(None, description="Reason for intervention"),
    expected_duration_days: int = Query(14, description="Expected duration in days")
):
    """
    Create a new intervention for an at-risk student
    
    Types:
    - tutoring: Direct academic support
    - mentoring: Guidance and motivation
    - resource_provision: Materials, tools, or assistance
    - counseling: Personal/emotional support
    - study_group: Peer learning
    - tech_support: Technical assistance
    """
    try:
        intervention = await intervention_service.create_intervention(
            student_id=student_id,
            educator_id=educator_id,
            course_id=course_id,
            intervention_type=intervention_type,
            description=description,
            trigger_reason=trigger_reason,
            expected_duration_days=expected_duration_days
        )
        
        return {
            "success": True,
            "data": intervention
        }
    except Exception as e:
        logger.error(f"Error creating intervention: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/interventions/{intervention_id}/start")
async def start_intervention(intervention_id: int):
    """Activate an intervention"""
    try:
        result = await intervention_service.start_intervention(intervention_id)
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error starting intervention: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/interventions/{intervention_id}/checkin")
async def add_intervention_checkin(
    intervention_id: int,
    educator_id: str = Query(..., description="Educator ID"),
    student_response: str = Query(..., description="Student response: positive, neutral, negative"),
    progress_notes: str = Query(..., description="Progress notes"),
    next_steps: Optional[str] = Query(None, description="Next steps")
):
    """
    Add a progress check-in to an intervention
    
    Tracks student engagement and intervention progress
    """
    try:
        checkin = await intervention_service.add_checkin(
            intervention_id=intervention_id,
            educator_id=educator_id,
            student_response=student_response,
            progress_notes=progress_notes,
            next_steps=next_steps
        )
        
        return {
            "success": True,
            "data": checkin
        }
    except Exception as e:
        logger.error(f"Error adding check-in: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/interventions/{intervention_id}/outcome")
async def record_intervention_outcome(
    intervention_id: int,
    outcome_metric: str = Query(..., description="What metric: score_improvement, attendance_improvement, etc."),
    baseline_value: float = Query(..., description="Value before intervention"),
    post_intervention_value: float = Query(..., description="Value after intervention"),
    notes: Optional[str] = Query(None, description="Outcome notes")
):
    """
    Record an outcome measurement for an intervention
    
    Automatically calculates improvement percentage
    """
    try:
        outcome = await intervention_service.record_outcome(
            intervention_id=intervention_id,
            outcome_metric=outcome_metric,
            baseline_value=baseline_value,
            post_intervention_value=post_intervention_value,
            notes=notes
        )
        
        return {
            "success": True,
            "data": outcome
        }
    except Exception as e:
        logger.error(f"Error recording outcome: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/interventions/{intervention_id}/complete")
async def complete_intervention(
    intervention_id: int,
    summary: Optional[str] = Query(None, description="Completion summary")
):
    """
    Complete an intervention and calculate effectiveness
    
    Returns effectiveness metrics
    """
    try:
        result = await intervention_service.complete_intervention(
            intervention_id=intervention_id,
            summary=summary
        )
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        logger.error(f"Error completing intervention: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/interventions/{intervention_id}")
async def get_intervention_details(intervention_id: int):
    """Get detailed intervention information including outcomes and check-ins"""
    try:
        details = await intervention_service.get_intervention_details(intervention_id)
        
        return {
            "success": True,
            "data": details
        }
    except Exception as e:
        logger.error(f"Error getting intervention details: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/interventions/student/{student_id}")
async def get_student_interventions(
    student_id: str,
    course_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="Filter by status: planning, active, paused, completed, cancelled")
):
    """Get all interventions for a student"""
    try:
        interventions = await intervention_service.get_student_interventions(
            student_id=student_id,
            course_id=course_id,
            status=status
        )
        
        return {
            "success": True,
            "data": interventions,
            "count": len(interventions)
        }
    except Exception as e:
        logger.error(f"Error getting student interventions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/interventions/course/{course_id}/effectiveness")
async def get_intervention_effectiveness_report(course_id: str):
    """
    Get intervention effectiveness report for a course
    
    Shows:
    - Total interventions and success rates
    - By intervention type
    - Average improvement metrics
    """
    try:
        report = await intervention_service.get_effectiveness_report(course_id)
        
        return {
            "success": True,
            "data": report
        }
    except Exception as e:
        logger.error(f"Error generating effectiveness report: {e}")
        raise HTTPException(status_code=500, detail=str(e))
