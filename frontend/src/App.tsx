import { useState, useCallback, useEffect } from 'react';
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
  Cpu
} from 'lucide-react';
import { MapComponent } from './components/MapComponent';
import type { DrawnPlotData } from './components/MapComponent';
import { 
  submitPricePrediction, 
  getPredictionStatus 
} from './services/api';
import type {
  PredictionJobResponse, 
  PredictionResult 
} from './services/api';

export function App() {
  // Plot state
  const [plotData, setPlotData] = useState<DrawnPlotData | null>(null);
  const [plotName, setPlotName] = useState('พื้นที่ตรวจสอบ GeoPrice');
  const [landUseZone, setLandUseZone] = useState('สีส้ม ย.6 (ที่อยู่อาศัยหนาแน่นปานกลาง)');
  const [predictionYears, setPredictionYears] = useState(1);

  // Submission & Job tracking state
  const [loading, setLoading] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<PredictionJobResponse | null>(null);
  const [jobResult, setJobResult] = useState<PredictionResult | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const handlePlotDrawn = useCallback((data: DrawnPlotData) => {
    setPlotData(data);
    setSubmissionError(null);
  }, []);

  const handlePlotCleared = useCallback(() => {
    setPlotData(null);
    setActiveJob(null);
    setJobResult(null);
  }, []);

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

  // Submit Price Prediction to Backend API
  const handlePredict = async () => {
    if (!plotData) {
      setSubmissionError('กรุณาวาดแปลงที่ดิน (Polygon หรือ Rectangle) บนแผนที่ก่อนประเมินราคา');
      return;
    }

    setLoading(true);
    setSubmissionError(null);
    setActiveJob(null);
    setJobResult(null);

    try {
      const response = await submitPricePrediction({
        plot_name: plotName.trim() || 'พื้นที่ตรวจสอบ GeoPrice',
        latitude: plotData.latitude,
        longitude: plotData.longitude,
        geometry: plotData.geometry,
        area_size_sqm: plotData.areaSqm,
        land_use_zone: landUseZone,
        features: {
          prediction_years: predictionYears,
          distance_to_center_km: 1.5,
          road_access: true,
        },
      });

      setActiveJob(response);
      setIsPolling(true);
    } catch (err: any) {
      console.error('Failed to submit prediction:', err);
      const errMsg = err.response?.data?.detail || err.message || 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ Backend ได้';
      setSubmissionError(`เกิดข้อผิดพลาด: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  };

  // Poll job status when activeJob is present
  useEffect(() => {
    if (!activeJob?.job_id || !isPolling) return;

    const interval = setInterval(async () => {
      try {
        const result = await getPredictionStatus(activeJob.job_id);
        setJobResult(result);

        if (result.status === 'completed' || result.status === 'failed') {
          setIsPolling(false);
        }
      } catch (err) {
        console.warn('Status poll failed:', err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [activeJob?.job_id, isPolling]);

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
        </div>

        {/* Map Rendering */}
        <MapComponent 
          onPlotDrawn={handlePlotDrawn} 
          onPlotCleared={handlePlotCleared} 
          plotData={plotData}
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
          {/* Plot Information Section */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-blue-400" /> ข้อมูลแปลงที่ดิน
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

            {/* Coordinates and Area Display */}
            {plotData ? (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800">
                  <div className="text-[11px] text-slate-400">จุดศูนย์กลาง (Lat, Lng)</div>
                  <div className="text-xs font-mono font-medium text-slate-200 mt-1">
                    {plotData.latitude}, {plotData.longitude}
                  </div>
                </div>
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800">
                  <div className="text-[11px] text-slate-400">ขนาดพื้นที่คำนวณ</div>
                  <div className="text-sm font-bold text-emerald-400 mt-0.5">
                    {plotData.areaSqm.toLocaleString()} <span className="text-xs font-normal text-slate-400">ตร.ม.</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-medium">
                    ({formatThaiLandArea(plotData.areaSqm)})
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-lg bg-blue-950/30 border border-blue-800/50 text-xs text-blue-200/90 flex items-start gap-2.5 shadow-sm">
                <span className="text-base shrink-0 mt-0.5">💡</span>
                <span className="leading-relaxed">
                  <strong>วิธีวาดแปลงที่ดิน:</strong> คลิกจุดตามมุมของที่ดินไปเรื่อยๆ (ไม่จำกัดจำนวนจุด) และ <strong>คลิกที่จุดเริ่มต้นอีกครั้ง</strong> เพื่อเสร็จสิ้นการวาด
                </span>
              </div>
            )}
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

          {/* Job Queue Status & Response Details */}
          {activeJob && (
            <div className="bg-slate-950/80 rounded-xl border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  สถานะการประมวลผล (HTTP 202)
                </div>
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
                    : 'กำลังประมวลผล (อยู่ในคิว)'}
                </span>
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
                  <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                    <TrendingUp className="w-4 h-4" />
                    ผลการประเมินราคาที่ดิน ({predictionYears} ปี)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <div className="text-[10px] text-slate-400">ราคาเฉลี่ย / ตร.ม.</div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        ฿{jobResult.price_prediction.predicted_price_per_sqm.toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <div className="text-[10px] text-slate-400">มูลค่ารวมทั้งแปลง</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        ฿{jobResult.price_prediction.total_predicted_price.toLocaleString()}
                      </div>
                    </div>
                  </div>
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
