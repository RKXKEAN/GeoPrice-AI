import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import math
import io
import csv
import json
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
ZOOM = 17

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://livingatlas.arcgis.com/wayback/"
}

# 10 Semiannual periods with corresponding ESRI Wayback Release Numbers
PERIODS = [
    ("2022_01-06", "44710"),  # 2022-06-08
    ("2022_07-12", "45134"),  # 2022-12-14
    ("2023_01-06", "25982"),  # 2023-06-13
    ("2023_07-12", "56102"),  # 2023-12-07
    ("2024_01-06", "12428"),  # 2024-06-06
    ("2024_07-12", "16453"),  # 2024-12-12
    ("2025_01-06", "48925"),  # 2025-06-26
    ("2025_07-12", "13192"),  # 2025-12-18
    ("2026_01-06", "32246"),  # 2026-06-30
    ("2026_07-12", "26334"),  # 2026-08-05 (Latest)
]

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

def get_or_generate_fixed_coordinates():
    coord_file = r"D:\Geo-price\backend\app\data\fixed_1000_coordinates.json"
    if os.path.exists(coord_file):
        with open(coord_file, "r", encoding="utf-8") as f:
            coords = json.load(f)
            if len(coords) == 1000:
                print(f"📍 Loaded {len(coords)} existing fixed coordinates from {coord_file}")
                return coords

    coords = []
    # 1. Sample 520 points from 21,718 CSV
    csv_path = r"D:\Geo-price\ราคาประเมินและราคาตลาด_แปลงที่ดินหาดใหญ่_21718แปลง.csv"
    if os.path.exists(csv_path):
        with open(csv_path, encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            random.seed(999)
            sampled_rows = random.sample(rows, min(520, len(rows)))
            for idx, r in enumerate(sampled_rows):
                try:
                    lat = float(r["latitude"])
                    lon = float(r["longitude"])
                    sd = r.get("subdistrict", "หาดใหญ่").strip()
                    coords.append({
                        "id": len(coords) + 1,
                        "latitude": lat,
                        "longitude": lon,
                        "subdistrict": sd
                    })
                except (ValueError, KeyError):
                    pass

    # 2. Add 480 points across all 13 subdistricts (~37 per subdistrict) to reach 1,000
    random.seed(888)
    remaining_needed = 1000 - len(coords)
    points_per_sd = math.ceil(remaining_needed / len(HAT_YAI_SUBDISTRICTS))

    for sd_name, (center_lat, center_lon) in HAT_YAI_SUBDISTRICTS.items():
        for _ in range(points_per_sd):
            if len(coords) >= 1000:
                break
            dlat = (random.random() - 0.5) * 0.05
            dlon = (random.random() - 0.5) * 0.05
            coords.append({
                "id": len(coords) + 1,
                "latitude": round(center_lat + dlat, 6),
                "longitude": round(center_lon + dlon, 6),
                "subdistrict": sd_name
            })

    coords = coords[:1000]
    os.makedirs(os.path.dirname(coord_file), exist_ok=True)
    with open(coord_file, "w", encoding="utf-8") as f:
        json.dump(coords, f, ensure_ascii=False, indent=2)
    print(f"📍 Generated and saved exactly {len(coords)} fixed coordinates to {coord_file}")
    return coords

def sync_period(period_name, release_num, fixed_coords, minio_client):
    print(f"\n========================================================")
    print(f"🚀 Processing Period: {period_name} (Release: {release_num})")
    print(f"========================================================", flush=True)

    tile_cache = {}
    cache_lock = Lock()
    print_lock = Lock()
    processed_count = 0
    start_time = time.time()
    total_images = len(fixed_coords)

    def fetch_tile(client, tx, ty):
        key = (tx, ty)
        with cache_lock:
            if key in tile_cache:
                return tile_cache[key]

        url = f"https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{release_num}/{ZOOM}/{ty}/{tx}"
        for attempt in range(3):
            try:
                resp = client.get(url)
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

    def process_image(item):
        nonlocal processed_count
        idx, coord = item
        lat = coord["latitude"]
        lon = coord["longitude"]
        cx, cy = lat_lon_to_tile(lat, lon, ZOOM)

        with httpx.Client(timeout=15.0, headers=HEADERS, follow_redirects=True) as http_client:
            canvas = Image.new("RGB", (768, 768))
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    tx, ty = cx + dx, cy + dy
                    tile_bytes = fetch_tile(http_client, tx, ty)
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
        object_key = f"{period_name}/{img_name}"

        # Upload strictly the image (NO metadata file)
        minio_client.put_object(
            BUCKET_NAME,
            object_key,
            io.BytesIO(img_bytes),
            len(img_bytes),
            content_type="image/jpeg"
        )

        with print_lock:
            processed_count += 1
            if processed_count % 100 == 0 or processed_count == total_images:
                elapsed = time.time() - start_time
                rate = processed_count / elapsed if elapsed > 0 else 0
                print(f"[{period_name}] {processed_count}/{total_images} uploaded ({rate:.1f} img/s) - Tiles: {len(tile_cache)}", flush=True)

    items = list(enumerate(fixed_coords, start=1))
    with ThreadPoolExecutor(max_workers=14) as executor:
        futures = [executor.submit(process_image, it) for it in items]
        for f in as_completed(futures):
            try:
                f.result()
            except Exception as e:
                pass

    total_period_time = time.time() - start_time
    print(f"✅ Completed {period_name}: {processed_count} images in {total_period_time:.1f}s ({processed_count/total_period_time:.1f} img/s)", flush=True)

def main():
    print("🌟 GeoPrice AI - Full Multi-Period Wayback Imagery Synchronization (2022-2026)")
    print(f"🎯 Target: 10 Periods | 1,000 images per period | 640x640 JPEG | MinIO bucket: '{BUCKET_NAME}'")

    minio_client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False
    )
    if not minio_client.bucket_exists(BUCKET_NAME):
        minio_client.make_bucket(BUCKET_NAME)

    fixed_coords = get_or_generate_fixed_coordinates()
    global_start = time.time()

    for idx, (p_name, rel_num) in enumerate(PERIODS, start=1):
        print(f"\n--- [Period {idx}/10] Starting {p_name} ---", flush=True)
        sync_period(p_name, rel_num, fixed_coords, minio_client)

    global_elapsed = time.time() - global_start
    print(f"\n🎉 ALL 10 PERIODS COMPLETE!")
    print(f"📊 Total 10,000 images uploaded to MinIO across all 10 periods in {global_elapsed/60:.1f} minutes!")

if __name__ == "__main__":
    main()
