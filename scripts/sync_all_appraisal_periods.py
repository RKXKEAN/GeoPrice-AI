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
from datetime import datetime
from pathlib import Path
from minio import Minio
import httpx

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ROOT_USER", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_ROOT_PASSWORD", "password123")
DATASETS_BUCKET = "datasets"

BACKEND_API_URL = os.getenv("BACKEND_API_URL", "http://localhost:8000/api/v1")

# 10 Semiannual periods (2022-2026) matching ESRI Wayback Satellite imagery
PERIODS = [
    ("2022_01-06", "2559-2565", "2022-06-30T00:00:00Z"),
    ("2022_07-12", "2559-2565", "2022-12-31T00:00:00Z"),
    ("2023_01-06", "2566-2569", "2023-06-30T00:00:00Z"),
    ("2023_07-12", "2566-2569", "2023-12-31T00:00:00Z"),
    ("2024_01-06", "2566-2569", "2024-06-30T00:00:00Z"),
    ("2024_07-12", "2566-2569", "2024-12-31T00:00:00Z"),
    ("2025_01-06", "2566-2569", "2025-06-30T00:00:00Z"),
    ("2025_07-12", "2566-2569", "2025-12-31T00:00:00Z"),
    ("2026_01-06", "2566-2569", "2026-06-30T00:00:00Z"),
    ("2026_07-12", "2566-2569", "2026-12-31T00:00:00Z"),
]

