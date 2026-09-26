import json
import math
import logging
from pathlib import Path
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.appraisal_dataset import AppraisalDataset
from app.services.minio_service import MinIOService, get_minio_service
from app.schemas.appraisal_dataset import (
    AppraisalDatasetCreate,
    AppraisalDatasetResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()

PARCELS_DATA_FILE = Path(__file__).resolve().parents[3] / "data" / "hatyai_parcels.json"

def _calc_polygon_area_sqm(coordinates) -> float:
    """Calculate approximate polygon area in square meters from lon/lat coordinates."""
    try:
        if not coordinates or not isinstance(coordinates, list) or len(coordinates) == 0:
            return 250.0
        ring = coordinates[0]
        if len(ring) < 3:
            return 250.0
        lat0 = ring[0][1]
        m_lat = 111320.0
        m_lon = 111320.0 * math.cos(math.radians(lat0))
        area = 0.0
        for i in range(len(ring) - 1):
            x1 = ring[i][0] * m_lon
            y1 = ring[i][1] * m_lat
            x2 = ring[i + 1][0] * m_lon
            y2 = ring[i + 1][1] * m_lat
            area += (x1 * y2 - x2 * y1)
        return round(abs(area) / 2.0, 2)
    except Exception:
        return 350.0

def _calc_centroid(coords: list) -> tuple[float, float]:
    """Calculate (latitude, longitude) center point from coordinates."""
    try:
        ring = coords[0] if isinstance(coords[0][0], (list, tuple)) else coords
        avg_lon = sum(pt[0] for pt in ring) / len(ring)
        avg_lat = sum(pt[1] for pt in ring) / len(ring)
        return round(avg_lat, 6), round(avg_lon, 6)
    except Exception:
        return 7.0084, 100.4767

def _get_price_ref(land_type: str, parcel_id_num: int) -> float:
    """Returns baseline government reference appraisal price in THB/sqm."""
    lt = (land_type or "").lower()
    if any(k in lt for k in ["retail", "ห้าง", "ค้าปลีก", "พาณิชยกรรม", "commercial"]):
        base = 95000.0
    elif any(k in lt for k in ["hospital", "โรงพยาบาล", "ราชการ", "station", "สถานี"]):
        base = 75000.0
    elif any(k in lt for k in ["condo", "คอนโด", "อาคารสูง", "apartment"]):
        base = 82000.0
    else:
        base = 52000.0
    variance = (parcel_id_num % 15) * 1500.0
    return float(base + variance)

@router.get(
    "/active-geojson",
    summary="Get GeoJSON FeatureCollection of active appraisal dataset",
    description="Reads the active appraisal dataset file (from MinIO or simulated local dataset) and returns a GeoJSON FeatureCollection with parcel_id, area_size, and price_ref properties."
)
def get_active_appraisal_geojson(
    db: Session = Depends(get_db),
    minio_svc: MinIOService = Depends(get_minio_service)
) -> Dict[str, Any]:
    active_dataset = db.query(AppraisalDataset).filter(AppraisalDataset.is_active.is_(True)).first()
    if not active_dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active appraisal dataset found. Please mark a dataset as active first."
        )

    # 1. Attempt reading from MinIO if file exists
    if minio_svc.check_dataset_exists(active_dataset.bucket_name, active_dataset.file_name):
        try:
            obj = minio_svc.client.get_object(active_dataset.bucket_name, active_dataset.file_name)
            raw = obj.read().decode("utf-8")
            obj.close()
            obj.release_conn()
            if active_dataset.file_name.endswith((".json", ".geojson")):
                data = json.loads(raw)
                if data.get("type") == "FeatureCollection" and data.get("features"):
                    # Ensure each feature has required properties
                    for feat in data["features"]:
                        props = feat.setdefault("properties", {})
                        coords = feat.get("geometry", {}).get("coordinates", [])
                        if "parcel_id" not in props:
                            props["parcel_id"] = props.get("id") or str(feat.get("id", "PARCEL"))
                        if "area_size" not in props:
                            props["area_size"] = _calc_polygon_area_sqm(coords)
                        if "price_ref" not in props:
                            props["price_ref"] = 65000.0
                        if "latitude" not in props or "longitude" not in props:
                            c_lat, c_lon = _calc_centroid(coords)
                            props.setdefault("latitude", c_lat)
                            props.setdefault("longitude", c_lon)
                    return data
        except Exception as e:
            logger.warning(f"Error reading dataset from MinIO: {e}, using local sample dataset fallback")

    # 2. Simulated read from local dataset (for development or until custom dataset is uploaded)
    if not PARCELS_DATA_FILE.exists():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Sample parcels dataset file not found on server."
        )

    with open(PARCELS_DATA_FILE, "r", encoding="utf-8") as f:
        source_data = json.load(f)

    features = []
    for idx, feat in enumerate(source_data.get("features", [])):
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [])
        area_size = _calc_polygon_area_sqm(coords)
        parcel_id = props.get("id") or f"PARCEL-{idx + 1:04d}"
        price_ref = _get_price_ref(props.get("land_type", ""), idx)
        lat, lon = _calc_centroid(coords)

        features.append({
            "type": "Feature",
            "id": feat.get("id", idx + 1),
            "properties": {
                "parcel_id": parcel_id,
                "area_size": area_size,
                "price_ref": price_ref,
                "latitude": lat,
                "longitude": lon,
                "name": props.get("name") or f"แปลงที่ดิน {parcel_id}",
                "land_type": props.get("land_type", "ทั่วไป"),
                "street": props.get("street", ""),
                "district": props.get("district", "อำเภอหาดใหญ่"),
                "province": props.get("province", "สงขลา"),
                "active_dataset": active_dataset.file_name,
                "bucket": active_dataset.bucket_name
            },
            "geometry": feat.get("geometry")
        })

    return {
        "type": "FeatureCollection",
        "metadata": {
            "dataset_id": active_dataset.id,
            "bucket_name": active_dataset.bucket_name,
            "file_name": active_dataset.file_name,
            "is_active": True,
            "description": active_dataset.description,
            "total_parcels": len(features)
        },
        "features": features
    }

