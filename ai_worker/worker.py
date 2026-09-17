import os
import asyncio
import torch
import httpx
from arq.connections import RedisSettings

# Check GPU availability
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"🔥 AI Worker Ready! Using device: {device.upper()}")
if device == "cuda":
    print(f"GPU Name: {torch.cuda.get_device_name(0)}")

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

async def predict_flood_risk(ctx, image_name: str, location_id: int, job_id: str = None):
    """
    AI Processing task for flood and landslide risk inference.
    Executes inference and posts results back to backend via internal webhook.
    """
    print(f"[AI Worker] Processing image '{image_name}' for location {location_id} on {device.upper()}... (Job ID: {job_id})")
    
    # Simulate AI Model Inference
    await asyncio.sleep(2)
    
    risk_level = "moderate"
    risk_score = 0.68
    details = {
        "device": device.upper(),
        "image_processed": image_name,
        "location_id": location_id,
        "simulated_flood_depth_m": 1.25,
        "slope_stability_index": 0.45,
        "rainfall_estimate_mm": 115.0,
        "confidence": 0.91
    }
    
    print(f"[AI Worker] Inference completed for job: {job_id} | Risk: {risk_level} (Score: {risk_score})")

    # Send results to Backend Internal Webhook if job_id is provided
    if job_id:
        webhook_url = f"{BACKEND_URL}/api/v1/internal/webhook/results"
        payload = {
            "job_id": job_id,
            "status": "completed",
            "risk_level": risk_level,
            "score": risk_score,
            "details": details
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(webhook_url, json=payload)
                if res.status_code == 200:
                    print(f"[AI Worker] Successfully reported results to backend webhook for job: {job_id}")
                else:
                    print(f"[AI Worker] Webhook returned status {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[AI Worker] Failed to call webhook at {webhook_url}: {e}")

    return {"status": "success", "risk_level": risk_level, "job_id": job_id}

class WorkerSettings:
    functions = [predict_flood_risk]
    redis_settings = RedisSettings.from_dsn(REDIS_URL)