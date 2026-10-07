import io
import os
import time
import boto3
import cv2
import numpy as np
from PIL import Image
from contour_extractor import extract_target_roof_polygon

def run_comprehensive_evaluation():
    print("=" * 65)
    print("🛰️ GeoPrice AI - Comprehensive Superpixel + Fluid Field Evaluation")
    print("=" * 65)

    s3 = boto3.client(
        "s3",
        endpoint_url=f"http://{os.getenv('MINIO_URL', 'minio:9000')}",
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "admin"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "password123"),
    )

    test_images = [
        "2022_01-06/img_0001.jpg",
        "2022_01-06/img_0002.jpg",
        "2022_01-06/img_0003.jpg",
        "2022_01-06/img_0004.jpg"
    ]

    total_tested = 0
    method_counts = {
        "superpixel_fluid_polygon": 0,
        "opencv_otsu_polygon": 0,
        "opencv_otsu_inv_polygon": 0,
        "opencv_adapt_polygon": 0,
        "opencv_adapt_inv_polygon": 0,
        "opencv_edge_polygon": 0,
        "opencv_hull_polygon": 0,
        "yolo_bbox_rect": 0,
        "envelope_fallback": 0
    }
    execution_times = []

    m_per_px = 0.596 # standard zoom 18 in Hat Yai

    for img_key in test_images:
        print(f"\n📂 Evaluating Image: {img_key}")
        try:
            res = s3.get_object(Bucket="images", Key=img_key)
            img = Image.open(io.BytesIO(res['Body'].read())).convert("RGB")
            img_bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
            h_img, w_img = img_bgr.shape[:2]

            lbl_key = "labels/" + img_key.replace("/", "_").replace(".jpg", ".txt")
            lbl_res = s3.get_object(Bucket="images", Key=lbl_key)
            lines = [ln.strip() for ln in lbl_res['Body'].read().decode("utf-8").strip().split("\n") if ln.strip()]
        except Exception as e:
            print(f"Error loading {img_key}: {e}")
            continue

        for i, line in enumerate(lines[:6]):
            total_tested += 1
            parts = line.split()
            cls, xc, yc, w, h = [float(x) for x in parts]
            bx1 = (xc - w / 2.0) * w_img
            by1 = (yc - h / 2.0) * h_img
            bx2 = (xc + w / 2.0) * w_img
            by2 = (yc + h / 2.0) * h_img

            center_x = (bx1 + bx2) / 2.0
            center_y = (by1 + by2) / 2.0

            t0 = time.perf_counter()
            result = extract_target_roof_polygon(
                image_bgr=img_bgr,
                click_x=center_x,
                click_y=center_y,
                m_per_px=m_per_px,
                bounding_box=(bx1, by1, bx2, by2)
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            execution_times.append(elapsed_ms)

            method = result.get("method", "unknown")
            method_counts[method] = method_counts.get(method, 0) + 1

            area = result.get("area_sqm", 0)
            verts = result.get("vertices_count", 0)
            conf = result.get("confidence", 0)

            print(f"  Building #{i+1:02d}: Method={method:<26} Vertices={verts:2d} Area={area:6.1f} sqm Conf={conf:.2f} ({elapsed_ms:5.1f} ms)")

    print("\n" + "=" * 65)
    print("📊 BENCHMARK & EVALUATION SUMMARY")
    print("=" * 65)
    print(f"Total Buildings Tested : {total_tested}")
    print(f"Average Execution Time : {np.mean(execution_times):.2f} ms per building")
    print(f"Min / Max Execution    : {np.min(execution_times):.2f} ms / {np.max(execution_times):.2f} ms")
    print("\nExtraction Method Distribution:")
    for m, c in sorted(method_counts.items(), key=lambda x: x[1], reverse=True):
        if c > 0:
            pct = (c / total_tested) * 100.0 if total_tested > 0 else 0
            badge = "⭐ PRIMARY" if "superpixel" in m else ("🔄 FALLBACK TIER 2" if "opencv" in m else "🛡️ SAFETY TIER 3")
            print(f"  - {m:<28}: {c:2d} ({pct:5.1f}%) [{badge}]")
    print("=" * 65)

if __name__ == "__main__":
    run_comprehensive_evaluation()
