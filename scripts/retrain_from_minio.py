"""
================================================================================
TerraCast-AI: Automated Retrain Pipeline from MinIO Object Storage
================================================================================
สคริปต์สำหรับ:
1. เชื่อมต่อ MinIO เพื่อดาวน์โหลด Dataset (รองรับทั้งไฟล์ .zip และโฟลเดอร์รูปภาพ)
2. โหลดโมเดลเดิม (best1.pt) มาเทรนต่อยอด (Fine-tuning / Retrain) ด้วย GPU
3. อัปโหลดผลลัพธ์โมเดลตัวใหม่ (best_retrained.pt) กลับขึ้น MinIO อัตโนมัติ

วิธีใช้งาน:
  python retrain_from_minio.py --model best1.pt --bucket datasets --epochs 50
"""

import os
import sys
import glob
import zipfile
import argparse
import logging
from pathlib import Path

# ตรวจสอบ Library ที่จำเป็น
try:
    from minio import Minio
    from minio.error import S3Error
except ImportError:
    print("❌ กรุณาติดตั้ง minio ก่อน: pip install minio", file=sys.stderr)
    sys.exit(1)

try:
    import torch
    from ultralytics import YOLO
except ImportError:
    print("❌ กรุณาติดตั้ง ultralytics และ torch: pip install ultralytics torch", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("MinIORetrainPipeline")


def download_dataset_from_minio(
    client: Minio,
    bucket_name: str,
    target_dir: str = "dataset_local",
    zip_filename: str = "dataset.zip"
) -> str:
    """
    ดาวน์โหลด Dataset จาก MinIO ลงมาไว้ที่เครื่อง Local
    รองรับทั้งกรณีเป็นไฟล์ .zip และกรณีเป็นโฟลเดอร์แยกไฟล์
    """
    os.makedirs(target_dir, exist_ok=True)

    # 1. ตรวจสอบว่ามี Bucket นี้ไหม
    if not client.bucket_exists(bucket_name):
        raise ValueError(f"ไม่พบบักเก็ตชื่อ '{bucket_name}' ใน MinIO")

    logger.info(f"🔍 สำรวจไฟล์ใน Bucket: '{bucket_name}'...")
    objects = list(client.list_objects(bucket_name, recursive=True))
    object_names = [obj.object_name for obj in objects]

    # กรณีที่ 1: พบไฟล์ Zip (เช่น dataset.zip หรือชื่อที่ระบุ)
    found_zips = [name for name in object_names if name.endswith(".zip")]
    if found_zips:
        chosen_zip = zip_filename if zip_filename in found_zips else found_zips[0]
        local_zip_path = os.path.join(target_dir, os.path.basename(chosen_zip))
        logger.info(f"📦 กำลังดาวน์โหลดไฟล์ zip: '{chosen_zip}' จาก MinIO...")
        client.fget_object(bucket_name, chosen_zip, local_zip_path)
        
        logger.info(f"📂 กำลังแตกไฟล์ zip ไปที่ '{target_dir}'...")
        with zipfile.ZipFile(local_zip_path, 'r') as zip_ref:
            zip_ref.extractall(target_dir)
        logger.info("✅ แตกไฟล์ Dataset สำเร็จ!")
        return target_dir

    # กรณีที่ 2: เป็นโฟลเดอร์รูปและ labels เก็บแยกไฟล์
    logger.info(f"📥 กำลังดาวน์โหลดไฟล์ทั้งหมด ({len(objects)} ไฟล์) จาก MinIO...")
    for obj in objects:
        if obj.is_dir:
            continue
        dest_path = os.path.join(target_dir, obj.object_name)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        client.fget_object(bucket_name, obj.object_name, dest_path)
    
    logger.info("✅ ดาวน์โหลด Dataset ทั้งหมดเสร็จสิ้น!")
    return target_dir


def find_data_yaml(search_dir: str) -> str:
    """ค้นหาไฟล์ data.yaml ภายในโฟลเดอร์ Dataset อัตโนมัติ"""
    yaml_files = glob.glob(f"{search_dir}/**/data.yaml", recursive=True)
    if not yaml_files:
        yaml_files = glob.glob(f"{search_dir}/**/*.yaml", recursive=True)
    
    if yaml_files:
        logger.info(f"📄 พบไฟล์ตั้งค่า Dataset: {yaml_files[0]}")
        return os.path.abspath(yaml_files[0])
    raise FileNotFoundError(f"ไม่พบไฟล์ data.yaml หรือ *.yaml ในโฟลเดอร์ '{search_dir}'")


def retrain_yolo_model(
    model_path: str,
    data_yaml_path: str,
    epochs: int = 50,
    imgsz: int = 640,
    batch_size: int = 8,
    project: str = "runs/retrain",
    name: str = "best_v2"
) -> str:
    """สั่งเทรนโมเดลต่อจาก model_path ด้วย Ultralytics YOLO"""
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"ไม่พบไฟล์โมเดลตั้งต้นที่: {model_path}")

    # ตรวจสอบ Device (GPU หรือ CPU)
    device = 0 if torch.cuda.is_available() else "cpu"
    device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    logger.info("=" * 60)
    logger.info(f"🚀 เริ่มการ Retrain โมเดล YOLO")
    logger.info(f"   - Base Model: {model_path}")
    logger.info(f"   - Dataset Config: {data_yaml_path}")
    logger.info(f"   - Hardware: {device_name} (device={device})")
    logger.info(f"   - Epochs: {epochs} | Batch: {batch_size} | ImgSize: {imgsz}")
    logger.info("=" * 60)

    # โหลดโมเดลเดิมมาเทรนต่อ
    model = YOLO(model_path)
    
    results = model.train(
        data=data_yaml_path,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch_size,
        device=device,
        project=project,
        name=name,
        exist_ok=True,
        save=True,
        verbose=True
    )

    trained_best_path = os.path.join(project, name, "weights", "best.pt")
    if os.path.exists(trained_best_path):
        logger.info(f"🎉 Retrain สำเร็จ! บันทึกโมเดลใหม่ไว้ที่: {trained_best_path}")
        return trained_best_path
    
    # กรณีหา weights/best.pt ตรงๆ ไม่เจอ ให้หา .pt ล่าสุดในโฟลเดอร์ project
    fallback = glob.glob(f"{project}/{name}/**/*.pt", recursive=True)
    if fallback:
        return fallback[0]
    return model_path


