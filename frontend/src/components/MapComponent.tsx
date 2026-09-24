import { useEffect, useRef, useCallback } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  WMSTileLayer, 
  GeoJSON, 
  LayersControl, 
  FeatureGroup, 
  LayerGroup,
  useMap 
} from 'react-leaflet';
import L from 'leaflet';
import type { Feature, Polygon } from 'geojson';
import * as turf from '@turf/turf';
import { EditControl } from './EditControl';
import hatYaiParcelsData from '../data/hatyai_parcels.json';
import hatYaiLandmarksData from '../data/hatyai_landmarks.json';

export interface DrawnPlotData {
  geometry: any;
  latitude: number;
  longitude: number;
  areaSqm: number;
}

interface MapComponentProps {
  onPlotDrawn: (data: DrawnPlotData) => void;
  onPlotCleared: () => void;
  plotData?: DrawnPlotData | null;
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

// Hat Yai District Boundary (อำเภอหาดใหญ่) Mock GeoJSON Polygon
const HAT_YAI_BOUNDARY_GEOJSON: Feature<Polygon> = {
  type: 'Feature',
  properties: {
    name: 'ขอบเขตอำเภอหาดใหญ่',
    district: 'Hat Yai',
    province: 'Songkhla',
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [100.3650, 7.1150],
        [100.4120, 7.1420],
        [100.4680, 7.1510],
        [100.5280, 7.1260],
        [100.5750, 7.0780],
        [100.6010, 7.0120],
        [100.5890, 6.9450],
        [100.5420, 6.8920],
        [100.4750, 6.8680],
        [100.4050, 6.8950],
        [100.3520, 6.9480],
        [100.3340, 7.0250],
        [100.3420, 7.0760],
        [100.3650, 7.1150]
      ]
    ]
  }
};

