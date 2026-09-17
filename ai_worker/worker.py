import os
import asyncio
import torch
import httpx
from arq.connections import RedisSettings

# Check GPU availability
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"🔥 GeoPrice AI Worker Ready! Using device: {device.upper()}")
if device == "cuda":
    print(f"GPU Name: {torch.cuda.get_device_name(0)}")

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

async def predict_land_price(
    ctx,
    plot_id: int,
    area_size_sqm: float,
    features: dict = None,
    job_id: str = None
):
    """
    AI Valuation task for Land Price Prediction.
    Executes valuation model inference and posts results back to backend via internal webhook.
    """
    print(f"[GeoPrice Worker] Valuating land plot {plot_id} ({area_size_sqm} sq.m.) on {device.upper()}... (Job ID: {job_id})")
    
    # Simulate AI Model Valuation Inference (e.g. XGBoost / Spatial Neural Net)
    await asyncio.sleep(2)
    
    features = features or {}
    distance_to_transit = features.get("distance_to_bts_m", 500)
    
    # Simulated baseline price logic based on spatial factors
    base_sqm_price = 280000.0
    if distance_to_transit < 400:
        base_sqm_price += 65000.0
    
    predicted_price_per_sqm = round(base_sqm_price, 2)
    total_predicted_price = round(predicted_price_per_sqm * area_size_sqm, 2)
    confidence_score = 0.93
    model_version = "geoprice-xgb-v1.0"
    
    details = {
        "device": device.upper(),
        "plot_id": plot_id,
        "area_size_sqm": area_size_sqm,
        "predicted_price_per_sqm_thb": predicted_price_per_sqm,
        "total_predicted_price_thb": total_predicted_price,
        "features_evaluated": features,
        "comparables_count": 18,
        "confidence_score": confidence_score
    }
    
    print(f"[GeoPrice Worker] Valuation completed for job {job_id} | Price/sqm: {predicted_price_per_sqm:,.2f} THB | Total: {total_predicted_price:,.2f} THB")

    # Send results to Backend Internal Webhook if job_id is provided
    if job_id:
        webhook_url = f"{BACKEND_URL}/api/v1/internal/webhook/results"
        payload = {
            "job_id": job_id,
            "status": "completed",
            "predicted_price_per_sqm": predicted_price_per_sqm,
            "total_predicted_price": total_predicted_price,
            "confidence_score": confidence_score,
            "model_version": model_version,
            "details": details
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(webhook_url, json=payload)
                if res.status_code == 200:
                    print(f"[GeoPrice Worker] Successfully reported valuation to backend webhook for job: {job_id}")
                else:
                    print(f"[GeoPrice Worker] Webhook returned status {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[GeoPrice Worker] Failed to call webhook at {webhook_url}: {e}")

    return {
        "status": "success",
        "predicted_price_per_sqm": predicted_price_per_sqm,
        "total_predicted_price": total_predicted_price,
        "job_id": job_id
    }

class WorkerSettings:
    functions = [predict_land_price]
    redis_settings = RedisSettings.from_dsn(REDIS_URL)