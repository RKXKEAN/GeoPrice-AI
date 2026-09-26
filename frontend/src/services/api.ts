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
  const response = await apiClient.get('/api/v1/appraisal-data/active-geojson');
  return response.data;
}

