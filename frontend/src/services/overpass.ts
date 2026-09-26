import axios from 'axios';
import hatYaiLandmarksData from '../data/hatyai_landmarks.json';

export interface OverpassPOI {
  id: number | string;
  lat: number;
  lon: number;
  name: string;
  category: string;
  type: string;
  tags: Record<string, string>;
}

/**
 * Fallback to local curated Hat Yai landmarks if backend or Overpass is unavailable.
 */
const getFallbackPOIs = (lat: number, lon: number, radiusM: number = 3000): OverpassPOI[] => {
  try {
    const features = (hatYaiLandmarksData as any).features || [];
    return features
      .map((feat: any) => {
        const coords = feat.geometry?.coordinates || [];
        const pLon = coords[0];
        const pLat = coords[1];
        const p = feat.properties || {};

        // Calculate approximate distance in meters
        const dLat = (pLat - lat) * 111000;
        const dLon = (pLon - lon) * 111000 * 0.99;
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);

        return {
          id: feat.id,
          lat: pLat,
          lon: pLon,
          name: p.name || 'สถานที่สำคัญ',
          category: p.category || 'poi',
          type: p.category || 'poi',
          tags: {
            name: p.name,
            amenity: p.category,
            description: p.description || '',
            badge: p.badge || '',
          },
          dist,
        };
      })
      .filter((poi: any) => poi.dist <= Math.max(radiusM, 4000))
      .map(({ dist, ...poi }: any) => poi);
  } catch (err) {
    console.error('Error in fallback POIs:', err);
    return [];
  }
};

/**
 * Fetches Points of Interest (POIs) around a given coordinate.
 * Uses Backend API Proxy (/api/v1/pois/overpass) with valid User-Agent to bypass Overpass 406.
 * Automatically falls back to curated landmarks if network or Overpass is unreachable.
 *
 * @param lat Latitude in decimal degrees
 * @param lon Longitude in decimal degrees
 * @param radius Search radius in meters (default: 1000)
 * @returns Array of POIs with names and coordinates
 */
export const fetchPOIsAround = async (
  lat: number,
  lon: number,
  radius: number = 1000
): Promise<OverpassPOI[]> => {
  try {
    // 1. Try Backend Proxy endpoint
    const response = await axios.get<OverpassPOI[]>('/api/v1/pois/overpass', {
      params: { lat, lon, radius },
      timeout: 8000,
    });

    if (Array.isArray(response.data) && response.data.length > 0) {
      return response.data;
    }
  } catch (error) {
    console.warn('Backend Overpass proxy unreachable or timed out, using local curated landmarks fallback:', error);
  }

  // 2. Resilient Fallback to curated landmarks
  return getFallbackPOIs(lat, lon, radius);
};
