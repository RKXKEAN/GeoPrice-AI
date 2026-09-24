import io
import logging
from datetime import timedelta
from typing import Optional, List, Dict, Any, Union, BinaryIO
from minio import Minio
from minio.error import S3Error
from app.config import settings

logger = logging.getLogger(__name__)

class MinIOService:
    """
    Service wrapper for interacting with MinIO Object Storage (S3 API).
    Provides methods for dataset verification, file uploads, listing objects,
    and generating presigned URLs for MLOps and spatial asset workflows.
    """
    def __init__(
        self,
        endpoint: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        secure: Optional[bool] = None,
    ):
        raw_endpoint = endpoint or settings.MINIO_ENDPOINT
        # Remove http:// or https:// scheme if included, as Minio client expects host:port
        self.endpoint = (
            raw_endpoint.replace("http://", "").replace("https://", "").rstrip("/")
        )
        self.access_key = access_key or settings.MINIO_ROOT_USER
        self.secret_key = secret_key or settings.MINIO_ROOT_PASSWORD
        self.secure = (
            secure if secure is not None else settings.MINIO_SECURE
        )
        self._client: Optional[Minio] = None

    @property
    def client(self) -> Minio:
        """Lazily initialize and return the MinIO S3 client instance."""
        if self._client is None:
            logger.info(
                f"Initializing MinIO client connecting to {self.endpoint} (secure={self.secure})"
            )
            self._client = Minio(
                endpoint=self.endpoint,
                access_key=self.access_key,
                secret_key=self.secret_key,
                secure=self.secure,
            )
        return self._client

    def ensure_bucket_exists(self, bucket_name: str) -> None:
        """Ensures that the target bucket exists in MinIO, creating it if necessary."""
        bucket_name = bucket_name.strip()
        try:
            if not self.client.bucket_exists(bucket_name):
                self.client.make_bucket(bucket_name)
                logger.info(f"Created new MinIO bucket: '{bucket_name}'")
        except Exception as e:
            logger.error(f"Error ensuring bucket '{bucket_name}' exists: {e}")
            raise

    def check_dataset_exists(self, bucket_name: str, object_name: str) -> bool:
        """
        Verifies if a dataset object exists within the specified MinIO bucket.
        
        Args:
            bucket_name: Name of the MinIO bucket (e.g. 'datasets')
            object_name: Key/path of the dataset file (e.g. 'hatyai_land_prices.csv')
            
        Returns:
            bool: True if bucket exists and object is found, False otherwise.
        """
        bucket_name = bucket_name.strip()
        object_name = object_name.strip()
        try:
            if not self.client.bucket_exists(bucket_name):
                logger.warning(f"Bucket '{bucket_name}' does not exist in MinIO.")
                return False

            self.client.stat_object(bucket_name=bucket_name, object_name=object_name)
            logger.info(f"Dataset '{object_name}' confirmed in bucket '{bucket_name}'.")
            return True
        except S3Error as e:
            if e.code in ("NoSuchKey", "NoSuchBucket"):
                logger.warning(
                    f"Dataset '{object_name}' not found in bucket '{bucket_name}' (S3 Error: {e.code})."
                )
                return False
            logger.error(
                f"S3Error while checking dataset '{object_name}' in bucket '{bucket_name}': {e}"
            )
            return False
        except Exception as e:
            logger.error(
                f"Unexpected error while verifying dataset '{object_name}' in MinIO: {e}"
            )
            return False

    def list_objects(self, bucket_name: str, recursive: bool = True) -> List[Dict[str, Any]]:
        """
        Lists all objects in the specified MinIO bucket.
        
        Args:
            bucket_name: Name of the target bucket (e.g. 'datasets', 'images')
            recursive: Whether to list recursively through prefixes
            
        Returns:
            List[Dict[str, Any]]: List of object metadata dicts (name, size, last_modified, etag)
        """
        bucket_name = bucket_name.strip()
        try:
            if not self.client.bucket_exists(bucket_name):
                logger.warning(f"Bucket '{bucket_name}' does not exist for listing.")
                return []

            objects = self.client.list_objects(bucket_name, recursive=recursive)
            results = []
            for obj in objects:
                results.append({
                    "object_name": obj.object_name,
                    "size": obj.size,
                    "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
                    "etag": obj.etag.strip('"') if obj.etag else None,
                    "is_dir": obj.is_dir
                })
            logger.info(f"Listed {len(results)} objects from bucket '{bucket_name}'.")
            return results
        except Exception as e:
            logger.error(f"Error listing objects in MinIO bucket '{bucket_name}': {e}")
            raise

    def upload_file(
        self,
        bucket_name: str,
        object_name: str,
        file_data: Union[bytes, bytearray, BinaryIO],
        length: Optional[int] = None,
        content_type: str = "application/octet-stream"
    ) -> Dict[str, Any]:
        """
        Uploads a binary file or byte stream to the specified MinIO bucket.
        
        Args:
            bucket_name: Target bucket name
            object_name: Target object key/path in bucket
            file_data: File bytes or BinaryIO stream
            length: Optional size in bytes
            content_type: MIME type
            
        Returns:
            Dict[str, Any]: Upload metadata result
        """
        bucket_name = bucket_name.strip()
        object_name = object_name.strip()
        self.ensure_bucket_exists(bucket_name)

        try:
            if isinstance(file_data, (bytes, bytearray)):
                stream = io.BytesIO(file_data)
                stream_len = len(file_data)
            elif hasattr(file_data, "read"):
                content = file_data.read()
                stream = io.BytesIO(content)
                stream_len = len(content)
            else:
                raise ValueError("file_data must be bytes or a readable binary stream")

            result = self.client.put_object(
                bucket_name=bucket_name,
                object_name=object_name,
                data=stream,
                length=stream_len,
                content_type=content_type or "application/octet-stream"
            )
            logger.info(
                f"Successfully uploaded '{object_name}' ({stream_len} bytes) to bucket '{bucket_name}'."
            )
            return {
                "bucket_name": bucket_name,
                "object_name": object_name,
                "size": stream_len,
                "content_type": content_type,
                "etag": result.etag.strip('"') if result.etag else None
            }
        except Exception as e:
            logger.error(f"Failed to upload '{object_name}' to MinIO bucket '{bucket_name}': {e}")
            raise

    def get_presigned_url(
        self,
        bucket_name: str,
        object_name: str,
        expires_hours: int = 1
    ) -> str:
        """
        Generates a temporary presigned URL for downloading or viewing an object.
        
        Args:
            bucket_name: Target bucket name
            object_name: Object key/path in bucket
            expires_hours: Validity duration in hours (default: 1 hour)
            
        Returns:
            str: Presigned URL string
        """
        bucket_name = bucket_name.strip()
        object_name = object_name.strip()
        try:
            url = self.client.presigned_get_object(
                bucket_name=bucket_name,
                object_name=object_name,
                expires=timedelta(hours=expires_hours)
            )
            logger.info(
                f"Generated presigned URL for '{bucket_name}/{object_name}' (valid for {expires_hours}h)."
            )
            return url
        except Exception as e:
            logger.error(
                f"Error generating presigned URL for '{bucket_name}/{object_name}': {e}"
            )
            raise

# Default singleton instance
minio_service = MinIOService()

def get_minio_service() -> MinIOService:
    """FastAPI dependency for obtaining MinIOService instance."""
    return minio_service
