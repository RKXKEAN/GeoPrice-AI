import axios from 'axios';

// Get API base URL from environment or fallback to relative path (Vite proxy)
const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  return '';
};
const API_BASE_URL = getApiBaseUrl();

export interface GeoJSONGeometry {
  type: string;
  coordinates: number[][][] | number[][][][];
}

export interface PredictionPayload {
  plot_name?: string;
  latitude: number;
  longitude: number;
  geometry: GeoJSONGeometry;
  area_size_sqm: number;
  land_use_zone?: string;
  selected_model?: 'xgboost' | 'arimax';
  force_model?: boolean;
  features?: {
    prediction_years?: number;
    [key: string]: any;
  };
}


export interface PredictionJobResponse {
  job_id: string;
  status: string;
  message: string;
  created_at: string;
}

export interface PricePredictionDetail {
  id: number;
  predicted_price_per_sqm: number;
  total_predicted_price: number;
  confidence_score: number;
  model_version?: string;
  details_json?: Record<string, any>;
  created_at: string;
}

export interface PredictionResult {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message?: string | null;
  land_plot?: any;
  price_prediction?: PricePredictionDetail | null;
  created_at: string;
  updated_at?: string | null;
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

/**
 * Submit land plot for AI price prediction
 */
export async function submitPricePrediction(payload: PredictionPayload): Promise<PredictionJobResponse> {
  const response = await apiClient.post<PredictionJobResponse>('/api/v1/predictions', payload);
  return response.data;
}

/**
 * Retrieve prediction job status and result
 */
export async function getPredictionStatus(jobId: string): Promise<PredictionResult> {
  const response = await apiClient.get<PredictionResult>(`/api/v1/predictions/${jobId}`);
  return response.data;
}

/**
 * Retrieve active appraisal dataset GeoJSON features for Select Mode
 */
export async function fetchActiveGeoJSON(): Promise<any> {
  const response = await apiClient.get('/api/v1/appraisal-data/active-geojson', {
    timeout: 60000, // 60s timeout for large GIS dataset over mobile / remote tunnels
  });
  return response.data;
}

export interface TargetBuildingData {
  found: boolean;
  id?: string;
  confidence: number;
  shape_type?: 'polygon' | 'bbox';
  area_sqm: number;
  area_wah: number;
  width_m: number;
  length_m: number;
  price_per_wah: number;
  price_per_sqm?: number;
  total_estimated_price: number;
  road_name: string;
  zone_name: string;
  subdistrict: string;
  district: string;
  valuation_source?: string;
  source_badge?: 'real_exact' | 'ai_ml_model' | 'ai_model_baseline' | 'hybrid_interpolated';
  nearest_dist_m?: number;
  nearest_parcel_id?: string;
  parcel_total_value?: number;
  parcel_area_sqm?: number;
  parcel_area_wah?: number;
  market_price_per_sqw?: number;
  center: [number, number]; // [lat, lon]
  coordinates: number[][];   // [[lon, lat], ...]
}

export interface SurroundingBuildingData {
  id: string;
  confidence: number;
  shape_type?: 'polygon' | 'bbox';
  area_sqm: number;
  area_wah: number;
  width_m: number;
  length_m: number;
  distance_m: number;
  coordinates: number[][];
  center: [number, number];
}

export interface RadarVisionResponse {
  status: string;
  target_building: TargetBuildingData;
  radar_summary: {
    radius_meters: number;
    total_buildings_detected: number;
    density_level: string;
    zone_name: string;
    road_name: string;
    base_price_wah: number;
  };
  surrounding_buildings: SurroundingBuildingData[];
}

/**
 * Perform 200m AI Vision Radar building detection using YOLOv8 best.pt
 */
export async function scanVisionRadar(
  latitude: number,
  longitude: number,
  radiusMeters: number = 200.0,
  confThreshold: number = 0.25
): Promise<RadarVisionResponse> {
  const response = await apiClient.post<RadarVisionResponse>(
    '/api/v1/vision/radar-detect',
    {
      latitude,
      longitude,
      radius_meters: radiusMeters,
      conf_threshold: confThreshold,
    },
    {
      timeout: 35000,
    }
  );
  return response.data;
}



