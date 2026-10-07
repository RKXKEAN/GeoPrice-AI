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
  useMapEvents,
  Polygon as LeafletPolygon
} from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { Pencil, Square, Scissors, Trash2, X, HelpCircle } from 'lucide-react';
import { EditControl } from './EditControl';
import { fetchPOIsAround, type OverpassPOI } from '../services/overpass';
import { scanVisionRadar, type RadarVisionResponse } from '../services/api';
import { resolveZoneAppraisalRate, formatThaiLandAreaStr } from '../services/zonePricing';
import { getPOIMeta, createPOIIcon, type POIMeta } from '../utils/poiMeta';
import hatYaiBoundaryData from '../data/hatyai_district_boundary.json';

// Configure Leaflet Draw Thai Localization
if (typeof L !== 'undefined' && (L as any).drawLocal) {
  (L as any).drawLocal.draw.toolbar.actions.title = 'ยกเลิกการวาด';
  (L as any).drawLocal.draw.toolbar.actions.text = 'ยกเลิก';
  (L as any).drawLocal.draw.toolbar.finish.title = 'เสร็จสิ้นการวาด';
  (L as any).drawLocal.draw.toolbar.finish.text = 'เสร็จสิ้น';
  (L as any).drawLocal.draw.toolbar.undo.title = 'ลบจุดสุดท้าย';
  (L as any).drawLocal.draw.toolbar.undo.text = 'ย้อนกลับ';
  (L as any).drawLocal.draw.toolbar.buttons.polygon = 'วาดแปลงที่ดินหลายเหลี่ยม (Polygon)';
  (L as any).drawLocal.draw.toolbar.buttons.rectangle = 'วาดแปลงที่ดินสี่เหลี่ยม (Rectangle)';
  (L as any).drawLocal.draw.handlers.polygon.tooltip.start = 'คลิกบนแผนที่เพื่อเริ่มปักมุมแรก';
  (L as any).drawLocal.draw.handlers.polygon.tooltip.cont = 'คลิกเพื่อปักมุมถัดไป';
  (L as any).drawLocal.draw.handlers.polygon.tooltip.end = 'คลิกจุดแรกหรือดับเบิลคลิกเพื่อปิดแปลง';
  (L as any).drawLocal.draw.handlers.rectangle.tooltip.start = 'คลิกค้างแล้วลากเพื่อวาดแปลงสี่เหลี่ยม';
  (L as any).drawLocal.edit.toolbar.buttons.edit = 'แก้ไขขอบเขตแปลง (ลากจุดมุม)';
  (L as any).drawLocal.edit.toolbar.buttons.editDisabled = 'ไม่มีแปลงให้แก้ไข';
  (L as any).drawLocal.edit.toolbar.buttons.remove = 'ลบแปลงที่ดิน';
  (L as any).drawLocal.edit.toolbar.buttons.removeDisabled = 'ไม่มีแปลงให้ลบ';
  (L as any).drawLocal.edit.handlers.edit.tooltip.text = 'ลากจุดมุมเพื่อปรับขนาดพื้นที่';
  (L as any).drawLocal.edit.handlers.edit.tooltip.subtext = 'กด "บันทึก" เมื่อแก้ไขเสร็จสิ้น';
}

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
  isSidebarOpen?: boolean;
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

// Official Hat Yai District Boundary (อำเภอหาดใหญ่) from OSM Relation 18959810 (852.8 sq.km)
const HAT_YAI_BOUNDARY_GEOJSON = hatYaiBoundaryData.boundaryFeature as any;
const HAT_YAI_OUTER_MASK_GEOJSON = hatYaiBoundaryData.maskFeature as any;
const HAT_YAI_SUBDISTRICTS = hatYaiBoundaryData.subdistricts;
const HAT_YAI_DISTRICT_BBOX: [[number, number], [number, number]] = [
  [hatYaiBoundaryData.metadata.bbox[1], hatYaiBoundaryData.metadata.bbox[0]], // [6.78711, 100.19088] (SW)
  [hatYaiBoundaryData.metadata.bbox[3], hatYaiBoundaryData.metadata.bbox[2]], // [7.18704, 100.60825] (NE)
];

const createSubdistrictIcon = (nameTh: string) => {
  return L.divIcon({
    className: 'custom-subdistrict-marker',
    html: `
      <div style="
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(56, 189, 248, 0.45);
        border-radius: 9999px;
        padding: 2px 7px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(6px);
        white-space: nowrap;
        cursor: pointer;
        transition: transform 0.15s ease;
      ">
        <span style="font-size: 10px;">📍</span>
        <span style="font-size: 10px; font-weight: 600; color: #f1f5f9; font-family: sans-serif;">${nameTh.replace('ตำบล', '')}</span>
      </div>
    `,
    iconSize: [80, 22],
    iconAnchor: [40, 11],
  });
};

