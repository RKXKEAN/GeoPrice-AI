import axios from 'axios';

const API_BASE = '/api/v1/admin';

export interface AdminUser {
  token: string;
  username: string;
  role: string;
}

export interface ServiceHealthStatus {
  backend: string;
  database: string;
  redis: string;
  minio: string;
  ai_worker: string;
  mlflow: string;
  label_studio: string;
}

export interface GpuInfo {
  device: string;
  gpu_name: string;
  vram: string;
  cuda_version: string;
  acceleration_status: string;
}

export interface EcosystemInfo {
  total_cadastral_plots: number;
  cadastral_source: string;
  last_appraisal_sync: string;
  total_satellite_images: number;
  latest_image_period: string;
  total_models: number;
  active_price_model: string;
  active_vision_model: string;
  last_retrain_timestamp: string;
  pipeline_status: string;
  sync_cadence: string;
  next_sync_policy: string;
}

export interface AdminOverviewResponse {
  status: string;
  timestamp: string;
  services: ServiceHealthStatus;
  gpu_info: GpuInfo;
  ecosystem: EcosystemInfo;
}

export interface MinioObjectItem {
  name: string;
  size_bytes: number;
  size_formatted: string;
  last_modified: string;
  etag: string;
}

export interface MinioFilesResponse {
  bucket: string;
  total_objects: number;
  returned_count: number;
  objects: MinioObjectItem[];
}

export interface ModelMetricsData {
  timestamp: string;
  model_version?: string;
  trained_on?: string;
  metrics: {
    ensemble_appraisal: { r2: number; mae: number; rmse: number };
    ensemble_market: { r2: number; mae: number; rmse: number };
    lightgbm_appraisal: { r2: number; mae: number };
    xgboost_appraisal: { r2: number; mae: number };
    random_forest_appraisal: { r2: number; mae: number };
  };
}

export interface ModelMetricsResponse {
  status: string;
  source: string;
  data: ModelMetricsData;
}

export interface PolygonPoint {
  id: number;
  class_id: number;
  label: string;
  confidence: number;
  is_human_reviewed?: boolean;
  points: [number, number][]; // normalized [x, y]
}

export interface LabelSampleResponse {
  image_key: string;
  preview_url: string;
  width: number;
  height: number;
  total_polygons: number;
  polygons: PolygonPoint[];
  is_human_reviewed?: boolean;
  label_file?: string;
}

export interface FolderInfo {
  id: string;
  name: string;
  label: string;
  total_images: number;
  labeled_count: number;
  status: string;
}

export interface FeedbackItem {
  feedback_id: string;
  job_id: string;
  rating: 'reasonable' | 'too_high' | 'too_low';
  expected_price?: number;
  comment?: string;
  created_at: string;
}

export interface FeedbackSummary {
  total_feedbacks: number;
  satisfaction_rate: number;
  reasonable_count: number;
  too_high_count: number;
  too_low_count: number;
  avg_expected_price: number;
}

export interface FeedbackApiResponse {
  status: string;
  summary: FeedbackSummary;
  feedbacks: FeedbackItem[];
}

export const adminApi = {
  async login(username: string, password: string): Promise<{ token: string; username: string; role: string }> {
    const res = await axios.post(`${API_BASE}/auth/login`, { username, password });
    return res.data;
  },

  async getOverview(): Promise<AdminOverviewResponse> {
    const res = await axios.get(`${API_BASE}/overview`);
    return res.data;
  },

  async listFiles(bucket: string = 'datasets', prefix: string = '', limit: number = 100): Promise<MinioFilesResponse> {
    const res = await axios.get(`${API_BASE}/minio/files`, {
      params: { bucket, prefix, limit }
    });
    return res.data;
  },

  async uploadFile(file: File, bucket: string = 'datasets', folder: string = ''): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('bucket', bucket);
    formData.append('folder', folder);
    const res = await axios.post(`${API_BASE}/minio/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return res.data;
  },

  async getModelMetrics(): Promise<ModelMetricsResponse> {
    const res = await axios.get(`${API_BASE}/models/metrics`);
    return res.data;
  },

  async triggerPriceRetrain(): Promise<{ status: string; job_id: string; message: string }> {
    const res = await axios.post(`${API_BASE}/retrain/price`);
    return res.data;
  },

  async triggerVisionRetrain(period: string = '2026_07-12', epochs: number = 5): Promise<{ status: string; job_id: string; message: string }> {
    const formData = new FormData();
    formData.append('period', period);
    formData.append('epochs', epochs.toString());
    const res = await axios.post(`${API_BASE}/retrain/vision`, formData);
    return res.data;
  },

  async getJobLogs(jobId: string): Promise<{ job_id: string; status: string; logs: string[]; is_finished: boolean }> {
    const res = await axios.get(`${API_BASE}/jobs/${jobId}/logs`);
    return res.data;
  },

  async getLabelFolders(): Promise<{ total_folders: number; folders: FolderInfo[] }> {
    const res = await axios.get(`${API_BASE}/labels/folders`);
    return res.data;
  },

  async listLabelingImages(folder: string = '2026_07-12', limit: number = 100): Promise<{ folder: string; total_images: number; sample_images: string[] }> {
    const res = await axios.get(`${API_BASE}/labels/list`, {
      params: { folder, limit }
    });
    return res.data;
  },

  async triggerBatchAutoLabel(folder: string = '2026_07-12', conf: number = 0.35, maxImages?: number): Promise<{ status: string; job_id: string; folder: string; message: string }> {
    const res = await axios.post(`${API_BASE}/labels/batch-auto-label`, {
      folder,
      conf_threshold: conf,
      max_images: maxImages
    });
    return res.data;
  },

  async getLabelSample(imageKey: string, conf: number = 0.25): Promise<LabelSampleResponse> {
    const res = await axios.get(`${API_BASE}/labels/sample`, {
      params: { image_key: imageKey, conf }
    });
    return res.data;
  },

  async savePolygonLabels(imageKey: string, polygons: PolygonPoint[]): Promise<any> {
    const res = await axios.post(`${API_BASE}/labels/save`, {
      image_key: imageKey,
      polygons
    });
    return res.data;
  },

  async getUserFeedbacks(): Promise<FeedbackApiResponse> {
    const res = await axios.get(`${API_BASE}/feedback`);
    return res.data;
  }
};
