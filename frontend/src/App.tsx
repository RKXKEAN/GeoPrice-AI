import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  MapPin, 
  Layers, 
  Clock, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  RotateCcw,
  Building2,
  TrendingUp,
  Cpu,
  Radar,
  Navigation,
  Radio,
  Pencil,
  Sliders,
  BarChart3,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

import * as turf from '@turf/turf';
import hatYaiLandmarksData from './data/hatyai_landmarks.json';
import { MapComponent } from './components/MapComponent';
import type { DrawnPlotData } from './components/MapComponent';
import { AdminLogin } from './components/AdminLogin';
import { AdminDashboard } from './components/AdminDashboard';
import type { AdminUser } from './services/adminApi';
import { submitPricePrediction, getPredictionStatus, scanVisionRadar } from './services/api';
import { resolveZoneAppraisalRate } from './services/zonePricing';
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

  // Plot state
  const [plotData, setPlotData] = useState<DrawnPlotData | null>(null);
  const [plotName, setPlotName] = useState('พื้นที่ตรวจสอบ GeoPrice');
  const [landUseZone, setLandUseZone] = useState('สีส้ม ย.6 (ที่อยู่อาศัยหนาแน่นปานกลาง)');
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
      return;
    }
    setPlotData(data);
    if (data.plotName) {
      setPlotName(data.plotName);
    }
    setSubmissionError(null);
    setVisionResult(null);
    setScannedBuildings(null);
  }, []);

  const handlePlotCleared = useCallback(() => {
    setPlotData(null);
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
          const lats = tb.coordinates.map((c: any) => c[0]);
          const lngs = tb.coordinates.map((c: any) => c[1]);
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
              [Math.min(...lats), Math.min(...lngs)],
              [Math.max(...lats), Math.min(...lngs)],
              [Math.max(...lats), Math.max(...lngs)],
              [Math.min(...lats), Math.max(...lngs)],
              [Math.min(...lats), Math.min(...lngs)]
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
      return;
    }

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
        land_use_zone: landUseZone,
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
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Left / Main Section: Interactive Map */}
      <div className="flex-1 relative h-full">
        {/* Top Floating App Brand Badge */}
        <div className="absolute top-4 left-4 z-[1000] flex items-center gap-3 bg-slate-900/90 backdrop-blur-md px-4 py-2.5 rounded-xl border border-slate-800 shadow-xl">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
              GeoPrice AI
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                PoC Hat Yai
              </span>
            </h1>
            <p className="text-xs text-slate-400">ระบบประเมินราคาที่ดินและศักยภาพอัจฉริยะ</p>
          </div>

          {/* Admin MLOps Console Shortcut Button */}
          <button
            onClick={() => {
              window.history.pushState({}, '', '/admin');
              setCurrentView('admin');
            }}
            className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-xs font-semibold shadow-md transition-all cursor-pointer"
            title="เปิดแผงควบคุมดูแลระบบ MLOps (Admin Console)"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>⚙️ Admin MLOps</span>
          </button>
        </div>

        {/* Map Rendering with 200m Radar Scan & Visual Connection Line */}
        <MapComponent 
          onPlotDrawn={handlePlotDrawn} 
          onPlotCleared={handlePlotCleared} 
          plotData={plotData}
          onRadarScanned={handleRadarScanned}
          nearestPOI={nearestPOI}
          interactionMode={interactionMode}
          visionResult={visionResult}
          onVisionResult={(res) => {
            setVisionResult(res);
            if (res) {
              setPlotData(null);
            }
          }}
          isVisionScanning={isVisionScanning}
          setIsVisionScanning={setIsVisionScanning}
        />
      </div>

      {/* Right Section: Control Sidebar */}
      <div className="w-[420px] max-w-full h-full bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl z-20 overflow-y-auto">
        {/* Sidebar Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/60 sticky top-0 backdrop-blur-sm z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-400">
              <Layers className="w-5 h-5" />
              <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300">
                แผงควบคุมและประเมินราคา
              </h2>
            </div>
            {plotData && (
              <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> แปลงที่ดินพร้อม
              </span>
            )}
          </div>
        </div>

        {/* Sidebar Content */}
        <div className="p-5 space-y-5 flex-1">
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

            <div>
              <label className="block text-xs text-slate-400 mb-1">ผังเมือง / เขตการใช้ประโยชน์ที่ดิน</label>
              <select
                value={landUseZone}
                onChange={(e) => setLandUseZone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              >
                <option value="สีส้ม ย.6 (ที่อยู่อาศัยหนาแน่นปานกลาง)">สีส้ม ย.6 (ที่อยู่อาศัยหนาแน่นปานกลาง)</option>
                <option value="สีแดง พ.3 (พาณิชยกรรม)">สีแดง พ.3 (พาณิชยกรรม)</option>
                <option value="สีเหลือง ย.3 (ที่อยู่อาศัยหนาแน่นน้อย)">สีเหลือง ย.3 (ที่อยู่อาศัยหนาแน่นน้อย)</option>
                <option value="สีม่วง อ.1 (อุตสาหกรรมและคลังสินค้า)">สีม่วง อ.1 (อุตสาหกรรมและคลังสินค้า)</option>
                <option value="สีเขียว ก.4 (เกษตรกรรมและชนบท)">สีเขียว ก.4 (เกษตรกรรมและชนบท)</option>
              </select>
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
                      <span>สิ่งปลูกสร้างใกล้เคียง (Bounding Box):</span>
                      <span className="text-[10px] text-cyan-400">สแกนครอบคลุม 200 ม.</span>
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
                สแกนภาพถ่ายดาวเทียมความละเอียดสูงด้วย YOLOv8 (best.pt) ในรัศมี 200 เมตร แสดงอาคารรอบข้างเป็น Bounding Box (กรอบสี่เหลี่ยมสีฟ้า) เพื่อวิเคราะห์ความหนาแน่น
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
                    {nearbyPOIs.map((poi, idx) => (
                      <div key={idx} className="bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-800/50 flex items-center justify-between gap-2 shadow-sm">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{poi.name}</div>
                          <div className="text-[10px] text-slate-300 flex items-center gap-1.5 mt-0.5">
                            <span className="px-1.5 py-0.5 bg-emerald-900/60 text-emerald-300 rounded text-[9px]">{poi.category_th}</span>
                            {poi.badge && <span className="text-slate-400">&bull; {poi.badge}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-900/80 border border-emerald-700/60 px-2 py-0.5 rounded-md">
                            {poi.distanceMeters} ม.
                          </span>
                          <div className="text-[9px] text-slate-400 mt-0.5">ถนนจริง OSRM</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span className="text-amber-400 shrink-0">ℹ️</span>
                    <span>ไม่พบสถานที่สำคัญในระยะเดินรถ &le; 500 ม. (อยู่นอกรัศมีเดินรถใกล้)</span>
                  </div>
                )}

                {/* Always show Nearest Landmark with its exact driving distance! */}
                {nearestPOI && (
                  <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="text-[11px] font-semibold text-cyan-400 flex items-center justify-between">
                      <span className="flex items-center gap-1">📍 สถานที่สำคัญที่ใกล้ที่สุด</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        เส้นตรง: {nearestPOI.straightDistanceMeters} ม.
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{nearestPOI.name}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          หมวดหมู่: <span className="text-slate-200">{nearestPOI.category_th}</span> {nearestPOI.badge && `(${nearestPOI.badge})`}
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
                )}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/70 text-xs text-slate-500 text-center">
                กรุณาวาดแปลงที่ดินเพื่อค้นหาและวัดระยะห่าง POI
              </div>
            )}
          </div>

          {/* AI Model Selection Card for Land Valuation (XGBoost vs ARIMAX) */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-cyan-400" /> โมเดลประเมินราคาที่ดิน (Algorithm)
              </label>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-white/10">
                {selectedModel === 'xgboost'
                  ? 'R² 0.968 (Spatial ML)'
                  : 'AIC 230.7 (Time-Series)'}
              </span>
            </div>

            {/* Model Selection 2 Columns */}
            <div className="grid grid-cols-2 gap-2.5">
              {[
                {
                  id: 'xgboost',
                  name: 'XGBoost Regressor',
                  badge: 'Spatial ML',
                  metric: 'R² 0.968',
                  desc: 'วิเคราะห์เชิงพื้นที่ 17 ปัจจัย + รัศมีอาคาร 200 ม.',
                  tag: 'เหมาะกับแปลงเจาะจง & ซื้อขาย',
                  activeColor: 'border-cyan-500/80 bg-cyan-950/40 text-cyan-300 ring-1 ring-cyan-500/30'
                },
                {
                  id: 'arimax',
                  name: 'ARIMAX (1,1,0)',
                  badge: 'Econometrics',
                  metric: 'AIC 230.7',
                  desc: 'วิเคราะห์อนุกรมเวลา 17 ปี + อัตราเงินเฟ้อ',
                  tag: 'เหมาะกับวางแผนระยะยาว & ลงทุน',
                  activeColor: 'border-emerald-500/80 bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-500/30'
                },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModel(m.id as any)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    selectedModel === m.id
                      ? `${m.activeColor} shadow-md`
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-xs font-bold text-white truncate">{m.name}</span>
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 font-semibold ${
                        selectedModel === m.id ? 'bg-white/15 text-white' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {m.metric}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-300 leading-snug">{m.desc}</div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[9px]">
                    <span className="text-slate-400">{m.tag}</span>
                    <span className={`px-1.5 py-0.2 rounded font-mono ${
                      selectedModel === m.id ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500'
                    }`}>
                      {m.badge}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Checkbox: Force ML Model */}
            <label className="flex items-start gap-2 pt-1 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={forceModel}
                onChange={(e) => setForceModel(e.target.checked)}
                className="mt-0.5 w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-0 cursor-pointer"
              />
              <span className="text-[11px] text-slate-400 leading-tight">
                บังคับใช้โมเดลเพื่อตรวจสอบและวัดความคลาดเคลื่อน (Residual Error) เทียบกับราคาจริงกรมธนารักษ์
              </span>
            </label>
          </div>

          {/* Prediction Horizon Slider (1-5 Years) */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">

            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-400" /> ระยะเวลาคาดการณ์ราคา
              </label>
              <span className="text-sm font-bold text-blue-400 bg-blue-500/10 px-2.5 py-0.5 rounded-md border border-blue-500/20">
                {predictionYears} ปีข้างหน้า
              </span>
            </div>

            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={predictionYears}
              onChange={(e) => setPredictionYears(parseInt(e.target.value, 10))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
            />

            <div className="flex justify-between text-[11px] font-medium text-slate-500 px-1">
              {[1, 2, 3, 4, 5].map((year) => (
                <span
                  key={year}
                  onClick={() => setPredictionYears(year)}
                  className={`cursor-pointer transition-colors ${
                    predictionYears === year ? 'text-blue-400 font-bold' : 'hover:text-slate-300'
                  }`}
                >
                  {year} ปี
                </span>
              ))}
            </div>
          </div>

          {/* Action Button: Predict Price */}
          <div>
            <button
              onClick={handlePredict}
              disabled={loading || !plotData}
              className={`w-full py-3.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${
                !plotData
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                  : loading
                  ? 'bg-blue-600/80 text-white cursor-wait animate-pulse'
                  : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/25 active:scale-[0.99] border border-blue-400/20'
              }`}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>กำลังส่งคำขอเข้าสู่คิว AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-blue-200" />
                  <span>ประเมินราคา (GeoPrice)</span>
                </>
              )}
            </button>
          </div>

          {/* Submission Error Banner */}
          {submissionError && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{submissionError}</span>
            </div>
          )}

          {/* Job Queue Status & Response Details (Real-Time WebSocket) */}
          {activeJob && (
            <div className="bg-slate-950/80 rounded-xl border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  สถานะการประมวลผล
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Radio className="w-3 h-3 text-cyan-400 animate-pulse" /> WebSocket
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      jobResult?.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : jobResult?.status === 'failed'
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
                    }`}
                  >
                    {jobResult?.status === 'completed'
                      ? 'ประเมินราคาเสร็จสมบูรณ์'
                      : jobResult?.status === 'failed'
                      ? 'การประเมินล้มเหลว'
                      : 'กำลังประมวลผล (Real-Time)'}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Job ID:</span>
                  <span className="font-mono text-slate-200 text-[11px] truncate max-w-[200px]" title={activeJob.job_id}>
                    {activeJob.job_id}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>ข้อความ:</span>
                  <span className="text-slate-300 text-right">{activeJob.message}</span>
                </div>
              </div>

              {/* Completed Price Prediction Display */}
              {jobResult?.price_prediction && (
                <div className="mt-3 pt-3 border-t border-slate-800/80 bg-blue-950/30 -mx-4 -mb-4 p-4 rounded-b-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                      <TrendingUp className="w-4 h-4" />
                      ผลการประเมินราคาที่ดิน ({predictionYears} ปีข้างหน้า - ปี {2026 + predictionYears})
                    </div>
                    {(jobResult.price_prediction.details_json?.total_growth_pct ?? 0) > 0 && (
                      <span className="text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 px-2 py-0.5 rounded-full">
                        +{jobResult.price_prediction.details_json?.total_growth_pct}%
                      </span>
                    )}
                  </div>

                  {jobResult.price_prediction.details_json?.valuation_source && (
                    <div className="text-[10px] text-slate-400 bg-slate-900/60 p-1.5 rounded border border-slate-800 flex items-center gap-1.5">
                      <span>{jobResult.price_prediction.details_json.source_badge === 'real_exact' ? '🟢' : '🟣'}</span>
                      <span className="truncate">{jobResult.price_prediction.details_json.valuation_source}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <div className="text-[10px] text-slate-400">ราคาเฉลี่ย / ตร.ม. (ปี {2026 + predictionYears})</div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        ฿{jobResult.price_prediction.predicted_price_per_sqm.toLocaleString()}
                      </div>
                      {jobResult.price_prediction.details_json?.base_price_per_sqm_thb && (
                        <div className="text-[9px] text-slate-500 mt-0.5">
                          ปัจจุบัน ฿{jobResult.price_prediction.details_json.base_price_per_sqm_thb.toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <div className="text-[10px] text-slate-400">มูลค่ารวมทั้งแปลง (ปี {2026 + predictionYears})</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        ฿{jobResult.price_prediction.total_predicted_price.toLocaleString()}
                      </div>
                      {(jobResult.price_prediction.details_json?.appreciation_gain_thb ?? 0) > 0 && (
                        <div className="text-[9px] text-emerald-400/80 mt-0.5 font-medium">
                          +฿{jobResult.price_prediction.details_json?.appreciation_gain_thb?.toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Multi-Year Timeline pills if available */}
                  {jobResult.price_prediction.details_json?.forecast_timeline && (
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                        <span>ไทม์ไลน์คาดการณ์ราคาอนาคต ({jobResult.price_prediction.details_json?.selected_model?.toUpperCase() || 'ML'}):</span>
                        <span className="text-[9px] text-cyan-400 font-mono">
                          {jobResult.price_prediction.details_json?.selected_model === 'arimax' ? '95% CI Bands' : '±MAE Bounds'}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-center">
                        {jobResult.price_prediction.details_json.forecast_timeline.slice(0, 4).map((f: any) => (
                          <div key={f.calendar_year} className={`p-1.5 rounded text-[9px] transition-all ${
                            f.year_offset === predictionYears
                              ? 'bg-blue-600/30 text-blue-200 border border-blue-500/50 font-bold shadow-sm'
                              : 'bg-slate-800/40 text-slate-400'
                          }`}>
                            <div className="text-[10px] font-semibold">{f.calendar_year}</div>
                            <div className="font-mono mt-0.5 text-white">฿{Math.round(f.price_per_sqm / 1000)}k</div>
                            {f.growth_pct > 0 && (
                              <div className="text-emerald-400 text-[8.5px] font-semibold">+{f.growth_pct}%</div>
                            )}
                            {f.lower_bound_wah && f.upper_bound_wah && f.lower_bound_wah !== f.upper_bound_wah && (
                              <div className="text-[7.5px] text-slate-400/80 mt-0.5 font-mono truncate" title={`ช่วงความเชื่อมั่น: ฿${f.lower_bound_wah.toLocaleString()} - ฿${f.upper_bound_wah.toLocaleString()}`}>
                                ±{Math.round((f.upper_bound_wah - f.price_per_wah) / 1000)}k
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Multi-Model Inspection & Variance Table */}
                  {jobResult.price_prediction.details_json?.model_comparisons && (
                    <div className="bg-slate-900/90 rounded-xl border border-slate-800 p-3 space-y-2">
                      <div 
                        onClick={() => setShowModelComparison(!showModelComparison)}
                        className="flex items-center justify-between cursor-pointer select-none py-0.5"
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400">
                          <BarChart3 className="w-3.5 h-3.5" />
                          <span>เปรียบเทียบ 2 โมเดล (XGBoost vs ARIMAX)</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                          <span>{showModelComparison ? 'ซ่อน' : 'แสดงตาราง'}</span>
                          {showModelComparison ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </div>
                      </div>

                      {showModelComparison && (
                        <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                          <div className="grid grid-cols-4 text-[10px] font-semibold text-slate-400 pb-1 px-1">
                            <div>โมเดล</div>
                            <div className="text-right">ราคา/ตร.ว.</div>
                            <div className="text-right">ตัวชี้วัด</div>
                            <div className="text-right">ส่วนต่าง</div>
                          </div>

                          {Object.values(jobResult.price_prediction.details_json.model_comparisons).map((m: any) => {
                            const isCurrentSelected = jobResult.price_prediction?.details_json?.selected_model === m.id || 
                              (m.id === 'xgboost' && (!jobResult.price_prediction?.details_json?.selected_model || jobResult.price_prediction?.details_json?.selected_model === 'xgboost'));
                            return (
                              <div 
                                key={m.id}
                                className={`grid grid-cols-4 items-center text-[10px] p-2 rounded transition-colors ${
                                  isCurrentSelected ? 'bg-cyan-950/40 border border-cyan-800/60 font-semibold' : 'hover:bg-slate-800/40'
                                }`}
                              >
                                <div className="truncate text-slate-200" title={m.name}>
                                  <div className="font-semibold text-white">{m.short_name || m.name}</div>
                                  <div className="text-[9px] text-slate-400 truncate">{m.model_type || m.tag}</div>
                                </div>
                                <div className="text-right font-mono text-amber-300 font-bold">
                                  ฿{m.price_per_wah?.toLocaleString()}
                                </div>
                                <div className="text-right font-mono text-slate-300 text-[9.5px]">
                                  {m.metric_value || m.r2}
                                </div>
                                <div className="text-right font-mono">
                                  {m.diff_from_xgboost_pct === 0 || m.diff_from_ensemble_pct === 0 ? (
                                    <span className="text-slate-500">ฐาน (0%)</span>
                                  ) : (m.diff_from_xgboost_pct ?? m.diff_from_ensemble_pct) > 0 ? (
                                    <span className="text-rose-400">+{(m.diff_from_xgboost_pct ?? m.diff_from_ensemble_pct)}%</span>
                                  ) : (
                                    <span className="text-emerald-400">{(m.diff_from_xgboost_pct ?? m.diff_from_ensemble_pct)}%</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {/* Official ground truth residual comparison if available */}
                          {jobResult.price_prediction.details_json?.official_ground_truth && (
                            <div className="mt-2 p-2 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-[10px] text-emerald-300 space-y-0.5">
                              <div className="font-semibold flex items-center justify-between">
                                <span>🎯 เทียบราคาจริงกรมธนารักษ์ (Residual):</span>
                                <span className="font-mono">฿{jobResult.price_prediction.details_json.official_ground_truth.price_per_wah?.toLocaleString()} / ตร.ว.</span>
                              </div>
                              <div className="text-slate-300 text-[9px]">
                                {jobResult.price_prediction.details_json.official_ground_truth.note} (แปลง {jobResult.price_prediction.details_json.official_ground_truth.parcel_id})
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>ความเชื่อมั่นโมเดล:</span>
                    <span className="font-mono font-semibold text-blue-300">
                      {Math.round(jobResult.price_prediction.confidence_score * 100)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800/80 text-center text-[11px] text-slate-500 bg-slate-950/40">
          GeoPrice AI Platform &bull; GIS Spatio-Temporal Valuation
        </div>
      </div>
    </div>
  );
}

export default App;
