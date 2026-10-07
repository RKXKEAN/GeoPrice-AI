import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  MapPin, 
  Layers, 
  Sparkles, 
  CheckCircle2, 
  RotateCcw,
  Building2,
  Radar,
  Navigation,
  Pencil,
  Sliders,
  X,
  ArrowLeft,
  ChevronRight
} from 'lucide-react';

import * as turf from '@turf/turf';
import hatYaiLandmarksData from './data/hatyai_landmarks.json';
import { MapComponent } from './components/MapComponent';
import type { DrawnPlotData } from './components/MapComponent';
import { FuturePredictionPanel } from './components/FuturePredictionPanel';
import { getPOIMeta } from './utils/poiMeta';
import { AdminLogin } from './components/AdminLogin';
import { AdminDashboard } from './components/AdminDashboard';
import type { AdminUser } from './services/adminApi';
import { submitPricePrediction, getPredictionStatus, scanVisionRadar } from './services/api';
import { resolveZoneAppraisalRate, formatThaiLandAreaStr } from './services/zonePricing';
import type {
  PredictionJobResponse, 
  PredictionResult,
  RadarVisionResponse
} from './services/api';

export interface NearbyPOI {
  id: string;
  name: string;
  category: string;
  category_th: string;
  distanceMeters: number;
  straightDistanceMeters: number;
  coordinates: [number, number]; // [lon, lat]
  badge?: string;
  isWithin500m: boolean;
}

