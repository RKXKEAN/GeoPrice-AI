import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet-draw';
import * as turf from '@turf/turf';

export interface DrawnPlotData {
  geometry: any;
  latitude: number;
  longitude: number;
  areaSqm: number;
}

interface MapComponentProps {
  onPlotDrawn: (data: DrawnPlotData) => void;
  onPlotCleared: () => void;
}

// Fix default Leaflet icon paths
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Default center: Hat Yai District, Songkhla Province, Thailand
const HAT_YAI_COORDINATES: [number, number] = [7.0084, 100.4767];

export const MapComponent = ({ onPlotDrawn, onPlotCleared }: MapComponentProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Initialize Map
    const map = L.map(mapContainerRef.current, {
      center: HAT_YAI_COORDINATES,
      zoom: 14,
      zoomControl: true,
    });
    mapInstanceRef.current = map;

    // Base Tile Layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // FeatureGroup to store drawn shapes
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    // Configure Draw Control (Strictly allow Polygon and Rectangle only)
    const drawControl = new L.Control.Draw({
      position: 'topright',
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          drawError: {
            color: '#ef4444',
            message: '<strong>แปลงที่ดินซ้อนทับกันไม่ได้!</strong> กรุณาวาดใหม่',
          },
          shapeOptions: {
            color: '#2563eb',
            fillColor: '#3b82f6',
            fillOpacity: 0.35,
            weight: 3,
          },
        },
        rectangle: {
          shapeOptions: {
            color: '#059669',
            fillColor: '#10b981',
            fillOpacity: 0.35,
            weight: 3,
          },
        },
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: {
        featureGroup: drawnItems,
        remove: true,
      },
    });

    map.addControl(drawControl);

    // Event: Shape Created
    map.on(L.Draw.Event.CREATED, (event: any) => {
      const layer = event.layer;
      
      // Clear previous layers to ensure one plot at a time
      drawnItems.clearLayers();
      drawnItems.addLayer(layer);

      const geoJson = layer.toGeoJSON();
      // Calculate plot area in square meters using Turf.js
      const area = turf.area(geoJson);
      // Calculate center coordinates (centroid)
      const centroid = turf.centroid(geoJson);
      const [lng, lat] = centroid.geometry.coordinates;

      onPlotDrawn({
        geometry: geoJson.geometry,
        latitude: parseFloat(lat.toFixed(6)),
        longitude: parseFloat(lng.toFixed(6)),
        areaSqm: Math.round(area * 100) / 100,
      });
    });

    // Event: Shape Edited
    map.on(L.Draw.Event.EDITED, (event: any) => {
      const layers = event.layers;
      layers.eachLayer((layer: any) => {
        const geoJson = layer.toGeoJSON();
        const area = turf.area(geoJson);
        const centroid = turf.centroid(geoJson);
        const [lng, lat] = centroid.geometry.coordinates;

        onPlotDrawn({
          geometry: geoJson.geometry,
          latitude: parseFloat(lat.toFixed(6)),
          longitude: parseFloat(lng.toFixed(6)),
          areaSqm: Math.round(area * 100) / 100,
        });
      });
    });

    // Event: Shape Deleted
    map.on(L.Draw.Event.DELETED, () => {
      onPlotCleared();
    });

    // Force map resize check
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [onPlotDrawn, onPlotCleared]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
      {/* Map watermark / location tag */}
      <div className="absolute bottom-6 left-6 z-[1000] bg-slate-900/80 backdrop-blur text-white px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-md border border-slate-700/50 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        พิกัดศูนย์กลาง: อ.หาดใหญ่ จ.สงขลา (7.0084° N, 100.4767° E)
      </div>
    </div>
  );
};
