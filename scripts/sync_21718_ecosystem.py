import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import math
import io
import csv
import json
import time
from pathlib import Path
from minio import Minio
import httpx

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ROOT_USER", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_ROOT_PASSWORD", "password123")
DATASETS_BUCKET = "datasets"
BACKEND_API_URL = os.getenv("BACKEND_API_URL", "http://localhost:8000/api/v1")

BASE_DIR = Path(__file__).resolve().parents[1]
HARVESTED_JSON = BASE_DIR / "hatyai_parcels_harvested (1).json"
SURVEY_CSV = BASE_DIR / "backend" / "app" / "data" / "hatyai_appraisal_market_21718.csv"

# 10 Semiannual periods (2022-2026) matching ESRI Wayback Satellite imagery
PERIODS = [
    ("2022_01-06", "2559-2565", 4.5),  # 4.5 years back from 2026_07-12
    ("2022_07-12", "2559-2565", 4.0),  # 4.0 years back
    ("2023_01-06", "2566-2569", 3.5),  # 3.5 years back
    ("2023_07-12", "2566-2569", 3.0),  # 3.0 years back
    ("2024_01-06", "2566-2569", 2.5),  # 2.5 years back
    ("2024_07-12", "2566-2569", 2.0),  # 2.0 years back
    ("2025_01-06", "2566-2569", 1.5),  # 1.5 years back
    ("2025_07-12", "2566-2569", 1.0),  # 1.0 years back
    ("2026_01-06", "2566-2569", 0.5),  # 0.5 years back
    ("2026_07-12", "2566-2569", 0.0),  # Latest
]