// Component to provide programmatic zooming to the full Hat Yai district boundary
const DistrictBoundaryActions = () => {
  const map = useMap();
  useEffect(() => {
    (window as any).__geoprice_fit_hatyai = () => {
      map.fitBounds(HAT_YAI_DISTRICT_BBOX, {
        padding: [30, 30],
        duration: 0.8,
      });
    };
    return () => {
      delete (window as any).__geoprice_fit_hatyai;
    };
  }, [map]);
  return null;
};



// Component to handle map size invalidation with ResizeObserver & container transitions
const MapResizer = ({ isSidebarOpen }: { isSidebarOpen?: boolean }) => {
  const map = useMap();

  useEffect(() => {
    const handleResize = () => {
      map.invalidateSize();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    // Direct ResizeObserver on Leaflet container DOM to catch 100% full-screen transitions
    let resizeObserver: ResizeObserver | null = null;
    const container = map.getContainer();
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
      });
      resizeObserver.observe(container);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (resizeObserver && container) {
        resizeObserver.unobserve(container);
        resizeObserver.disconnect();
      }
    };
  }, [map]);

  // Timed invalidations when sidebar toggles to sync with Tailwind CSS transition duration
  useEffect(() => {
    const t0 = setTimeout(() => map.invalidateSize(), 50);
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 300);
    const t3 = setTimeout(() => map.invalidateSize(), 450);

    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [map, isSidebarOpen]);

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
  const onMapClickRef = useRef(onMapClick);
  const enabledRef = useRef(enabled);
  onMapClickRef.current = onMapClick;
  enabledRef.current = enabled;

  useMapEvents({
    click(e) {
      if (enabledRef.current) {
        onMapClickRef.current(e.latlng.lat, e.latlng.lng);
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
  setIsVisionScanning,
  isSidebarOpen
}: MapComponentProps) => {
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const [radarCircle, setRadarCircle] = useState<any>(null);
  const [dynamicPOIs, setDynamicPOIs] = useState<OverpassPOI[]>([]);
  const [isFetchingPOIs, setIsFetchingPOIs] = useState<boolean>(false);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [selectedPOICategory, setSelectedPOICategory] = useState<string | null>(null);
  const [showPOILegend, setShowPOILegend] = useState<boolean>(false);

  // Group POIs by category for the filter & legend bar
  const poiCategoryStats = useMemo(() => {
    const counts: Record<string, { meta: POIMeta; count: number }> = {};
    for (const poi of dynamicPOIs) {
      const meta = getPOIMeta(poi);
      if (!counts[meta.categoryKey]) {
        counts[meta.categoryKey] = { meta, count: 0 };
      }
      counts[meta.categoryKey].count += 1;
    }
    return Object.values(counts).sort((a, b) => b.count - a.count);
  }, [dynamicPOIs]);

  const filteredPOIs = useMemo(() => {
    if (!selectedPOICategory) return dynamicPOIs;
    return dynamicPOIs.filter((poi) => getPOIMeta(poi).categoryKey === selectedPOICategory);
  }, [dynamicPOIs, selectedPOICategory]);

  // User can dismiss/toggle the UI Hint Banner (especially useful on iPad and mobile screens)
  const [showHintBanner, setShowHintBanner] = useState(() => {
    try {
      const stored = localStorage.getItem('geoprice_show_hint_banner');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const handleToggleHintBanner = (visible: boolean) => {
    setShowHintBanner(visible);
    try {
      localStorage.setItem('geoprice_show_hint_banner', String(visible));
    } catch {}
  };

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

  // Sync plotData to featureGroupRef whenever plotData changes (e.g. converted from Target Building or re-mounted)
  useEffect(() => {
    if (!plotData) {
      if (featureGroupRef.current) {
        featureGroupRef.current.clearLayers();
      }
      return;
    }

    if (featureGroupRef.current && plotData.geometry) {
      featureGroupRef.current.clearLayers();
      const thaiUnit = formatThaiLandAreaStr(plotData.areaSqm);
      const pricing = resolveZoneAppraisalRate(plotData.latitude, plotData.longitude);
      const geoLayer = L.geoJSON(plotData.geometry as any, {
        style: {
          color: '#10b981',
          weight: 3.5,
          fillColor: '#059669',
          fillOpacity: 0.35,
          className: 'glowing-polygon-path',
        },
      });

      geoLayer.eachLayer((subLayer: any) => {
        subLayer.bindTooltip(
          `<div style="text-align: center; padding: 2px 4px;">
            <span style="color: #34d399; font-weight: 700; font-size: 13px;">📐 แปลงที่ดิน: ${plotData.areaSqm.toLocaleString()} ตร.ม.</span><br/>
            <span style="color: #93c5fd; font-size: 11px; font-weight: 600;">(${thaiUnit})</span><br/>
            <span style="color: #fbbf24; font-size: 10px;">฿${(plotData.priceRef || pricing.price_per_wah).toLocaleString()} / ตร.ว.</span>
          </div>`,
          { permanent: false, sticky: true, className: 'drawn-plot-area-badge' }
        );

        featureGroupRef.current?.addLayer(subLayer);
      });
    }
  }, [plotData]);

  useEffect(() => {
    if (!plotData && !visionResult) {
      setRadarCircle(null);
      setFlyTarget(null);
    } else if (plotData && visionResult) {
      const circle = turf.circle([plotData.longitude, plotData.latitude], 0.2, { units: 'kilometers' });
      setRadarCircle(circle);
    } else if (plotData && !visionResult) {
      setRadarCircle(null);
    }
  }, [plotData, visionResult]);

  // Pre-calculate [lat, lng] array for Leaflet Polygon rendering (fast, robust, reactive)
  const targetBuildingLatLngs = useMemo(() => {
    if (!visionResult?.target_building?.coordinates?.length) return null;
    const rawCoords = visionResult.target_building.coordinates;
    return rawCoords.map((pt: any) => [Number(pt[1]), Number(pt[0])] as [number, number]);
  }, [visionResult]);

  // Memoized GeoJSON for surrounding buildings (within 200m - Bounding Box)
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

  // Handle click on Map in Select / AI Radar Mode (Target: Polygon, Surroundings: Bounding Box)
  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    if (interactionMode !== 'select') return;

    if (featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
    }

    setIsVisionScanning?.(true);

    // Create immediate 200m circle around clicked point
    const circle = turf.circle([lng, lat], 0.2, { units: 'kilometers' });
    setRadarCircle(circle);
    setFlyTarget([lat, lng]);

    try {
      // Execute 200m YOLOv8 AI Vision inference
      const res = await scanVisionRadar(lat, lng, 200.0, 0.25);
      onVisionResult?.(res);
      onRadarScanned?.(res.radar_summary.total_buildings_detected);

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
  }, [interactionMode, setIsVisionScanning, onVisionResult, onRadarScanned]);

  // Handle newly created polygon or rectangle in manual Draw mode (Strictly calculates area from drawing)
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

    const calculatedAreaSqm = Math.round(area * 100) / 100;
    const pricing = resolveZoneAppraisalRate(lat, lng);
    const thaiUnit = formatThaiLandAreaStr(calculatedAreaSqm);

    // Bind permanent on-map area badge directly to the drawn polygon
    layer.bindTooltip(
      `<div style="text-align: center; padding: 2px 4px;">
        <span style="color: #34d399; font-weight: 700; font-size: 13px;">📐 แปลงที่ดิน: ${calculatedAreaSqm.toLocaleString()} ตร.ม.</span><br/>
        <span style="color: #93c5fd; font-size: 11px; font-weight: 600;">(${thaiUnit})</span><br/>
        <span style="color: #fbbf24; font-size: 10px;">฿${pricing.price_per_wah.toLocaleString()} / ตร.ว.</span>
      </div>`,
      { permanent: false, sticky: true, className: 'drawn-plot-area-badge' }
    );

    // Set plotData strictly from user drawing!
    onPlotDrawn({
      geometry: geoJson.geometry,
      latitude: parseFloat(lat.toFixed(6)),
      longitude: parseFloat(lng.toFixed(6)),
      areaSqm: calculatedAreaSqm,
      priceRef: pricing.price_per_wah,
      plotName: `แปลงที่ดิน ${pricing.road_name}`,
      source: 'draw',
    });

    // DO NOT invoke scanVisionRadar! Manual drawing is 100% user-authoritative.
    // Clear any previous vision result so user's drawn shape is clean.
    onVisionResult?.(null);

  }, [onPlotDrawn, onVisionResult]);

  // Handle edited shapes
  const handleEdited = useCallback((event: any) => {
    const layers = event.layers;
    layers.eachLayer((layer: any) => {
      const geoJson = layer.toGeoJSON();
      const area = turf.area(geoJson);
      const centroid = turf.centroid(geoJson);
      const [lng, lat] = centroid.geometry.coordinates;

      const calculatedAreaSqm = Math.round(area * 100) / 100;
      const pricing = resolveZoneAppraisalRate(lat, lng);
      const thaiUnit = formatThaiLandAreaStr(calculatedAreaSqm);

      layer.unbindTooltip();
      layer.bindTooltip(
        `<div style="text-align: center; padding: 2px 4px;">
          <span style="color: #34d399; font-weight: 700; font-size: 13px;">📐 แปลงที่ดิน: ${calculatedAreaSqm.toLocaleString()} ตร.ม.</span><br/>
          <span style="color: #93c5fd; font-size: 11px; font-weight: 600;">(${thaiUnit})</span><br/>
          <span style="color: #fbbf24; font-size: 10px;">฿${pricing.price_per_wah.toLocaleString()} / ตร.ว.</span>
        </div>`,
        { permanent: true, direction: 'center', className: 'drawn-plot-area-badge' }
      ).openTooltip();

      onPlotDrawn({
        geometry: geoJson.geometry,
        latitude: parseFloat(lat.toFixed(6)),
        longitude: parseFloat(lng.toFixed(6)),
        areaSqm: calculatedAreaSqm,
        priceRef: pricing.price_per_wah,
        plotName: `แปลงที่ดิน ${pricing.road_name} (แก้ไขแล้ว)`,
        source: 'draw',
      });
    });
  }, [onPlotDrawn]);

  // Handle deleted shapes
  const handleDeleted = useCallback(() => {
    if (featureGroupRef.current) {
      featureGroupRef.current.clearLayers();
    }
    setRadarCircle(null);
    onPlotCleared();
    onVisionResult?.(null);
  }, [onPlotCleared, onVisionResult]);


  return (
    <div className="relative w-full h-full">
      {/* UI Hint Banner: Closable and toggleable for iPad and mobile screens */}
      {showHintBanner ? (
        <div className="absolute top-16 md:top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/95 backdrop-blur-md text-slate-200 px-3 md:px-4 py-1.5 md:py-2.5 rounded-xl text-[11px] md:text-xs font-medium shadow-xl border border-cyan-500/40 flex items-center justify-between gap-2 max-w-[92vw] md:max-w-xl pointer-events-auto shadow-cyan-500/10 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-1.5 md:gap-2 text-left min-w-0">
            <span className="text-sm md:text-base shrink-0 animate-pulse">
              {isVisionScanning ? '🛰️' : (interactionMode === 'select' ? '🎯' : '✏️')}
            </span>
            <span className="line-clamp-2 md:line-clamp-none text-slate-200">
              {isVisionScanning ? (
                <span className="text-cyan-300 font-semibold flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shrink-0" />
                  กำลังตรวจจับด้วย AI (อาคารเป้าหมาย: Polygon, รอบข้าง 200 ม.: Bounding Box)...
                </span>
              ) : interactionMode === 'select' ? (
                <>
                  <strong className="text-cyan-300">โหมดเลือก AI Radar (200m):</strong> แตะบนหลังคาเพื่อดู <strong>Polygon</strong> & <strong>BBox</strong> (หรือสลับไปโหมดวาด)
                </>
              ) : (
                <>
                  <strong className="text-blue-300">โหมดวาดแปลงที่ดิน:</strong> แตะวาดตามขอบเขตจริงเพื่อ <strong>นับ ตร.ม. ประเมินราคา</strong> โดยตรง
                </>
              )}
            </span>
          </div>

          {/* Dismiss / Close Button */}
          <button
            type="button"
            onClick={() => handleToggleHintBanner(false)}
            className="p-1 -mr-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-all shrink-0 touch-manipulation cursor-pointer"
            title="ปิดคำอธิบายนี้ (ซ่อนเพื่อไม่ให้บังหน้าจอ)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* Small Re-open Pill Button when dismissed */
        <button
          type="button"
          onClick={() => handleToggleHintBanner(true)}
          className="absolute top-16 md:top-4 right-14 md:right-auto md:left-1/2 md:-translate-x-1/2 z-[1000] bg-slate-900/85 hover:bg-slate-800 backdrop-blur-md text-slate-400 hover:text-cyan-300 px-2.5 py-1 rounded-lg text-[10px] md:text-xs font-medium shadow-md border border-slate-700/80 hover:border-cyan-500/50 flex items-center gap-1.5 pointer-events-auto transition-all touch-manipulation cursor-pointer"
          title="แตะเพื่อเปิดคำอธิบายวิธีใช้งานโหมด"
        >
          <span>{interactionMode === 'select' ? '🎯' : '✏️'}</span>
          <span className="hidden sm:inline">วิธีใช้งาน</span>
          <HelpCircle className="w-3 h-3 text-cyan-400" />
        </button>
      )}

      {/* POI Categories & Filter Floating Panel - Positioned safely below Brand Header Badge */}
      <div className="absolute top-[68px] sm:top-[76px] left-3 sm:left-4 z-[1000] flex flex-col items-start gap-1.5 pointer-events-auto">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPOILegend(prev => !prev)}
            className="bg-slate-900/90 hover:bg-slate-800 backdrop-blur-md text-slate-200 hover:text-white px-3 py-1.5 rounded-xl text-xs font-semibold shadow-lg border border-slate-700/80 hover:border-cyan-500/50 flex items-center gap-2 transition-all cursor-pointer shadow-cyan-500/5 active:scale-95 touch-manipulation"
            title="คลิกเพื่อเปิด/ปิด แผงหมวดหมู่ไอคอน POI และตัวกรองสถานที่"
          >
            <span className="text-sm">🏷️</span>
            <span className="hidden sm:inline">หมวดหมู่ POI</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
              {dynamicPOIs.length}
            </span>
            {selectedPOICategory && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="กำลังกรองหมวดหมู่อยู่" />
            )}
          </button>

          {/* Fit Hat Yai District Boundary Quick Button */}
          <button
            type="button"
            onClick={() => {
              if (typeof (window as any).__geoprice_fit_hatyai === 'function') {
                (window as any).__geoprice_fit_hatyai();
              }
            }}
            className="bg-slate-900/90 hover:bg-slate-800 backdrop-blur-md text-cyan-300 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-semibold shadow-lg border border-slate-700/80 hover:border-cyan-400/60 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 touch-manipulation"
            title="ซูมแสดงภาพรวมขอบเขตอำเภอหาดใหญ่ทั้งหมด (852.8 ตร.กม.)"
          >
            <span>🏛️</span>
            <span className="hidden sm:inline">เขตอำเภอหาดใหญ่</span>
            <span className="text-[10px] text-slate-400 font-mono hidden md:inline">852.8 กม.²</span>
          </button>
        </div>

        {/* Expandable POI Filter & Legend Tray */}
        {showPOILegend && (
          <div className="bg-slate-950/95 backdrop-blur-md border border-slate-800/90 rounded-2xl p-3 shadow-2xl max-w-[88vw] sm:max-w-md w-full animate-in fade-in zoom-in-95 duration-150 space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">🧭</span>
                <span className="text-xs font-bold text-white">หมวดหมู่สถานที่สำคัญ (POI Categories)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPOILegend(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="text-[11px] text-slate-400">
              คลิกที่หมวดหมู่เพื่อกรองการแสดงผลบนแผนที่ ({dynamicPOIs.length} จุดรอบพื้นที่):
            </div>

            {/* Filter Pills Grid */}
            <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto pr-1">
              {/* All Filter */}
              <button
                type="button"
                onClick={() => setSelectedPOICategory(null)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer border ${
                  selectedPOICategory === null
                    ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/60 shadow-sm'
                    : 'bg-slate-900/60 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span>🌐</span>
                <span>ทั้งหมด</span>
                <span className="text-[10px] font-mono text-slate-400">({dynamicPOIs.length})</span>
              </button>

              {/* Individual Category Pills */}
              {poiCategoryStats.map(({ meta, count }) => {
                const isFilterActive = selectedPOICategory === meta.categoryKey;
                return (
                  <button
                    key={meta.categoryKey}
                    type="button"
                    onClick={() => setSelectedPOICategory(isFilterActive ? null : meta.categoryKey)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer border ${
                      isFilterActive
                        ? 'ring-2 shadow-sm'
                        : 'bg-slate-900/60 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                    style={
                      isFilterActive
                        ? {
                            backgroundColor: meta.bgLight,
                            borderColor: meta.color,
                            color: meta.color,
                            boxShadow: `0 0 10px ${meta.color}35`,
                          }
                        : undefined
                    }
                  >
                    <span>{meta.emoji}</span>
                    <span>{meta.labelTh}</span>
                    <span className="text-[10px] font-mono opacity-75">({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Footer tip */}
            <div className="text-[10px] text-slate-500 pt-1 flex items-center justify-between border-t border-slate-900">
              <span>แตะที่หมุดบนแผนที่เพื่อดูข้อมูลรายละเอียด</span>
              {selectedPOICategory && (
                <button
                  type="button"
                  onClick={() => setSelectedPOICategory(null)}
                  className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <MapContainer
        center={HAT_YAI_COORDINATES}
        zoom={15}
        preferCanvas={true}
        zoomControl={true}
        className="w-full h-full"
      >
        <MapResizer isSidebarOpen={isSidebarOpen} />
        <MapFlyTo center={flyTarget} />
        <MapClickHandler key={`click-handler-${interactionMode}`} enabled={interactionMode === 'select'} onMapClick={handleMapClick} />
        <DistrictBoundaryActions />

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

          {/* Overlay 1: หน้ากากโฟกัสเฉพาะเขตอำเภอหาดใหญ่ (Inverted Outer Mask - Focus on Hat Yai District) */}
          <LayersControl.Overlay checked name="🌑 หน้ากากโฟกัสอำเภอหาดใหญ่ (Outer Mask)">
            <LayerGroup>
              <GeoJSON
                data={HAT_YAI_OUTER_MASK_GEOJSON}
                interactive={false}
                style={{
                  color: 'transparent',
                  weight: 0,
                  fillColor: '#020617',
                  fillOpacity: 0.40,
                  className: 'hatyai-outer-mask',
                }}
              />
            </LayerGroup>
          </LayersControl.Overlay>

          {/* Overlay 2: เส้นแบ่งเขตแดนอำเภอหาดใหญ่ สไตล์เขตแดนประเทศ (Administrative Country Border) */}
          <LayersControl.Overlay checked name="🗺️ เส้นแบ่งเขตแดนอำเภอหาดใหญ่ (Border Line)">
            <LayerGroup>
              {/* Layer 1: Ambient Halo Glow */}
              <GeoJSON
                data={HAT_YAI_BOUNDARY_GEOJSON}
                interactive={false}
                style={{
                  color: '#0284c7',
                  weight: 7,
                  opacity: 0.40,
                  fillColor: '#38bdf8',
                  fillOpacity: 0.03,
                  className: 'hatyai-boundary-glow',
                }}
              />
              {/* Layer 2: Sharp Solid Administrative Border */}
              <GeoJSON
                data={HAT_YAI_BOUNDARY_GEOJSON}
                interactive={false}
                style={{
                  color: '#0369a1',
                  weight: 3.5,
                  opacity: 0.95,
                  fillOpacity: 0,
                  className: 'hatyai-boundary-solid',
                }}
              />
              {/* Layer 3: White Dashed National Core Line (เหมือนเส้นแบ่งเขตแดนประเทศ) */}
              <GeoJSON
                data={HAT_YAI_BOUNDARY_GEOJSON}
                interactive={true}
                onEachFeature={(_feature, layer) => {
                  layer.bindTooltip(
                    `<div style="text-align: center; padding: 4px 8px;">
                      <span style="color: #38bdf8; font-weight: 700; font-size: 12px;">🏛️ ขอบเขตการปกครอง: อำเภอหาดใหญ่</span><br/>
                      <span style="color: #94a3b8; font-size: 10px;">จังหวัดสงขลา &bull; เนื้อที่ 852.8 ตร.กม. &bull; 13 ตำบล</span>
                    </div>`,
                    { sticky: true, className: 'hatyai-boundary-tooltip' }
                  );
                }}
                style={{
                  color: '#ffffff',
                  weight: 1.5,
                  dashArray: '8, 6',
                  opacity: 1.0,
                  fillOpacity: 0,
                  className: 'hatyai-boundary-dashed',
                }}
              />
            </LayerGroup>
          </LayersControl.Overlay>

          {/* Overlay 3: จุดศูนย์กลางและป้าย 13 ตำบลในอำเภอหาดใหญ่ (13 Subdistricts of Hat Yai) */}
          <LayersControl.Overlay checked name="📍 ป้าย 13 ตำบลในอำเภอหาดใหญ่ (Subdistricts)">
            <LayerGroup>
              {HAT_YAI_SUBDISTRICTS.map((sd: any) => (
                <Marker
                  key={sd.id}
                  position={[sd.lat, sd.lon]}
                  icon={createSubdistrictIcon(sd.name_th)}
                >
                  <Popup className="custom-subdistrict-popup">
                    <div className="p-2 space-y-1 min-w-[180px] text-xs font-sans">
                      <div className="font-bold text-slate-800 flex items-center justify-between">
                        <span>{sd.name_th}</span>
                        <span className="text-[10px] text-slate-500 font-normal">{sd.name_en}</span>
                      </div>
                      <div className="text-[11px] text-indigo-600 font-medium">
                        {sd.type}
                      </div>
                      <div className="text-[10px] text-slate-500 border-t border-slate-200 pt-1 flex items-center justify-between">
                        <span>พิกัดศูนย์กลาง:</span>
                        <span className="font-mono">{sd.lat.toFixed(4)}, {sd.lon.toFixed(4)}</span>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>

          {/* Overlay 2: สถานที่สำคัญรอบแปลงที่ดิน (POIs & Landmarks) */}
          <LayersControl.Overlay checked name="สถานที่สำคัญรอบแปลง (POIs & Landmarks)">
            <LayerGroup>
              {filteredPOIs.map((poi) => {
                const meta = getPOIMeta(poi);
                const isSelected = selectedPOICategory === meta.categoryKey || (nearestPOI?.id === poi.id);
                const icon = createPOIIcon(meta, isSelected);
                const categoryType = poi.tags?.amenity
                  ? `amenity: ${poi.tags.amenity}`
                  : (poi.tags?.shop ? `shop: ${poi.tags.shop}` : (poi.tags?.category_th || poi.category));

                // Calculate straight-line distance to plot if active
                let distToPlotM: number | null = null;
                if (plotData?.latitude && plotData?.longitude) {
                  const dLat = (poi.lat - plotData.latitude) * 111000;
                  const dLon = (poi.lon - plotData.longitude) * 111000 * 0.99;
                  distToPlotM = Math.round(Math.sqrt(dLat * dLat + dLon * dLon));
                }

                return (
                  <Marker
                    key={`overpass-poi-${poi.id}`}
                    position={[poi.lat, poi.lon]}
                    icon={icon}
                  >
                    <Popup>
                      <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#f8fafc', minWidth: '240px', lineHeight: 1.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', paddingBottom: '6px' }}>
                          <span style={{ 
                            fontSize: '11px', 
                            fontWeight: 700, 
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '2px 8px', 
                            borderRadius: '9999px', 
                            background: meta.bgLight, 
                            color: meta.color, 
                            border: `1px solid ${meta.borderLight}` 
                          }}>
                            <span>{meta.emoji}</span>
                            <span>{meta.labelTh}</span>
                          </span>
                          <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                            {poi.tags?.badge || 'Overpass / OSM'}
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: '#ffffff', marginBottom: '4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                          {poi.name}
                        </div>
                        <div style={{ color: '#cbd5e1', fontSize: '11px', marginBottom: '4px' }}>
                          ประเภท: <strong style={{ color: meta.color }}>{categoryType}</strong>
                        </div>
                        {poi.tags?.description && (
                          <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '6px', fontStyle: 'italic' }}>
                            {poi.tags.description}
                          </div>
                        )}
                        {distToPlotM !== null && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(30, 41, 59, 0.7)', padding: '4px 8px', borderRadius: '6px', marginBottom: '6px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                            <span style={{ fontSize: '10px', color: '#94a3b8' }}>ระยะทางตรงถึงแปลง:</span>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>
                              {distToPlotM.toLocaleString()} ม.
                            </span>
                          </div>
                        )}
                        <div style={{ fontSize: '10px', color: '#94a3b8', borderTop: '1px dashed rgba(255, 255, 255, 0.15)', paddingTop: '6px', fontFamily: 'monospace' }}>
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

        {/* 1. Surrounding Buildings Bounding Box (YOLOv8 best.pt 200m Radar) */}
        {surroundingGeoJSON && (
          <GeoJSON
            key={`surrounding-${plotData?.latitude ?? visionResult?.target_building?.center?.[0]}-${plotData?.longitude ?? visionResult?.target_building?.center?.[1]}-${visionResult?.surrounding_buildings?.length}`}
            data={surroundingGeoJSON as any}
            style={() => ({
              color: '#38bdf8',
              weight: 1.6,
              fillColor: '#0284c7',
              fillOpacity: 0.18,
              dashArray: '4, 4',
              className: 'vision-surrounding-bbox',
            })}
            onEachFeature={(feature: any, layer: any) => {
              const p = feature.properties || {};
              layer.bindTooltip(`
                <div style="font-family: system-ui, sans-serif; font-size: 11px; line-height: 1.4;">
                  <div style="font-weight: 700; color: #38bdf8;">📦 ${p.id || 'สิ่งปลูกสร้าง'} (Bounding Box)</div>
                  <div>มิติ: <strong>${p.width_m} × ${p.length_m} ม.</strong> (~${p.area_sqm} ตร.ม.)</div>
                  <div>ห่าง: <strong>${p.distance_m} ม.</strong> | AI Conf: ${Math.round((p.confidence || 0) * 100)}%</div>
                </div>
              `, { sticky: true, className: 'vision-building-tooltip' });

              layer.on('click', (e: any) => {
                if (interactionMode === 'select') {
                  L.DomEvent.stopPropagation(e);
                  handleMapClick(e.latlng.lat, e.latlng.lng);
                }
              });
            }}
          />
        )}

        {/* 2. Target Building Architectural Footprint (Emerald Neon Glow Polygon - Always Rendered) */}
        {targetBuildingLatLngs && targetBuildingLatLngs.length >= 3 && (
          <LeafletPolygon
            key={`target-bld-poly-${visionResult?.target_building?.center?.[0]}-${visionResult?.target_building?.center?.[1]}-${visionResult?.target_building?.area_sqm}-${targetBuildingLatLngs.length}`}
            positions={targetBuildingLatLngs}
            pathOptions={{
              color: '#10b981',
              weight: 3.5,
              fillColor: '#059669',
              fillOpacity: 0.60,
              className: 'vision-target-building-polygon',
            }}
            eventHandlers={{
              click: (e: any) => {
                if (interactionMode === 'select') {
                  L.DomEvent.stopPropagation(e);
                  handleMapClick(e.latlng.lat, e.latlng.lng);
                }
              },
            }}
          >
            <Tooltip sticky>
              <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '11px', lineHeight: '1.4' }}>
                <div style={{ fontWeight: 700, color: '#34d399' }}>
                  {visionResult?.target_building?.method === 'cadastral_survey_polygon'
                    ? '📐 รูปแปลงรังวัดจริง (21,718 แปลง)'
                    : '🎯 อาคารเป้าหมาย (Polygon)'}
                </div>
                <div>
                  วิธี: {visionResult?.target_building?.method === 'cadastral_survey_polygon'
                    ? 'ฐานข้อมูลสำรวจและรังวัดจริง (Cadastral Survey GIS)'
                    : visionResult?.target_building?.method === 'fastsam_ai'
                    ? 'FastSAM Foundation AI (Zero-Shot)'
                    : visionResult?.target_building?.method === 'superpixel_fluid'
                    ? 'SuperPixel + Fluid Field (SLIC)'
                    : (visionResult?.target_building?.method || 'AI Vector Polygon')}
                </div>
                {visionResult?.target_building?.area_sqm && (
                  <div style={{ color: '#93c5fd', marginTop: '2px' }}>
                    พื้นที่: {visionResult.target_building.area_sqm.toLocaleString()} ตร.ม. ({visionResult.target_building.area_wah} ตร.ว.)
                  </div>
                )}
              </div>
            </Tooltip>
          </LeafletPolygon>
        )}

        {/* 4. AI Radar Scan Circle (200m Radius) */}
        {radarCircle && (
          <GeoJSON
            key={`radar-${plotData?.latitude ?? visionResult?.target_building?.center?.[0]}-${plotData?.longitude ?? visionResult?.target_building?.center?.[1]}`}
            data={radarCircle as any}
            interactive={false}
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
              position="topleft"
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

      {/* Floating Draw Toolbar when in Draw Mode */}
      {interactionMode === 'draw' && (
        <div className="absolute bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/95 backdrop-blur-md px-3 md:px-4 py-2 md:py-2.5 rounded-2xl border border-blue-500/40 shadow-2xl flex items-center gap-2 md:gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-[94vw] overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 md:gap-2 border-r border-slate-700/80 pr-2 md:pr-3 shrink-0">
            <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[11px] md:text-xs font-bold text-white whitespace-nowrap">
              โหมดวาด
            </span>
            {plotData && (
              <span className="text-[10px] md:text-xs text-emerald-400 font-bold bg-emerald-950/80 border border-emerald-800/60 px-1.5 md:px-2 py-0.5 rounded-full font-mono whitespace-nowrap">
                {plotData.areaSqm.toLocaleString()} ตร.ม.
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 md:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                const btn = document.querySelector<HTMLElement>('.leaflet-draw-draw-polygon');
                if (btn) btn.click();
              }}
              className="px-2.5 md:px-3 py-1.5 rounded-xl bg-blue-600/25 hover:bg-blue-600/40 text-blue-300 border border-blue-500/40 text-[11px] md:text-xs font-semibold flex items-center gap-1 md:gap-1.5 transition-all cursor-pointer hover:scale-[1.02] shadow-sm whitespace-nowrap active:scale-95 touch-manipulation"
              title="คลิกปักหมุดมุมแปลงหลายเหลี่ยม แล้วดับเบิลคลิกหรือคลิกจุดแรกเพื่อปิดรูป"
            >
              <Pencil className="w-3.5 h-3.5 text-blue-400" />
              <span>หลายเหลี่ยม</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const btn = document.querySelector<HTMLElement>('.leaflet-draw-draw-rectangle');
                if (btn) btn.click();
              }}
              className="px-2.5 md:px-3 py-1.5 rounded-xl bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 text-[11px] md:text-xs font-semibold flex items-center gap-1 md:gap-1.5 transition-all cursor-pointer hover:scale-[1.02] shadow-sm whitespace-nowrap active:scale-95 touch-manipulation"
              title="คลิกค้างแล้วลากเพื่อวาดแปลงสี่เหลี่ยม"
            >
              <Square className="w-3.5 h-3.5 text-emerald-400" />
              <span>สี่เหลี่ยม</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const btn = document.querySelector<HTMLElement>('.leaflet-draw-edit-edit');
                if (btn) btn.click();
              }}
              disabled={!plotData}
              className={`px-2.5 md:px-3 py-1.5 rounded-xl border text-[11px] md:text-xs font-semibold flex items-center gap-1 md:gap-1.5 transition-all whitespace-nowrap active:scale-95 touch-manipulation ${
                plotData
                  ? 'bg-amber-600/25 hover:bg-amber-600/40 text-amber-300 border-amber-500/40 cursor-pointer hover:scale-[1.02]'
                  : 'bg-slate-800/40 text-slate-500 border-slate-800 cursor-not-allowed opacity-50'
              }`}
              title="ลากจุดมุมเพื่อปรับแต่งขอบเขตแปลง"
            >
              <Scissors className="w-3.5 h-3.5 text-amber-400" />
              <span>ปรับแต่ง</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (featureGroupRef.current) {
                  featureGroupRef.current.clearLayers();
                }
                setRadarCircle(null);
                onPlotCleared();
                onVisionResult?.(null);
              }}
              disabled={!plotData}
              className={`px-2.5 md:px-3 py-1.5 rounded-xl border text-[11px] md:text-xs font-semibold flex items-center gap-1 md:gap-1.5 transition-all whitespace-nowrap active:scale-95 touch-manipulation ${
                plotData
                  ? 'bg-rose-600/25 hover:bg-rose-600/40 text-rose-300 border-rose-500/40 cursor-pointer hover:scale-[1.02]'
                  : 'bg-slate-800/40 text-slate-500 border-slate-800 cursor-not-allowed opacity-50'
              }`}
              title="ล้างแปลงที่ดินที่วาด"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>ล้าง</span>
            </button>
          </div>
        </div>
      )}

      {/* Map watermark / location tag (Desktop / Tablet only) */}
      <div className="hidden md:flex absolute bottom-2 left-4 z-[1000] bg-slate-900/80 backdrop-blur text-white px-3 py-1 rounded-lg text-[11px] font-medium shadow-md border border-cyan-500/30 items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400"></span>
        <span>ระบบประเมินราคาที่ดิน GeoPrice: อ.หาดใหญ่ จ.สงขลา</span>
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