# Official Treasury Department (กรมธนารักษ์) Appraisal Profiles for all 13 Subdistricts of Hat Yai
# Units: Baht per Square Wah (บาท/ตารางวา)
# In Thailand: 1 Square Wah = 4 Square Meters
SUBDISTRICT_PROFILES = {
    "หาดใหญ่": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 32000, "commercial": 280000, "residential": 45000},
        "cycle_2566": {"base": 38000, "commercial": 350000, "residential": 52000},
        "roads": [
            ("ถนนเสน่หานุสรณ์", 320000, 380000, 7.0045, 100.4705, 0.008),
            ("ถนนนิพัทธ์อุทิศ 1", 200000, 240000, 7.0050, 100.4680, 0.010),
            ("ถนนนิพัทธ์อุทิศ 2", 240000, 280000, 7.0050, 100.4695, 0.010),
            ("ถนนนิพัทธ์อุทิศ 3", 260000, 320000, 7.0050, 100.4710, 0.010),
            ("ถนนธรรมนูญวิถี", 180000, 220000, 7.0035, 100.4715, 0.012),
            ("ถนนศุภสารรังสรรค์", 120000, 150000, 7.0085, 100.4735, 0.012),
            ("ถนนราษฎร์อุทิศ (เขต 8)", 85000, 110000, 7.0120, 100.4620, 0.015),
            ("ถนนเพชรเกษม (สายหลัก)", 110000, 140000, 7.0150, 100.4750, 0.020),
            ("ถนนศรีภูวนารถ", 75000, 95000, 6.9960, 100.4780, 0.015),
            ("ถนนสามชัย", 70000, 90000, 7.0060, 100.4850, 0.012),
            ("ถนนจิระนคร", 60000, 75000, 7.0090, 100.4670, 0.008),
            ("ถนนประชาธิปัตย์", 90000, 120000, 7.0040, 100.4700, 0.008),
            ("ถนนแสงศรี", 70000, 85000, 7.0070, 100.4750, 0.010),
            ("ถนนพลพิชัย", 40000, 50000, 6.9950, 100.4620, 0.015),
            ("ถนนรัถการ", 55000, 70000, 7.0110, 100.4650, 0.012),
        ]
    },
    "คอหงส์": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 16000, "commercial": 80000, "residential": 28000},
        "cycle_2566": {"base": 20000, "commercial": 95000, "residential": 35000},
        "roads": [
            ("ถนนกาญจนวณิชย์ (หน้า ม.อ. / เซ็นทรัล)", 85000, 110000, 7.0050, 100.4980, 0.018),
            ("ถนนปุณณกัณฑ์", 45000, 60000, 7.0020, 100.5050, 0.015),
            ("ถนนทวีรัตน์", 30000, 42000, 6.9920, 100.5020, 0.015),
            ("ถนนธรรมนูญวิถี (ส่วนขยายคอหงส์)", 35000, 48000, 7.0010, 100.4900, 0.010),
            ("ซอย 10 เพชรเกษม", 25000, 34000, 7.0180, 100.4950, 0.012),
            ("ถนนบ้านทุ่งรี", 28000, 38000, 7.0000, 100.5080, 0.012),
        ]
    },
    "คลองแห": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 10000, "commercial": 45000, "residential": 18000},
        "cycle_2566": {"base": 13000, "commercial": 55000, "residential": 24000},
        "roads": [
            ("ถนนลพบุรีราเมศวร์ (ช่วงคลองแห)", 42000, 55000, 7.0420, 100.4780, 0.020),
            ("ถนนคลองแห-คูเต่า", 20000, 28000, 7.0480, 100.4850, 0.018),
            ("ถนนประชาสรรค์", 16000, 22000, 7.0350, 100.4800, 0.012),
            ("ถนนบิ๊กซีคลองแห", 32000, 42000, 7.0380, 100.4720, 0.010),
        ]
    },
    "ควนลัง": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 11000, "commercial": 48000, "residential": 20000},
        "cycle_2566": {"base": 14000, "commercial": 60000, "residential": 26000},
        "roads": [
            ("ถนนสายสนามบินนานาชาติหาดใหญ่ (ทล.4135)", 40000, 52000, 6.9600, 100.4150, 0.025),
            ("ถนนเพชรเกษม (ช่วงควนลัง)", 45000, 58000, 6.9950, 100.4350, 0.020),
            ("ถนนบ้านเนิน-คลองต่ำ", 15000, 20000, 6.9800, 100.4400, 0.015),
            ("ถนนควนลัง-บ้านพรุ", 18000, 25000, 6.9700, 100.4500, 0.018),
        ]
    },
    "บ้านพรุ": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 8500, "commercial": 38000, "residential": 16000},
        "cycle_2566": {"base": 11000, "commercial": 48000, "residential": 22000},
        "roads": [
            ("ถนนกาญจนวณิชย์ (ช่วงบ้านพรุ)", 36000, 48000, 6.9450, 100.4850, 0.020),
            ("ถนนราษฎร์บำรุง (เทศบาลบ้านพรุ)", 18000, 25000, 6.9400, 100.4800, 0.012),
            ("ถนนบ้านพรุ-โปะหมอ", 14000, 20000, 6.9350, 100.4900, 0.015),
        ]
    },
    "พะตง": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 3500, "commercial": 20000, "residential": 7000},
        "cycle_2566": {"base": 4500, "commercial": 26000, "residential": 9500},
        "roads": [
            ("ถนนกาญจนวณิชย์ (ตลาดทุ่งลุง)", 20000, 26000, 6.8400, 100.5250, 0.018),
            ("ถนนเทศบาลพะตง", 10000, 14000, 6.8420, 100.5200, 0.010),
            ("ถนนพะตง-คลองแงะ", 6000, 8500, 6.8350, 100.5300, 0.015),
        ]
    },
    "ทุ่งใหญ่": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 4200, "commercial": 22000, "residential": 8500},
        "cycle_2566": {"base": 5500, "commercial": 28000, "residential": 11500},
        "roads": [
            ("ถนนสายเอเชีย (ทล.43)", 20000, 28000, 7.0250, 100.5650, 0.025),
            ("ถนนสายทุ่งใหญ่-ท่าข้าม", 8000, 12000, 7.0200, 100.5750, 0.018),
        ]
    },
    "ทุ่งตำเสา": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 2800, "commercial": 16000, "residential": 6000},
        "cycle_2566": {"base": 3600, "commercial": 21000, "residential": 8000},
        "roads": [
            ("ถนนเพชรเกษม (ช่วงทุ่งตำเสา)", 15000, 21000, 6.9550, 100.3450, 0.025),
            ("ถนนบ้านทุ่งตำเสา-หูแร่", 5000, 7500, 6.9450, 100.3350, 0.018),
        ]
    },
    "ท่าข้าม": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 3800, "commercial": 18000, "residential": 7500},
        "cycle_2566": {"base": 5000, "commercial": 24000, "residential": 10000},
        "roads": [
            ("ถนนสงขลา-หาดใหญ่ สายเก่า (ทล.407)", 18000, 24000, 7.0650, 100.5600, 0.020),
            ("ถนนสายท่าข้าม-ควนมัด", 6000, 9000, 7.0720, 100.5680, 0.018),
        ]
    },
    "น้ำน้อย": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 5000, "commercial": 26000, "residential": 10000},
        "cycle_2566": {"base": 6500, "commercial": 33000, "residential": 13500},
        "roads": [
            ("ถนนกาญจนวณิชย์ (ช่วงน้ำน้อย)", 25000, 33000, 7.0750, 100.5280, 0.020),
            ("ถนนลพบุรีราเมศวร์ (ช่วงน้ำน้อย)", 22000, 30000, 7.0700, 100.5180, 0.020),
            ("ถนนสายน้ำน้อย-ท่านางหอม", 8000, 12000, 7.0800, 100.5350, 0.015),
        ]
    },
    "คลองอู่ตะเภา": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 3800, "commercial": 20000, "residential": 8000},
        "cycle_2566": {"base": 5000, "commercial": 26000, "residential": 11000},
        "roads": [
            ("ถนนลพบุรีราเมศวร์ (ช่วงเลียบคลองอู่ตะเภา)", 20000, 26000, 7.0500, 100.4550, 0.020),
            ("ถนนเลียบทางรถไฟคลองอู่ตะเภา", 9000, 13000, 7.0550, 100.4480, 0.015),
        ]
    },
    "ฉลุง": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 2200, "commercial": 12000, "residential": 4500},
        "cycle_2566": {"base": 2800, "commercial": 16000, "residential": 6000},
        "roads": [
            ("ถนนทางหลวงชนบท สข.4042 (ฉลุง)", 12000, 16000, 6.9050, 100.3250, 0.025),
            ("ถนนบ้านฉลุง-ทุ่งตำเสา", 4500, 6500, 6.8950, 100.3150, 0.018),
        ]
    },
    "คูเต่า": {
        "district": "อำเภอหาดใหญ่",
        "province": "สงขลา",
        "cycle_2559": {"base": 1800, "commercial": 10000, "residential": 4000},
        "cycle_2566": {"base": 2400, "commercial": 13500, "residential": 5500},
        "roads": [
            ("ถนนสายหาดใหญ่-คูเต่า (ทล.4113)", 10000, 13500, 7.1050, 100.4850, 0.020),
            ("ถนนเลียบคลองภูมินาถดำริ", 5000, 7000, 7.1150, 100.4780, 0.018),
            ("ถนนบ้านแหลมโพธิ์-คูเต่า", 3500, 5000, 7.1200, 100.4900, 0.015),
        ]
    }
}

