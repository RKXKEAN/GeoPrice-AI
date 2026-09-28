import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import math
import io
import csv
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from PIL import Image
import httpx
from minio import Minio

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ROOT_USER", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_ROOT_PASSWORD", "password123")
BUCKET_NAME = "images"
PERIOD_FOLDER = "2026_03-08"
RELEASE_NUM = "26334"  # ESRI Wayback 2026-08-05
ZOOM = 17

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://livingatlas.arcgis.com/wayback/"
}

HAT_YAI_SUBDISTRICTS = {
    "หาดใหญ่": (7.008, 100.477),
    "ควนลัง": (6.992, 100.435),
    "คลองแห": (7.045, 100.485),
    "คอหงส์": (7.005, 100.510),
    "บ้านพรุ": (6.940, 100.480),
    "ทุ่งใหญ่": (7.020, 100.570),
    "ทุ่งตำเสา": (6.950, 100.340),
    "ท่าข้าม": (7.070, 100.560),
    "น้ำน้อย": (7.075, 100.525),
    "พะตง": (6.840, 100.520),
    "คลองอู่ตะเภา": (7.050, 100.450),
    "ฉลุง": (6.900, 100.320),
    "คูเต่า": (7.110, 100.480),
}

def lat_lon_to_tile(lat, lon, zoom):
    n = 2.0 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y

def main():
    print(f"🚀 Starting High-Performance Multi-threaded Wayback Ingestion Pipeline...")
    print(f"📁 Target Period: {PERIOD_FOLDER} | Release: {RELEASE_NUM} | Zoom: {ZOOM} | Size: 640x640")

    minio_client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False
    )
    if not minio_client.bucket_exists(BUCKET_NAME):
        minio_client.make_bucket(BUCKET_NAME)

    # 1. Sample real parcels
    csv_path = r"D:\Geo-price\ราคาประเมินและราคาตลาด_แปลงที่ดินหาดใหญ่_21718แปลง.csv"
    sampled_points = []
    
    if os.path.exists(csv_path):
        with open(csv_path, encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            random.seed(42)
            sample_rows = random.sample(rows, min(700, len(rows)))
            for r in sample_rows:
                try:
                    lat = float(r["latitude"])
                    lon = float(r["longitude"])
                    sd = r.get("subdistrict", "หาดใหญ่").strip()
                    sampled_points.append({"lat": lat, "lon": lon, "subdistrict": sd, "source": "parcel_csv"})
                except (ValueError, KeyError):
                    pass
        print(f"✅ Sampled {len(sampled_points)} parcels from CSV.")

    # 2. Add grid points across 13 subdistricts
    random.seed(123)
    for sd_name, (center_lat, center_lon) in HAT_YAI_SUBDISTRICTS.items():
        count_for_sd = 38
        for _ in range(count_for_sd):
            dlat = (random.random() - 0.5) * 0.04
            dlon = (random.random() - 0.5) * 0.04
            sampled_points.append({
                "lat": round(center_lat + dlat, 6),
                "lon": round(center_lon + dlon, 6),
                "subdistrict": sd_name,
                "source": "district_grid"
            })

    total_target = len(sampled_points)
    print(f"📊 Total target images: {total_target} images covering all 13 subdistricts.")

    # Shared thread-safe structures
    tile_cache = {}
    cache_lock = Lock()
    print_lock = Lock()
    processed_count = 0
    metadata_records = []
    start_time = time.time()

    def fetch_tile_threadsafe(client, tx, ty):
        key = (tx, ty)
        with cache_lock:
            if key in tile_cache:
                return tile_cache[key]

        url = f"https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{RELEASE_NUM}/{ZOOM}/{ty}/{tx}"
        for attempt in range(3):
            try:
                resp = client.get(url)
                if resp.status_code == 200 and len(resp.content) > 1000:
                    with cache_lock:
                        tile_cache[key] = resp.content
                    return resp.content
                elif resp.status_code == 403:
                    time.sleep(0.3)
            except Exception:
                time.sleep(0.3)

        blank = Image.new("RGB", (256, 256), (30, 40, 50))
        b = io.BytesIO()
        blank.save(b, format="JPEG")
        return b.getvalue()

    def process_item(item_data):
        nonlocal processed_count
        idx, pt = item_data
        lat = pt["lat"]
        lon = pt["lon"]
        cx, cy = lat_lon_to_tile(lat, lon, ZOOM)

        # Thread-local HTTP client and MinIO client
        with httpx.Client(timeout=12.0, headers=HEADERS) as http_client:
            canvas = Image.new("RGB", (768, 768))
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    tx, ty = cx + dx, cy + dy
                    tile_bytes = fetch_tile_threadsafe(http_client, tx, ty)
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
        object_key = f"{PERIOD_FOLDER}/{img_name}"

        # Upload
        minio_client.put_object(
            BUCKET_NAME,
            object_key,
            io.BytesIO(img_bytes),
            len(img_bytes),
            content_type="image/jpeg"
        )

        record = {
            "image_name": img_name,
            "object_path": f"{BUCKET_NAME}/{object_key}",
            "latitude": lat,
            "longitude": lon,
            "subdistrict": pt["subdistrict"],
            "district": "อำเภอหาดใหญ่",
            "province": "สงขลา",
            "source": pt["source"],
            "release_id": RELEASE_NUM,
            "captured_period": "2026-03_to_2026-08",
            "zoom": ZOOM,
            "width": 640,
            "height": 640
        }

        with print_lock:
            processed_count += 1
            metadata_records.append(record)
            if processed_count % 50 == 0 or processed_count == total_target:
                elapsed = time.time() - start_time
                rate = processed_count / elapsed if elapsed > 0 else 0
                print(f"⚡ [{processed_count}/{total_target}] Uploaded {img_name} ({rate:.1f} img/s) - Tiles in cache: {len(tile_cache)}", flush=True)

        return record

    print("🚀 Launching ThreadPoolExecutor with 10 concurrent workers...")
    items = list(enumerate(sampled_points, start=1))

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(process_item, item) for item in items]
        for f in as_completed(futures):
            try:
                f.result()
            except Exception as e:
                print(f"Error processing item: {e}", flush=True)

    # Sort records by image_name
    metadata_records.sort(key=lambda x: x["image_name"])

    # Upload metadata.csv
    csv_buffer = io.StringIO()
    fieldnames = list(metadata_records[0].keys())
    writer = csv.DictWriter(csv_buffer, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(metadata_records)
    csv_bytes = csv_buffer.getvalue().encode("utf-8-sig")

    minio_client.put_object(
        BUCKET_NAME,
        f"{PERIOD_FOLDER}/metadata.csv",
        io.BytesIO(csv_bytes),
        len(csv_bytes),
        content_type="text/csv"
    )

    local_meta_path = r"D:\Geo-price\backend\app\data\metadata_2026_03_08.csv"
    with open(local_meta_path, "wb") as f:
        f.write(csv_bytes)

    total_time = time.time() - start_time
    print(f"\n🎉 Successfully completed! {len(metadata_records)} images uploaded to MinIO '{BUCKET_NAME}/{PERIOD_FOLDER}/'", flush=True)
    print(f"⏱️ Total time: {total_time:.1f}s ({len(metadata_records)/total_time:.1f} img/s)", flush=True)
    print(f"📄 Metadata saved to: '{BUCKET_NAME}/{PERIOD_FOLDER}/metadata.csv' and '{local_meta_path}'", flush=True)

if __name__ == "__main__":
    main()
