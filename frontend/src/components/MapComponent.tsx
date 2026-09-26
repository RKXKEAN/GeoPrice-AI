import { useEffect, useRef, useCallback, useState } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  WMSTileLayer, 
  GeoJSON, 
  LayersControl, 
  FeatureGroup, 
  LayerGroup,
  Polyline,
  Tooltip,
  Marker,
  Popup,
  useMap 
} from 'react-leaflet';
import L from 'leaflet';
import type { Feature, Polygon } from 'geojson';
import * as turf from '@turf/turf';
import { EditControl } from './EditControl';
import hatYaiParcelsData from '../data/hatyai_parcels.json';
// import hatYaiLandmarksData from '../data/hatyai_landmarks.json'; // Replaced by dynamic Overpass API
import { fetchPOIsAround, type OverpassPOI } from '../services/overpass';
import { fetchActiveGeoJSON } from '../services/api';

export interface DrawnPlotData {
  geometry: any;
  latitude: number;
  longitude: number;
  areaSqm: number;
  parcelId?: string | number;
  priceRef?: number;
  plotName?: string;
  source?: 'draw' | 'select';
}

interface MapComponentProps {
  onPlotDrawn: (data: DrawnPlotData) => void;
  onPlotCleared: () => void;
  plotData?: DrawnPlotData | null;
  onRadarScanned?: (count: number) => void;
  nearestPOI?: any;
  interactionMode?: 'draw' | 'select';
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

export const MapComponent = ({ 
  onPlotDrawn, 
  onPlotCleared, 
  plotData, 
  onRadarScanned, 
  nearestPOI,
  interactionMode = 'draw'
}: MapComponentProps) => {
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const [radarCircle, setRadarCircle] = useState<any>(null);
  const [scannedBuildingIds, setScannedBuildingIds] = useState<Set<string | number>>(new Set());
  const [dynamicPOIs, setDynamicPOIs] = useState<OverpassPOI[]>([]);
  const [isFetchingPOIs, setIsFetchingPOIs] = useState<boolean>(false);
  const [activeDataset, setActiveDataset] = useState<any>(null);
  const [isLoadingDataset, setIsLoadingDataset] = useState<boolean>(false);
  const [selectedParcelId, setSelectedParcelId] = useState<string | number | null>(null);

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

  // Fetch active dataset GeoJSON when entering Select Mode
  useEffect(() => {
    if (interactionMode === 'select' && !activeDataset && !isLoadingDataset) {
      setIsLoadingDataset(true);
      fetchActiveGeoJSON()
        .then((data) => {
          if (data && data.features) {
            setActiveDataset(data);
          }
        })
        .catch((err) => {
          console.error('Failed to load active appraisal dataset GeoJSON:', err);
        })
        .finally(() => {
          setIsLoadingDataset(false);
        });
    }
  }, [interactionMode, activeDataset, isLoadingDataset]);

  // Sync external parcel ID and clearing
  useEffect(() => {
    if (plotData?.parcelId !== undefined) {
      setSelectedParcelId(plotData.parcelId);
    } else if (!plotData) {
      setSelectedParcelId(null);
      if (featureGroupRef.current) {
        featureGroupRef.current.clearLayers();
      }
    }
  }, [plotData]);

  // Perform AI Radar 200m spatial analysis and Overpass POIs (1000m) when plotData changes
  useEffect(() => {
    if (!plotData || !plotData.geometry) {
      setRadarCircle(null);
      setScannedBuildingIds(new Set());
      onRadarScanned?.(0);
      // Reset back to Hat Yai city center POIs
      fetchPOIsAround(HAT_YAI_COORDINATES[0], HAT_YAI_COORDINATES[1], 2000)
        .then((pois) => {
          if (pois && pois.length > 0) setDynamicPOIs(pois);
        })
        .catch(() => {});
      return;
    }

    try {
      const centroid = turf.centroid(plotData.geometry);
      const [lng, lat] = centroid.geometry.coordinates;

      // 1. Fetch dynamic POIs within 1000m radius around centroid using Overpass API
      setIsFetchingPOIs(true);
      fetchPOIsAround(lat, lng, 1000)
        .then((pois) => {
          if (pois && pois.length > 0) {
            setDynamicPOIs(pois);
          }
        })
        .catch((err) => {
          console.error('Error fetching POIs from Overpass:', err);
        })
        .finally(() => {
          setIsFetchingPOIs(false);
        });

      // 2. Create 200-meter radius circle (0.2 kilometers)
      const circle = turf.circle(centroid, 0.2, { units: 'kilometers' });
      setRadarCircle(circle);

      // Check which parcels/buildings intersect with or are inside the 200m circle
      const hitIds = new Set<string | number>();
      const featuresToCheck = (interactionMode === 'select' && activeDataset?.features) 
        ? activeDataset.features 
        : (hatYaiParcelsData as any).features;

      for (const feature of featuresToCheck) {
        try {
          if (turf.booleanIntersects(circle, feature)) {
            const id = feature.id ?? feature.properties?.parcel_id ?? feature.properties?.id;
            if (id !== undefined) hitIds.add(id);
          }
        } catch {
          // ignore malformed geometry
        }
      }

      setScannedBuildingIds(hitIds);
      onRadarScanned?.(hitIds.size);
    } catch (err) {
      console.error('Error during AI Radar scan analysis:', err);
    }
  }, [plotData, onRadarScanned, interactionMode, activeDataset]);

  // Dynamic parcel styling: glowing red if inside 200m radar scan
  const getParcelStyle = useCallback((feature: any) => {
    const fid = feature?.id ?? feature?.properties?.id;
    const isScanned = fid !== undefined && (
      scannedBuildingIds.has(fid) ||
      scannedBuildingIds.has(String(fid)) ||
      scannedBuildingIds.has(Number(fid))
    );

    if (isScanned) {
      return {
        fillColor: '#ef4444',
        color: '#f87171',
        weight: 2,
        fillOpacity: 0.6,
        opacity: 1,
        className: 'scanned-building-glow',
      };
    }

    return {
      color: '#f59e0b',
      weight: 1.5,
      opacity: 0.9,
      fillColor: '#fbbf24',
      fillOpacity: 0.15,
    };
  }, [scannedBuildingIds]);

  // Dynamic styling for Active Dataset parcels in Select Mode
  const getActiveDatasetStyle = useCallback((feature: any) => {
    const pid = feature?.properties?.parcel_id || feature?.id;
    const isSelected = selectedParcelId !== null && (selectedParcelId === pid || String(selectedParcelId) === String(pid));
    const isScanned = pid !== undefined && (
      scannedBuildingIds.has(pid) ||
      scannedBuildingIds.has(String(pid)) ||
      scannedBuildingIds.has(Number(pid))
    );

    if (isSelected) {
      return {
        color: '#10b981',
        weight: 3.5,
        fillColor: '#059669',
        fillOpacity: 0.65,
        className: 'selected-parcel-glow',
      };
    }

    if (isScanned) {
      return {
        fillColor: '#ef4444',
        color: '#f87171',
        weight: 2,
        fillOpacity: 0.6,
        opacity: 1,
        className: 'scanned-building-glow',
      };
    }

    return {
      color: '#06b6d4',
      weight: 1.5,
      opacity: 0.85,
      fillColor: '#0284c7',
      fillOpacity: 0.25,
      className: 'select-mode-parcel',
    };
  }, [selectedParcelId, scannedBuildingIds]);

  // Handle parcel selection in Select Mode
  const handleSelectParcel = useCallback((feature: any) => {
    const props = feature.properties || {};
    const pid = props.parcel_id || feature.id;
    setSelectedParcelId(pid);

    let lat = props.latitude;
    let lng = props.longitude;
    if (lat === undefined || lng === undefined) {
      const coords = feature.geometry?.coordinates;
      const ring = coords?.[0] || [];
      if (ring.length > 0) {
        const avgLon = ring.reduce((sum: number, pt: number[]) => sum + pt[0], 0) / ring.length;
        const avgLat = ring.reduce((sum: number, pt: number[]) => sum + pt[1], 0) / ring.length;
        lat = parseFloat(avgLat.toFixed(6));
        lng = parseFloat(avgLon.toFixed(6));
      } else {
        lat = 7.0084;
        lng = 100.4767;
      }
    }

    // Direct area size from dataset properties (no Turf.js recalculation)
    const areaSqm = typeof props.area_size === 'number' ? props.area_size : 400.0;

    // Clear any drawn shape from manual draw
    if (featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
    }

    onPlotDrawn({
      geometry: feature.geometry,
      latitude: lat,
      longitude: lng,
      areaSqm: areaSqm,
      parcelId: pid,
      priceRef: props.price_ref,
      plotName: props.name || `แปลงที่ดิน ${pid}`,
      source: 'select',
    });
  }, [onPlotDrawn]);

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
      {/* UI Hint Banner: Dynamic based on interactionMode */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 backdrop-blur-md text-slate-200 px-4 py-2.5 rounded-xl text-xs font-medium shadow-xl border border-cyan-500/40 flex items-center gap-2 max-w-xl text-center pointer-events-auto shadow-cyan-500/10">
        <span className="text-base shrink-0 animate-pulse">
          {interactionMode === 'select' ? '🎯' : '💡'}
        </span>
        <span>
          {interactionMode === 'select' ? (
            <>
              <strong>โหมดเลือกแปลงที่ดิน (Select Mode):</strong> คลิกเลือกแปลงที่ดินบนแผนที่เพื่อดูข้อมูลและประเมินราคา (ดึงพิกัดและขนาดพื้นที่จาก Active Dataset เข้าสู่โมเดลโดยตรง)
            </>
          ) : (
            <>
              <strong>วิธีวาดแปลงที่ดิน:</strong> คลิกจุดตามมุมของที่ดินไปเรื่อยๆ (ไม่จำกัดจำนวนจุด) และ <strong>คลิกที่จุดเริ่มต้นอีกครั้ง</strong> เพื่อเสร็จสิ้นการวาด
            </>
          )}
        </span>
      </div>

      {/* Loading badge for Active Dataset */}
      {isLoadingDataset && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 backdrop-blur-md text-cyan-300 px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-xl border border-cyan-500/40 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>กำลังโหลดแปลงที่ดิน Active Dataset จากระบบ...</span>
        </div>
      )}

      <MapContainer
        center={HAT_YAI_COORDINATES}
        zoom={13}
        zoomControl={true}
        className="w-full h-full"
      >
        <MapResizer />

        {/* Layer Controls: Base layers and Overlays */}
        <LayersControl position="topright">
          {/* Base Layer 1: แผนที่ถนนมาตรฐาน (OpenStreetMap Standard - คมชัด โหลดเร็ว ฟรี 100% ไม่มีลายน้ำ) */}
          <LayersControl.BaseLayer checked name="OpenStreetMap Standard">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* Base Layer 2: แผนที่สีพาสเทลเพื่อมนุษยธรรม (OpenStreetMap HOT) */}
          <LayersControl.BaseLayer name="OpenStreetMap HOT (สีพาสเทล)">
            <TileLayer
              url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles by HOT'
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* Base Layer 3: แผนที่ภูมิประเทศและเส้นทาง Esri (World Topo Map) */}
          <LayersControl.BaseLayer name="Esri World Topo Map (ภูมิประเทศ)">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
              attribution='Tiles &copy; Esri'
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          {/* Base Layer 4: ภาพถ่ายดาวเทียม (Google Satellite) */}
          <LayersControl.BaseLayer name="ภาพถ่ายดาวเทียม (Satellite)">
            <TileLayer
              url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
              attribution="&copy; Google Maps Satellite Hybrid"
              maxZoom={20}
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

          {/* Overlay 2: สถานที่สำคัญรอบแปลงที่ดิน (Dynamic POIs via Overpass API 1000m) */}
          <LayersControl.Overlay checked name="สถานที่สำคัญรอบแปลง (POIs & Landmarks)">
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

          {/* Overlay 4: เส้นรูปแปลงที่ดินจริง (อ.หาดใหญ่ - OpenStreetMap Cadastral/Building Polygons) */}
          {interactionMode !== 'select' && (
            <LayersControl.Overlay checked name="เส้นรูปแปลงที่ดินจริง (อ.หาดใหญ่)">
              <GeoJSON
                key={`parcels-${scannedBuildingIds.size}-${plotData?.latitude ?? 'none'}`}
                data={hatYaiParcelsData as any}
                style={getParcelStyle}
                onEachFeature={(feature, layer) => {
                  if (feature.properties) {
                    const p = feature.properties;
                    const fid = feature.id ?? p.id;
                    const isScanned = fid !== undefined && (
                      scannedBuildingIds.has(fid) ||
                      scannedBuildingIds.has(String(fid)) ||
                      scannedBuildingIds.has(Number(fid))
                    );
                    layer.bindPopup(`
                      <div style="font-family: system-ui, sans-serif; font-size: 12px; color: #f8fafc; min-width: 200px; line-height: 1.5;">
                        <div style="font-weight: 700; font-size: 13px; color: #ffffff; margin-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding-bottom: 4px;">
                          📌 ${p.name || 'แปลงที่ดิน / สิ่งปลูกสร้าง'}
                        </div>
                        ${isScanned ? `
                        <div style="display: inline-block; font-size: 10px; font-weight: 700; color: #fca5a5; background: rgba(239, 68, 68, 0.25); border: 1px solid rgba(248, 113, 113, 0.6); padding: 2px 8px; border-radius: 6px; margin-bottom: 6px;">
                          📡 ตรวจพบใน AI Radar (200m)
                        </div>
                        ` : ''}
                        <div style="color: #cbd5e1; margin-bottom: 3px;">
                          ประเภท: <span style="color: #38bdf8; font-weight: 600;">${p.land_type || 'ทั่วไป'}</span>
                        </div>
                        <div style="color: #cbd5e1; margin-bottom: 3px;">
                          พื้นที่: <span style="color: #f1f5f9;">${p.district}, จ.${p.province}</span>
                        </div>
                        <div style="font-size: 10px; color: #94a3b8; margin-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.15); padding-top: 4px;">
                          รหัส: ${p.id} &bull; ข้อมูลพิกัดจริง OSM
                        </div>
                      </div>
                    `);
                  }
                }}
              />
            </LayersControl.Overlay>
          )}

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

        {/* Active Dataset GeoJSON Layer (Select Mode) */}
        {interactionMode === 'select' && activeDataset && (
          <GeoJSON
            key={`active-dataset-${activeDataset?.metadata?.total_parcels || 'parcels'}-${selectedParcelId ?? 'none'}`}
            data={activeDataset}
            style={getActiveDatasetStyle}
            onEachFeature={(feature, layer) => {
              const p = feature.properties || {};
              const pid = p.parcel_id || feature.id;

              layer.on({
                click: () => {
                  handleSelectParcel(feature);
                },
                mouseover: (e: any) => {
                  if (selectedParcelId !== pid && String(selectedParcelId) !== String(pid)) {
                    e.target.setStyle({ fillOpacity: 0.45, weight: 2.5, color: '#38bdf8' });
                  }
                },
                mouseout: (e: any) => {
                  if (selectedParcelId !== pid && String(selectedParcelId) !== String(pid)) {
                    e.target.setStyle({ fillOpacity: 0.25, weight: 1.5, color: '#06b6d4' });
                  }
                },
              });

              layer.bindPopup(`
                <div style="font-family: system-ui, sans-serif; font-size: 12px; color: #f8fafc; min-width: 220px; line-height: 1.5;">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding-bottom: 4px;">
                    <span style="font-size: 10px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); padding: 2px 6px; border-radius: 4px;">
                      ${p.parcel_id || 'PARCEL'}
                    </span>
                    <span style="font-size: 10px; color: #10b981; font-weight: 600;">
                      Active Dataset
                    </span>
                  </div>
                  <div style="font-weight: 700; font-size: 13px; color: #ffffff; margin-bottom: 4px;">
                    📌 ${p.name || 'แปลงที่ดินพร้อมประเมิน'}
                  </div>
                  <div style="color: #cbd5e1; margin-bottom: 3px;">
                    ขนาดพื้นที่: <strong style="color: #10b981;">${Number(p.area_size || 0).toLocaleString()} ตร.ม.</strong>
                  </div>
                  ${p.price_ref ? `
                  <div style="color: #cbd5e1; margin-bottom: 3px;">
                    ราคาอ้างอิง: <strong style="color: #fbbf24;">฿${Number(p.price_ref).toLocaleString()} / ตร.ม.</strong>
                  </div>
                  ` : ''}
                  <div style="color: #cbd5e1; margin-bottom: 3px;">
                    ประเภท: <span style="color: #38bdf8;">${p.land_type || 'ทั่วไป'}</span>
                  </div>
                  <div style="font-size: 10px; color: #94a3b8; margin-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.15); padding-top: 4px;">
                    🖱️ คลิกแปลงนี้เพื่อเลือกและประเมินราคา
                  </div>
                </div>
              `);
            }}
          />
        )}

        {/* AI Radar Scan Circle (200m Radius) */}
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

        {/* Visual Road Distance Line to Nearest POI */}
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

        {/* FeatureGroup for user-drawn land plots with Glowing Neon Styles */}
        <FeatureGroup ref={featureGroupRef}>
          {interactionMode !== 'select' && (
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
        พิกัดศูนย์กลาง: อ.หาดใหญ่ จ.สงขลา (7.0084° N, 100.4767° E)
      </div>

      {/* Loading badge for Overpass POIs */}
      {isFetchingPOIs && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 backdrop-blur-md text-cyan-300 px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-xl border border-cyan-500/40 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>กำลังค้นหาสถานที่สำคัญจาก Overpass API (รัศมี 500 ม.)...</span>
        </div>
      )}
    </div>
  );
};

export default MapComponent;