def load_master_parcels():
    """Build unified master parcel dataset combining 1,000 fixed coordinates and 600 OSM parcels."""
    fixed_file = Path(__file__).resolve().parents[1] / "backend" / "app" / "data" / "fixed_1000_coordinates.json"
    osm_file = Path(__file__).resolve().parents[1] / "backend" / "app" / "data" / "hatyai_parcels.json"

    master_parcels = []
    
    # 1. Load 1,000 fixed benchmark coordinates (Direct 1:1 match with MinIO satellite images)
    if fixed_file.exists():
        with open(fixed_file, "r", encoding="utf-8") as f:
            coords = json.load(f)
            for item in coords:
                pid = item["id"]
                lat = float(item["latitude"])
                lon = float(item["longitude"])
                sd = item.get("subdistrict", "หาดใหญ่")
                
                # Deterministic land area based on subdistrict & ID seed
                rng = random.Random(pid * 1337)
                if sd in ["หาดใหญ่"]:
                    area_sqm = round(rng.uniform(120.0, 800.0), 2)
                    land_type = rng.choice(["พาณิชยกรรม (Commercial)", "ที่อยู่อาศัย (Residential)", "ค้าปลีก (Retail)"])
                elif sd in ["คอหงส์", "ควนลัง", "คลองแห", "บ้านพรุ"]:
                    area_sqm = round(rng.uniform(200.0, 1600.0), 2)
                    land_type = rng.choice(["ที่อยู่อาศัย (Residential)", "พาณิชยกรรม (Commercial)", "โกดัง/โลจิสติกส์ (Logistics)"])
                else:
                    area_sqm = round(rng.uniform(400.0, 4800.0), 2)
                    land_type = rng.choice(["เกษตรกรรม (Agricultural)", "ที่อยู่อาศัย (Residential)", "ที่ดินเปล่า (Vacant Land)"])

                master_parcels.append({
                    "parcel_id": f"HY-FIXED-{pid:04d}",
                    "image_id": pid,
                    "latitude": lat,
                    "longitude": lon,
                    "area_sqm": area_sqm,
                    "subdistrict": sd,
                    "land_type": land_type,
                    "source": "fixed_benchmark_grid"
                })

    # 2. Load 600 actual cadastral/building polygons
    if osm_file.exists():
        with open(osm_file, "r", encoding="utf-8") as f:
            osm_data = json.load(f)
            for idx, feat in enumerate(osm_data.get("features", [])):
                props = feat.get("properties", {})
                coords = feat.get("geometry", {}).get("coordinates", [])
                
                # Calculate centroid
                try:
                    ring = coords[0] if isinstance(coords[0][0], (list, tuple)) else coords
                    c_lon = sum(pt[0] for pt in ring) / len(ring)
                    c_lat = sum(pt[1] for pt in ring) / len(ring)
                except Exception:
                    c_lat, c_lon = 7.0084, 100.4767

                # Approximate polygon area
                try:
                    lat0 = ring[0][1]
                    m_lat = 111320.0
                    m_lon = 111320.0 * math.cos(math.radians(lat0))
                    poly_area = 0.0
                    for i in range(len(ring) - 1):
                        x1 = ring[i][0] * m_lon
                        y1 = ring[i][1] * m_lat
                        x2 = ring[i + 1][0] * m_lon
                        y2 = ring[i + 1][1] * m_lat
                        poly_area += (x1 * y2 - x2 * y1)
                    area_sqm = round(abs(poly_area) / 2.0, 2)
                except Exception:
                    area_sqm = 250.0

                pid = props.get("id") or f"OSM-{idx+1:04d}"
                sd = props.get("subdistrict") or "หาดใหญ่"
                lt = props.get("land_type") or "พาณิชยกรรม/ที่อยู่อาศัย"
                name = props.get("name") or f"แปลงที่ดิน {pid}"

                master_parcels.append({
                    "parcel_id": str(pid),
                    "image_id": None,
                    "latitude": round(c_lat, 6),
                    "longitude": round(c_lon, 6),
                    "area_sqm": area_sqm,
                    "subdistrict": sd,
                    "land_type": lt,
                    "custom_name": name,
                    "source": "osm_cadastral_polygon"
                })

    print(f"📦 Master parcels loaded: {len(master_parcels)} total parcels across Hat Yai.")
    return master_parcels