@router.get(
    "/active",
    response_model=AppraisalDatasetResponse,
    summary="Get currently active appraisal dataset",
    description="Returns the appraisal dataset file that is currently marked as active (is_active == True)."
)
def get_active_appraisal_dataset(
    db: Session = Depends(get_db)
):
    active_dataset = db.query(AppraisalDataset).filter(AppraisalDataset.is_active.is_(True)).first()
    if not active_dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active appraisal dataset found."
        )
    return active_dataset

@router.get(
    "",
    response_model=List[AppraisalDatasetResponse],
    summary="List all appraisal datasets",
    description="Returns a list of all registered appraisal datasets ordered by creation date."
)
@router.get(
    "/",
    response_model=List[AppraisalDatasetResponse],
    include_in_schema=False
)
def list_appraisal_datasets(
    db: Session = Depends(get_db)
):
    return db.query(AppraisalDataset).order_by(AppraisalDataset.created_at.desc()).all()

@router.post(
    "",
    response_model=AppraisalDatasetResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new appraisal dataset",
    description="Records metadata for a new appraisal dataset file. If is_active is set to True, all other datasets will be deactivated."
)
@router.post(
    "/",
    response_model=AppraisalDatasetResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False
)
def create_appraisal_dataset(
    dataset_in: AppraisalDatasetCreate,
    db: Session = Depends(get_db)
):
    # Check if file_name already exists
    existing = db.query(AppraisalDataset).filter(AppraisalDataset.file_name == dataset_in.file_name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Appraisal dataset with file_name '{dataset_in.file_name}' already exists."
        )

    try:
        # If this dataset is set to active, deactivate all others
        if dataset_in.is_active:
            db.query(AppraisalDataset).update({AppraisalDataset.is_active: False})

        new_dataset = AppraisalDataset(
            bucket_name=dataset_in.bucket_name,
            file_name=dataset_in.file_name,
            is_active=dataset_in.is_active,
            description=dataset_in.description
        )
        db.add(new_dataset)
        db.commit()
        db.refresh(new_dataset)
        logger.info(f"Registered appraisal dataset: id={new_dataset.id}, file_name={new_dataset.file_name}, active={new_dataset.is_active}")
        return new_dataset
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating appraisal dataset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create appraisal dataset: {str(e)}"
        )

@router.put(
    "/{id}/set-active",
    response_model=AppraisalDatasetResponse,
    summary="Set appraisal dataset as active",
    description="Updates the specified dataset to active (is_active = True) and deactivates all other appraisal datasets."
)
def set_active_appraisal_dataset(
    id: int,
    db: Session = Depends(get_db)
):
    dataset = db.query(AppraisalDataset).filter(AppraisalDataset.id == id).first()
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Appraisal dataset with ID {id} was not found."
        )

    try:
        # Set all other datasets to False
        db.query(AppraisalDataset).filter(AppraisalDataset.id != id).update({AppraisalDataset.is_active: False})

        # Set target dataset to True
        dataset.is_active = True
        db.commit()
        db.refresh(dataset)
        logger.info(f"Appraisal dataset ID {id} ('{dataset.file_name}') is now set to ACTIVE.")
        return dataset
    except Exception as e:
        db.rollback()
        logger.error(f"Error activating appraisal dataset ID {id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to set dataset as active: {str(e)}"
        )