// Custom glowing HTML div-icon for landmark pins
const createLandmarkIcon = (category: string, color: string) => {
  const iconEmoji: Record<string, string> = {
    university: '🎓',
    hospital: '🏥',
    school: '🏫',
    transport: '✈️',
    commercial: '🛍️',
  };
  const emoji = iconEmoji[category] || '📍';
  return L.divIcon({
    className: 'custom-landmark-div',
    html: `
      <div class="landmark-pin-container">
        <div class="landmark-pulse" style="background: ${color};"></div>
        <div class="landmark-pin" style="background: ${color};">
          <span style="font-size: 15px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">${emoji}</span>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
};

// Component to handle map size invalidation on render
const MapResizer = () => {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
};

export const MapComponent = ({ onPlotDrawn, onPlotCleared, plotData }: MapComponentProps) => {
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);

  // Sync external clearing (e.g. from Sidebar 'ล้างแปลง')
  useEffect(() => {
    if (!plotData && featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
    }
  }, [plotData]);

  // Handle newly created polygon or rectangle
  const handleCreated = useCallback((event: any) => {
    const layer = event.layer;
    if (featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
      featureGroupRef.current.addLayer(layer);
    }

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
  }, [onPlotDrawn]);

  // Handle edited shapes
  const handleEdited = useCallback((event: any) => {
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
  }, [onPlotDrawn]);

  // Handle deleted shapes
  const handleDeleted = useCallback(() => {
    onPlotCleared();
  }, [onPlotCleared]);

  return (
    <div className="relative w-full h-full">
      {/* UI Hint Banner: How to draw polygon with glowing styling */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 backdrop-blur-md text-slate-200 px-4 py-2.5 rounded-xl text-xs font-medium shadow-xl border border-cyan-500/40 flex items-center gap-2 max-w-xl text-center pointer-events-auto shadow-cyan-500/10">
        <span className="text-base shrink-0 animate-pulse">💡</span>
        <span>
          <strong>วิธีวาดแปลงที่ดิน:</strong> คลิกจุดตามมุมของที่ดินไปเรื่อยๆ (ไม่จำกัดจำนวนจุด) และ <strong>คลิกที่จุดเริ่มต้นอีกครั้ง</strong> เพื่อเสร็จสิ้นการวาด
        </span>
      </div>

      <MapContainer
        center={HAT_YAI_COORDINATES}
        zoom={13}
        zoomControl={true}
        className="w-full h-full"
      >
        <MapResizer />

        {/* Layer Controls: Base layers and Overlays */}
        <LayersControl position="topright">
          {/* Base Layer 1: ภาพถ่ายดาวเทียม (Google Satellite Hybrid - Checked by default) */}
          <LayersControl.BaseLayer checked name="ภาพถ่ายดาวเทียม">
            <TileLayer
              url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
              attribution="&copy; Google Maps Satellite Hybrid"
              maxZoom={20}
            />
          </LayersControl.BaseLayer>

          {/* Base Layer 2: แผนที่ถนน (OpenStreetMap) */}
          <LayersControl.BaseLayer name="แผนที่ถนน">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* Overlay 1: ขอบเขตอำเภอหาดใหญ่ (Glowing Neon Boundary Line) */}
          <LayersControl.Overlay checked name="ขอบเขตอำเภอหาดใหญ่ (เส้นเรืองแสง Neon)">
            <LayerGroup>
              {/* Outer Glow Halo */}
              <GeoJSON
                data={HAT_YAI_BOUNDARY_GEOJSON}
                style={{
                  color: '#00f2fe',
                  weight: 6,
                  fillOpacity: 0,
                  className: 'hatyai-boundary-glow',
                }}
              />
              {/* Inner High-Contrast Core Line */}
              <GeoJSON
                data={HAT_YAI_BOUNDARY_GEOJSON}
                style={{
                  color: '#ffffff',
                  weight: 2,
                  dashArray: '8, 8',
                  fillOpacity: 0,
                  className: 'hatyai-boundary-core',
                }}
              />
            </LayerGroup>
          </LayersControl.Overlay>


          {/* Overlay 3: สถานที่สำคัญและ Landmark (มหาวิทยาลัย / โรงพยาบาล / โรงเรียน) */}
          <LayersControl.Overlay checked name="สถานที่สำคัญ & Landmark (มหาวิทยาลัย/รพ./รร.)">
            <GeoJSON
              data={hatYaiLandmarksData as any}
              pointToLayer={(feature, latlng) => {
                const p = feature.properties;
                const icon = createLandmarkIcon(p.category, p.color);
                return L.marker(latlng, { icon });
              }}
              onEachFeature={(feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`
                  <div style="font-family: system-ui, sans-serif; font-size: 12px; color: #f8fafc; min-width: 220px; line-height: 1.5;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">
                      <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 9999px; background: ${p.color}25; color: ${p.color}; border: 1px solid ${p.color}50;">
                        ${p.category_th}
                      </span>
                      <span style="font-size: 10px; color: #94a3b8;">${p.badge}</span>
                    </div>
                    <div style="font-weight: 700; font-size: 14px; color: #ffffff; margin-bottom: 4px;">
                      ${p.name}
                    </div>
                    <p style="color: #cbd5e1; font-size: 11px; margin: 0 0 6px 0;">
                      ${p.description}
                    </p>
                    <div style="font-size: 10px; color: #64748b; font-family: monospace;">
                      พิกัด: ${(feature.geometry as any).coordinates[1].toFixed(4)}°N, ${(feature.geometry as any).coordinates[0].toFixed(4)}°E
                    </div>
                  </div>
                `);
              }}
            />
          </LayersControl.Overlay>

          {/* Overlay 4: เส้นรูปแปลงที่ดินจริง (อ.หาดใหญ่ - OpenStreetMap Cadastral/Building Polygons) */}
          <LayersControl.Overlay checked name="เส้นรูปแปลงที่ดินจริง (อ.หาดใหญ่)">
            <GeoJSON
              data={hatYaiParcelsData as any}
              style={{
                color: '#f59e0b',
                weight: 1.5,
                opacity: 0.9,
                fillColor: '#fbbf24',
                fillOpacity: 0.15,
              }}
              onEachFeature={(feature, layer) => {
                if (feature.properties) {
                  const p = feature.properties;
                  layer.bindPopup(`
                    <div style="font-family: system-ui, sans-serif; font-size: 12px; color: #1e293b; min-width: 190px; line-height: 1.5;">
                      <div style="font-weight: 700; font-size: 13px; color: #0f172a; margin-bottom: 4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px;">
                        📌 ${p.name || 'แปลงที่ดิน / สิ่งปลูกสร้าง'}
                      </div>
                      <div style="color: #475569; margin-bottom: 2px;">
                        ประเภท: <span style="color: #2563eb; font-weight: 600;">${p.land_type || 'ทั่วไป'}</span>
                      </div>
                      <div style="color: #475569; margin-bottom: 2px;">
                        พื้นที่: <span>${p.district}, จ.${p.province}</span>
                      </div>
                      <div style="font-size: 10px; color: #94a3b8; margin-top: 5px; border-top: 1px dashed #cbd5e1; padding-top: 3px;">
                        รหัส: ${p.id} &bull; ข้อมูลพิกัดจริง OSM
                      </div>
                    </div>
                  `);
                }
              }}
            />
          </LayersControl.Overlay>

          {/* Overlay 5: เส้นรูปแปลงที่ดิน (กรมที่ดิน WMS - ทางเลือก) */}
          <LayersControl.Overlay name="เส้นรูปแปลงที่ดิน (กรมที่ดิน WMS)">
            <WMSTileLayer
              url="https://landsmaps.dol.go.th/arcgis/rest/services/DOL_CADASTRAL/MapServer/WMSServer"
              layers="0"
              format="image/png"
              transparent={true}
              attribution="&copy; กรมที่ดิน (Department of Lands)"
            />
          </LayersControl.Overlay>
        </LayersControl>

        {/* FeatureGroup for user-drawn land plots with Glowing Neon Styles */}
        <FeatureGroup ref={featureGroupRef}>
          <EditControl
            position="topright"
            onCreated={handleCreated}
            onEdited={handleEdited}
            onDeleted={handleDeleted}
            draw={{
              polygon: {
                allowIntersection: false,
                shapeOptions: {
                  color: '#00f2fe',
                  weight: 3,
                  opacity: 1,
                  fillColor: '#00f2fe',
                  fillOpacity: 0.25,
                  className: 'glowing-polygon-path',
                },
              },
              rectangle: {
                shapeOptions: {
                  color: '#10b981',
                  weight: 3,
                  opacity: 1,
                  fillColor: '#10b981',
                  fillOpacity: 0.25,
                  className: 'glowing-rectangle-path',
                },
              },
              polyline: false,
              circle: false,
              circlemarker: false,
              marker: false,
            }}
          />
        </FeatureGroup>
      </MapContainer>

      {/* Map watermark / location tag */}
      <div className="absolute bottom-6 left-6 z-[1000] bg-slate-900/80 backdrop-blur text-white px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-md border border-cyan-500/30 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400"></span>
        พิกัดศูนย์กลาง: อ.หาดใหญ่ จ.สงขลา (7.0084° N, 100.4767° E)
      </div>
    </div>
  );
};

export default MapComponent;