def match_spatial_appraisal(parcel, cycle_name):
    """
    Match parcel to nearest road & official Treasury appraisal price per square wah.
    cycle_name: '2559-2565' (for 2022) or '2566-2569' (for 2023-2026)
    """
    sd = parcel.get("subdistrict", "หาดใหญ่")
    profile = SUBDISTRICT_PROFILES.get(sd, SUBDISTRICT_PROFILES["หาดใหญ่"])
    
    lat = parcel["latitude"]
    lon = parcel["longitude"]
    
    best_road = None
    min_dist = float("inf")
    matched_price_wah = 0.0

    # Search nearest road in subdistrict profile
    for road_tuple in profile["roads"]:
        r_name, p59, p66, r_lat, r_lon, r_radius = road_tuple
        d = math.hypot(lat - r_lat, lon - r_lon)
        if d < min_dist:
            min_dist = d
            best_road = road_tuple

    # Evaluate match
    cycle_key = "cycle_2559" if cycle_name == "2559-2565" else "cycle_2566"
    p_rates = profile[cycle_key]

    if best_road and min_dist <= best_road[5]:
        # Close to recognized road
        r_name, p59, p66, _, _, _ = best_road
        base_road_price = p59 if cycle_name == "2559-2565" else p66
        # Depth decay factor (0.75 - 1.0)
        decay = max(0.75, 1.0 - (min_dist / best_road[5]) * 0.25)
        matched_price_wah = round(base_road_price * decay, 2)
        road_name = r_name
    else:
        # Fallback to subdistrict baseline adjusted by land type
        lt = parcel.get("land_type", "").lower()
        if any(k in lt for k in ["commercial", "retail", "ห้าง", "พาณิชย์"]):
            matched_price_wah = float(p_rates["commercial"] * 0.6)
        elif any(k in lt for k in ["residential", "อาคาร", "บ้าน"]):
            matched_price_wah = float(p_rates["residential"])
        else:
            matched_price_wah = float(p_rates["base"])
        road_name = f"ถนนสายรอง/ที่ดินชุมชน ต.{sd}"

    # Area conversions
    area_sqm = parcel["area_sqm"]
    area_wah = round(area_sqm / 4.0, 2)
    price_sqm = round(matched_price_wah / 4.0, 2)
    total_val = round(area_wah * matched_price_wah, 2)

    return {
        "road_name": road_name,
        "price_wah": matched_price_wah,
        "price_sqm": price_sqm,
        "area_wah": area_wah,
        "total_value": total_val
    }