def upload_model_to_minio(
    client: Minio,
    bucket_name: str,
    local_model_path: str,
    minio_target_key: str = "models/best_retrained.pt"
):
    """อัปโหลดโมเดลที่ได้ใหม่กลับเข้า MinIO"""
    logger.info(f"⬆️ กำลังอัปโหลดโมเดลใหม่ '{local_model_path}' ขึ้น MinIO ที่ '{minio_target_key}'...")
    client.fput_object(
        bucket_name=bucket_name,
        object_name=minio_target_key,
        file_path=local_model_path
    )
    logger.info(f"✅ บันทึกโมเดลขึ้น MinIO สำเร็จแล้ว: {bucket_name}/{minio_target_key}")


def main():
    parser = argparse.ArgumentParser(description="Auto Retrain YOLO Model using MinIO Dataset")
    # ตั้งค่า MinIO
    parser.add_argument("--minio-endpoint", default="localhost:9000", help="MinIO API endpoint (default: localhost:9000)")
    parser.add_argument("--minio-access-key", default="minioadmin", help="MinIO Access Key (default: minioadmin)")
    parser.add_argument("--minio-secret-key", default="minioadmin", help="MinIO Secret Key (default: minioadmin)")
    parser.add_argument("--bucket", default="datasets", help="MinIO Bucket containing dataset (default: datasets)")
    parser.add_argument("--zip-name", default="dataset.zip", help="Name of dataset zip if applicable")
    
    # ตั้งค่า Model และ Training
    parser.add_argument("--model", default="best1.pt", help="Path to base model (default: best1.pt)")
    parser.add_argument("--epochs", type=int, default=50, help="Number of training epochs (default: 50)")
    parser.add_argument("--batch", type=int, default=8, help="Batch size (default: 8)")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size (default: 640)")
    parser.add_argument("--upload-key", default="models/best_retrained.pt", help="MinIO destination path for retrained model")
    
    args = parser.parse_args()

    # 1. เชื่อมต่อ MinIO
    client = Minio(
        endpoint=args.minio_endpoint.replace("http://", "").replace("https://", ""),
        access_key=args.minio_access_key,
        secret_key=args.minio_secret_key,
        secure=False
    )

    # 2. ดาวน์โหลด Dataset
    dataset_dir = download_dataset_from_minio(
        client=client,
        bucket_name=args.bucket,
        target_dir="dataset_local",
        zip_filename=args.zip_name
    )

    # 3. หาไฟล์ data.yaml
    data_yaml = find_data_yaml(dataset_dir)

    # 4. ทำการ Retrain ต่อจาก best1.pt
    new_model_path = retrain_yolo_model(
        model_path=args.model,
        data_yaml_path=data_yaml,
        epochs=args.epochs,
        batch_size=args.batch,
        imgsz=args.imgsz
    )

    # 5. อัปโหลดโมเดลตัวใหม่กลับเข้า MinIO
    upload_model_to_minio(
        client=client,
        bucket_name=args.bucket,
        local_model_path=new_model_path,
        minio_target_key=args.upload_key
    )

    logger.info("=" * 60)
    logger.info("🏁 เสร็จสิ้นกระบวนการทั้งหมดเรียบร้อยแล้ว!")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
    