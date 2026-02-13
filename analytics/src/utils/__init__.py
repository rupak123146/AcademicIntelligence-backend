"""
🎓 Academic Intelligence Platform - Utilities Package
"""

from src.utils.logger import logger
from src.utils.helpers import (
    calculate_percentage,
    calculate_average,
    calculate_median,
    calculate_std_dev,
    calculate_moving_average,
    calculate_exponential_moving_average,
    calculate_linear_regression_slope,
    calculate_consistency_score,
    get_mastery_level,
    get_performance_tag,
    get_gap_severity,
    calculate_grade,
    get_grade_distribution,
    get_percentile,
    get_quartile,
    format_duration,
    time_ago,
    chunk_list,
    safe_divide,
    round_to_decimal,
    normalize_score,
    calculate_z_score,
    identify_outliers
)


__all__ = [
    "logger",
    "calculate_percentage",
    "calculate_average",
    "calculate_median",
    "calculate_std_dev",
    "calculate_moving_average",
    "calculate_exponential_moving_average",
    "calculate_linear_regression_slope",
    "calculate_consistency_score",
    "get_mastery_level",
    "get_performance_tag",
    "get_gap_severity",
    "calculate_grade",
    "get_grade_distribution",
    "get_percentile",
    "get_quartile",
    "format_duration",
    "time_ago",
    "chunk_list",
    "safe_divide",
    "round_to_decimal",
    "normalize_score",
    "calculate_z_score",
    "identify_outliers"
]
