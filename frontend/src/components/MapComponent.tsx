import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  GeoJSON, 
  LayersControl, 
  FeatureGroup, 
  LayerGroup,
  Polyline,
  Tooltip,
  Marker,
  Popup,
  useMap,
  useMapEvents
} from 'react-leaflet';
import L from 'leaflet';
import type { Feature, Polygon } from 'geojson';
import * as turf from '@turf/turf';
import { EditControl } from './EditControl';
import { fetchPOIsAround, type OverpassPOI } from '../services/overpass';
import { scanVisionRadar, type RadarVisionResponse } from '../services/api';

export interface DrawnPlotData {
  geometry: any;
  latitude: number;
  longitude: number;
  areaSqm: number;
  parcelId?: string | number;
  priceRef?: number;
  plotName?: string;
  source?: 'draw' | 'select' | 'radar';
}

interface MapComponentProps {
  onPlotDrawn: (data: DrawnPlotData) => void;
  onPlotCleared: () => void;
  plotData?: DrawnPlotData | null;
  onRadarScanned?: (count: number) => void;
  nearestPOI?: any;
  interactionMode?: 'draw' | 'select';
  visionResult?: RadarVisionResponse | null;
  onVisionResult?: (result: RadarVisionResponse | null) => void;
  isVisionScanning?: boolean;
  setIsVisionScanning?: (scanning: boolean) => void;
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

// Helper to classify Overpass POI emoji, color, and label
const getPOIMeta = (poi: OverpassPOI) => {
  const amenity = poi.tags?.amenity;
  const shop = poi.tags?.shop;

  if (amenity === 'hospital') {
    return { emoji: '🏥', color: '#ef4444', label: 'โรงพยาบาล (Hospital)' };
  } else if (amenity === 'school') {
    return { emoji: '🏫', color: '#f59e0b', label: 'โรงเรียน (School)' };
  } else if (amenity === 'university') {
    return { emoji: '🎓', color: '#3b82f6', label: 'มหาวิทยาลัย (University)' };
  } else if (amenity === 'marketplace') {
    return { emoji: '🛒', color: '#10b981', label: 'ตลาด (Marketplace)' };
  } else if (shop === 'mall') {
    return { emoji: '🛍️', color: '#ec4899', label: 'ห้างสรรพสินค้า (Mall)' };
  } else if (shop === 'supermarket') {
    return { emoji: '🏪', color: '#8b5cf6', label: 'ซูเปอร์มาร์เก็ต (Supermarket)' };
  }

  return { emoji: '📍', color: '#06b6d4', label: amenity || shop || poi.category || 'สถานที่สำคัญ' };
};

// Custom glowing HTML div-icon for POI pins
const createPOIIcon = (emoji: string, color: string) => {
  return L.divIcon({
    className: 'custom-poi-div',
    html: `
      <div class="landmark-pin-container" style="cursor: pointer;">
        <div class="landmark-pulse" style="background: ${color};"></div>
        <div class="landmark-pin" style="background: ${color}; box-shadow: 0 2px 8px ${color}80;">
          <span style="font-size: 15px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">${emoji}</span>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
};

// Custom glowing pin icon for target building detected by YOLOv8
const createTargetPinIcon = () => {
  return L.divIcon({
    className: 'custom-target-marker',
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer;">
        <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(16, 185, 129, 0.4); animation: landmarkPulse 1.8s infinite;"></div>
        <div style="width: 32px; height: 32px; border-radius: 50%; background: #059669; border: 2.5px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 16px rgba(16, 185, 129, 0.9);">
          <span style="font-size: 16px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));">🎯</span>
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

// Component to fly map smoothly to target center at high zoom
const MapFlyTo = ({ center }: { center: [number, number] | null }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, 18, { duration: 0.8, easeLinearity: 0.25 });
    }
  }, [center, map]);
  return null;
};

// Component to capture click events in select/radar mode
const MapClickHandler = ({ 
  enabled, 
  onMapClick 
}: { 
  enabled: boolean; 
  onMapClick: (lat: number, lng: number) => void;
}) => {
  useMapEvents({
    click(e) {
      if (enabled) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
};

export const MapComponent = ({ 
  onPlotDrawn, 
  onPlotCleared, 
  plotData, 
  onRadarScanned, 
  nearestPOI,
  interactionMode = 'select',
  visionResult,
  onVisionResult,
  isVisionScanning = false,
  setIsVisionScanning
}: MapComponentProps) => {
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const [radarCircle, setRadarCircle] = useState<any>(null);
  const [dynamicPOIs, setDynamicPOIs] = useState<OverpassPOI[]>([]);
  const [isFetchingPOIs, setIsFetchingPOIs] = useState<boolean>(false);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);

  // Initial load of POIs around Hat Yai center so the map is never empty
  useEffect(() => {
    fetchPOIsAround(HAT_YAI_COORDINATES[0], HAT_YAI_COORDINATES[1], 2000)
      .then((pois) => {
        if (pois && pois.length > 0) {
          setDynamicPOIs(pois);
        }
      })
      .catch((err) => {
        console.warn('Initial POIs load warning:', err);
      });
  }, []);

  // When plotData is cleared, reset visual states
  useEffect(() => {
    if (!plotData) {
      setRadarCircle(null);
      setFlyTarget(null);
      onVisionResult?.(null);
      if (featureGroupRef.current) {
        featureGroupRef.current.clearLayers();
      }
    }
  }, [plotData, onVisionResult]);

  // Memoized GeoJSON for target building (detected by YOLOv8)
  const targetGeoJSON = useMemo(() => {
    if (!visionResult?.target_building?.coordinates) return null;
    return {
      type: 'Feature' as const,
      properties: visionResult.target_building,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [visionResult.target_building.coordinates],
      },
    };
  }, [visionResult]);

  // Memoized GeoJSON for surrounding buildings (within 200m)
  const surroundingGeoJSON = useMemo(() => {
    if (!visionResult?.surrounding_buildings?.length) return null;
    return {
      type: 'FeatureCollection' as const,
      features: visionResult.surrounding_buildings.map((bld) => ({
        type: 'Feature' as const,
        id: bld.id,
        properties: bld,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [bld.coordinates],
        },
      })),
    };
  }, [visionResult]);

  // Handle click on Map in Select / AI Radar Mode
  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    if (interactionMode !== 'select') return;

    setIsVisionScanning?.(true);

    // Create immediate 200m circle around clicked point
    const circle = turf.circle([lng, lat], 0.2, { units: 'kilometers' });
    setRadarCircle(circle);
    setFlyTarget([lat, lng]);

    // Clear any manual drawn polygon
    if (featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
    }

    try {
      // Execute 200m YOLOv8 AI Vision inference
      const res = await scanVisionRadar(lat, lng, 200.0, 0.25);
      onVisionResult?.(res);
      onRadarScanned?.(res.radar_summary.total_buildings_detected);

      if (res.target_building) {
        const tb = res.target_building;
        onPlotDrawn({
          geometry: {
            type: 'Polygon',
            coordinates: [tb.coordinates],
          },
          latitude: tb.center[0],
          longitude: tb.center[1],
          areaSqm: tb.area_sqm,
          priceRef: tb.price_per_wah,
          plotName: tb.found
            ? `อาคารเป้าหมาย (${tb.road_name})`
            : `จุดตรวจสอบ (${tb.road_name})`,
          source: 'select',
        });
      }

      // Dynamic POIs within 1000m
      setIsFetchingPOIs(true);
      fetchPOIsAround(lat, lng, 1000)
        .then((pois) => {
          if (pois && pois.length > 0) setDynamicPOIs(pois);
        })
        .finally(() => setIsFetchingPOIs(false));

    } catch (err: any) {
      console.error('AI Vision Radar error:', err);
      alert('เกิดข้อผิดพลาดในการรันโมเดล Vision: ' + (err?.response?.data?.detail || err.message));
    } finally {
      setIsVisionScanning?.(false);
    }
  }, [interactionMode, setIsVisionScanning, onVisionResult, onRadarScanned, onPlotDrawn]);

  // Handle newly created polygon or rectangle in manual Draw mode
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

    const circle = turf.circle(centroid, 0.2, { units: 'kilometers' });
    setRadarCircle(circle);

    onPlotDrawn({
      geometry: geoJson.geometry,
      latitude: parseFloat(lat.toFixed(6)),
      longitude: parseFloat(lng.toFixed(6)),
      areaSqm: Math.round(area * 100) / 100,
      source: 'draw',
    });

    // Optionally scan vision around drawn plot centroid
    setIsVisionScanning?.(true);
    scanVisionRadar(lat, lng, 200.0, 0.25)
      .then((res) => {
        onVisionResult?.(res);
        onRadarScanned?.(res.radar_summary.total_buildings_detected);
      })
      .catch((err) => console.warn('Radar scan around drawn shape:', err))
      .finally(() => setIsVisionScanning?.(false));

  }, [onPlotDrawn, onVisionResult, onRadarScanned, setIsVisionScanning]);

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
        source: 'draw',
      });
    });
  }, [onPlotDrawn]);

  // Handle deleted shapes
  const handleDeleted = useCallback(() => {
    onPlotCleared();
  }, [onPlotCleared]);

  return (
    <div className="relative w-full h-full">
      {/* UI Hint Banner: Dynamic based on interactionMode and scanning state */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 backdrop-blur-md text-slate-200 px-4 py-2.5 rounded-xl text-xs font-medium shadow-xl border border-cyan-500/40 flex items-center gap-2 max-w-xl text-center pointer-events-auto shadow-cyan-500/10">
        <span className="text-base shrink-0 animate-pulse">
          {isVisionScanning ? '🛰️' : (interactionMode === 'select' ? '🎯' : '💡')}
        </span>
        <span>
          {isVisionScanning ? (
            <span className="text-cyan-300 font-semibold flex items-center gap-2">
              <span className="w-2.5 h-2.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              กำลังวิเคราะห์ภาพถ่ายดาวเทียมและตรวจจับอาคารด้วย AI (YOLOv8 best.pt)...
            </span>
          ) : interactionMode === 'select' ? (
            <>
              <strong>โหมด AI Vision Radar (200m):</strong> คลิกที่อาคารหรือจุดใดก็ได้บนแผนที่ดาวเทียม เพื่อให้ AI ตรวจจับบ้าน ประเมินราคา และนับบ้านรอบข้าง 200 ม.
            </>
          ) : (
            <>
              <strong>วิธีวาดแปลงที่ดิน:</strong> คลิกจุดตามมุมของที่ดินไปเรื่อยๆ (ไม่จำกัดจำนวนจุด) และ <strong>คลิกที่จุดเริ่มต้นอีกครั้ง</strong> เพื่อเสร็จสิ้นการวาด
            </>
          )}
        </span>
      </div>

      <MapContainer
        center={HAT_YAI_COORDINATES}
        zoom={15}
        preferCanvas={true}
        zoomControl={true}
        className="w-full h-full"
      >
        <MapResizer />
        <MapFlyTo center={flyTarget} />
        <MapClickHandler enabled={interactionMode === 'select'} onMapClick={handleMapClick} />

        {/* Layer Controls: Base layers and Overlays */}
        <LayersControl position="topright">
          {/* Base Layer 1: ภาพถ่ายดาวเทียมดิบ (Google Raw Satellite) - 100% สะอาด ไร้ไอคอนและป้ายชื่อ */}
          <LayersControl.BaseLayer checked name="ภาพถ่ายดาวเทียมดิบ (Google Raw Satellite - ไร้ไอคอน)">
            <TileLayer
              url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
              attribution="&copy; Google Maps Satellite Raw"
              maxZoom={20}
            />
          </LayersControl.BaseLayer>

          {/* Base Layer 2: ภาพถ่ายดาวเทียมแบบมีชื่อสถานที่ (Google Hybrid) */}
          <LayersControl.BaseLayer name="ภาพถ่ายดาวเทียมแบบมีป้ายชื่อ (Google Hybrid)">
            <TileLayer
              url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
              attribution="&copy; Google Maps Satellite Hybrid"
              maxZoom={20}
            />
          </LayersControl.BaseLayer>

          {/* Base Layer 3: แผนที่ถนนมาตรฐาน (OpenStreetMap) */}
          <LayersControl.BaseLayer name="แผนที่ถนน (OpenStreetMap)">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* Overlay 1: ขอบเขตอำเภอหาดใหญ่ (Glowing Neon Boundary Line) */}
          <LayersControl.Overlay checked name="ขอบเขตอำเภอหาดใหญ่ (เส้นเรืองแสง Neon)">
            <LayerGroup>
              <GeoJSON
                data={HAT_YAI_BOUNDARY_GEOJSON}
                style={{
                  color: '#00f2fe',
                  weight: 6,
                  fillOpacity: 0,
                  className: 'hatyai-boundary-glow',
                }}
              />
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

          {/* Overlay 2: สถานที่สำคัญรอบแปลงที่ดิน (POIs & Landmarks) - ปิดไว้เริ่มต้นเพื่อภาพที่สะอาดตา ไร้ไอคอน */}
          <LayersControl.Overlay name="สถานที่สำคัญรอบแปลง (POIs & Landmarks)">

            <LayerGroup>
              {dynamicPOIs.map((poi) => {
                const meta = getPOIMeta(poi);
                const icon = createPOIIcon(meta.emoji, meta.color);
                const categoryType = poi.tags?.amenity
                  ? `amenity: ${poi.tags.amenity}`
                  : (poi.tags?.shop ? `shop: ${poi.tags.shop}` : poi.category);

                return (
                  <Marker
                    key={`overpass-poi-${poi.id}`}
                    position={[poi.lat, poi.lon]}
                    icon={icon}
                  >
                    <Popup>
                      <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#f8fafc', minWidth: '220px', lineHeight: 1.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', paddingBottom: '6px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: '9999px', background: `${meta.color}35`, color: meta.color, border: `1px solid ${meta.color}80` }}>
                            {meta.label}
                          </span>
                          <span style={{ fontSize: '10px', color: '#94a3b8' }}>Overpass / OSM</span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: '#ffffff', marginBottom: '4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                          {poi.name}
                        </div>
                        <div style={{ color: '#cbd5e1', fontSize: '11px', marginBottom: '4px' }}>
                          ประเภท: <strong style={{ color: '#38bdf8' }}>{categoryType}</strong>
                        </div>
                        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px', borderTop: '1px dashed rgba(255, 255, 255, 0.15)', paddingTop: '6px', fontFamily: 'monospace' }}>
                          พิกัด: {poi.lat.toFixed(5)}°N, {poi.lon.toFixed(5)}°E
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>

        {/* 1. Surrounding Buildings Real Polygons (YOLOv8 best.pt 200m Radar) */}
        {surroundingGeoJSON && (
          <GeoJSON
            key={`surrounding-${visionResult?.target_building?.center?.[0]}-${visionResult?.target_building?.center?.[1]}`}
            data={surroundingGeoJSON as any}
            style={{
              color: '#00f2fe',
              weight: 1.5,
              fillColor: '#0284c7',
              fillOpacity: 0.25,
              className: 'vision-surrounding-building',
            }}
            onEachFeature={(feature: any, layer: any) => {
              const p = feature.properties || {};
              layer.bindTooltip(`
                <div style="font-family: system-ui, sans-serif; font-size: 11px; line-height: 1.4;">
                  <div style="font-weight: 700; color: #38bdf8;">${p.id || 'สิ่งปลูกสร้าง'}</div>
                  <div>ขนาด: <strong>${p.area_sqm} ตร.ม.</strong> (${p.area_wah} ตร.ว.)</div>
                  <div>ห่าง: <strong>${p.distance_m} ม.</strong> | AI Conf: ${Math.round((p.confidence || 0) * 100)}%</div>
                </div>
              `, { sticky: true, className: 'vision-building-tooltip' });
            }}
          />
        )}

        {/* 2. Target Building Footprint (Emerald Neon Glow) */}
        {targetGeoJSON && (
          <GeoJSON
            key={`target-bld-${visionResult?.target_building?.center?.[0]}-${visionResult?.target_building?.center?.[1]}`}
            data={targetGeoJSON as any}
            style={{
              color: '#10b981',
              weight: 3.5,
              fillColor: '#059669',
              fillOpacity: 0.65,
              className: 'vision-target-building',
            }}
          />
        )}

        {/* 3. Floating Target Pin & Detail Popup */}
        {visionResult?.target_building && (
          <Marker
            position={visionResult.target_building.center}
            icon={createTargetPinIcon()}
          >
            <Popup autoPan={false}>
              <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#f8fafc', minWidth: '240px', lineHeight: 1.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', paddingBottom: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: '9999px', background: '#10b98135', color: '#10b981', border: '1px solid #10b98180' }}>
                    🎯 สิ่งปลูกสร้างเป้าหมาย
                  </span>
                  <span style={{ fontSize: '10px', color: '#34d399', fontWeight: 600 }}>
                    AI {Math.round(visionResult.target_building.confidence * 100)}%
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#ffffff', marginBottom: '2px' }}>
                  {visionResult.target_building.road_name}
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '11px', marginBottom: '6px' }}>
                  {visionResult.target_building.zone_name}
                </div>
                {visionResult.target_building.valuation_source && (
                  <div style={{
                    fontSize: '10px',
                    color: visionResult.target_building.source_badge === 'real_exact' ? '#34d399' : '#c084fc',
                    background: visionResult.target_building.source_badge === 'real_exact' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                    border: `1px solid ${visionResult.target_building.source_badge === 'real_exact' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(168, 85, 247, 0.4)'}`,
                    padding: '3px 6px',
                    borderRadius: '4px',
                    marginBottom: '6px',
                    fontWeight: 600,
                  }}>
                    {visionResult.target_building.source_badge === 'real_exact' ? '🟢 ' : '🟣 '}
                    {visionResult.target_building.valuation_source}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', background: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: '6px', margin: '6px 0' }}>
                  <div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>ขนาดสิ่งปลูกสร้าง</div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8' }}>
                      {visionResult.target_building.area_sqm} ตร.ม.
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>
                      ({visionResult.target_building.area_wah} ตร.ว.)
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                      {visionResult.target_building.source_badge === 'real_exact' ? 'ราคาประเมินจริง' : 'ราคาประเมินโมเดล'}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b' }}>
                      ฿{visionResult.target_building.price_per_wah.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>/ ตร.ว.</div>
                  </div>
                </div>
                <div style={{ borderTop: '1px dashed rgba(255, 255, 255, 0.15)', paddingTop: '6px', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>มูลค่าประเมินรวม:</span>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#10b981' }}>
                    ฿{visionResult.target_building.total_estimated_price.toLocaleString()}
                  </span>
                </div>
                {visionResult.target_building.parcel_total_value && (
                  <div style={{ fontSize: '10px', color: '#34d399', marginTop: '4px', textAlign: 'right' }}>
                    มูลค่าทั้งแปลงโฉนดจริง: ฿{visionResult.target_building.parcel_total_value.toLocaleString()}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        {/* 4. AI Radar Scan Circle (200m Radius) */}
        {radarCircle && (
          <GeoJSON
            key={`radar-${plotData?.latitude}-${plotData?.longitude}`}
            data={radarCircle as any}
            style={{
              color: '#00f2fe',
              dashArray: '5, 10',
              fillColor: '#00f2fe',
              fillOpacity: 0.1,
              weight: 2,
              className: 'radar-scan-circle',
            }}
          />
        )}

        {/* 5. Visual Road Distance Line to Nearest POI */}
        {plotData && nearestPOI && nearestPOI.coordinates && (
          <Polyline
            key={`poi-line-${nearestPOI.id}-${plotData.latitude}-${plotData.longitude}`}
            positions={[
              [plotData.latitude, plotData.longitude],
              [nearestPOI.coordinates[1], nearestPOI.coordinates[0]],
            ]}
            pathOptions={{
              color: (nearestPOI.isWithin500m ?? nearestPOI.distanceMeters <= 500) ? '#10b981' : '#38bdf8',
              weight: 2.5,
              dashArray: '6, 8',
              opacity: 0.9,
            }}
          >
            <Tooltip permanent direction="center" className="poi-distance-tooltip">
              <span className="font-sans font-semibold text-xs text-white flex items-center gap-1">
                {(nearestPOI.isWithin500m ?? nearestPOI.distanceMeters <= 500) ? '🎯 ' : '🚗 '}
                {nearestPOI.name}: <strong>{nearestPOI.distanceMeters} ม.</strong> (OSRM)
              </span>
            </Tooltip>
          </Polyline>
        )}

        {/* FeatureGroup for manual land plot drawing */}
        <FeatureGroup ref={featureGroupRef}>
          {interactionMode === 'draw' && (
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
          )}
        </FeatureGroup>
      </MapContainer>

      {/* Map watermark / location tag */}
      <div className="absolute bottom-6 left-6 z-[1000] bg-slate-900/80 backdrop-blur text-white px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-md border border-cyan-500/30 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400"></span>
        <span>ระบบเรดาร์ AI: อ.หาดใหญ่ จ.สงขลา (รัศมี 200 ม. โมเดล best.pt)</span>
      </div>

      {/* Loading badge for Overpass POIs */}
      {isFetchingPOIs && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 backdrop-blur-md text-cyan-300 px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-xl border border-cyan-500/40 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>กำลังค้นหาสถานที่สำคัญจาก Overpass API (รัศมี 1,000 ม.)...</span>
        </div>
      )}
    </div>
  );
};

export default MapComponent;
