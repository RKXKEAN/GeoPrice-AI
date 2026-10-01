@echo off
chcp 65001 >nul
title GeoPrice AI - Unified Automated MLOps Daemon (YOLO + Price Prediction)
echo ===================================================================
echo  GeoPrice AI: Unified MLOps Automated Pipeline Daemon (24 Hours)
echo ===================================================================
echo  ระบบตรวจจับและรีเทรนอัตโนมัติ 2 แกนหลัก:
echo  1. [Vision Node] YOLO Segmentation: สแกน MinIO 'images' ทุก 60 วิ
echo     - Output: scripts/output/auto_segmented_parcels.geojson
echo  2. [Price Node] 4-Model Valuation Retrain: รีเทรนโมเดลทำนายราคา
echo     - Models: Ensemble, LightGBM, XGBoost, Random Forest
echo     - Metrics: ส่งขึ้น MLflow Server (พอร์ต 5000)
echo     - Upload: บันทึกขึ้น MinIO 'models/price_prediction/'
echo ===================================================================

:: ตรวจสอบไฟล์สคริปต์รีเทรนราคา (รองรับทุกชื่อ)
set RETRAIN_SCRIPT="%~dp0retrain_price_prediction2.py"
if not exist %RETRAIN_SCRIPT% set RETRAIN_SCRIPT="%~dp0retrain_price_prediction_2.py"
if not exist %RETRAIN_SCRIPT% set RETRAIN_SCRIPT="%~dp0retrain_price_prediction.py"

echo [Price Node] กำลังตรวจสอบและรีเทรนโมเดลทำนายราคาเข้า MinIO / MLflow...
python %RETRAIN_SCRIPT% --minio-endpoint localhost:9000 --mlflow-uri http://localhost:5000

:: เริ่มต้น Auto Polygon Pipeline Daemon ทำงานคู่กัน 24 ชม.
echo.
echo [Vision Node] กำลังเริ่มต้นระบบเฝ้าดู MinIO และประมวลผลสิ่งปลูกสร้าง...
python "%~dp0auto_polygon_pipeline.py" --daemon --interval 60 --conf 0.60

pause