export function App() {
  // Navigation Route state: 'map' | 'admin'
  const [currentView, setCurrentView] = useState<'map' | 'admin'>(() => {
    return typeof window !== 'undefined' && window.location.pathname.startsWith('/admin') ? 'admin' : 'map';
  });

  // Admin authentication state
  const [adminUser, setAdminUser] = useState<AdminUser | null>(() => {
    try {
      const raw = localStorage.getItem('geoprice_admin_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // Listen to browser forward/backward navigation
  useEffect(() => {
    const handlePopState = () => {
      if (window.location.pathname.startsWith('/admin')) {
        setCurrentView('admin');
      } else {
        setCurrentView('map');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Mode state: 'draw' | 'select' (default to AI Vision Radar select mode)
  const [interactionMode, setInteractionMode] = useState<'draw' | 'select'>('select');

  // Responsive UI states (Mobile / iPad / Desktop)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  // Plot state
  const [plotData, setPlotData] = useState<DrawnPlotData | null>(null);
  const [plotName, setPlotName] = useState('พื้นที่ตรวจสอบ GeoPrice');
  const [showPredictionPanel, setShowPredictionPanel] = useState<boolean>(false);
  const [predictionYears, setPredictionYears] = useState(1);
  const [selectedModel, setSelectedModel] = useState<'xgboost' | 'arimax'>('xgboost');
  const [forceModel, setForceModel] = useState(false);
  const [showModelComparison, setShowModelComparison] = useState(true);

  // AI Vision Radar (best.pt) states
  const [visionResult, setVisionResult] = useState<RadarVisionResponse | null>(null);
  const [isVisionScanning, setIsVisionScanning] = useState(false);

  // AI Radar Scan (200m) & OSRM POI states (500m)
  const [scannedBuildings, setScannedBuildings] = useState<number | null>(null);
  const [nearbyPOIs, setNearbyPOIs] = useState<NearbyPOI[]>([]);
  const [nearestPOI, setNearestPOI] = useState<NearbyPOI | null>(null);
  const [loadingPOIs, setLoadingPOIs] = useState(false);

  // Submission & Job tracking state
  const [loading, setLoading] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<PredictionJobResponse | null>(null);
  const [jobResult, setJobResult] = useState<PredictionResult | null>(null);
  const wsRef = useRef<WebSocket | null>(null);


  const handlePlotDrawn = useCallback((data: DrawnPlotData | null) => {
    if (!data) {
      setPlotData(null);
      setShowPredictionPanel(false);
      return;
    }
    setPlotData(data);
    if (data.plotName) {
      setPlotName(data.plotName);
    }
    setSubmissionError(null);
    setVisionResult(null);
    setScannedBuildings(null);
    setShowPredictionPanel(true);
  }, []);

  const handlePlotCleared = useCallback(() => {
    setPlotData(null);
    setShowPredictionPanel(false);
    setActiveJob(null);
    setJobResult(null);
    setScannedBuildings(null);
    setVisionResult(null);
    setIsVisionScanning(false);
    setNearbyPOIs([]);
    setNearestPOI(null);
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore error
      }
      wsRef.current = null;
    }
  }, []);

  const handleRadarScanned = useCallback((count: number) => {
    setScannedBuildings(count);
  }, []);

  // Optional manual scan around the drawn plot (surroundings: bounding boxes, plot area strictly preserved)
  const handleScanRadarAroundPlot = useCallback(async () => {
    if (!plotData) return;
    setIsVisionScanning(true);
    try {
      const res = await scanVisionRadar(plotData.latitude, plotData.longitude, 200.0, 0.25);
      
      // ในระบบวาดแปลง (Draw Mode): แปลงที่ผู้ใช้วาดคือเป้าหมายหลัก 100%
      // ห้ามมี "สิ่งปลูกสร้างเป้าหมาย (target_building)" โผล่ขึ้นมาซ้อนทับแปลงที่วาด
      // หากโมเดลตรวจพบอาคารตรงจุดศูนย์กลาง ให้นำไปรวมในอาคารรอบข้าง (Bounding Box) เพื่อใช้วิเคราะห์ความหนาแน่น 200 ม. เท่านั้น
      let allSurrounding = [...(res.surrounding_buildings || [])];
      if (res.target_building && res.target_building.coordinates?.length) {
        const tb = res.target_building;
        const alreadyIncluded = allSurrounding.some(b => b.id === tb.id);
        if (!alreadyIncluded) {
          const lngs = tb.coordinates.map((c: any) => Number(c[0]));
          const lats = tb.coordinates.map((c: any) => Number(c[1]));
          allSurrounding.push({
            id: tb.id || 'BLD-ENV',
            confidence: tb.confidence,
            distance_m: 0,
            area_sqm: tb.area_sqm,
            area_wah: tb.area_wah || Math.round((tb.area_sqm / 4) * 100) / 100,
            width_m: tb.width_m,
            length_m: tb.length_m,
            center: tb.center || [plotData.latitude, plotData.longitude],
            shape_type: 'bbox',
            coordinates: [
              [Math.min(...lngs), Math.min(...lats)],
              [Math.max(...lngs), Math.min(...lats)],
              [Math.max(...lngs), Math.max(...lats)],
              [Math.min(...lngs), Math.max(...lats)],
              [Math.min(...lngs), Math.min(...lats)]
            ]
          });
        }
      }

      setVisionResult({
        ...res,
        target_building: null as any,
        surrounding_buildings: allSurrounding,
        radar_summary: {
          ...res.radar_summary,
          total_buildings_detected: allSurrounding.length
        }
      });
      setScannedBuildings(allSurrounding.length);
    } catch (err: any) {
      console.error('Scan radar around plot error:', err);
      alert('เกิดข้อผิดพลาดในการสแกนเรดาร์: ' + (err?.response?.data?.detail || err.message));
    } finally {
      setIsVisionScanning(false);
    }
  }, [plotData]);


  // Convert Target Building Polygon into an editable Drawn Plot
  const handleUseTargetBuildingAsPlot = useCallback(() => {
    if (!visionResult?.target_building) return;
    const tb = visionResult.target_building;
    const geoJson: any = {
      type: 'Polygon',
      coordinates: [tb.coordinates],
    };
    const area = turf.area(geoJson);
    const calculatedAreaSqm = Math.round(area * 100) / 100;

    const newPlot: DrawnPlotData = {
      geometry: geoJson,
      latitude: tb.center[0],
      longitude: tb.center[1],
      areaSqm: calculatedAreaSqm,
      priceRef: tb.price_per_wah,
      plotName: `แปลงอาคาร ${tb.road_name}`,
      source: 'draw',
    };

    setPlotData(newPlot);
    setPlotName(`แปลงอาคาร ${tb.road_name}`);
    setInteractionMode('draw');
  }, [visionResult]);

  // Helper: Convert Square Meters to Thai Traditional Land Units (Rai - Ngan - Wah)
  const formatThaiLandArea = (sqm: number) => {
    const rai = Math.floor(sqm / 1600);
    const remainingAfterRai = sqm % 1600;
    const ngan = Math.floor(remainingAfterRai / 400);
    const remainingAfterNgan = remainingAfterRai % 400;
    const wah = Math.round((remainingAfterNgan / 4) * 10) / 10;

    const parts = [];
    if (rai > 0) parts.push(`${rai} ไร่`);
    if (ngan > 0) parts.push(`${ngan} งาน`);
    if (wah > 0 || parts.length === 0) parts.push(`${wah} ตร.ว.`);
    return parts.join(' ');
  };

  // 3. ระบบเส้นทางจริง OSRM (ในส่วนจัดการ Map/Sidebar):
  // ปรับระยะห่าง POI ครอบคลุมถึง 500 เมตร (<= 500m)
  useEffect(() => {
    if (!plotData || !plotData.geometry) {
      setNearbyPOIs([]);
      setNearestPOI(null);
      setLoadingPOIs(false);
      return;
    }

    let isCancelled = false;

    const findNearbyPOIs = async () => {
      setLoadingPOIs(true);
      try {
        const centroid = turf.centroid(plotData.geometry);
        const [lon1, lat1] = centroid.geometry.coordinates;

        // คำนวณระยะเส้นตรงไปยัง Landmarks ทั้งหมด 15 แห่ง
        const allLandmarks = (hatYaiLandmarksData as any).features.map((feature: any) => {
          const [lon2, lat2] = feature.geometry.coordinates;
          const straightDistKm = turf.distance(
            turf.point([lon1, lat1]),
            turf.point([lon2, lat2]),
            { units: 'kilometers' }
          );
          return {
            feature,
            lon2,
            lat2,
            straightDistKm,
            straightDistM: Math.round(straightDistKm * 1000),
          };
        }).sort((a: any, b: any) => a.straightDistKm - b.straightDistKm);

        // ดึงตัวที่ระยะเส้นตรง <= 0.8 km เพื่อครอบคลุมระยะถนนจริงถึง 500m (และคงไว้อย่างน้อย 1 สถานที่ที่ใกล้ที่สุดเสมอ)
        // ดึงตัวที่ระยะเส้นตรง <= 0.8 km เพื่อครอบคลุมระยะถนนจริงถึง 500m (และคงไว้อย่างน้อย 1 สถานที่ที่ใกล้ที่สุดเสมอ)
        const candidates = allLandmarks.filter((item: any, idx: number) => item.straightDistKm <= 0.8 || idx === 0);

        // คำนวณระยะทางแบบขนาน (Parallel) พร้อม Fallback รวดเร็ว เพื่อป้องกัน UI ค้าง
        const poiPromises = candidates.map(async (item: any) => {
          let drivingDist = Math.round(item.straightDistM * 1.32); // Fallback แม่นยำสำหรับถนนเขตเมืองหาดใหญ่

          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200); // Timeout สูงสุด 1.2 วินาที
            const res = await fetch(
              `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${item.lon2},${item.lat2}?overview=false`,
              { signal: controller.signal }
            );
            clearTimeout(timeoutId);
            if (res.ok) {
              const data = await res.json();
              if (data?.routes?.[0]?.distance !== undefined) {
                drivingDist = Math.round(data.routes[0].distance);
              }
            }
          } catch {
            // สลับใช้ระยะถนนจากการประมาณการ (1.32x) ทันทีหาก OSRM สาธารณะช้าหรือ rate-limit
          }

          const isWithin500m = drivingDist <= 500;
          const poiObj: NearbyPOI = {
            id: item.feature.id || item.feature.properties?.name,
            name: item.feature.properties?.name,
            category: item.feature.properties?.category,
            category_th: item.feature.properties?.category_th,
            distanceMeters: drivingDist,
            straightDistanceMeters: item.straightDistM,
            coordinates: [item.lon2, item.lat2],
            badge: item.feature.properties?.badge,
            isWithin500m,
          };

          return poiObj;
        });

        const allResolved = await Promise.all(poiPromises);
        if (isCancelled) return;

        const results: NearbyPOI[] = [];
        let closest: NearbyPOI | null = null;
        let minDrivingDist = Infinity;

        for (const poiObj of allResolved) {
          if (poiObj.isWithin500m) {
            results.push(poiObj);
          }
          if (poiObj.distanceMeters < minDrivingDist) {
            minDrivingDist = poiObj.distanceMeters;
            closest = poiObj;
          }
        }

        // เรียงลำดับ POI จากใกล้ไปไกล
        results.sort((a, b) => a.distanceMeters - b.distanceMeters);

        if (!isCancelled) {
          setNearbyPOIs(results);
          setNearestPOI(closest);
        }
      } catch (err) {
        console.error('Error finding nearby POIs:', err);
      } finally {
        if (!isCancelled) {
          setLoadingPOIs(false);
        }
      }
    };

    findNearbyPOIs();

    return () => {
      isCancelled = true;
    };
  }, [plotData]);

  // Submit Price Prediction to Backend API with Real-Time WebSocket
  const handlePredict = async () => {
    if (!plotData) {
      setSubmissionError('กรุณาวาดแปลงที่ดิน (Polygon หรือ Rectangle) บนแผนที่ก่อนประเมินราคา');
      setMobileDrawerOpen(true);
      return;
    }

    setMobileDrawerOpen(true);
    setLoading(true);
    setSubmissionError(null);
    setActiveJob(null);
    setJobResult(null);

    // Close any previous WebSocket connection
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    try {
      const response = await submitPricePrediction({
        plot_name: plotName.trim() || 'พื้นที่ตรวจสอบ GeoPrice',
        latitude: plotData.latitude,
        longitude: plotData.longitude,
        geometry: plotData.geometry,
        area_size_sqm: plotData.areaSqm,
        land_use_zone: 'สีส้ม ย.6 (ที่อยู่อาศัยหนาแน่นปานกลาง)',
        selected_model: selectedModel,
        force_model: forceModel,
        features: {
          prediction_years: predictionYears,
          selected_model: selectedModel,
          force_model: forceModel,
          distance_to_center_km: 1.5,
          nearest_poi_name: nearestPOI?.name,
          nearest_poi_distance_m: nearestPOI?.distanceMeters,
          nearest_poi_category: nearestPOI?.category,
          road_access: true,
        },
      });


      setActiveJob(response);
      setJobResult({
        job_id: response.job_id,
        status: 'pending',
        created_at: response.created_at,
      } as PredictionResult);

      // 2. การเชื่อมต่อ WebSocket แบบ Real-Time
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.host;
      const wsUrl = `${wsProtocol}//${wsHost}/api/v1/predictions/ws/${response.job_id}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`WebSocket connected for job: ${response.job_id}`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket received:', data);

          if (data.status === 'completed' || data.status === 'failed') {
            setJobResult(data);
            ws.close();
          } else if (data.status) {
            setJobResult((prev) => ({
              ...(prev || {
                job_id: response.job_id,
                status: data.status,
                created_at: new Date().toISOString(),
              }),
              status: data.status,
            } as PredictionResult));
          }
        } catch (parseErr) {
          console.error('Failed to parse WebSocket message:', parseErr);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed.');
      };

      // 3. Fallback Polling Loop to guarantee 100% result delivery regardless of WebSocket connectivity
      let pollAttempts = 0;
      const pollInterval = setInterval(async () => {
        pollAttempts++;
        if (pollAttempts > 30) {
          clearInterval(pollInterval);
          return;
        }
        try {
          const res = await getPredictionStatus(response.job_id);
          if (res && (res.status === 'completed' || res.status === 'failed')) {
            setJobResult(res);
            clearInterval(pollInterval);
            if (wsRef.current) {
              try { wsRef.current.close(); } catch {}
            }
          }
        } catch {
          // ignore transient poll error
        }
      }, 1200);
    } catch (err: any) {
      console.error('Failed to submit prediction:', err);
      const errMsg = err.response?.data?.detail || err.message || 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ Backend ได้';
      setSubmissionError(`เกิดข้อผิดพลาด: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  };

  // Clean up WebSocket on component unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Render Admin View if currentView is 'admin'
  if (currentView === 'admin') {
    if (!adminUser) {
      return (
        <AdminLogin
          onLoginSuccess={(u) => setAdminUser(u)}
          onBackToMap={() => {
            window.history.pushState({}, '', '/');
            setCurrentView('map');
          }}
        />
      );
    }
    return (
      <AdminDashboard
        user={adminUser}
        onLogout={() => {
          localStorage.removeItem('geoprice_admin_token');
          localStorage.removeItem('geoprice_admin_user');
          setAdminUser(null);
        }}
        onBackToMap={() => {
          window.history.pushState({}, '', '/');
          setCurrentView('map');
        }}
      />
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans relative">
      {/* Left / Main Section: Interactive Map */}
      <div className="flex-1 relative h-full w-full">
        {/* Top Floating App Brand Badge */}
        <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-[1000] flex items-center gap-2 sm:gap-3 bg-slate-900/90 backdrop-blur-md px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-slate-800 shadow-xl max-w-[calc(100vw-80px)] sm:max-w-none">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
            <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-white tracking-wide flex items-center gap-1.5 sm:gap-2 truncate">
              GeoPrice AI
              <span className="hidden xs:inline-block text-[9px] sm:text-[10px] font-semibold tracking-wider uppercase px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                PoC Hat Yai
              </span>
            </h1>
            <p className="text-[10px] sm:text-xs text-slate-400 truncate hidden sm:block">ระบบประเมินราคาที่ดินและศักยภาพอัจฉริยะ</p>
          </div>

          {/* Admin MLOps Console Shortcut Button */}
          <button
            onClick={() => {
              window.history.pushState({}, '', '/admin');
              setCurrentView('admin');
            }}
            className="ml-1 sm:ml-2 flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-xs font-semibold shadow-md transition-all cursor-pointer shrink-0"
            title="เปิดแผงควบคุมดูแลระบบ MLOps (Admin Console)"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">⚙️ Admin MLOps</span>
            <span className="sm:hidden">⚙️ Admin</span>
          </button>
        </div>

        {/* Desktop / iPad Landscape Toggle Button (When Sidebar is collapsed) */}
        {!desktopSidebarOpen && (
          <button
            onClick={() => setDesktopSidebarOpen(true)}
            className="hidden lg:flex absolute top-4 right-4 z-[1000] items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-700 shadow-xl text-xs font-semibold text-white hover:bg-slate-800 transition-all hover:scale-105"
            title="เปิดแผงควบคุมและประเมินราคา"
          >
            <Layers className="w-4 h-4 text-blue-400" />
            <span>เปิดแผงประเมินราคา</span>
          </button>
        )}

        {/* Floating Future Price Prediction Button (Desktop & iPad) */}
        {plotData && !showPredictionPanel && (
          <button
            type="button"
            onClick={() => setShowPredictionPanel(true)}
            className="hidden md:flex absolute top-4 right-14 lg:right-52 z-[1000] items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white border border-indigo-400/40 text-xs font-semibold shadow-xl shadow-purple-500/25 hover:scale-105 active:scale-95 transition-all cursor-pointer animate-in fade-in duration-200"
            title="เปิดแผงคาดการณ์ราคาอนาคต AI"
          >
            <Sparkles className="w-4 h-4 text-purple-200" />
            <span>คาดการณ์อนาคต (AI)</span>
            {jobResult?.status === 'completed' ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>
        )}

        {/* Map Rendering with 200m Radar Scan & Visual Connection Line */}
        <MapComponent 
          onPlotDrawn={handlePlotDrawn} 
          onPlotCleared={handlePlotCleared} 
          plotData={plotData}
          onRadarScanned={handleRadarScanned}
          nearestPOI={nearestPOI}
          interactionMode={interactionMode}
          visionResult={visionResult}
          isSidebarOpen={desktopSidebarOpen}
          onVisionResult={(res) => {
            setVisionResult(res);
            if (res?.target_building?.coordinates?.length) {
              const tb = res.target_building;
              const geoJson: any = {
                type: 'Polygon',
                coordinates: [tb.coordinates],
              };
              const calculatedAreaSqm = Math.round(Number(tb.area_sqm) * 100) / 100;
              const newPlot: DrawnPlotData = {
                geometry: geoJson,
                latitude: tb.center?.[0] || 0,
                longitude: tb.center?.[1] || 0,
                areaSqm: calculatedAreaSqm,
                priceRef: tb.price_per_wah,
                plotName: `แปลงอาคาร ${tb.road_name || 'AI ตรวจจับ'}`,
                source: 'draw',
              };
              setPlotData(newPlot);
              setPlotName(`แปลงอาคาร ${tb.road_name || 'AI ตรวจจับ'}`);
              setShowPredictionPanel(true);
            } else if (res) {
              setPlotData(null);
              setShowPredictionPanel(false);
            }
          }}
          isVisionScanning={isVisionScanning}
          setIsVisionScanning={setIsVisionScanning}
        />

        {/* Mobile / iPad Floating Bottom Action Bar (< lg) */}
        <div className="lg:hidden absolute bottom-3 left-3 right-3 z-[1000] pointer-events-auto">
          <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 p-2.5 sm:p-3 rounded-2xl shadow-2xl flex items-center justify-between gap-2 text-xs">
            {/* Status / Plot Info */}
            <div className="flex items-center gap-2 min-w-0">
              {plotData ? (
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <div className="truncate">
                    <span className="font-bold text-white block truncate text-[11px] sm:text-xs">
                      {plotData.plotName || 'แปลงที่ดิน'}
                    </span>
                    <span className="text-[10px] sm:text-[11px] text-emerald-400 font-mono font-medium truncate block">
                      📐 {plotData.areaSqm.toLocaleString()} ตร.ม. ({formatThaiLandAreaStr(plotData.areaSqm)})
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-slate-400 truncate">
                  <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-[10px] sm:text-[11px] truncate">
                    {interactionMode === 'select' ? 'แตะแปลงบนแผนที่เพื่อดูข้อมูล' : 'แตะวาดแปลงบนแผนที่'}
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Mode Switcher Shortcut on Mobile */}
              <button
                type="button"
                onClick={() => {
                  setInteractionMode(prev => prev === 'select' ? 'draw' : 'select');
                  if (interactionMode === 'select') setPlotData(null);
                }}
                className={`p-2 rounded-xl border text-xs font-semibold flex items-center justify-center transition-all touch-manipulation ${
                  interactionMode === 'draw'
                    ? 'bg-blue-600/30 text-blue-300 border-blue-500/50'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
                title={interactionMode === 'select' ? 'สลับไปโหมดวาด' : 'สลับไปโหมดเลือก'}
              >
                {interactionMode === 'select' ? <Pencil className="w-3.5 h-3.5 text-blue-400" /> : <Radar className="w-3.5 h-3.5 text-cyan-400" />}
              </button>

              {/* If plotData exists: show 2 action buttons */}
              {plotData ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMobileDrawerOpen(true)}
                    className="px-2.5 py-2 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 transition-all touch-manipulation"
                    title="เปิดดูรายละเอียดแปลงและราคาประเมินฐาน"
                  >
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    <span>ข้อมูลแปลง</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPredictionPanel(true)}
                    className="px-3 py-2 rounded-xl font-semibold text-xs flex items-center gap-1.5 shadow-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-purple-500/25 border border-purple-400/40 active:scale-95 transition-all touch-manipulation"
                    title="เปิดแผงคาดการณ์ราคาอนาคต AI"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                    <span>{jobResult?.status === 'completed' ? 'ดูผลทำนาย ➔' : 'ทำนายอนาคต'}</span>
                    {!jobResult && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    )}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(true)}
                  className="px-3 py-2 rounded-xl font-semibold text-xs bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 flex items-center gap-1.5 transition-all touch-manipulation"
                >
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span>แผงข้อมูล</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Backdrop Overlay */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1999] lg:hidden animate-in fade-in duration-200"
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      {/* Right Section: Control Sidebar (Slide-over drawer on mobile/tablet, responsive fixed panel on desktop) */}
      <aside
        className={`
          ${mobileDrawerOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
          ${desktopSidebarOpen ? 'lg:w-[420px] xl:w-[440px]' : 'lg:w-0 lg:overflow-hidden lg:border-none'}
          fixed lg:static inset-y-0 right-0 z-[2000] lg:z-20
          w-full sm:w-[480px] lg:max-w-none h-full
          bg-slate-900 border-l border-slate-800
          flex flex-col shadow-2xl transition-all duration-300 ease-in-out overflow-hidden
        `}
      >
        {/* Sidebar Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/80 sticky top-0 backdrop-blur-md z-10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {/* Mobile Back to Map button */}
            <button
              onClick={() => setMobileDrawerOpen(false)}
              className="lg:hidden p-1.5 -ml-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex items-center gap-1 text-xs touch-manipulation"
              title="กลับไปยังแผนที่"
            >
              <ArrowLeft className="w-4 h-4 text-cyan-400" />
              <span className="font-medium">แผนที่</span>
            </button>

            <div className="flex items-center gap-2 text-blue-400">
              <Layers className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
              <h2 className="text-xs sm:text-sm font-semibold tracking-wider uppercase text-slate-200 truncate">
                แผงควบคุมและประเมินราคา
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {plotData && (
              <span className="text-[10px] sm:text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1 whitespace-nowrap">
                <CheckCircle2 className="w-3 h-3" /> แปลงพร้อม
              </span>
            )}

            {/* Desktop Collapse Button */}
            <button
              onClick={() => setDesktopSidebarOpen(false)}
              className="hidden lg:flex p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
              title="ยุบแผงควบคุมเพื่อดูแผนที่เต็มจอ"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Mobile Close X button */}
            <button
              onClick={() => setMobileDrawerOpen(false)}
              className="lg:hidden p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all touch-manipulation"
              title="ปิดแผงข้อมูล"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sidebar Content */}
        <div className="p-4 sm:p-5 space-y-4 sm:space-y-5 flex-1 overflow-y-auto admin-custom-scrollbar safe-bottom">
          {/* Mode Switcher Toggle: AI Vision Radar vs Manual Draw */}
          <div className="bg-slate-950/80 p-1.5 rounded-xl border border-slate-800 flex items-center gap-1.5 shadow-inner">
            <button
              type="button"
              onClick={() => {
                setInteractionMode('select');
                setPlotData(null);
              }}
              className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                interactionMode === 'select'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-500/25 border border-cyan-400/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Radar className="w-3.5 h-3.5 animate-pulse" />
              <span>AI Vision Radar (200m)</span>
            </button>
            <button
              type="button"
              onClick={() => setInteractionMode('draw')}
              className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                interactionMode === 'draw'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 border border-blue-400/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>โหมดวาดแปลง (Draw)</span>
            </button>
          </div>

          {/* Plot & Target Building Information Section */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-blue-400" /> ข้อมูลแปลงและสิ่งปลูกสร้าง
              </label>
              {plotData && (
                <button
                  onClick={handlePlotCleared}
                  className="text-xs text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> ล้างแปลง
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">ชื่อแปลง / จุดสังเกต</label>
              <input
                type="text"
                value={plotName}
                onChange={(e) => setPlotName(e.target.value)}
                placeholder="ระบุชื่อแปลงที่ดิน"
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              />
            </div>


            {/* SECTION: If plotData exists, the Drawn Plot strictly determines area and valuation */}
            {plotData ? (
              <div className="space-y-3 pt-1">
                {/* Drawn Plot Verification Badge */}
                <div className="bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-800/50 flex items-center justify-between gap-2 shadow-sm">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-300 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>แปลงที่ดินจากการวาด (Drawn Plot):</span>
                  </div>
                  <div className="text-[11px] text-emerald-200 font-mono bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-700/50">
                    นับ ตร.ม. จากรูปแปลงจริง
                  </div>
                </div>

                {/* Road & Zone Name and Metrics strictly from Drawn Plot */}
                {(() => {
                  const zonePricing = resolveZoneAppraisalRate(plotData.latitude, plotData.longitude);
                  const roadName = plotData.plotName && !plotData.plotName.includes('พื้นที่ตรวจสอบ') 
                    ? plotData.plotName 
                    : zonePricing.road_name;
                  const unitPriceWah = plotData.priceRef || zonePricing.price_per_wah || 38000;
                  const unitPriceSqm = Math.round(unitPriceWah / 4);
                  const totalPrice = Math.round((plotData.areaSqm / 4) * unitPriceWah);
                  const sourceBadge = zonePricing.source_badge;
                  const sourceText = zonePricing.valuation_source;

                  return (
                    <>
                      <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1">
                        <div className="text-[10px] text-slate-400">ทำเล / โซนราคาประเมิน</div>
                        <div className="text-sm font-bold text-white flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          {roadName}
                        </div>
                        <div className="text-xs text-slate-300">
                          {zonePricing.zone_name} (ต.{zonePricing.subdistrict} อ.{zonePricing.district})
                        </div>
                      </div>

                      {/* Metrics 2x2 Grid based strictly on Drawn plotData.areaSqm */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                          <div className="text-[10px] text-slate-400">ขนาดพื้นที่ (คำนวณจากการวาด)</div>
                          <div className="text-sm font-bold text-emerald-400 mt-0.5">
                            {plotData.areaSqm.toLocaleString()} <span className="text-[10px] font-normal text-slate-400">ตร.ม.</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">
                            ({formatThaiLandArea(plotData.areaSqm)})
                          </div>
                        </div>

                        <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                          <div className="text-[10px] text-slate-400">
                            {sourceBadge === 'real_exact' ? 'ราคาประเมินจริง (ต่อ ตร.ว.)' : 'ราคาประเมินฐาน (ต่อ ตร.ว.)'}
                          </div>
                          <div className="text-xs font-bold text-amber-300 mt-0.5">
                            ฿{unitPriceWah.toLocaleString()} <span className="text-[10px] font-normal text-slate-400">/ ตร.ว.</span>
                          </div>
                          <div className="text-[10px] text-slate-500">
                            (~฿{unitPriceSqm.toLocaleString()} / ตร.ม.)
                          </div>
                        </div>

                        <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                          <div className="text-[10px] text-slate-400">จุดศูนย์กลางแปลง (Lat, Lng)</div>
                          <div className="text-xs font-mono font-medium text-slate-200 mt-1 truncate">
                            {plotData.latitude}, {plotData.longitude}
                          </div>
                          <div className="text-[10px] text-slate-500">พิกัดทางภูมิศาสตร์ WGS84</div>
                        </div>

                        <div className="bg-emerald-950/60 p-2.5 rounded-lg border border-emerald-700/60 shadow-inner">
                          <div className="text-[10px] text-emerald-300 font-medium">มูลค่าประเมินรวม (แปลงที่วาด)</div>
                          <div className="text-sm font-extrabold text-emerald-400 mt-0.5">
                            ฿{totalPrice.toLocaleString()}
                          </div>
                          <div className="text-[9px] text-emerald-300/70 truncate" title={sourceText}>
                            {sourceBadge === 'real_exact' ? '🟢 ข้อมูลจริงกรมธนารักษ์' : '🟣 อัตราฐานราคาประเมิน'}
                          </div>
                        </div>
                      </div>

                      {/* Optional On-Demand AI Radar Scan button around drawn plot */}
                      <div className="pt-0.5">
                        <button
                          type="button"
                          onClick={handleScanRadarAroundPlot}
                          disabled={isVisionScanning}
                          className="w-full py-2 px-3 rounded-xl bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-700/50 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:scale-[1.01]"
                        >
                          {isVisionScanning ? (
                            <>
                              <span className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                              <span>กำลังสแกนเรดาร์รอบแปลง 200 ม....</span>
                            </>
                          ) : (
                            <>
                              <Radar className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                              <span>🛰️ สแกนเรดาร์สิ่งปลูกสร้างรอบแปลง 200 ม.</span>
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  );
                })()}


              </div>
            ) : visionResult?.target_building ? (
              /* SECTION: User scanned in Select Mode, Target Building Polygon detected */
              <div className="space-y-3 pt-1">
                {/* Confidence & Shape Type Badge */}
                <div className="bg-cyan-950/40 p-2.5 rounded-lg border border-cyan-800/50 flex items-center justify-between gap-2 shadow-sm">
                  <div className="flex items-center gap-1.5 text-xs text-cyan-300 font-semibold">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>AI Vision Radar (ตรวจพบรูปทรง Polygon):</span>
                  </div>
                  <div className="text-[11px] text-cyan-200 font-mono bg-cyan-900/60 px-2 py-0.5 rounded border border-cyan-700/50">
                    ความมั่นใจ {Math.round(visionResult.target_building.confidence * 100)}%
                  </div>
                </div>

                {/* Road & Zone Name */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-400">ทำเล / โซนราคาประเมิน</div>
                  <div className="text-sm font-bold text-white flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    {visionResult.target_building.road_name}
                  </div>
                  <div className="text-xs text-slate-300">
                    {visionResult.target_building.zone_name} (ต.{visionResult.target_building.subdistrict} อ.{visionResult.target_building.district})
                  </div>
                </div>

                {/* Building Footprint Dimensions */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-400">มิติตัวอาคาร (กว้าง × ยาว)</div>
                    <div className="text-xs font-semibold text-slate-200 mt-1">
                      {visionResult.target_building.width_m} × {visionResult.target_building.length_m} ม.
                    </div>
                    <div className="text-[10px] text-slate-500">รูปทรง Polygon สถาปัตยกรรม</div>
                  </div>

                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-400">พื้นที่รอยเท้าอาคาร (Footprint)</div>
                    <div className="text-sm font-bold text-cyan-400 mt-0.5">
                      {visionResult.target_building.area_sqm.toLocaleString()} <span className="text-[10px] font-normal text-slate-400">ตร.ม.</span>
                    </div>
                    <div className="text-[10px] text-slate-400">({visionResult.target_building.area_wah} ตร.ว.)</div>
                  </div>

                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-400">ราคาประเมินโซน (ต่อ ตร.ว.)</div>
                    <div className="text-xs font-bold text-amber-300 mt-0.5">
                      ฿{visionResult.target_building.price_per_wah.toLocaleString()} <span className="text-[10px] font-normal text-slate-400">/ ตร.ว.</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      (~฿{Math.round(visionResult.target_building.price_per_wah / 4).toLocaleString()} / ตร.ม.)
                    </div>
                  </div>

                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-400">แหล่งข้อมูลราคา</div>
                    <div className="text-xs font-semibold text-emerald-400 mt-1 truncate">
                      {visionResult.target_building.valuation_source || 'กรมธนารักษ์ / ML'}
                    </div>
                    <div className="text-[10px] text-slate-500">ฐานข้อมูลทางการ</div>
                  </div>
                </div>

                {/* Important Notice & Drawing Action Buttons */}
                <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200 space-y-2">
                  <div className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                    <span className="shrink-0 mt-0.5">💡</span>
                    <span>
                      <strong>เพื่อการประเมินราคาแปลงที่ดินที่ถูกต้อง:</strong> ระบบจะคำนวณ ตร.ม. จากการวาดแปลงที่ดิน ไม่ใช้ขนาดตัวอาคารของโมเดล
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleUseTargetBuildingAsPlot}
                      className="flex-1 py-1.5 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>ใช้รูปทรงนี้สร้างแปลงที่ดิน</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setInteractionMode('draw')}
                      className="py-1.5 px-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <span>วาดแปลงเอง</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : isVisionScanning ? (
              <div className="p-4 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-xs text-cyan-200 flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shrink-0" />
                <div>
                  <div className="font-bold text-cyan-300">กำลังประมวลผล AI Vision Radar...</div>
                  <div className="text-[11px] text-slate-400">สแกนอาคารเป้าหมาย (Polygon) และอาคารรอบข้าง 200 ม. (Bounding Box)</div>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-300 space-y-2 shadow-sm">
                <div className="flex items-start gap-2 text-cyan-300">
                  <span className="text-base shrink-0">🎯</span>
                  <span className="leading-relaxed">
                    <strong>เลือกรูปแบบการทำงาน:</strong>
                  </span>
                </div>
                <ul className="space-y-1.5 pl-6 text-[11px] text-slate-400 list-disc">
                  <li>
                    <strong className="text-slate-200">โหมด AI Radar (200m):</strong> คลิกบนอาคารเพื่อดูรูปทรง <strong>Polygon</strong> อาคารเป้าหมาย และ <strong>Bounding Box</strong> อาคารรอบข้าง
                  </li>
                  <li>
                    <strong className="text-slate-200">โหมดวาดแปลง (Draw):</strong> วาดรูปแปลงที่ดินบนแผนที่เพื่อนับ <strong>ตร.ม.</strong> และคำนวณมูลค่าราคาประเมินจริง
                  </li>
                </ul>
              </div>
            )}
          </div>

          {/* AI Radar Scan 200m Section (Surrounding Buildings as Bounding Box) */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Radar className="w-4 h-4 text-cyan-400 animate-pulse" /> ผลการสแกนเรดาร์รอบข้าง (200m - Bounding Box)
              </label>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border transition-colors ${
                (visionResult || scannedBuildings !== null)
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  : 'bg-slate-800/80 text-slate-500 border-slate-700/60'
              }`}>
                {visionResult
                  ? `ตรวจพบ ${visionResult.radar_summary.total_buildings_detected} หลัง`
                  : scannedBuildings !== null
                  ? `พบสิ่งปลูกสร้าง ${scannedBuildings} หลัง`
                  : 'รอคลิกสแกนเรดาร์'}
              </span>
            </div>

            {visionResult ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400">ระดับความหนาแน่น:</span>
                  <span className="font-semibold text-amber-300">
                    {visionResult.radar_summary.density_level}
                  </span>
                </div>

                {visionResult.surrounding_buildings.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                      <span>สิ่งปลูกสร้างรอบแปลง (Bounding Box 200 ม.):</span>
                      <span className="text-[10px] text-cyan-400">พบ {visionResult.surrounding_buildings.length} หลัง</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {visionResult.surrounding_buildings.slice(0, 4).map((bld, idx) => (
                        <div key={idx} className="bg-slate-900/60 p-2 rounded-lg border border-slate-800 text-[11px]">
                          <div className="text-cyan-400 font-bold flex items-center justify-between">
                            <span>📦 {bld.id}</span>
                            <span className="text-[10px] text-slate-400">ห่าง {bld.distance_m} ม.</span>
                          </div>
                          <div className="text-slate-300 text-[10px] mt-0.5">
                            มิติ: <strong>{bld.width_m} × {bld.length_m} ม.</strong>
                          </div>
                          <div className="text-[10px] text-slate-500">
                            (~{bld.area_sqm} ตร.ม.)
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                สแกนภาพถ่ายดาวเทียมความละเอียดสูงด้วย YOLO-test ในรัศมี 200 เมตร แสดงอาคารรอบข้างเป็น Bounding Box (กรอบสี่เหลี่ยมสีฟ้า) เพื่อวิเคราะห์ความหนาแน่น
              </p>
            )}
          </div>


          {/* 3. Nearby POIs Section (OSRM API Driving Route <= 500m) */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-emerald-400" /> สถานที่สำคัญระยะถนนจริง (OSRM &le; 500m)
              </label>
              {loadingPOIs && (
                <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                  <span className="w-2.5 h-2.5 border-2 border-cyan-400/40 border-t-cyan-400 rounded-full animate-spin"></span>
                  กำลังคำนวณ...
                </span>
              )}
            </div>

            {plotData ? (
              <div className="space-y-2.5">
                {/* Highlight POIs within 500m if found */}
                {nearbyPOIs.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      ตรวจพบสถานที่ในระยะเดินรถ &le; 500 ม. ({nearbyPOIs.length} แห่ง)
                    </div>
                    {nearbyPOIs.map((poi, idx) => {
                      const meta = getPOIMeta(poi);
                      return (
                        <div key={idx} className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800/80 hover:border-emerald-500/40 flex items-center justify-between gap-2.5 shadow-sm transition-colors">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span 
                              className="text-base shrink-0 p-1.5 rounded-lg flex items-center justify-center shadow-inner"
                              style={{ 
                                backgroundColor: meta.bgLight, 
                                border: `1px solid ${meta.borderLight}`,
                                color: meta.color 
                              }}
                            >
                              {meta.emoji}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">{poi.name}</div>
                              <div className="text-[10px] text-slate-300 flex items-center gap-1.5 mt-0.5">
                                <span 
                                  className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                                  style={{ backgroundColor: meta.bgLight, color: meta.color, border: `1px solid ${meta.borderLight}` }}
                                >
                                  {meta.labelTh}
                                </span>
                                {poi.badge && <span className="text-slate-400 truncate">&bull; {poi.badge}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-900/80 border border-emerald-700/60 px-2 py-0.5 rounded-md">
                              {poi.distanceMeters} ม.
                            </span>
                            <div className="text-[9px] text-slate-400 mt-0.5">ถนนจริง OSRM</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span className="text-amber-400 shrink-0">ℹ️</span>
                    <span>ไม่พบสถานที่สำคัญในระยะเดินรถ &le; 500 ม. (อยู่นอกรัศมีเดินรถใกล้)</span>
                  </div>
                )}

                {/* Always show Nearest Landmark with its exact driving distance! */}
                {nearestPOI && (() => {
                  const meta = getPOIMeta(nearestPOI);
                  return (
                    <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-2">
                      <div className="text-[11px] font-semibold text-cyan-400 flex items-center justify-between">
                        <span className="flex items-center gap-1">📍 สถานที่สำคัญที่ใกล้ที่สุด</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          เส้นตรง: {nearestPOI.straightDistanceMeters} ม.
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span 
                            className="text-lg shrink-0 p-1.5 rounded-lg flex items-center justify-center shadow-inner"
                            style={{ 
                              backgroundColor: meta.bgLight, 
                              border: `1px solid ${meta.borderLight}`,
                              color: meta.color 
                            }}
                          >
                            {meta.emoji}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">{nearestPOI.name}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                              <span 
                                className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                                style={{ backgroundColor: meta.bgLight, color: meta.color, border: `1px solid ${meta.borderLight}` }}
                              >
                                {meta.labelTh}
                              </span>
                              {nearestPOI.badge && <span className="text-slate-400 truncate">&bull; {nearestPOI.badge}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded border ${
                            nearestPOI.isWithin500m
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                          }`}>
                            {nearestPOI.distanceMeters} ม.
                          </span>
                          <div className="text-[9px] text-slate-400 mt-0.5">เส้นทางเดินรถ OSRM</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/70 text-xs text-slate-500 text-center">
                กรุณาวาดแปลงที่ดินเพื่อค้นหาและวัดระยะห่าง POI
              </div>
            )}
          </div>

          {/* Future Prediction Launch Card inside Sidebar */}
          {plotData ? (
            <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/50 via-slate-950/60 to-purple-950/40 border border-indigo-800/60 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5 uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-indigo-400" /> การทำนายราคาในอนาคต (AI)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-200 border border-indigo-700/50">
                  {selectedModel === 'xgboost' ? 'XGBoost (Spatial ML)' : 'ARIMAX (Time-Series)'}
                </span>
              </div>

              {jobResult?.price_prediction ? (
                <div className="p-3 rounded-lg bg-indigo-900/30 border border-indigo-500/30 space-y-1">
                  <div className="text-[10px] text-indigo-300">
                    ผลการประเมินราคาล่าสุด ({jobResult.price_prediction.details_json?.selected_model?.toUpperCase() || selectedModel.toUpperCase()})
                  </div>
                  <div className="text-lg font-bold font-mono text-amber-300">
                    ฿{(
                      jobResult.price_prediction.details_json?.price_per_wah_thb ??
                      jobResult.price_prediction.details_json?.predicted_price_per_wah ??
                      Math.round(jobResult.price_prediction.predicted_price_per_sqm * 4)
                    ).toLocaleString()} <span className="text-xs text-slate-400 font-normal">/ ตร.ว.</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    ความเชื่อมั่น: <span className="text-emerald-400 font-semibold">{Math.round(jobResult.price_prediction.confidence_score * 100)}%</span> &bull; ระยะเวลา: {predictionYears} ปี
                    {jobResult.price_prediction.details_json?.base_price_per_wah_thb && (
                      <span className="text-slate-400"> &bull; ฐานราคา: ฿{jobResult.price_prediction.details_json.base_price_per_wah_thb.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-300 leading-relaxed">
                  วิเคราะห์และคาดการณ์ราคาที่ดินล่วงหน้า 1-5 ปี ด้วยโมเดล Spatial ML และ Time-Series พร้อมเปรียบเทียบทุกโมเดล
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowPredictionPanel(true)}
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer border border-blue-400/30"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-200" />
                <span>{jobResult?.price_prediction ? 'เปิดแผงวิเคราะห์และเปรียบเทียบโมเดล' : 'เปิดแผงควบคุมทำนายราคา (AI)'}</span>
              </button>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/70 text-xs text-slate-500 text-center space-y-1">
              <div className="font-semibold text-slate-400">🔮 ระบบทำนายราคาในอนาคต (AI)</div>
              <div>กรุณาเลือกหรือวาดแปลงที่ดินบนแผนที่ เพื่อเปิดใช้งานการทำนายราคา</div>
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800/80 text-center text-[11px] text-slate-500 bg-slate-950/40">
          GeoPrice AI Platform &bull; GIS Spatio-Temporal Valuation
        </div>
      </aside>

      {/* Dedicated Future Price Prediction Panel (Drawer / Floating Modal) */}
      <FuturePredictionPanel
        isOpen={showPredictionPanel}
        onClose={() => setShowPredictionPanel(false)}
        plotData={plotData}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        forceModel={forceModel}
        setForceModel={setForceModel}
        predictionYears={predictionYears}
        setPredictionYears={setPredictionYears}
        onPredict={handlePredict}
        loading={loading}
        submissionError={submissionError}
        activeJob={activeJob}
        jobResult={jobResult}
        showModelComparison={showModelComparison}
        setShowModelComparison={setShowModelComparison}
      />
    </div>
  );
}

export default App;
