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
  },

  async getDataSyncStatus(): Promise<DataSyncStatus> {
    const res = await axios.get(`${API_BASE}/data-sync/status`);
    return res.data;
  },

  async triggerDataSync(): Promise<{ status: string; message: string }> {
    const res = await axios.post(`${API_BASE}/data-sync/trigger`);
    return res.data;
  },

  async confirmDataSyncRetrain(epochs: number = 5): Promise<{ status: string; job_id: string; message: string }> {
    const res = await axios.post(`${API_BASE}/data-sync/confirm-retrain`, { epochs });
    return res.data;
  },

  async getLabelStudioStatus(): Promise<LabelStudioStatusResponse> {
    const res = await axios.get(`${API_BASE}/label-studio/status`);
    return res.data;
  },

  async getPendingTriggers(limit: number = 30): Promise<PendingTriggersResponse> {
    const res = await axios.get(`${API_BASE}/triggers/pending`, { params: { limit } });
    return res.data;
  },

  async correctAndRecalculateTrigger(
    predictionId: number,
    bboxes: any[],
    targetBbox: { xmin: number; ymin: number; xmax: number; ymax: number }
  ): Promise<{ status: string; message: string; recalculated_price: number; area_sqm: number; coordinates: number[][]; prediction_id: number; is_verified: boolean }> {
    const res = await axios.post(`${API_BASE}/triggers/correct-and-recalculate`, {
      prediction_id: predictionId,
      bboxes,
      target_bbox: targetBbox
    });
    return res.data;
  },

  async triggerVisionModelRetrain(datasetPeriod: string = '2026_07-12', epochs: number = 5): Promise<{ status: string; job_id: string; queue: string; message: string }> {
    const res = await axios.post(`${API_BASE}/vision-model/trigger-retrain`, {
      dataset_period: datasetPeriod,
      epochs
    });
    return res.data;
  },

  async groundTruthMatch(datasetFilename: string = 'hatyai_appraisal_latest.csv', triggerRetrain: boolean = true): Promise<{
    status: string;
    message: string;
    matched_count: number;
    mean_mape: number;
    retrain_enqueued: boolean;
    job_id?: string;
    queue?: string;
  }> {
    const res = await axios.post(`${API_BASE}/price-model/ground-truth-match`, {
      dataset_filename: datasetFilename,
      trigger_retrain: triggerRetrain
    });
    return res.data;
  },

  async getMultiStateRecords(limit: number = 50): Promise<MultiStateResponse> {
    const res = await axios.get(`${API_BASE}/price-model/multi-state-records`, { params: { limit } });
    return res.data;
  },

  async syncLabelStudio(folder: string = 'latest', limit: number = 1000): Promise<{ status: string; message: string; total_synced: number; project_id: number; project_url: string }> {
    const res = await axios.post(`${API_BASE}/label-studio/sync`, { folder, limit });
    return res.data;
  }
};

export interface UserTriggerItem {
  id: number;
  job_id: string;
  plot_id: number;
  plot_name: string;
  latitude: number;
  longitude: number;
  raw_image_url: string;
  preview_url: string | null;
  initial_price: number;
  initial_area_sqm: number;
  surrounding_count: number;
  initial_bboxes: any;
  initial_polygons: any;
  is_verified: boolean;
  recalculated_price?: number;
  recalculated_polygons?: any;
  actual_market_price?: number;
  error_metrics?: any;
  created_at: string;
}

export interface PendingTriggersResponse {
  status: string;
  total_unverified: number;
  triggers: UserTriggerItem[];
}

export interface MultiStateRecordItem {
  id: number;
  job_id: string;
  plot_name: string;
  latitude: number;
  longitude: number;
  raw_image_url: string;
  initial_price: number;
  initial_area_sqm: number;
  is_verified: boolean;
  recalculated_price?: number;
  recalculated_area_sqm?: number;
  actual_market_price?: number;
  actual_recorded_at?: string;
  error_metrics?: {
    predicted_price: number;
    actual_price: number;
    diff_thb: number;
    mape_percent: number;
    matched_cadastral_source: string;
    match_confidence: number;
  };
  created_at: string;
}

export interface MultiStateResponse {
  status: string;
  total: number;
  records: MultiStateRecordItem[];
}


export interface DataSyncStatus {
  status: 'idle' | 'ingesting' | 'auto_labeling' | 'syncing_label_studio' | 'ready_for_retrain' | 'retraining' | 'completed' | 'error';
  progress_percent: number;
  downloaded_count: number;
  total_count: number;
  speed_imgs_per_sec: number;
  cycle_name: string;
  target_folder: string;
  overwrite_policy: string;
  schedule_cadence: string;
  next_scheduled_run: string;
  last_completed_at?: string;
  ready_for_retrain: boolean;
  retrain_job_id?: string;
  logs: string[];
}

export interface LabelStudioProjectInfo {
  id: number;
  title: string;
  task_number: number;
  finished_task_number: number;
  created_at?: string;
}

export interface LabelStudioStatusResponse {
  status: string;
  url: string;
  total_projects: number;
  total_tasks: number;
  projects: LabelStudioProjectInfo[];
}