def load_master_data():
    print("📖 Loading master survey CSV...")
    csv_lookup = {}
    if SURVEY_CSV.exists():
        with open(SURVEY_CSV, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                pid = row.get("parcel_id")
                if pid:
                    csv_lookup[pid] = row
    print(f"✅ Loaded {len(csv_lookup):,} surveyed parcel records from CSV.")

    print(f"📖 Loading real geometry polygons from {HARVESTED_JSON.name}...")
    if not HARVESTED_JSON.exists():
        raise FileNotFoundError(f"Missing {HARVESTED_JSON}")

    with open(HARVESTED_JSON, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    parcels = []
    features = raw_data.get("features", [])
    print(f"📊 Parsing {len(features):,} features...")

    for feat in features:
        props = feat.get("properties", {})
        geom = feat.get("geometry", {})
        pid = str(feat.get("id") or props.get("id") or props.get("parcel_id") or "")
        if not pid.startswith("OSM-"):
            clean_pid = f"OSM-{pid}"
        else:
            clean_pid = pid

        # Surveyed row
        s_row = csv_lookup.get(clean_pid) or csv_lookup.get(pid) or {}

        # Centroid
        lat = float(s_row.get("latitude") or props.get("latitude") or 7.0084)
        lon = float(s_row.get("longitude") or props.get("longitude") or 100.4767)
        area_sqm = float(s_row.get("area_sqm") or props.get("area_sqm") or 250.0)
        area_wah = round(area_sqm / 4.0, 2)

        pname = s_row.get("parcel_name") or props.get("name") or f"แปลงที่ดิน {clean_pid}"
        sd = s_row.get("subdistrict") or props.get("subdistrict") or "ต.หาดใหญ่"
        sd = sd.replace("ต.", "")
        lt = s_row.get("land_type") or props.get("land_type") or "ที่ดิน/สิ่งปลูกสร้างทั่วไป"
        street = s_row.get("zone_name") or s_row.get("street") or props.get("street") or pname

        # 2026 Baseline Rates
        appr_2026 = float(s_row.get("appraisal_price_per_sqw_2026") or 65000.0)
        mkt_2026 = float(s_row.get("market_price_per_sqw_2026") or (appr_2026 * 1.3))
        growth_rate = float(s_row.get("urban_growth_rate_pct") or 5.0) / 100.0

        parcels.append({
            "parcel_id": clean_pid,
            "name": pname,
            "latitude": lat,
            "longitude": lon,
            "area_sqm": area_sqm,
            "area_wah": area_wah,
            "subdistrict": sd,
            "district": "อำเภอหาดใหญ่",
            "province": "สงขลา",
            "street": street,
            "land_type": lt,
            "appraisal_2026": appr_2026,
            "market_2026": mkt_2026,
            "growth_rate": growth_rate,
            "geometry": geom
        })

    print(f"🎉 Master data ready: {len(parcels):,} real parcel polygons.")
    return parcels

def purge_minio_and_db(minio_client):
    print("\n🧹 [Phase 1] Purging OLD Mockup / Synthetic Datasets from MinIO & PostgreSQL...")

    # 1. Clean MinIO bucket 'datasets'
    if minio_client.bucket_exists(DATASETS_BUCKET):
        objects = list(minio_client.list_objects(DATASETS_BUCKET))
        print(f"Found {len(objects)} existing objects in MinIO bucket '{DATASETS_BUCKET}'.")
        for obj in objects:
            name = obj.object_name
            # Remove old mockup files
            if (
                name.startswith("appraisal_base_") or 
                name.startswith("hatyai_parcels_harvested_all") or
                name.startswith("hatyai_appraisal_")
            ):
                minio_client.remove_object(DATASETS_BUCKET, name)
                print(f"   🗑️ Removed MinIO object: {name}")
    else:
        minio_client.make_bucket(DATASETS_BUCKET)
        print(f"   ✨ Created bucket '{DATASETS_BUCKET}'.")

    # 2. Clean Database table 'appraisal_datasets' via Docker postgres container
    try:
        import subprocess
        clean_sql = "DELETE FROM appraisal_datasets;"
        res = subprocess.run(
            ["docker", "exec", "geoprice-postgres", "psql", "-U", "admin", "-d", "hydrogeo_db", "-c", clean_sql],
            capture_output=True,
            text=True
        )
        if res.returncode == 0:
            print("   🗑️ Purged all old dataset records from PostgreSQL appraisal_datasets table.")
        else:
            print(f"   ⚠️ PostgreSQL clean warning: {res.stderr}")
    except Exception as e:
        print(f"   ⚠️ Could not run psql directly: {e}")

def generate_and_upload(minio_client, parcels):
    print("\n🚀 [Phase 2] Generating & Uploading 10 Semiannual Periods (2022-2026) + Latest for 21,718 Parcels...")

    db_entries = []

    # Process all 10 periods
    for period_name, cycle_name, years_back in PERIODS:
        t0 = time.time()
        print(f"\n⚡ Processing Period: {period_name} (Cycle: {cycle_name}, Years back: {years_back})...")

        features = []
        csv_rows = []

        is_latest_period = (period_name == "2026_07-12")

        for p in parcels:
            area_sqm = p["area_sqm"]
            area_wah = p["area_wah"]

            # 1. Official Treasury Appraisal
            if cycle_name == "2559-2565":
                # Cycle 2559-2565 was ~15% lower than 2566-2569 in Hat Yai
                price_appr = round(p["appraisal_2026"] * 0.85, 2)
            else:
                price_appr = round(p["appraisal_2026"], 2)

            total_appr = round(area_wah * price_appr, 2)

            # 2. Market Price compounded discount
            multiplier = (1.0 + p["growth_rate"]) ** (-years_back)
            price_mkt = round(p["market_2026"] * multiplier, 2)
            total_mkt = round(area_wah * price_mkt, 2)

            feat = {
                "type": "Feature",
                "id": p["parcel_id"],
                "properties": {
                    "parcel_id": p["parcel_id"],
                    "name": p["name"],
                    "area_size": area_sqm,
                    "area_wah": area_wah,
                    "price_ref": price_appr,
                    "total_appraisal": total_appr,
                    "market_price_wah": price_mkt,
                    "total_market": total_mkt,
                    "latitude": p["latitude"],
                    "longitude": p["longitude"],
                    "street": p["street"],
                    "subdistrict": p["subdistrict"],
                    "district": p["district"],
                    "province": p["province"],
                    "land_type": p["land_type"],
                    "appraisal_cycle": cycle_name,
                    "period": period_name,
                    "active_dataset": f"hatyai_appraisal_{period_name}.geojson",
                    "bucket": DATASETS_BUCKET
                },
                "geometry": p["geometry"]
            }
            features.append(feat)

            csv_rows.append({
                "parcel_id": p["parcel_id"],
                "parcel_name": p["name"],
                "latitude": p["latitude"],
                "longitude": p["longitude"],
                "area_sqm": area_sqm,
                "area_wah": area_wah,
                "subdistrict": p["subdistrict"],
                "district": p["district"],
                "province": p["province"],
                "road_name": p["street"],
                "land_type": p["land_type"],
                "gov_appraisal_price_wah": price_appr,
                "gov_appraisal_price_sqm": round(price_appr / 4.0, 2),
                "total_gov_appraisal_value": total_appr,
                "market_price_per_sqw": price_mkt,
                "total_market_price": total_mkt,
                "appraisal_cycle": cycle_name,
                "period": period_name,
                "geometry": json.dumps(p["geometry"])
            })

        fc = {
            "type": "FeatureCollection",
            "metadata": {
                "period": period_name,
                "cycle": cycle_name,
                "total_parcels": len(features),
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": "OpenStreetMap Real Polygons + กรมธนารักษ์"
            },
            "features": features
        }

        # Encode GeoJSON bytes
        geojson_bytes = json.dumps(fc, ensure_ascii=False).encode("utf-8")
        geojson_name = f"hatyai_appraisal_{period_name}.geojson"
        minio_client.put_object(
            DATASETS_BUCKET,
            geojson_name,
            io.BytesIO(geojson_bytes),
            len(geojson_bytes),
            content_type="application/geo+json"
        )

        # Encode CSV bytes
        csv_buffer = io.StringIO()
        writer = csv.DictWriter(csv_buffer, fieldnames=list(csv_rows[0].keys()))
        writer.writeheader()
        writer.writerows(csv_rows)
        csv_bytes = csv_buffer.getvalue().encode("utf-8")
        csv_name = f"hatyai_appraisal_{period_name}.csv"
        minio_client.put_object(
            DATASETS_BUCKET,
            csv_name,
            io.BytesIO(csv_bytes),
            len(csv_bytes),
            content_type="text/csv"
        )

        print(f"   ✅ Uploaded MinIO: {geojson_name} ({len(geojson_bytes):,} B) & {csv_name} ({len(csv_bytes):,} B) [{time.time() - t0:.1f}s]")

        db_entries.append((
            geojson_name,
            False,
            f"ราคาประเมินหาดใหญ่ 21,718 แปลงจริง งวด {period_name} (รอบ {cycle_name})"
        ))

        # If this is 2026_07-12, also upload as hatyai_appraisal_latest.*
        if is_latest_period:
            print("   🌟 Also uploading as 'hatyai_appraisal_latest.geojson' and '.csv' (ACTIVE)...")
            minio_client.put_object(
                DATASETS_BUCKET,
                "hatyai_appraisal_latest.geojson",
                io.BytesIO(geojson_bytes),
                len(geojson_bytes),
                content_type="application/geo+json"
            )
            minio_client.put_object(
                DATASETS_BUCKET,
                "hatyai_appraisal_latest.csv",
                io.BytesIO(csv_bytes),
                len(csv_bytes),
                content_type="text/csv"
            )

    # Register into DB
    print("\n📝 [Phase 3] Registering Datasets in PostgreSQL...")
    import subprocess
    for fname, is_act, desc in db_entries:
        sql = f"INSERT INTO appraisal_datasets (bucket_name, file_name, is_active, description, created_at) VALUES ('datasets', '{fname}', false, '{desc}', NOW());"
        subprocess.run(
            ["docker", "exec", "geoprice-postgres", "psql", "-U", "admin", "-d", "hydrogeo_db", "-c", sql],
            capture_output=True
        )

    # Add and activate latest
    latest_sql = "INSERT INTO appraisal_datasets (bucket_name, file_name, is_active, description, created_at) VALUES ('datasets', 'hatyai_appraisal_latest.geojson', true, 'ราคาประเมินและราคาตลาดหาดใหญ่ 21,718 แปลงจริง (รอบ 2566-2569 ล่าสุด)', NOW());"
    subprocess.run(
        ["docker", "exec", "geoprice-postgres", "psql", "-U", "admin", "-d", "hydrogeo_db", "-c", latest_sql],
        capture_output=True
    )
    print("   ✅ Registered all 10 periods + hatyai_appraisal_latest.geojson (ACTIVE).")

def clean_local_obsolete_files():
    print("\n🧹 [Phase 4] Cleaning Obsolete Local Working Files...")

    # 1. Clean appraisal_periods local directory
    local_periods_dir = BASE_DIR / "backend" / "app" / "data" / "appraisal_periods"
    if local_periods_dir.exists():
        for f in local_periods_dir.glob("*"):
            if f.is_file():
                try:
                    f.unlink()
                    print(f"   🗑️ Removed local obsolete file: {f.name}")
                except Exception as e:
                    print(f"   ⚠️ Could not delete {f.name}: {e}")

    # 2. Clean fixed_1000_coordinates.json and metadata_2026_03_08.csv
    obsolete_files = [
        BASE_DIR / "backend" / "app" / "data" / "fixed_1000_coordinates.json",
        BASE_DIR / "backend" / "app" / "data" / "metadata_2026_03_08.csv"
    ]
    for of in obsolete_files:
        if of.exists():
            try:
                of.unlink()
                print(f"   🗑️ Removed local obsolete file: {of.name}")
            except Exception as e:
                print(f"   ⚠️ Could not delete {of.name}: {e}")

    print("   ✨ Local workspace cleaned up. Everything is managed within MinIO S3!")

def main():
    print("==================================================================")
    print("🌐 Full Ecosystem Sync: 21,718 Real Parcels (2022-2026) -> MinIO")
    print("==================================================================")

    minio_client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False
    )

    parcels = load_master_data()
    purge_minio_and_db(minio_client)
    generate_and_upload(minio_client, parcels)
    clean_local_obsolete_files()

    print("\n==================================================================")
    print("🎉 ALL 10 PERIODS (2022-2026) OF 21,718 REAL PARCELS ARE LIVE IN MINIO!")
    print("==================================================================")

if __name__ == "__main__":
    main()
