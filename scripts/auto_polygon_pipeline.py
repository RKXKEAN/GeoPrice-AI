#!/usr/bin/env python3
"""
================================================================================
TerraCast-AI / GeoPrice AI: Automated Polygon Segmentation Pipeline (Zero-Touch Daemon)
================================================================================
สคริปต์อัตโนมัติแบบครบวงจร (End-to-End Automated Pipeline):
1. Background Watcher / Daemon:
   - คอยเฝ้าดู MinIO บักเก็ต images ตลอด 24 ชั่วโมง โดยไม่ต้องสั่งรันมือ
   - เมื่อมีภาพถ่ายดาวเทียมใหม่เข้ามา ระบบจะรู้ตัวทันทีและเริ่มทำงานอัตโนมัติ
2. Auto-Labeling (Polygon Contours):
   - โหลดโมเดล YOLO-seg มาทำนายเส้นรอบรูป Polygon (ไม่ใช่ Bounding Box)
   - สกัดพิกัดจุดยอดรอบรูปทรงจริง แปลงเป็นฟอร์แมต YOLO Segmentation
   - สร้างไฟล์ labels (.txt) พร้อม data.yaml และแบ่ง Train/Val (80/20)
   - แพ็กเป็น dataset_auto_seg.zip อัปโหลดขึ้น MinIO (bucket: datasets)
3. Auto-Retrain:
   - สั่ง Fine-tune โมเดล YOLO-seg ต่อจาก Base Model ด้วยชุดข้อมูลที่ได้ใหม่
   - บันทึกและอัปโหลดโมเดลตัวใหม่ (best_retrained_seg.pt) กลับขึ้น MinIO
4. Geo-Projection & GeoJSON Generation:
   - นำโมเดลตัวใหม่มารันสกัด Polygon
   - แปลงจุดยอดพิกเซล (u, v) บนภาพ 640x640 เป็นพิกัดภูมิศาสตร์จริง (Lon, Lat) WGS84
   - ประกอบเป็น GeoJSON FeatureCollection รูปแปลง Polygon ที่สมบูรณ์
   - บันทึกไฟล์ผลลัพธ์พร้อมสำหรับให้ Frontend ดึงไปพล็อตลงแผนที่ได้ทันที
================================================================================
"""

import os
import sys
import math
import time
import json
import glob
import shutil
import zipfile
import random
import logging
import argparse
from pathlib import Path
from typing import List, Dict, Tuple, Any, Optional, Set

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("AutoPolygonPipeline")

# ตรวจสอบ Library ที่จำเป็น
try:
    from minio import Minio
    from minio.error import S3Error
except ImportError:
    logger.error("❌ กรุณาติดตั้ง minio ก่อน: pip install minio")
    sys.exit(1)

try:
    import torch
    from ultralytics import YOLO
except ImportError:
    logger.error("❌ กรุณาติดตั้ง ultralytics และ torch: pip install ultralytics torch")
    sys.exit(1)


# ==============================================================================
# 1. พิกัดอ้างอิงของหาดใหญ่ (สำหรับแปลงภาพเป็นพิกัดภูมิศาสตร์)
# ==============================================================================
HAT_YAI_SUBDISTRICTS = {
    "หาดใหญ่": (7.0084, 100.4767),
    "ควนลัง": (6.9920, 100.4350),
    "คลองแห": (7.0450, 100.4850),
    "คอหงส์": (7.0050, 100.5100),
    "บ้านพรุ": (6.9400, 100.4800),
    "ทุ่งใหญ่": (7.0200, 100.5700),
    "ทุ่งตำเสา": (6.9500, 100.3400),
    "ท่าข้าม": (7.0700, 100.5600),
    "น้ำน้อย": (7.0750, 100.5250),
    "พะตง": (6.8400, 100.5200),
    "คลองอู่ตะเภา": (7.0500, 100.4500),
    "ฉลุง": (6.9000, 100.3200),
    "คูเต่า": (7.1100, 100.4800),
}