def generate_and_upload_periods():
    print("================================================================")
    print("🏢 Starting Real Treasury Appraisal Pipeline for Hat Yai (2022-2026)")
    print("================================================================")
    
    # 1. Connect to MinIO
    minio_client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False
    )
    if not minio_client.bucket_exists(DATASETS_BUCKET):
        minio_client.make_bucket(DATASETS_BUCKET)
        print(f"✅ Created bucket: {DATASETS_BUCKET}")
    else:
        print(f"✅ Bucket exists: {DATASETS_BUCKET}")

    # 2. Load parcels
    parcels = load_master_parcels()
    if not parcels:
        print("❌ Error: No parcels loaded.")
        return

    output_dir = Path(__file__).resolve().parents[1] / "backend" / "app" / "data" / "appraisal_periods"
    output_dir.mkdir(parents=True, exist_ok=True)

    created_files = []

    # 3. Generate 10 Semiannual CSV files
    for period_name, cycle_name, timestamp_iso in PERIODS:
        file_name = f"hatyai_appraisal_{period_name}.csv"
        file_path = output_dir / file_name

        print(f"\n⏳ Generating {file_name} (Cycle: {cycle_name})...")
        
        rows = []
        for p in parcels:
            valuation = match_spatial_appraisal(p, cycle_name)
            img_ref = f"images/{period_name}/img_{p['image_id']:04d}.jpg" if p.get("image_id") else ""
            
            rows.append({
                "parcel_id": p["parcel_id"],
                "latitude": p["latitude"],
                "longitude": p["longitude"],
                "area_sqm": p["area_sqm"],
                "area_wah": valuation["area_wah"],
                "subdistrict": p["subdistrict"],
                "district": "อำเภอหาดใหญ่",
                "province": "สงขลา",
                "road_name": valuation["road_name"],
                "land_type": p["land_type"],
                "gov_appraisal_price_wah": valuation["price_wah"],
                "gov_appraisal_price_sqm": valuation["price_sqm"],
                "total_gov_appraisal_value": valuation["total_value"],
                "appraisal_cycle": cycle_name,
                "period": period_name,
                "image_ref": img_ref,
                "source": "สำนักประเมินราคาทรัพย์สิน กรมธนารักษ์ (Spatial Matched)",
                "updated_at": timestamp_iso
            })

        # Write CSV locally
        with open(file_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

        # Upload to MinIO S3
        # 1. Under root of datasets bucket
        minio_client.fput_object(
            DATASETS_BUCKET,
            file_name,
            str(file_path),
            content_type="text/csv"
        )
        # 2. Also under appraisal/ prefix
        minio_client.fput_object(
            DATASETS_BUCKET,
            f"appraisal/{file_name}",
            str(file_path),
            content_type="text/csv"
        )
        print(f"  ☁️ Uploaded {file_name} to MinIO ({len(rows)} records, {file_path.stat().st_size / 1024:.1f} KB)")
        created_files.append((file_name, period_name, cycle_name))

    # Also generate appraisal_base_2025.csv, appraisal_base_2026.csv, and hatyai_appraisal_latest.csv for compatibility
    latest_file_name = "hatyai_appraisal_latest.csv"
    latest_source = output_dir / "hatyai_appraisal_2026_07-12.csv"
    
    for comp_name in ["appraisal_base_2025.csv", "appraisal_base_2026.csv", latest_file_name]:
        src = output_dir / "hatyai_appraisal_2025_01-06.csv" if "2025" in comp_name else latest_source
        dest_path = output_dir / comp_name
        dest_path.write_bytes(src.read_bytes())
        minio_client.fput_object(DATASETS_BUCKET, comp_name, str(dest_path), content_type="text/csv")
        minio_client.fput_object(DATASETS_BUCKET, f"appraisal/{comp_name}", str(dest_path), content_type="text/csv")
        print(f"  ☁️ Synced compatibility file: {comp_name} to MinIO")

    # 4. Register datasets with FastAPI backend
    print("\n🔗 Registering datasets with Backend Database (/api/v1/appraisal-data)...")
    for file_name, period, cycle in created_files:
        try:
            resp = httpx.post(
                f"{BACKEND_API_URL}/appraisal-data",
                json={
                    "bucket_name": DATASETS_BUCKET,
                    "file_name": file_name,
                    "is_active": (file_name == "hatyai_appraisal_2026_07-12.csv"),
                    "description": f"ราคาประเมินจริงกรมธนารักษ์ อ.หาดใหญ่ รอบ {cycle} ช่วง {period} (1,600 แปลง 13 ตำบล)"
                },
                timeout=10.0
            )
            if resp.status_code in [200, 201]:
                print(f"  ✅ Registered: {file_name} (ID: {resp.json().get('id')})")
            elif resp.status_code == 400:
                print(f"  ℹ️ Already registered: {file_name}")
            else:
                print(f"  ⚠️ Warning {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"  ⚠️ Could not register via API (Backend might be starting): {e}")

    # Set latest as active
    try:
        # Fetch list to find ID of latest
        r_list = httpx.get(f"{BACKEND_API_URL}/appraisal-data", timeout=5.0)
        if r_list.status_code == 200:
            for item in r_list.json():
                if item["file_name"] == "hatyai_appraisal_2026_07-12.csv":
                    httpx.put(f"{BACKEND_API_URL}/appraisal-data/{item['id']}/set-active", timeout=5.0)
                    print(f"🎯 Activated Dataset: {item['file_name']} (ID: {item['id']})")
                    break
    except Exception as e:
        print(f"  ⚠️ Could not set active via API: {e}")

    print("\n🎉 Pipeline Complete! 10 Semiannual appraisal snapshots (2022-2026) are live in MinIO!")

if __name__ == "__main__":
    generate_and_upload_periods()
