import os
import io
import json
import logging
from typing import Dict, Any, List, Optional
import httpx
from app.services.minio_service import get_minio_service

logger = logging.getLogger(__name__)

LABEL_STUDIO_URL = os.getenv("LABEL_STUDIO_URL", "http://label_studio:8080")
LABEL_STUDIO_USERNAME = os.getenv("LABEL_STUDIO_USERNAME", "admin@geoprice.ai")
LABEL_STUDIO_PASSWORD = os.getenv("LABEL_STUDIO_PASSWORD", "password123")

LABEL_CONFIG_XML = """<View>
  <Image name="image" value="$image"/>
  <PolygonLabels name="label" toName="image">
    <Label value="Building" background="#f59e0b"/>
    <Label value="LandPlot" background="#00f2fe"/>
  </PolygonLabels>
</View>"""


class LabelStudioService:
    def __init__(self, base_url: str = LABEL_STUDIO_URL, username: str = LABEL_STUDIO_USERNAME, password: str = LABEL_STUDIO_PASSWORD):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.headers = {"Host": "localhost"}

    async def get_authenticated_client(self) -> httpx.AsyncClient:
        """Creates an authenticated httpx client using Django session authentication."""
        client = httpx.AsyncClient(timeout=15.0, headers=self.headers)
        try:
            # 1. Get login page to capture initial CSRF cookie
            await client.get(f"{self.base_url}/user/login/")
            csrf = client.cookies.get("csrftoken")

            # 2. Authenticate
            login_resp = await client.post(
                f"{self.base_url}/user/login/",
                data={
                    "email": self.username,
                    "password": self.password,
                    "csrfmiddlewaretoken": csrf or ""
                }
            )
            # Add CSRF token header for subsequent POST requests
            new_csrf = client.cookies.get("csrftoken")
            if new_csrf:
                client.headers["X-CSRFToken"] = new_csrf
            return client
        except Exception as e:
            await client.aclose()
            logger.error(f"Failed to authenticate with Label Studio at {self.base_url}: {e}")
            raise

    async def get_status(self) -> Dict[str, Any]:
        """Checks connection status and summary stats of Label Studio."""
        client = None
        try:
            client = await self.get_authenticated_client()
            resp = await client.get(f"{self.base_url}/api/projects/")
            if resp.status_code == 200:
                data = resp.json()
                projects = data.get("results", []) if isinstance(data, dict) else data
                total_tasks = sum(p.get("task_number", 0) for p in projects)
                return {
                    "status": "connected",
                    "url": "http://localhost:8080",
                    "total_projects": len(projects),
                    "total_tasks": total_tasks,
                    "projects": [
                        {
                            "id": p["id"],
                            "title": p.get("title", ""),
                            "task_number": p.get("task_number", 0),
                            "finished_task_number": p.get("finished_task_number", 0),
                            "created_at": p.get("created_at")
                        }
                        for p in projects
                    ]
                }
        except Exception as e:
            logger.warning(f"Label Studio connection check error: {e}")
        finally:
            if client:
                await client.aclose()

        return {
            "status": "disconnected",
            "url": "http://localhost:8080",
            "total_projects": 0,
            "total_tasks": 0,
            "projects": []
        }

    async def ensure_project(self, title: str = "GeoPrice Hat Yai Satellite Monitoring") -> int:
        """Finds existing project by title or creates a new one with polygon labeling config."""
        client = None
        try:
            client = await self.get_authenticated_client()
            list_resp = await client.get(f"{self.base_url}/api/projects/")
            if list_resp.status_code == 200:
                data = list_resp.json()
                projects = data.get("results", []) if isinstance(data, dict) else data
                for p in projects:
                    if p.get("title") == title:
                        return p["id"]

            # Create new project
            create_resp = await client.post(
                f"{self.base_url}/api/projects/",
                json={
                    "title": title,
                    "description": "Satellite parcel and building polygon annotations synchronized from MinIO.",
                    "label_config": LABEL_CONFIG_XML
                }
            )
            if create_resp.status_code in (200, 201):
                proj_data = create_resp.json()
                return proj_data["id"]
            else:
                raise RuntimeError(f"Failed to create Label Studio project: {create_resp.status_code} {create_resp.text}")
        finally:
            if client:
                await client.aclose()

    async def sync_minio_folder_to_project(
        self,
        folder: str = "latest",
        project_id: Optional[int] = None,
        limit: int = 1000
    ) -> Dict[str, Any]:
        """
        Synchronizes images from MinIO bucket 'images' under the specified folder into Label Studio.
        Attaches YOLO polygon predictions if label files exist.
        """
        if project_id is None:
            project_id = await self.ensure_project()

        minio_svc = get_minio_service()
        clean_folder = folder.rstrip("/")
        prefix = f"{clean_folder}/"

        # List images in MinIO
        all_objs = minio_svc.list_objects("images", recursive=True)
        img_objs = [
            o["object_name"] for o in all_objs
            if o["object_name"].startswith(prefix)
            and o["object_name"].lower().endswith((".jpg", ".jpeg", ".png"))
        ]
        img_objs = sorted(img_objs)[:limit]

        if not img_objs:
            return {
                "status": "warning",
                "message": f"ไม่พบไฟล์ภาพใน MinIO บักเก็ต images โฟลเดอร์ '{clean_folder}/'",
                "total_synced": 0,
                "project_id": project_id
            }

        # Check existing labels to attach predictions
        labels_map = {}
        for o in all_objs:
            name = o["object_name"]
            if name.startswith("labels/") and name.endswith(".txt"):
                stem = name.replace("labels/", "").replace(".txt", "")
                labels_map[stem] = name

        tasks_payload = []
        for img_key in img_objs:
            img_filename = img_key.split("/")[-1]
            stem_direct = img_filename.replace(".jpg", "").replace(".jpeg", "").replace(".png", "")
            stem_prefixed = f"{clean_folder}_{stem_direct}"

            # Browser-accessible URL via MinIO direct or backend preview endpoint
            image_url = f"http://localhost:9000/images/{img_key}"

            task_entry = {
                "data": {
                    "image": image_url,
                    "image_key": img_key,
                    "period": clean_folder,
                    "filename": img_filename
                }
            }

            # If YOLO label exists, parse into Label Studio predictions
            label_key = labels_map.get(stem_prefixed) or labels_map.get(stem_direct)
            if label_key:
                try:
                    obj = minio_svc.client.get_object("images", label_key)
                    txt = obj.read().decode("utf-8")
                    obj.close()
                    obj.release_conn()

                    pred_results = []
                    for line in txt.strip().split("\n"):
                        parts = line.strip().split()
                        if len(parts) >= 7:  # class_id + at least 3 pairs (x, y)
                            cls_id = parts[0]
                            label_name = "Building" if cls_id == "0" else "LandPlot"
                            raw_pts = [float(p) for p in parts[1:]]
                            # YOLO format is normalized (0..1), Label Studio polygon points are (0..100)
                            points = []
                            for i in range(0, len(raw_pts) - 1, 2):
                                points.append([round(raw_pts[i] * 100.0, 3), round(raw_pts[i + 1] * 100.0, 3)])

                            if len(points) >= 3:
                                pred_results.append({
                                    "original_width": 640,
                                    "original_height": 640,
                                    "image_rotation": 0,
                                    "value": {
                                        "points": points,
                                        "polygonlabels": [label_name]
                                    },
                                    "from_name": "label",
                                    "to_name": "image",
                                    "type": "polygonlabels"
                                })

                    if pred_results:
                        task_entry["predictions"] = [{
                            "model_version": "YOLOv8-seg-auto",
                            "result": pred_results
                        }]
                except Exception as ex:
                    logger.debug(f"Could not parse label prediction for {img_key}: {ex}")

            tasks_payload.append(task_entry)

        # Batch upload tasks to Label Studio in chunks of 100
        client = None
        total_created = 0
        chunk_size = 100

        try:
            client = await self.get_authenticated_client()
            for i in range(0, len(tasks_payload), chunk_size):
                chunk = tasks_payload[i:i + chunk_size]
                resp = await client.post(
                    f"{self.base_url}/api/projects/{project_id}/tasks/bulk",
                    json=chunk
                )
                if resp.status_code in (200, 201):
                    res_data = resp.json()
                    total_created += res_data.get("task_count", len(chunk))
                else:
                    logger.warning(f"Label Studio chunk upload status {resp.status_code}: {resp.text[:150]}")
        finally:
            if client:
                await client.aclose()

        logger.info(f"Synchronized {total_created} images into Label Studio Project #{project_id}")

        return {
            "status": "success",
            "message": f"นำเข้าไฟล์ภาพ {total_created:,} ภาพจาก MinIO '{clean_folder}/' เข้าสู่ Label Studio เรียบร้อยแล้ว",
            "total_synced": total_created,
            "project_id": project_id,
            "project_url": f"http://localhost:8080/projects/{project_id}/data"
        }


_label_studio_service: Optional[LabelStudioService] = None

def get_label_studio_service() -> LabelStudioService:
    global _label_studio_service
    if _label_studio_service is None:
        _label_studio_service = LabelStudioService()
    return _label_studio_service
