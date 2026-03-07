# Quick start script for model training (Windows)

Write-Host "🎓 Academic Intelligence Platform - Model Training" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "src\training\train_models.py")) {
    Write-Host "❌ Error: Please run this script from backend\analytics directory" -ForegroundColor Red
    exit 1
}

# Check Python version
$pythonVersion = python --version 2>&1
Write-Host "✓ Python version: $pythonVersion" -ForegroundColor Green

# Install dependencies
Write-Host ""
Write-Host "📦 Installing training dependencies..." -ForegroundColor Yellow
pip install -q tensorboard matplotlib seaborn plotly

# Check GPU availability
Write-Host ""
Write-Host "🔍 Checking GPU availability..." -ForegroundColor Yellow
python -c "import torch; print('✓ GPU available:', torch.cuda.is_available()); print('  Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"

# Check database connection
Write-Host ""
Write-Host "🔍 Checking database connection..." -ForegroundColor Yellow
python -c "import asyncio; from src.config.database import DatabaseConfig; asyncio.run(DatabaseConfig().connect())" 2>$null
if ($?) {
    Write-Host "✓ Database connected" -ForegroundColor Green
} else {
    Write-Host "❌ Database connection failed" -ForegroundColor Red
}

# Start training
Write-Host ""
Write-Host "🚀 Starting model training..." -ForegroundColor Cyan
Write-Host "This will take 1-3 hours depending on hardware." -ForegroundColor Yellow
Write-Host ""

$response = Read-Host "Continue? (y/n)"

if ($response -eq 'y' -or $response -eq 'Y') {
    # Run training
    python src\training\train_models.py
    
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "✅ Training completed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Check evaluation results:" -ForegroundColor Yellow
    Write-Host "   - evaluation_results\risk_detection\"
    Write-Host "   - evaluation_results\feedback_quality_metrics.json"
    Write-Host ""
    Write-Host "🤖 Trained models saved to:" -ForegroundColor Yellow
    Write-Host "   - models\risk_detection_finetuned\best_model"
    Write-Host "   - models\feedback_generation_finetuned\best_model"
    Write-Host ""
    Write-Host "📈 View training logs:" -ForegroundColor Yellow
    Write-Host "   tensorboard --logdir=models\"
    Write-Host ""
    Write-Host "🔄 Restart analytics service to use new models" -ForegroundColor Cyan
} else {
    Write-Host "Training cancelled." -ForegroundColor Yellow
}
