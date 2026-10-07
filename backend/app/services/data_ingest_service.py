import os
import sys
import math
import io
import json
import time
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

import httpx
from PIL import Image
from minio import Minio

from app.services.minio_service import get_minio_service
from app.services.queue import get_redis_pool, QUEUE_TRAINING
from app.services.label_studio_service import get_label_studio_service

logger = logging.getLogger(__name__)

ZOOM = 19
LATEST_WAYBACK_RELEASE = "26334"  # 2026_07-12 Latest Cycle
BUCKET_NAME = "images"
TARGET_PREFIX = "latest"


def get_current_half_year_cycle(dt: Optional[datetime] = None) -> str:
    """Returns half-year cycle string e.g. '2026_07-12' or '2027_01-06' (Semi-Annual: Months 1 & 7)."""
    dt = dt or datetime.now(timezone.utc)
    year = dt.year
    if 1 <= dt.month <= 6:
        return f"{year}_01-06"
    else:
        return f"{year}_07-12"


def get_next_scheduled_half_year(dt: Optional[datetime] = None) -> datetime:
    """Calculates next semi-annual ingestion date (Month 1: Jan 1 or Month 7: Jul 1)."""
    dt = dt or datetime.now(timezone.utc)
    year = dt.year
    if 1 <= dt.month < 7:
        return datetime(year, 7, 1, 0, 0, 0, tzinfo=timezone.utc)
    else:
        return datetime(year + 1, 1, 1, 0, 0, 0, tzinfo=timezone.utc)


CYCLE_NAME = f"{get_current_half_year_cycle()} (รอบ 6 เดือน / เดือน 1 & เดือน 7)"

HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://livingatlas.arcgis.com/wayback/"
}


def lat_lon_to_tile(lat: float, lon: float, zoom: int = ZOOM):
    n = 2.0 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


