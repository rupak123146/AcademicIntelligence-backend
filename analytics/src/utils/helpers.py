"""
🎓 Academic Intelligence Platform - Utility Helpers
"""

from typing import Any, Dict, List, Optional, Union
from datetime import datetime, timedelta
from decimal import Decimal
import statistics
import numpy as np


def calculate_percentage(part: Union[int, float], total: Union[int, float]) -> float:
    """Calculate percentage safely."""
    if total == 0:
        return 0.0
    return round((part / total) * 100, 2)


def calculate_average(values: List[Union[int, float]]) -> float:
    """Calculate average of a list of values."""
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def calculate_median(values: List[Union[int, float]]) -> float:
    """Calculate median of a list of values."""
    if not values:
        return 0.0
    return round(statistics.median(values), 2)


def calculate_std_dev(values: List[Union[int, float]]) -> float:
    """Calculate standard deviation."""
    if len(values) < 2:
        return 0.0
    return round(statistics.stdev(values), 2)


def calculate_moving_average(values: List[float], window: int) -> List[float]:
    """Calculate moving average with given window size."""
    if len(values) < window:
        return values
    
    result = []
    for i in range(len(values) - window + 1):
        window_avg = sum(values[i:i + window]) / window
        result.append(round(window_avg, 2))
    
    return result


def calculate_exponential_moving_average(values: List[float], alpha: float = 0.3) -> List[float]:
    """Calculate exponential moving average."""
    if not values:
        return []
    
    ema = [values[0]]
    for i in range(1, len(values)):
        ema_value = alpha * values[i] + (1 - alpha) * ema[-1]
        ema.append(round(ema_value, 2))
    
    return ema


def calculate_linear_regression_slope(values: List[float]) -> float:
    """
    Calculate slope using simple linear regression.
    Positive slope = improving trend
    Negative slope = declining trend
    """
    if len(values) < 2:
        return 0.0
    
    n = len(values)
    x = list(range(n))
    
    x_mean = sum(x) / n
    y_mean = sum(values) / n
    
    numerator = sum((x[i] - x_mean) * (values[i] - y_mean) for i in range(n))
    denominator = sum((x[i] - x_mean) ** 2 for i in range(n))
    
    if denominator == 0:
        return 0.0
    
    return round(numerator / denominator, 4)


def calculate_consistency_score(values: List[float]) -> float:
    """
    Calculate consistency score (0-100).
    Higher score = more consistent performance.
    """
    if len(values) < 2:
        return 100.0
    
    mean = statistics.mean(values)
    if mean == 0:
        return 0.0
    
    cv = statistics.stdev(values) / mean  # Coefficient of variation
    consistency = max(0, 100 - (cv * 100))
    
    return round(consistency, 2)


def get_mastery_level(accuracy: float) -> str:
    """Determine mastery level based on accuracy percentage."""
    if accuracy >= 90:
        return "expert"
    elif accuracy >= 75:
        return "advanced"
    elif accuracy >= 60:
        return "intermediate"
    elif accuracy >= 40:
        return "beginner"
    else:
        return "novice"


def get_performance_tag(accuracy: float, benchmark: float) -> str:
    """Get performance tag compared to benchmark."""
    diff = accuracy - benchmark
    
    if diff >= 15:
        return "excellent"
    elif diff >= 5:
        return "above_average"
    elif diff >= -5:
        return "average"
    elif diff >= -15:
        return "below_average"
    else:
        return "needs_improvement"


def get_gap_severity(accuracy: float) -> str:
    """Determine gap severity based on accuracy."""
    if accuracy < 30:
        return "critical"
    elif accuracy < 50:
        return "high"
    elif accuracy < 70:
        return "medium"
    else:
        return "low"


def calculate_grade(percentage: float) -> str:
    """Calculate letter grade from percentage."""
    if percentage >= 90:
        return "A+"
    elif percentage >= 85:
        return "A"
    elif percentage >= 80:
        return "A-"
    elif percentage >= 75:
        return "B+"
    elif percentage >= 70:
        return "B"
    elif percentage >= 65:
        return "B-"
    elif percentage >= 60:
        return "C+"
    elif percentage >= 55:
        return "C"
    elif percentage >= 50:
        return "C-"
    elif percentage >= 45:
        return "D+"
    elif percentage >= 40:
        return "D"
    else:
        return "F"


