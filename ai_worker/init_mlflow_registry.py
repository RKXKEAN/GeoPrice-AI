import os
import boto3
import json
from mlflow.tracking import MlflowClient

mlflow_uri = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")
os.environ["MLFLOW_TRACKING_URI"] = mlflow_uri
client = MlflowClient()

models = [
    {
        "name": "GeoPrice-Spatial-Valuation-Model",
        "desc": "Slot 1: AI Model for Parcel-level Land Valuation (XGBoost / LightGBM / RF / Stacking)",
        "source": "s3://models/Price Prediction/3_XGBoost_Model.joblib",
        "ver_desc": "XGBoost Regressor (17 Spatial Features) - Production Active Model",
        "tags": {"slot": "slot1_spatial", "framework": "XGBoost Regressor", "status": "Production"}
    },
    {
        "name": "GeoPrice-Econometrics-ARIMAX-Model",
        "desc": "Slot 2: Macroeconomic Time-Series Model (SARIMAX / ARIMAX with Exogenous Factors)",
        "source": "s3://models/Price Prediction/arimax_land_price_5features.joblib",
        "ver_desc": "SARIMAX (1,1,0) 5-Macroeconomic Features - Production Active Model",
        "tags": {"slot": "slot2_timeseries", "framework": "Statsmodels SARIMAX", "status": "Production"}
    },
    {
        "name": "GeoPrice-Satellite-Vision-YOLOv8",
        "desc": "Slot 3: Satellite Imagery Building Footprint & Cadastral Detection (Ultralytics YOLOv8)",
        "source": "s3://models/model_Yolov8/best.pt",
        "ver_desc": "YOLOv8 Satellite Building Detection (Best Weights) - Production Active Model",
        "tags": {"slot": "slot3_vision", "framework": "Ultralytics YOLOv8", "status": "Production"}
    }
]

for m in models:
    try:
        client.create_registered_model(m["name"], description=m["desc"])
        print(f"Created registered model: {m['name']}")
    except Exception as e:
        print(f"Model {m['name']} already exists: {e}")
    
    reg = client.get_registered_model(m["name"])
    if not reg.latest_versions:
        mv = client.create_model_version(
            name=m["name"],
            source=m["source"],
            description=m["ver_desc"],
            tags=m["tags"]
        )
        client.set_registered_model_alias(m["name"], "active", mv.version)
        try:
            client.transition_model_version_stage(m["name"], mv.version, "Production")
        except Exception:
            pass
        print(f"Created version {mv.version} for {m['name']}")
    else:
        print(f"{m['name']} already has versions: {[v.version for v in reg.latest_versions]}")

print("Current Registered Models in MLflow:")
for rm in client.search_registered_models():
    print(f" - {rm.name} (Latest versions: {[v.version for v in rm.latest_versions]})")