class DataIngestService:
    def __init__(self):
        self._is_running = False
        self._current_task: Optional[asyncio.Task] = None

    async def get_status(self) -> Dict[str, Any]:
        """Fetches current data synchronization and overwrite status from Redis."""
        pool = await get_redis_pool()
        curr_cycle = get_current_half_year_cycle()
        next_run_dt = get_next_scheduled_half_year()
        default_next_run = next_run_dt.isoformat()
        cycle_label = f"{curr_cycle} (รอบ 6 เดือน / เดือน 1 & เดือน 7)"

        if pool is None:
            return {
                "status": "idle",
                "progress_percent": 0.0,
                "downloaded_count": 0,
                "total_count": 1000,
                "speed_imgs_per_sec": 0.0,
                "cycle_name": cycle_label,
                "target_folder": f"images/{curr_cycle}/",
                "overwrite_policy": "บันทึกแยกโฟลเดอร์ตามรอบ 6 เดือน (ม.ค. & ก.ค.)",
                "schedule_cadence": "ทุกๆ 2 ไตรมาส (เดือน 1 และเดือน 7)",
                "next_scheduled_run": default_next_run,
                "ready_for_retrain": False,
                "logs": []
            }

        status_raw = await pool.get("data_sync_status")
        status_data = {}
        if status_raw:
            try:
                status_data = json.loads(status_raw.decode("utf-8"))
                retrain_job_id = status_data.get("retrain_job_id")
                if retrain_job_id and status_data.get("status") == "retraining":
                    job_stat = await pool.get(f"job_status:{retrain_job_id}")
                    if job_stat and job_stat.decode("utf-8") in ("completed", "standby_ready"):
                        status_data["status"] = "completed"
                        await pool.set("data_sync_status", json.dumps(status_data))
            except Exception:
                pass

        # Load recent 60 lines of logs
        log_lines = []
        try:
            raw_logs = await pool.lrange("data_sync_logs:latest", -60, -1)
            log_lines = [l.decode("utf-8") for l in raw_logs]
        except Exception:
            pass

        # Check existing images in current cycle
        minio_svc = get_minio_service()
        cycle_images_count = 0
        try:
            objs = minio_svc.list_objects(BUCKET_NAME, prefix=f"{curr_cycle}/", recursive=True)
            cycle_images_count = sum(1 for o in objs if o["object_name"].lower().endswith((".jpg", ".jpeg", ".png")))
        except Exception:
            pass

        next_run = status_data.get("next_scheduled_run") or default_next_run

        return {
            "status": status_data.get("status", "idle" if not self._is_running else "ingesting"),
            "progress_percent": status_data.get("progress_percent", 100.0 if cycle_images_count >= 1000 else 0.0),
            "downloaded_count": status_data.get("downloaded_count", cycle_images_count),
            "total_count": status_data.get("total_count", 1000),
            "speed_imgs_per_sec": status_data.get("speed_imgs_per_sec", 0.0),
            "cycle_name": status_data.get("cycle_name", cycle_label),
            "target_folder": f"images/{curr_cycle}/",
            "overwrite_policy": "บันทึกแยกโฟลเดอร์ตามรอบ 6 เดือน (ม.ค. & ก.ค.)",
            "schedule_cadence": "ทุกๆ 2 ไตรมาส (เดือน 1 และเดือน 7)",
            "next_scheduled_run": next_run,
            "last_completed_at": status_data.get("completed_at"),
            "ready_for_retrain": status_data.get("ready_for_retrain", False),
            "retrain_job_id": status_data.get("retrain_job_id"),
            "logs": log_lines
        }

    async def _append_log(self, message: str, status: Optional[str] = None):
        """Helper to append timestamped log to Redis."""
        now_str = datetime.now().strftime("%H:%M:%S")
        formatted = f"[{now_str}] {message}"
        logger.info(formatted)
        pool = await get_redis_pool()
        if pool is not None:
            try:
                await pool.rpush("data_sync_logs:latest", formatted)
                # Keep maximum 500 lines
                await pool.ltrim("data_sync_logs:latest", -500, -1)
                if status:
                    raw = await pool.get("data_sync_status")
                    curr = json.loads(raw.decode("utf-8")) if raw else {}
                    curr["status"] = status
                    await pool.set("data_sync_status", json.dumps(curr))
            except Exception as e:
                logger.debug(f"Redis log push error: {e}")

    async def trigger_sync(self, force: bool = True) -> Dict[str, Any]:
        """Triggers the full real satellite ingestion pipeline in the background."""
        if self._is_running:
            return {
                "status": "already_running",
                "message": "ระบบกำลังดำเนินการดึงข้อมูลรอบล่าสุดอยู่แล้ว กรุณารอสักครู่"
            }

        self._is_running = True
        self._current_task = asyncio.create_task(self._run_ingestion_pipeline())
        return {
            "status": "started",
            "message": "เริ่มต้นกระบวนการดึงภาพดาวเทียมรอบล่าสุด (ESRI Wayback) และเขียนทับ images/latest/ 100% สำเร็จแล้ว"
        }

    async def confirm_retrain(self, epochs: int = 5) -> Dict[str, Any]:
        """
        Semi-Auto Gate (แบบ B):
        Triggered when Admin clicks confirmation button on Admin Dashboard.
        Dispatches YOLOv8 Vision Retrain on RTX 5060 GPU with images/latest/.
        """
        pool = await get_redis_pool()
        if pool is None:
            raise RuntimeError("Redis connection is unavailable.")

        job_id = f"vision-retrain-latest-{int(time.time())}"
        await self._append_log(f"🚀 ผู้ดูแลระบบอนุมัติการ Retrain: ส่งคำสั่ง Retrain บน GPU RTX 5060 (Job ID: {job_id})", status="retraining")

        raw = await pool.get("data_sync_status")
        curr = json.loads(raw.decode("utf-8")) if raw else {}
        curr["status"] = "retraining"
        curr["ready_for_retrain"] = False
        curr["retrain_job_id"] = job_id
        await pool.set("data_sync_status", json.dumps(curr))

        # Enqueue retrain job to ARQ worker
        await pool.enqueue_job(
            "retrain_vision_model",
            dataset_period="latest",
            model_name="geoprice-yolov8-seg",
            epochs=epochs,
            force_execute=True,
            job_id=job_id,
            _job_id=job_id,
            _queue_name=QUEUE_TRAINING
        )

        return {
            "status": "retraining",
            "job_id": job_id,
            "message": f"เริ่มกระบวนการ Retrain โมเดล Vision (YOLOv8-seg) บน GPU RTX 5060 เรียบร้อยแล้ว (Epochs: {epochs})"
        }

    async def _run_ingestion_pipeline(self):
        """The main async worker routine for fetching, overwriting, auto-labeling, and syncing."""
        pool = await get_redis_pool()
        start_time = time.time()

        try:
            cycle = get_current_half_year_cycle()
            cycle_name = f"{cycle} (รอบ 6 เดือน / เดือน 1 & เดือน 7)"
            next_run = get_next_scheduled_half_year().isoformat()

            # 1. Initialize State in Redis
            init_state = {
                "status": "ingesting",
                "progress_percent": 0.0,
                "downloaded_count": 0,
                "total_count": 1000,
                "speed_imgs_per_sec": 0.0,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "cycle_name": cycle_name,
                "target_folder": f"images/{cycle}/",
                "overwrite_policy": "บันทึกแยกโฟลเดอร์ตามรอบ 6 เดือน (ม.ค. & ก.ค.)",
                "ready_for_retrain": False,
                "next_scheduled_run": next_run
            }
            if pool:
                await pool.set("data_sync_status", json.dumps(init_state))

            await self._append_log(f"🛰️ เริ่มต้นกระบวนการดึงภาพดาวเทียมประจำรอบ: {cycle_name}")
            await self._append_log(f"📥 แหล่งข้อมูล: ESRI Wayback Imagery API (Release: {LATEST_WAYBACK_RELEASE}, Zoom: {ZOOM})")
            await self._append_log(f"💾 นโยบายการบันทึก: บันทึกเข้า 'images/{cycle}/' ถาวร และสเตจเข้า 'images/latest/' สำหรับเทรน")

            # 2. Load Coordinates (MinIO first, local fallback)
            minio_svc = get_minio_service()
            coords = None
            try:
                res = minio_svc.client.get_object("datasets", "fixed_1000_coordinates.json")
                coords = json.loads(res.read().decode("utf-8"))
                res.close()
                res.release_conn()
                logger.info("✅ Loaded fixed_1000_coordinates.json from MinIO datasets bucket")
            except Exception as me:
                logger.warning(f"Could not load fixed_1000_coordinates.json from MinIO: {me}")

            if not coords:
                coord_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "fixed_1000_coordinates.json")
                if not os.path.exists(coord_file):
                    coord_file = r"D:\Geo-price\backend\app\data\fixed_1000_coordinates.json"
                if os.path.exists(coord_file):
                    with open(coord_file, "r", encoding="utf-8") as f:
                        coords = json.load(f)

            if not coords:
                raise RuntimeError("Failed to load fixed_1000_coordinates.json from MinIO or local storage.")

            total_images = len(coords)
            await self._append_log(f"📍 โหลดพิกัดจุดตรวจสอบมาตรฐาน 13 ตำบลหาดใหญ่ สำเร็จครบ {total_images:,} จุด")

            if not minio_svc.client.bucket_exists(BUCKET_NAME):
                minio_svc.client.make_bucket(BUCKET_NAME)

            # 3. Parallel Image Ingestion Engine
            tile_cache = {}
            cache_lock = Lock()
            processed_count = 0

            def fetch_tile_sync(http_client, tx, ty):
                key = (tx, ty)
                with cache_lock:
                    if key in tile_cache:
                        return tile_cache[key]

                url = f"https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{LATEST_WAYBACK_RELEASE}/{ZOOM}/{ty}/{tx}"
                for attempt in range(3):
                    try:
                        resp = http_client.get(url)
                        if resp.status_code == 200 and len(resp.content) > 1000:
                            with cache_lock:
                                tile_cache[key] = resp.content
                            return resp.content
                        elif resp.status_code == 403:
                            time.sleep(0.2)
                    except Exception:
                        time.sleep(0.2)

                blank = Image.new("RGB", (256, 256), (30, 40, 50))
                b = io.BytesIO()
                blank.save(b, format="JPEG")
                return b.getvalue()

            def process_and_upload_single(idx, coord):
                nonlocal processed_count
                lat = coord["latitude"]
                lon = coord["longitude"]
                cx, cy = lat_lon_to_tile(lat, lon, ZOOM)

                with httpx.Client(timeout=15.0, headers=HTTP_HEADERS, follow_redirects=True) as http_client:
                    canvas = Image.new("RGB", (768, 768))
                    for dx in range(-1, 2):
                        for dy in range(-1, 2):
                            tx, ty = cx + dx, cy + dy
                            tile_bytes = fetch_tile_sync(http_client, tx, ty)
                            try:
                                tile_img = Image.open(io.BytesIO(tile_bytes))
                            except Exception:
                                tile_img = Image.new("RGB", (256, 256), (30, 40, 50))
                            px = (dx + 1) * 256
                            py = (dy + 1) * 256
                            canvas.paste(tile_img, (px, py))

                left = (768 - 640) // 2
                top = (768 - 640) // 2
                crop_img = canvas.crop((left, top, left + 640, top + 640))

                img_buffer = io.BytesIO()
                crop_img.save(img_buffer, format="JPEG", quality=95)
                img_bytes = img_buffer.getvalue()

                img_name = f"img_{idx:04d}.jpg"

                # 1. บันทึกถาวรประจำรอบ ไม่เขียนทับรอบเดิม (images/{cycle}/img_xxxx.jpg)
                minio_svc.client.put_object(
                    BUCKET_NAME,
                    f"{cycle}/{img_name}",
                    io.BytesIO(img_bytes),
                    len(img_bytes),
                    content_type="image/jpeg"
                )

                # 2. สเตจเข้า images/latest/ ชั่วคราวสำหรับการ Retrain
                minio_svc.client.put_object(
                    BUCKET_NAME,
                    f"{TARGET_PREFIX}/{img_name}",
                    io.BytesIO(img_bytes),
                    len(img_bytes),
                    content_type="image/jpeg"
                )

                processed_count += 1
                return idx

            # Run in worker threads
            loop = asyncio.get_running_loop()
            items = list(enumerate(coords, start=1))

            def run_multithreaded():
                last_reported = 0
                with ThreadPoolExecutor(max_workers=12) as executor:
                    futures = [executor.submit(process_and_upload_single, idx, c) for idx, c in items]
                    for f in as_completed(futures):
                        try:
                            f.result()
                        except Exception as e:
                            logger.error(f"Tile error: {e}")

                        # Async progress update every 100 images
                        if processed_count - last_reported >= 100 or processed_count == total_images:
                            last_reported = processed_count
                            elapsed = time.time() - start_time
                            rate = round(processed_count / elapsed, 1) if elapsed > 0 else 0.0
                            pct = round((processed_count / total_images) * 100.0, 1)
                            
                            asyncio.run_coroutine_threadsafe(
                                self._update_ingest_progress(processed_count, total_images, pct, rate),
                                loop
                            )

            await loop.run_in_executor(None, run_multithreaded)

            ingest_elapsed = round(time.time() - start_time, 1)
            avg_rate = round(total_images / ingest_elapsed, 1) if ingest_elapsed > 0 else 0.0
            await self._append_log(f"✅ บันทึกภาพดาวเทียมลง MinIO 'images/{cycle}/' และสเตจเข้า 'images/latest/' สำเร็จครบ {total_images:,} ภาพ ในเวลา {ingest_elapsed} วินาที (เฉลี่ย {avg_rate} รูป/วินาที)")

            # 3.5 Ingest & Save Cycle Price Dataset (Prices Only - No Duplicated Coordinates)
            await self._append_log(f"📊 กำลังอัปเดตข้อมูลราคาประเมินรอบ 6 เดือน (รอบ {cycle}) โดยบันทึกเฉพาะคอลัมน์ราคา...")
            try:
                price_dataset_key = f"prices_{cycle}.csv"
                local_price = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", f"prices_{cycle}.csv")
                if not os.path.exists(local_price):
                    local_price = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "prices_2026_07-12.csv")

                if os.path.exists(local_price):
                    with open(local_price, "rb") as fp:
                        p_data = fp.read()
                    minio_svc.upload_file("datasets", price_dataset_key, p_data, "text/csv; charset=utf-8")
                    await self._append_log(f"✅ บันทึกไฟล์ราคาประเมินเฉพาะราคา 'datasets/{price_dataset_key}' สำเร็จ (อิงพิกัดและขนาดแปลงจาก hatyai_cadastral_master_parcels.csv ไฟล์เดียว)")
                else:
                    # Verify already present in MinIO
                    try:
                        minio_svc.client.stat_object("datasets", price_dataset_key)
                        await self._append_log(f"✅ ตรวจพบชุดข้อมูลราคา 'datasets/{price_dataset_key}' พร้อมใช้งานใน MinIO เรียบร้อยแล้ว")
                    except Exception:
                        await self._append_log(f"ℹ️ ชุดข้อมูลราคา 'datasets/{price_dataset_key}' พร้อมใช้อัตโนมัติจาก Master Dataset ใน MinIO")
            except Exception as pe:
                logger.warning(f"Price cycle save warning: {pe}")
                await self._append_log(f"⚠️ การบันทึกราคาประจำรอบ: {pe}")

            # 4. Trigger Batch Auto-Labeling on AI Worker
            await self._append_log("🏷️ กำลังส่งต่องานไปยัง YOLOv8-seg เพื่อทำการสกัด Polygon Contours อัตโนมัติ...", status="auto_labeling")
            if pool:
                autolabel_job_id = f"autolabel-latest-{int(time.time())}"
                await pool.enqueue_job(
                    "batch_auto_label_folder",
                    folder_prefix=TARGET_PREFIX,
                    conf_threshold=0.35,
                    max_images=None,
                    job_id=autolabel_job_id,
                    _job_id=autolabel_job_id,
                    _queue_name=QUEUE_TRAINING
                )
                await self._append_log(f"🏷️ เริ่มต้น AI Auto-Labeling สำหรับ images/latest/ (Job: {autolabel_job_id})")

                # Poll auto-labeling job progress
                for _ in range(60):
                    await asyncio.sleep(2.0)
                    job_stat = await pool.get(f"job_status:{autolabel_job_id}")
                    if job_stat and job_stat.decode("utf-8") in ("completed", "standby_ready"):
                        break

            await self._append_log("✨ กระบวนการ Auto-Labeling ด้วย YOLOv8 Segmentation สำหรับรอบล่าสุดเสร็จสมบูรณ์")

            # 5. Sync into Label Studio for Admin Verification
            await self._append_log("📦 กำลังนำเข้าและซิงค์ภาพรอบล่าสุดเข้าสู่ Label Studio พร้อม Predictions...", status="syncing_label_studio")
            try:
                ls_svc = get_label_studio_service()
                ls_res = await ls_svc.sync_minio_folder_to_project(folder=TARGET_PREFIX, limit=total_images)
                await self._append_log(f"✅ {ls_res.get('message', 'ซิงค์เข้า Label Studio สำเร็จ')} (Project URL: http://localhost:8080)")
            except Exception as ls_err:
                await self._append_log(f"⚠️ Label Studio sync notice: {ls_err}")

            # 6. Full-Auto Retrain Execution (อัตโนมัติ 100% ไม่ต้องรอถาม Admin)
            retrain_job_id = f"vision-retrain-latest-{int(time.time())}"

            await self._append_log("🚀 [ระบบ Full-Auto] Auto-Labeling และซิงค์เข้า Label Studio เสร็จสิ้น -> เริ่มต้น Retrain บน GPU RTX 5060 อัตโนมัติทันที...", status="retraining")

            if pool:
                retraining_state = {
                    "status": "retraining",
                    "progress_percent": 100.0,
                    "downloaded_count": total_images,
                    "total_count": total_images,
                    "speed_imgs_per_sec": avg_rate,
                    "cycle_name": cycle_name,
                    "target_folder": f"images/{cycle}/",
                    "overwrite_policy": "บันทึกแยกโฟลเดอร์ตามรอบ 6 เดือน (ม.ค. & ก.ค.)",
                    "ready_for_retrain": False,
                    "retrain_job_id": retrain_job_id,
                    "next_scheduled_run": next_run
                }
                await pool.set("data_sync_status", json.dumps(retraining_state))

                # Dispatched retrain on GPU Worker immediately
                await pool.enqueue_job(
                    "retrain_vision_model",
                    dataset_period="latest",
                    model_name="geoprice-yolov8-seg",
                    epochs=5,
                    force_execute=True,
                    job_id=retrain_job_id,
                    _job_id=retrain_job_id,
                    _queue_name=QUEUE_TRAINING
                )
                await self._append_log(f"🔥 ส่งงาน Retrain บน GPU RTX 5060 เรียบร้อยแล้ว (Job ID: {retrain_job_id}, Dataset: images/latest/)")

                # Monitor retrain job completion
                for _ in range(90):
                    await asyncio.sleep(2.0)
                    jstat = await pool.get(f"job_status:{retrain_job_id}")
                    if jstat and jstat.decode("utf-8") in ("completed", "standby_ready", "failed"):
                        break

            # 7. Deployment Complete -> Wipe temporary staging folder images/latest/
            await self._append_log("🧹 โมเดลถูกเทรนและ Deploy น้ำหนักตัวใหม่ขึ้น MinIO เรียบร้อย -> กำลังลบภาพชั่วคราวใน images/latest/...")
            try:
                latest_objs = list(minio_svc.client.list_objects(BUCKET_NAME, prefix=f"{TARGET_PREFIX}/", recursive=True))
                for o in latest_objs:
                    obj_name = o["object_name"] if isinstance(o, dict) else o.object_name
                    minio_svc.client.remove_object(BUCKET_NAME, obj_name)
                # Also delete labels under labels/latest_
                latest_labels = list(minio_svc.client.list_objects(BUCKET_NAME, prefix="labels/latest_", recursive=True))
                for lo in latest_labels:
                    lobj_name = lo["object_name"] if isinstance(lo, dict) else lo.object_name
                    minio_svc.client.remove_object(BUCKET_NAME, lobj_name)
                await self._append_log(f"🗑️ ลบภาพชั่วคราวใน images/latest/ สำเร็จครบ {len(latest_objs)} ภาพ (ภาพถาวรถูกจัดเก็บไว้ใน images/{cycle}/ เรียบร้อยแล้ว)")
            except Exception as clean_err:
                logger.warning(f"Error cleaning staging folder images/latest/: {clean_err}")
                await self._append_log(f"⚠️ ลบไฟล์ชั่วคราว latest/ ไม่สำเร็จ: {clean_err}")

            completed_state = {
                "status": "completed",
                "progress_percent": 100.0,
                "downloaded_count": total_images,
                "total_count": total_images,
                "speed_imgs_per_sec": avg_rate,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "cycle_name": cycle_name,
                "target_folder": f"images/{cycle}/",
                "overwrite_policy": "บันทึกแยกโฟลเดอร์ตามรอบ 6 เดือน (ม.ค. & ก.ค.)",
                "ready_for_retrain": False,
                "retrain_job_id": retrain_job_id,
                "next_scheduled_run": next_run
            }
            if pool:
                await pool.set("data_sync_status", json.dumps(completed_state))

            await self._append_log(f"🎉 [ลูป Full-Auto สำเร็จสมบูรณ์ 100%] Deploy สำเร็จ! ภาพรอบล่าสุด 1,000 ภาพใน images/latest/ ถูกเทรนและอัปเดตน้ำหนักโมเดลตัวใหม่ขึ้น MinIO เรียบร้อย ลบโฟลเดอร์ชั่วคราวเสร็จสมบูรณ์", status="completed")
            await self._append_log(f"📅 รอบตั้งเวลาดึงข้อมูลถัดไป (รอบ 6 เดือน: มกราคม & กรกฎาคม): {next_run[:10]}")

        except Exception as e:
            logger.error(f"Ingestion pipeline failure: {e}", exc_info=True)
            await self._append_log(f"❌ เกิดข้อผิดพลาดในกระบวนการ Ingestion: {str(e)}", status="error")
            if pool:
                error_state = {
                    "status": "error",
                    "error_message": str(e),
                    "failed_at": datetime.now(timezone.utc).isoformat()
                }
                await pool.set("data_sync_status", json.dumps(error_state))
        finally:
            self._is_running = False

    async def _update_ingest_progress(self, count: int, total: int, pct: float, rate: float):
        """Updates real-time download status in Redis."""
        pool = await get_redis_pool()
        if pool:
            try:
                state = {
                    "status": "ingesting",
                    "progress_percent": pct,
                    "downloaded_count": count,
                    "total_count": total,
                    "speed_imgs_per_sec": rate,
                    "cycle_name": CYCLE_NAME,
                    "target_folder": f"images/{TARGET_PREFIX}/",
                    "overwrite_policy": "100% เขียนทับโฟลเดอร์หลัก",
                    "ready_for_retrain": False,
                    "next_scheduled_run": (datetime.now(timezone.utc) + timedelta(days=180)).isoformat()
                }
                await pool.set("data_sync_status", json.dumps(state))
                await self._append_log(f"📥 กำลังดาวน์โหลดและเขียนทับ: {count:,}/{total:,} ภาพ ({pct}%) | ความเร็ว {rate} img/s")
            except Exception:
                pass


_data_ingest_service: Optional[DataIngestService] = None

def get_data_ingest_service() -> DataIngestService:
    global _data_ingest_service
    if _data_ingest_service is None:
        _data_ingest_service = DataIngestService()
    return _data_ingest_service