def get_grade_distribution(scores: List[float]) -> Dict[str, int]:
    """Calculate grade distribution from scores."""
    distribution = {
        "A+": 0, "A": 0, "A-": 0,
        "B+": 0, "B": 0, "B-": 0,
        "C+": 0, "C": 0, "C-": 0,
        "D+": 0, "D": 0, "F": 0
    }
    
    for score in scores:
        grade = calculate_grade(score)
        distribution[grade] += 1
    
    return distribution


def get_percentile(value: float, values: List[float]) -> float:
    """Calculate percentile rank of a value in a list."""
    if not values:
        return 0.0
    
    count_below = sum(1 for v in values if v < value)
    percentile = (count_below / len(values)) * 100
    
    return round(percentile, 2)


def get_quartile(values: List[float]) -> Dict[str, float]:
    """Calculate quartiles for a list of values."""
    if not values:
        return {"q1": 0, "q2": 0, "q3": 0}
    
    sorted_values = sorted(values)
    n = len(sorted_values)
    
    q1_idx = n // 4
    q2_idx = n // 2
    q3_idx = (3 * n) // 4
    
    return {
        "q1": sorted_values[q1_idx],
        "q2": sorted_values[q2_idx],
        "q3": sorted_values[q3_idx]
    }


def format_duration(seconds: int) -> str:
    """Format duration in seconds to human readable string."""
    if seconds < 60:
        return f"{seconds}s"
    elif seconds < 3600:
        minutes = seconds // 60
        secs = seconds % 60
        return f"{minutes}m {secs}s"
    else:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        return f"{hours}h {minutes}m"


def time_ago(dt: datetime) -> str:
    """Convert datetime to 'time ago' string."""
    now = datetime.utcnow()
    diff = now - dt
    
    seconds = diff.total_seconds()
    
    if seconds < 60:
        return "just now"
    elif seconds < 3600:
        minutes = int(seconds / 60)
        return f"{minutes} minute{'s' if minutes > 1 else ''} ago"
    elif seconds < 86400:
        hours = int(seconds / 3600)
        return f"{hours} hour{'s' if hours > 1 else ''} ago"
    elif seconds < 604800:
        days = int(seconds / 86400)
        return f"{days} day{'s' if days > 1 else ''} ago"
    elif seconds < 2592000:
        weeks = int(seconds / 604800)
        return f"{weeks} week{'s' if weeks > 1 else ''} ago"
    else:
        months = int(seconds / 2592000)
        return f"{months} month{'s' if months > 1 else ''} ago"


def chunk_list(lst: List[Any], chunk_size: int) -> List[List[Any]]:
    """Split list into chunks of specified size."""
    return [lst[i:i + chunk_size] for i in range(0, len(lst), chunk_size)]


def safe_divide(numerator: Union[int, float], denominator: Union[int, float], default: float = 0.0) -> float:
    """Safely divide two numbers."""
    if denominator == 0:
        return default
    return numerator / denominator


def round_to_decimal(value: float, places: int = 2) -> Decimal:
    """Round float to Decimal with specified decimal places."""
    return Decimal(str(round(value, places)))


def normalize_score(score: float, min_score: float, max_score: float) -> float:
    """Normalize a score to 0-100 scale."""
    if max_score == min_score:
        return 50.0
    
    normalized = ((score - min_score) / (max_score - min_score)) * 100
    return round(max(0, min(100, normalized)), 2)


def calculate_z_score(value: float, mean: float, std_dev: float) -> float:
    """Calculate z-score for a value."""
    if std_dev == 0:
        return 0.0
    return round((value - mean) / std_dev, 2)


def identify_outliers(values: List[float], threshold: float = 1.5) -> List[int]:
    """
    Identify outlier indices using IQR method.
    Returns indices of outlier values.
    """
    if len(values) < 4:
        return []
    
    q1 = np.percentile(values, 25)
    q3 = np.percentile(values, 75)
    iqr = q3 - q1
    
    lower_bound = q1 - threshold * iqr
    upper_bound = q3 + threshold * iqr
    
    outliers = []
    for i, value in enumerate(values):
        if value < lower_bound or value > upper_bound:
            outliers.append(i)
    
    return outliers