def load_coordinate_lookup(csv_path: Optional[str] = None) -> Dict[int, Tuple[float, float, str]]:
    """
    โหลดพิกัดกึ่งกลางของภาพแต่ละหมายเลข (img_0001, img_0002, ...)
    โดยอิงจาก CSV ราคาประเมิน 21,718 แปลง หรือสังเคราะห์พิกัดตาม subdistrict
    """
    coords_dict: Dict[int, Tuple[float, float, str]] = {}
    base_dir = Path(__file__).resolve().parents[1]

    # ตรวจหาไฟล์ CSV ข้อมูลแปลงที่ดิน
    candidate_csvs = [
        csv_path,
        str(base_dir / "backend" / "app" / "data" / "hatyai_appraisal_market_21718.csv"),
        str(base_dir / "ราคาประเมินและราคาตลาด_แปลงที่ดินหาดใหญ่_21718แปลง.csv")
    ]

    found_csv = None
    for p in candidate_csvs:
        if p and os.path.exists(p):
            found_csv = p
            break

    if found_csv:
        logger.info(f"📍 โหลดพิกัดอ้างอิงจาก CSV: {found_csv}")
        import csv
        with open(found_csv, mode="r", encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.DictReader(f)
            idx = 1
            for row in reader:
                try:
                    lat = float(row.get("latitude", 7.0084))
                    lon = float(row.get("longitude", 100.4767))
                    name = row.get("subdistrict", "หาดใหญ่")
                    coords_dict[idx] = (lat, lon, name)
                    idx += 1
                    if idx > 2000:
                        break
                except (ValueError, TypeError):
                    continue

    # หากไม่มี CSV ให้ใช้พิกัดสังเคราะห์ของหาดใหญ่
    if not coords_dict:
        logger.info("📍 ใช้พิกัดโครงข่าย 13 ตำบลหาดใหญ่เป็นพิกัดอ้างอิง")
        random.seed(999)
        idx = 1
        for sub_name, (clat, clon) in HAT_YAI_SUBDISTRICTS.items():
            for _ in range(80):
                dlat = (random.random() - 0.5) * 0.04
                dlon = (random.random() - 0.5) * 0.04
                coords_dict[idx] = (round(clat + dlat, 6), round(clon + dlon, 6), sub_name)
                idx += 1

    return coords_dict


# ==============================================================================
# 2. สูตรคณิตศาสตร์แปลงพิกัดพิกเซล Polygon -> Lat/Lon (EPSG:3857 -> WGS84)
# ==============================================================================
def pixel_to_latlon(
    u: float,
    v: float,
    center_lat: float,
    center_lon: float,
    zoom: int = 19
) -> Tuple[float, float]:
    """
    แปลงพิกัดพิกเซล (u, v) บนภาพ 640x640 เป็นพิกัดจริง (Longitude, Latitude)
    อ้างอิงตามระดับซูมและตำแหน่งจุดกึ่งกลางของภาพที่ดึงจาก ESRI Wayback
    """
    n = 2.0 ** zoom
    # คำนวณ Tile พิกัดกึ่งกลาง
    cx = (center_lon + 180.0) / 360.0 * n
    lat_rad = math.radians(center_lat)
    cy = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n

    # ชดเชย Offset การครอบภาพ 640x640 ตรงกลางจากผืนผ้าใบ 3x3 tiles (768x768)
    canvas_x = u + 64.0
    canvas_y = v + 64.0

    # คำนวณเป็น Global Tile Float Coordinate
    global_tile_x = (int(cx) - 1) + (canvas_x / 256.0)
    global_tile_y = (int(cy) - 1) + (canvas_y / 256.0)

    # แปลงกลับเป็นพิกัดจริง (WGS84)
    lon = global_tile_x / n * 360.0 - 180.0
    lat_merc = math.pi - (2.0 * math.pi * global_tile_y / n)
    lat = math.degrees(math.atan(math.sinh(lat_merc)))

    return round(lon, 7), round(lat, 7)


def calc_polygon_area_sqm(coordinates: List[List[float]]) -> float:
    """คำนวณพื้นที่รูปหลายเหลี่ยม (ตารางเมตร) จากพิกัด [lon, lat]"""
    try:
        if len(coordinates) < 3:
            return 0.0
        lat0 = coordinates[0][1]
        m_lat = 111320.0
        m_lon = 111320.0 * math.cos(math.radians(lat0))
        area = 0.0
        for i in range(len(coordinates) - 1):
            x1 = coordinates[i][0] * m_lon
            y1 = coordinates[i][1] * m_lat
            x2 = coordinates[i + 1][0] * m_lon
            y2 = coordinates[i + 1][1] * m_lat
            area += (x1 * y2 - x2 * y1)
        return round(abs(area) / 2.0, 2)
    except Exception:
        return 0.0


# ==============================================================================
# 3. จัดการ State และเชื่อมต่อ MinIO
# ==============================================================================
def get_minio_client(endpoint: str, access_key: str, secret_key: str) -> Minio:
    clean_endpoint = endpoint.replace("http://", "").replace("https://", "").strip()
    return Minio(
        endpoint=clean_endpoint,
        access_key=access_key,
        secret_key=secret_key,
        secure=False
    )


def load_processed_state(state_file: str) -> Set[str]:
    """โหลดประวัติไฟล์ภาพที่เคยประมวลผลแล้ว เพื่อป้องกันการทำงานซ้ำ"""
    if os.path.exists(state_file):
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                return set(json.load(f))
        except Exception as e:
            logger.warning(f"ไม่สามารถอ่าน state file ได้: {e}")
    return set()


def save_processed_state(state_file: str, processed_set: Set[str]):
    """บันทึกประวัติไฟล์ภาพที่ประมวลผลเสร็จแล้ว"""
    os.makedirs(os.path.dirname(os.path.abspath(state_file)), exist_ok=True)
    with open(state_file, "w", encoding="utf-8") as f:
        json.dump(sorted(list(processed_set)), f, indent=2)


def get_unprocessed_images_from_minio(
    client: Minio,
    bucket_name: str,
    processed_set: Set[str],
    prefix: str = ""
) -> List[str]:
    """สแกนค้นหารายการไฟล์ภาพใหม่ใน MinIO ที่ยังไม่เคยประมวลผล"""
    if not client.bucket_exists(bucket_name):
        return []

    objects = list(client.list_objects(bucket_name, prefix=prefix, recursive=True))
    new_images = [
        obj.object_name for obj in objects
        if not obj.is_dir 
        and obj.object_name.lower().endswith((".jpg", ".jpeg", ".png"))
        and obj.object_name not in processed_set
    ]
    return new_images


def download_images(
    client: Minio,
    bucket_name: str,
    object_names: List[str],
    target_dir: str
) -> List[str]:
    """ดาวน์โหลดภาพเฉพาะรายการที่ระบุมายังเครื่อง"""
    os.makedirs(target_dir, exist_ok=True)
    downloaded_paths = []
    for obj_name in object_names:
        filename = os.path.basename(obj_name)
        dest_path = os.path.join(target_dir, filename)
        if not os.path.exists(dest_path):
            client.fget_object(bucket_name, obj_name, dest_path)
        downloaded_paths.append(dest_path)
    return downloaded_paths


# ==============================================================================
# 4. Phase 1: Auto-Labeling (Polygon Contours ด้วย YOLO-seg)
# ==============================================================================
def auto_generate_polygon_labels(
    model: YOLO,
    image_paths: List[str],
    output_dataset_dir: str,
    conf_threshold: float = 0.60
) -> Tuple[str, int]:
    """
    ใช้โมเดล Segmentation ตรวจจับภาพและสกัดเฉพาะ Polygon Contours (ไม่ใช่ Box)
    แปลงผลลัพธ์เป็นโครงสร้าง YOLO Segmentation Dataset สำหรับนำไป Retrain ต่อ
    """
    logger.info("=" * 65)
    logger.info("🤖 Phase 1: Auto-Labeling (สกัดขอบเขต Polygon ด้วยโมเดล Segmentation)")
    logger.info("=" * 65)

    train_img_dir = os.path.join(output_dataset_dir, "images", "train")
    val_img_dir = os.path.join(output_dataset_dir, "images", "val")
    train_lbl_dir = os.path.join(output_dataset_dir, "labels", "train")
    val_lbl_dir = os.path.join(output_dataset_dir, "labels", "val")

    for d in [train_img_dir, val_img_dir, train_lbl_dir, val_lbl_dir]:
        os.makedirs(d, exist_ok=True)

    total_polygons = 0
    labeled_images = 0

    shuffled_paths = list(image_paths)
    random.seed(42)
    random.shuffle(shuffled_paths)
    split_idx = int(len(shuffled_paths) * 0.8)

    for i, img_path in enumerate(shuffled_paths):
        is_train = i < split_idx
        target_img_dir = train_img_dir if is_train else val_img_dir
        target_lbl_dir = train_lbl_dir if is_train else val_lbl_dir

        base_name = os.path.splitext(os.path.basename(img_path))[0]
        label_file = os.path.join(target_lbl_dir, f"{base_name}.txt")

        dest_img_path = os.path.join(target_img_dir, os.path.basename(img_path))
        if not os.path.exists(dest_img_path):
            shutil.copy2(img_path, dest_img_path)

        results = model.predict(img_path, conf=conf_threshold, verbose=False)
        label_lines = []

        if results and len(results) > 0 and results[0].masks is not None:
            masks = results[0].masks
            boxes = results[0].boxes

            for j, contour in enumerate(masks.xyn):
                confidence = float(boxes.conf[j]) if boxes is not None else 1.0
                class_id = int(boxes.cls[j]) if boxes is not None else 0

                if confidence >= conf_threshold and len(contour) >= 3:
                    # ฟอร์แมต YOLO Segmentation: <class_id> <x1> <y1> <x2> <y2> ... <xn> <yn>
                    points_str = " ".join([f"{pt[0]:.6f} {pt[1]:.6f}" for pt in contour])
                    label_lines.append(f"{class_id} {points_str}")
                    total_polygons += 1

        with open(label_file, "w", encoding="utf-8") as lf:
            lf.write("\n".join(label_lines))

        if label_lines:
            labeled_images += 1

    data_yaml_path = os.path.join(output_dataset_dir, "data.yaml")
    class_names = getattr(model, "names", {0: "parcel_or_building"})
    yaml_content = f"""# Auto-generated by GeoPrice AI Pipeline
path: {os.path.abspath(output_dataset_dir)}
train: images/train
val: images/val

names:
"""
    if isinstance(class_names, dict):
        for cid, cname in class_names.items():
            yaml_content += f"  {cid}: {cname}\n"
    elif isinstance(class_names, list):
        for cid, cname in enumerate(class_names):
            yaml_content += f"  {cid}: {cname}\n"
    else:
        yaml_content += "  0: building\n"

    with open(data_yaml_path, "w", encoding="utf-8") as yf:
        yf.write(yaml_content)

    logger.info(f"✨ สร้าง Label แบบ Polygon สำเร็จ: รวม {total_polygons:,} Polygons ใน {labeled_images} รูปภาพ")
    return data_yaml_path, total_polygons


def package_and_upload_dataset(
    client: Minio,
    dataset_dir: str,
    bucket_name: str = "datasets",
    zip_filename: str = "auto_seg_dataset.zip"
) -> str:
    """บีบอัด Dataset และอัปโหลดขึ้น MinIO"""
    zip_path = os.path.join(os.path.dirname(dataset_dir), zip_filename)
    logger.info(f"📦 กำลังแพ็ก Dataset เป็นไฟล์ Zip: {zip_path}...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(dataset_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, dataset_dir)
                zf.write(full_path, rel_path)

    if not client.bucket_exists(bucket_name):
        client.make_bucket(bucket_name)

    logger.info(f"⬆️ กำลังอัปโหลด {zip_filename} ขึ้น MinIO บักเก็ต '{bucket_name}'...")
    client.fput_object(bucket_name, zip_filename, zip_path)
    logger.info(f"✅ บันทึก Dataset ขึ้น MinIO สำเร็จ: {bucket_name}/{zip_filename}")
    return zip_path


# ==============================================================================
# 5. Phase 2: Auto Retraining (YOLO Segmentation)
# ==============================================================================
def retrain_yolo_segmentation(
    base_model_path: str,
    data_yaml_path: str,
    epochs: int = 15,
    imgsz: int = 640,
    batch_size: int = 8,
    project_dir: str = "runs/retrain_seg",
    run_name: str = "best_seg_v2"
) -> str:
    """สั่งเทรนโมเดล YOLO Segmentation ต่อด้วย GPU"""
    logger.info("=" * 65)
    logger.info("🚀 Phase 2: Auto Retraining (เทรนโมเดลใหม่ต่อยอดด้วยชุดข้อมูล Polygon)")
    logger.info("=" * 65)

    device = 0 if torch.cuda.is_available() else "cpu"
    hw_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    logger.info(f"   - Hardware: {hw_name} (device={device})")
    logger.info(f"   - Base Model: {base_model_path}")
    logger.info(f"   - Epochs: {epochs} | Batch: {batch_size} | Size: {imgsz}")

    model = YOLO(base_model_path)
    model.train(
        data=data_yaml_path,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch_size,
        device=device,
        project=project_dir,
        name=run_name,
        task="segment",
        exist_ok=True,
        save=True,
        verbose=True
    )

    trained_best = os.path.join(project_dir, run_name, "weights", "best.pt")
    if os.path.exists(trained_best):
        logger.info(f"🎉 Retrain สำเร็จ! โมเดลใหม่อยู่ที่: {trained_best}")
        return trained_best

    fallback = glob.glob(f"{project_dir}/{run_name}/**/*.pt", recursive=True)
    if fallback:
        return fallback[0]
    return base_model_path


# ==============================================================================
# 6. Phase 3: แปลง Polygon Pixel เป็นพิกัดจริง & สรุปเป็น GeoJSON
# ==============================================================================
def extract_and_project_polygons_to_geojson(
    model: YOLO,
    image_paths: List[str],
    coords_dict: Dict[int, Tuple[float, float, str]],
    output_geojson_path: str,
    conf_threshold: float = 0.65,
    zoom: int = 19
) -> Dict[str, Any]:
    """
    นำโมเดลตัวใหม่มารันตรวจจับรูปภาพล่าสุด
    แปลงจุดยอดพิกเซลแต่ละจุด (u, v) เป็นพิกัดโลกจริง (lon, lat)
    ส่งออกผลลัพธ์เป็น GeoJSON Polygon FeatureCollection ที่พร้อมสำหรับ Frontend
    """
    logger.info("=" * 65)
    logger.info("🌐 Phase 3: แปลงพิกัด Polygon Contours เป็นพิกัดจริง (Lat/Lon) สำหรับ Frontend")
    logger.info("=" * 65)

    features = []
    parcel_counter = 1

    for img_path in image_paths:
        base_name = os.path.splitext(os.path.basename(img_path))[0]
        img_idx = 1
        try:
            digits = "".join([c for c in base_name if c.isdigit()])
            if digits:
                img_idx = int(digits)
        except Exception:
            img_idx = 1

        center_lat, center_lon, subdistrict = coords_dict.get(
            img_idx, (7.0084, 100.4767, "หาดใหญ่")
        )

        results = model.predict(img_path, conf=conf_threshold, verbose=False)
        if not results or len(results) == 0 or results[0].masks is None:
            continue

        masks = results[0].masks
        boxes = results[0].boxes

        for j, contour_pixels in enumerate(masks.xy):
            confidence = float(boxes.conf[j]) if boxes is not None else 1.0
            class_id = int(boxes.cls[j]) if boxes is not None else 0
            class_name = getattr(model, "names", {}).get(class_id, "building_or_parcel")

            if len(contour_pixels) < 3 or confidence < conf_threshold:
                continue

            geo_ring: List[List[float]] = []
            for pt in contour_pixels:
                u, v = float(pt[0]), float(pt[1])
                lon, lat = pixel_to_latlon(u, v, center_lat, center_lon, zoom=zoom)
                geo_ring.append([lon, lat])

            if geo_ring and geo_ring[0] != geo_ring[-1]:
                geo_ring.append(geo_ring[0])

            area_sqm = calc_polygon_area_sqm(geo_ring)
            if area_sqm < 15.0:
                continue

            feature = {
                "type": "Feature",
                "id": parcel_counter,
                "properties": {
                    "parcel_id": f"AI-PARCEL-{parcel_counter:05d}",
                    "name": f"รูปแปลงที่ดินที่ตรวจจับได้ ({class_name})",
                    "land_type": class_name,
                    "subdistrict": subdistrict,
                    "district": "อำเภอหาดใหญ่",
                    "province": "สงขลา",
                    "area_size_sqm": area_sqm,
                    "confidence": round(confidence, 3),
                    "center_latitude": center_lat,
                    "center_longitude": center_lon,
                    "source_image": os.path.basename(img_path),
                    "model_source": "Retrained YOLO-Seg (Polygon Native)"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [geo_ring]
                }
            }
            features.append(feature)
            parcel_counter += 1

    geojson_result = {
        "type": "FeatureCollection",
        "metadata": {
            "title": "Hat Yai AI Segmented Land Parcels & Buildings",
            "description": "รูปแปลงที่ดินและอาคารที่ได้จากการทำนายอัตโนมัติด้วย Retrained YOLO-Seg แบบ Polygon",
            "total_features": len(features),
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
        },
        "features": features
    }

    os.makedirs(os.path.dirname(os.path.abspath(output_geojson_path)), exist_ok=True)
    with open(output_geojson_path, "w", encoding="utf-8") as f:
        json.dump(geojson_result, f, ensure_ascii=False, indent=2)

    logger.info(f"🎉 สร้าง GeoJSON Polygon สำเร็จ! ตรวจพบรูปแปลงทั้งหมด {len(features):,} แปลง")
    logger.info(f"📂 บันทึกไฟล์ที่: {output_geojson_path}")
    return geojson_result


# ==============================================================================
# 7. Core Pipeline Execution Loop
# ==============================================================================
def execute_pipeline_cycle(client: Minio, args, coords_dict, work_dir: str, target_images: List[str]):
    """รันวงจรกระบวนการอัตโนมัติ 1 รอบสมบูรณ์"""
    logger.info(f"🔄 เริ่มต้น Pipeline อัตโนมัติสำหรับรูปภาพจำนวน {len(target_images)} รูป...")

    # 1. ดาวน์โหลดภาพมาที่ Local
    raw_images_dir = os.path.join(work_dir, "raw_images")
    downloaded_images = download_images(
        client=client,
        bucket_name=args.images_bucket,
        object_names=target_images,
        target_dir=raw_images_dir
    )

    # 2. โหลด Base Model
    logger.info(f"🧠 กำลังโหลด Base Segmentation Model: {args.base_model}...")
    base_model = YOLO(args.base_model)

    # 3. Phase 1: Auto-Labeling (Polygon)
    dataset_dir = os.path.join(work_dir, "yolo_seg_dataset")
    data_yaml_path, total_polygons = auto_generate_polygon_labels(
        model=base_model,
        image_paths=downloaded_images,
        output_dataset_dir=dataset_dir,
        conf_threshold=args.conf
    )

    # 4. แพ็กและอัปโหลด Dataset ขึ้น MinIO
    package_and_upload_dataset(
        client=client,
        dataset_dir=dataset_dir,
        bucket_name=args.datasets_bucket,
        zip_filename="auto_seg_dataset.zip"
    )

    # 5. Phase 2: Auto-Retraining
    retrained_model_path = retrain_yolo_segmentation(
        base_model_path=args.base_model,
        data_yaml_path=data_yaml_path,
        epochs=args.epochs,
        batch_size=args.batch,
        project_dir=os.path.join(work_dir, "runs"),
        run_name="best_seg_v2"
    )

    # อัปโหลดโมเดลใหม่ขึ้น MinIO
    if client.bucket_exists("models"):
        logger.info("⬆️ อัปโหลดโมเดลใหม่ขึ้น MinIO: models/best_retrained_seg.pt...")
        client.fput_object("models", "best_retrained_seg.pt", retrained_model_path)

    # 6. Phase 3: แปลง Polygon Pixel เป็น Lat/Lon ➔ GeoJSON สำหรับ Frontend
    logger.info("🔮 โหลดโมเดลใหม่มารันแปลงรูปแปลงเป็น GeoJSON...")
    retrained_model = YOLO(retrained_model_path)
    extract_and_project_polygons_to_geojson(
        model=retrained_model,
        image_paths=downloaded_images,
        coords_dict=coords_dict,
        output_geojson_path=args.output_geojson,
        conf_threshold=args.conf
    )

    # 7. อัปโหลด GeoJSON ผลลัพธ์ขึ้น MinIO ไว้ด้วย
    if os.path.exists(args.output_geojson):
        client.fput_object(
            args.datasets_bucket,
            "auto_segmented_parcels.geojson",
            args.output_geojson
        )
        logger.info(f"✅ บันทึก GeoJSON ขึ้น MinIO: {args.datasets_bucket}/auto_segmented_parcels.geojson")

    logger.info("🏁 กระบวนการอัตโนมัติรอบนี้เสร็จสมบูรณ์เรียบร้อยแล้ว!")


# ==============================================================================
# 8. Main Entrypoint & Background Daemon
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="GeoPrice AI: Automated Polygon Retrain & Geo-Serving Pipeline")
    # การตั้งค่า MinIO
    parser.add_argument("--minio-endpoint", default=os.getenv("MINIO_ENDPOINT", "localhost:9000"), help="MinIO Endpoint")
    parser.add_argument("--minio-access-key", default=os.getenv("MINIO_ROOT_USER", "admin"), help="MinIO Access Key")
    parser.add_argument("--minio-secret-key", default=os.getenv("MINIO_ROOT_PASSWORD", "password123"), help="MinIO Secret Key")
    parser.add_argument("--images-bucket", default="images", help="Bucket containing raw images")
    parser.add_argument("--datasets-bucket", default="datasets", help="Bucket to store packaged datasets")
    parser.add_argument("--prefix", default="", help="Subfolder/period prefix in images bucket")
    
    # การตั้งค่าโมเดล
    parser.add_argument("--base-model", default="yolov8n-seg.pt", help="Base YOLO-seg model weights")
    parser.add_argument("--epochs", type=int, default=15, help="Training epochs for retraining")
    parser.add_argument("--batch", type=int, default=8, help="Batch size")
    parser.add_argument("--conf", type=float, default=0.60, help="Confidence threshold for Polygon extraction")

    # โหมด Background Daemon อัตโนมัติ (Zero-Touch)
    parser.add_argument("--daemon", action="store_true", default=True, help="Run as 24/7 background daemon watching MinIO")
    parser.add_argument("--interval", type=int, default=60, help="Poll interval in seconds for daemon mode")
    parser.add_argument("--min-new-images", type=int, default=1, help="Minimum new images to trigger retraining")

    # Output ไฟล์สำหรับเตรียมขึ้น Frontend
    parser.add_argument(
        "--output-geojson",
        default=os.path.join(os.path.dirname(__file__), "output", "auto_segmented_parcels.geojson"),
        help="Target output GeoJSON path ready for Frontend ingestion"
    )

    args = parser.parse_args()

    work_dir = os.path.join(os.path.dirname(__file__), "workspace_auto_pipeline")
    os.makedirs(work_dir, exist_ok=True)
    state_file = os.path.join(work_dir, "processed_images_state.json")

    client = get_minio_client(args.minio_endpoint, args.minio_access_key, args.minio_secret_key)
    coords_dict = load_coordinate_lookup()

    logger.info("=" * 65)
    logger.info("🌟 เริ่มต้นระบบ Automate Pipeline (Zero-Touch Mode)")
    logger.info(f"   - MinIO Endpoint: {args.minio_endpoint}")
    logger.info(f"   - Target Bucket: '{args.images_bucket}'")
    logger.info(f"   - Daemon Mode: {args.daemon} (Check every {args.interval}s)")
    logger.info("=" * 65)

    if not args.daemon:
        # กรณีรันรอบเดียว
        processed_set = load_processed_state(state_file)
        new_images = get_unprocessed_images_from_minio(client, args.images_bucket, processed_set, prefix=args.prefix)
        if not new_images:
            # หากไม่มีใหม่ ให้ใช้รูปทั้งหมดที่มี
            objects = list(client.list_objects(args.images_bucket, prefix=args.prefix, recursive=True))
            new_images = [obj.object_name for obj in objects if not obj.is_dir and obj.object_name.lower().endswith((".jpg", ".jpeg", ".png"))]

        if new_images:
            execute_pipeline_cycle(client, args, coords_dict, work_dir, new_images[:300])
            processed_set.update(new_images)
            save_processed_state(state_file, processed_set)
        return

    # ลูป Daemon ทำงานเบื้องหลังอัตโนมัติตลอด 24 ชั่วโมง
    logger.info("👀 ระบบกำลังเข้าสู่โหมดเฝ้าตรวจจับภาพใหม่ใน MinIO อัตโนมัติ...")
    while True:
        try:
            processed_set = load_processed_state(state_file)
            new_images = get_unprocessed_images_from_minio(client, args.images_bucket, processed_set, prefix=args.prefix)

            if len(new_images) >= args.min_new_images:
                logger.info(f"🔔 ตรวจพบภาพถ่ายดาวเทียมใหม่ใน MinIO จำนวน {len(new_images)} รูป! กำลังเริ่มประมวลผลอัตโนมัติ...")
                execute_pipeline_cycle(client, args, coords_dict, work_dir, new_images)
                processed_set.update(new_images)
                save_processed_state(state_file, processed_set)
                logger.info(f"💤 ประมวลผลเสร็จสิ้น กลับสู่โหมดเฝ้าดู (รอบถัดไปอีก {args.interval} วินาที)...")
            else:
                # ยังไม่มีภาพใหม่เข้ามา พักตามรอบ
                time.sleep(args.interval)

        except KeyboardInterrupt:
            logger.info("🛑 หยุดการทำงาน Daemon ตามคำสั่งผู้ใช้")
            break
        except Exception as e:
            logger.error(f"⚠️ เกิดข้อผิดพลาดในรอบการทำงาน: {e}")
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
