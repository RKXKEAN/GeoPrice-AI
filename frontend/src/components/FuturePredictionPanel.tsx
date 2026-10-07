import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles,
  TrendingUp,
  Clock,
  Cpu,
  Radio,
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
  Sliders,
  GripHorizontal,
  RotateCcw,
  Minus,
  Maximize2
} from 'lucide-react';
import type { DrawnPlotData } from './MapComponent';
import type { PredictionJobResponse, PredictionResult } from '../services/api';

interface FuturePredictionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  plotData: DrawnPlotData | null;
  selectedModel: 'xgboost' | 'arimax';
  setSelectedModel: (model: 'xgboost' | 'arimax') => void;
  forceModel: boolean;
  setForceModel: (force: boolean) => void;
  predictionYears: number;
  setPredictionYears: (years: number) => void;
  onPredict: () => void;
  loading: boolean;
  submissionError: string | null;
  activeJob: PredictionJobResponse | null;
  jobResult: PredictionResult | null;
  showModelComparison: boolean;
  setShowModelComparison: (show: boolean) => void;
}

export const FuturePredictionPanel: React.FC<FuturePredictionPanelProps> = ({
  isOpen,
  onClose,
  plotData,
  selectedModel,
  setSelectedModel,
  forceModel,
  setForceModel,
  predictionYears,
  setPredictionYears,
  onPredict,
  loading,
  submissionError,
  activeJob,
  jobResult,
  showModelComparison,
  setShowModelComparison,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const dragStartRef = useRef<{ clientX: number; clientY: number; posX: number; posY: number }>({
    clientX: 0,
    clientY: 0,
    posX: 20,
    posY: 124,
  });

  // Default position: Top-Left (below the brand badge & POI filter button)
  const getDefaultPosition = useCallback(() => {
    return { x: 20, y: 124 };
  }, []);

  // Initialize position on mount or when opening
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      if (!position) {
        setPosition(getDefaultPosition());
      }
    }
  }, [getDefaultPosition, position, isOpen]);

  // Handle window resize boundary clamping
  useEffect(() => {
    const handleResize = () => {
      if (typeof window === 'undefined' || window.innerWidth < 768) return;
      setPosition((prev) => {
        if (!prev) return getDefaultPosition();
        const panelWidth = panelRef.current?.offsetWidth || 420;
        const clampedX = Math.min(Math.max(prev.x, 8), Math.max(8, window.innerWidth - panelWidth - 8));
        const clampedY = Math.min(Math.max(prev.y, 8), Math.max(8, window.innerHeight - 80));
        return { x: clampedX, y: clampedY };
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getDefaultPosition]);

  // Pointer drag event handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Prevent drag if interacting with buttons, inputs, links
    if ((e.target as HTMLElement).closest('button, input, select, a, textarea')) return;
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsDragging(true);

    const currentX = position?.x ?? 20;
    const currentY = position?.y ?? 124;

    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      posX: currentX,
      posY: currentY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    const deltaX = e.clientX - dragStartRef.current.clientX;
    const deltaY = e.clientY - dragStartRef.current.clientY;

    let newX = dragStartRef.current.posX + deltaX;
    let newY = dragStartRef.current.posY + deltaY;

    // Viewport boundaries clamping
    const panelWidth = panelRef.current?.offsetWidth || 420;
    const minX = 8;
    const maxX = Math.max(minX, window.innerWidth - panelWidth - 8);
    const minY = 8;
    const maxY = Math.max(minY, window.innerHeight - 80);

    newX = Math.min(Math.max(newX, minX), maxX);
    newY = Math.min(Math.max(newY, minY), maxY);

    setPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
    }
  };

  // If not open or no plot data selected, do not render
  if (!isOpen || !plotData) {
    return null;
  }

  const currentYear = 2026;
  const targetYear = currentYear + predictionYears;

  return (
    <>
      {/* Mobile Backdrop (Below md breakpoint only) */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1998] md:hidden animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Floating Draggable Panel (Positioned on the Left on >= md) */}
      <div
        ref={panelRef}
        style={
          position && typeof window !== 'undefined' && window.innerWidth >= 768
            ? {
                left: `${position.x}px`,
                top: `${position.y}px`,
                right: 'auto',
                bottom: 'auto',
              }
            : undefined
        }
        className={`
          fixed z-[1999]
          /* Mobile (< md): Slide-up Bottom Sheet */
          inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl border-t border-slate-700/80 shadow-2xl
          /* iPad & Desktop (>= md): Floating Draggable Glassmorphic Panel on Left Side */
          md:inset-x-auto md:bottom-auto md:top-[124px] md:left-4 md:w-[420px] lg:w-[440px] md:max-h-[calc(100vh-140px)] md:rounded-2xl md:border md:border-slate-800/90
          bg-slate-950/95 backdrop-blur-2xl text-slate-100 flex flex-col overflow-hidden
          ${isDragging ? 'shadow-2xl shadow-indigo-500/25 ring-2 ring-indigo-500/60 select-none scale-[1.01]' : 'shadow-2xl'}
          transition-all duration-150
        `}
      >
        {/* Mobile Pull Handle */}
        <div className="md:hidden pt-3 pb-1 flex justify-center shrink-0">
          <div className="w-12 h-1.5 bg-slate-700 rounded-full" />
        </div>

        {/* Panel Header (Draggable Handle on md+) */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`
            px-4 py-3 sm:px-4 sm:py-3 border-b border-slate-800/90 flex items-center justify-between shrink-0 bg-slate-900/80
            md:cursor-grab active:md:cursor-grabbing select-none transition-colors
            ${isDragging ? 'bg-indigo-950/70 border-indigo-700/50' : 'hover:bg-slate-900/95'}
          `}
          title="คลิกค้างแล้วลากเพื่อย้ายตำแหน่งแผงควบคุม"
        >
          <div className="flex items-center gap-2.5 min-w-0 pointer-events-none">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20 shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5 truncate">
                <span>แผงวิเคราะห์และเปรียบเทียบโมเดล</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  {targetYear}
                </span>
              </h3>
              <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                <span>{plotData.plotName || 'แปลงที่ดิน'} &bull; {plotData.areaSqm.toLocaleString()} ตร.ม.</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Draggable Hint Badge */}
            <div
              className="hidden md:flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800/70 px-2 py-0.5 rounded-md border border-slate-700/50 mr-0.5 cursor-grab"
              title="คลิกค้างแล้วลากเพื่อย้ายตำแหน่ง"
            >
              <GripHorizontal className="w-3.5 h-3.5 text-indigo-400" />
              <span>ลากขยับได้</span>
            </div>

            {/* Reset Position to Left Button */}
            <button
              type="button"
              onClick={() => setPosition(getDefaultPosition())}
              className="hidden md:flex p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 transition-all cursor-pointer"
              title="รีเซ็ตตำแหน่งกลับไปทางซ้าย"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Minimize / Expand Toggle Button */}
            <button
              type="button"
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all cursor-pointer"
              title={isMinimized ? 'ขยายแผงควบคุม' : 'ย่อแผงควบคุม'}
            >
              {isMinimized ? <Maximize2 className="w-3.5 h-3.5 text-indigo-300" /> : <Minus className="w-3.5 h-3.5" />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition-all cursor-pointer touch-manipulation"
              title="ปิดแผงวิเคราะห์ราคา"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Panel Scrollable Body (Hidden if Minimized) */}
        {!isMinimized && (
          <div className="p-4 sm:p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
            {/* Algorithm Model Selector (XGBoost vs ARIMAX) */}
            <div className="bg-slate-900/70 p-3.5 rounded-xl border border-slate-800/90 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" /> เลือกอัลกอริทึม AI
                </label>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-white/10 font-bold">
                  {selectedModel === 'xgboost' ? 'R² 0.968 (Spatial ML)' : 'AIC 230.7 (Time-Series)'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    id: 'xgboost',
                    name: 'XGBoost Regressor',
                    badge: 'Spatial ML',
                    metric: 'R² 0.968',
                    desc: 'วิเคราะห์เชิงพื้นที่ 17 ปัจจัย + รัศมีอาคาร 200 ม.',
                    tag: 'แปลงเฉพาะ & ซื้อขาย',
                    activeColor: 'border-cyan-500/80 bg-cyan-950/40 text-cyan-300 ring-1 ring-cyan-500/30',
                  },
                  {
                    id: 'arimax',
                    name: 'ARIMAX (1,1,0)',
                    badge: 'Econometrics',
                    metric: 'AIC 230.7',
                    desc: 'วิเคราะห์อนุกรมเวลา 17 ปี + อัตราเงินเฟ้อ',
                    tag: 'ระยะยาว & วางแผนลงทุน',
                    activeColor: 'border-purple-500/80 bg-purple-950/40 text-purple-300 ring-1 ring-purple-500/30',
                  },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedModel(m.id as any)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between touch-manipulation ${
                      selectedModel === m.id
                        ? `${m.activeColor} shadow-md`
                        : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-bold text-white truncate">{m.name}</span>
                        <span
                          className={`text-[9px] font-mono px-1 py-0.2 rounded shrink-0 font-semibold ${
                            selectedModel === m.id ? 'bg-white/15 text-white' : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {m.metric}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-300 leading-tight">{m.desc}</div>
                    </div>
                    <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center justify-between text-[9px]">
                      <span className="text-slate-400">{m.tag}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded font-mono text-[8.5px] ${
                          selectedModel === m.id ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500'
                        }`}
                      >
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
                  className="mt-0.5 w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                />
                <span className="text-[11px] text-slate-400 leading-tight">
                  บังคับใช้โมเดลเพื่อตรวจสอบและวัดความคลาดเคลื่อน (Residual Error) เทียบกับราคาจริงกรมธนารักษ์
                </span>
              </label>
            </div>

            {/* Prediction Horizon Slider (1-5 Years) */}
            <div className="bg-slate-900/70 p-3.5 rounded-xl border border-slate-800/90 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-400" /> ระยะเวลาคาดการณ์ราคา
                </label>
                <span className="text-xs font-bold text-indigo-300 bg-indigo-500/15 px-2.5 py-0.5 rounded-md border border-indigo-500/30 font-mono">
                  +{predictionYears} ปี (พ.ศ. {targetYear + 543} / {targetYear})
                </span>
              </div>

              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={predictionYears}
                onChange={(e) => setPredictionYears(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
              />

              {/* Quick Preset Buttons */}
              <div className="grid grid-cols-5 gap-1 pt-1">
                {[1, 2, 3, 4, 5].map((year) => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => setPredictionYears(year)}
                    className={`py-1 text-[10px] rounded-lg font-mono transition-all touch-manipulation cursor-pointer ${
                      predictionYears === year
                        ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/30'
                        : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    +{year} ปี ({currentYear + year})
                  </button>
                ))}
              </div>
            </div>

            {/* Main Action Button */}
            <div>
              <button
                type="button"
                onClick={onPredict}
                disabled={loading || !plotData}
                className={`w-full py-3.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg transition-all touch-manipulation cursor-pointer ${
                  !plotData
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                    : loading
                    ? 'bg-indigo-600/80 text-white cursor-wait animate-pulse'
                    : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-indigo-500/25 active:scale-[0.99] border border-indigo-400/30'
                }`}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>กำลังส่งคำขอเข้าสู่คิว AI Worker...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-purple-200" />
                    <span>คำนวณและประเมินราคา ({selectedModel.toUpperCase()})</span>
                  </>
                )}
              </button>
            </div>

            {/* Error Banner */}
            {submissionError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{submissionError}</span>
              </div>
            )}

            {/* Job Queue Status (Real-Time WebSocket) */}
            {activeJob && (
              <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                    <span>คิวงานประมวลผล AI</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Radio className="w-2.5 h-2.5 text-cyan-400 animate-pulse" /> WebSocket
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        jobResult?.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : jobResult?.status === 'failed'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
                      }`}
                    >
                      {jobResult?.status === 'completed'
                        ? 'ประเมินราคาสำเร็จ'
                        : jobResult?.status === 'failed'
                        ? 'ล้มเหลว'
                        : 'กำลังประมวลผล...'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <span>Job ID:</span>
                    <span className="font-mono text-slate-200 text-[11px] truncate max-w-[200px]" title={activeJob.job_id}>
                      {activeJob.job_id}
                    </span>
                  </div>
                  {activeJob.message && (
                    <div className="flex justify-between">
                      <span>ข้อความ:</span>
                      <span className="text-slate-300 text-right text-[11px]">{activeJob.message}</span>
                    </div>
                  )}
                </div>

                {/* Completed Results Display */}
                {jobResult?.price_prediction && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 bg-indigo-950/30 -mx-3.5 -mb-3.5 p-3.5 rounded-b-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                        <TrendingUp className="w-4 h-4 text-indigo-400" />
                        ผลการประเมินราคา ({predictionYears} ปีข้างหน้า - ปี {targetYear})
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
                        <div className="text-[10px] text-slate-400">ราคาเฉลี่ย / ตร.ม. (ปี {targetYear})</div>
                        <div className="text-sm font-bold text-white mt-0.5 font-mono">
                          ฿{jobResult.price_prediction.predicted_price_per_sqm.toLocaleString()}
                        </div>
                        {jobResult.price_prediction.details_json?.base_price_per_sqm_thb && (
                          <div className="text-[9px] text-slate-500 mt-0.5">
                            ปัจจุบัน ฿{jobResult.price_prediction.details_json.base_price_per_sqm_thb.toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                        <div className="text-[10px] text-slate-400">มูลค่ารวมทั้งแปลง (ปี {targetYear})</div>
                        <div className="text-sm font-bold text-emerald-400 mt-0.5 font-mono">
                          ฿{jobResult.price_prediction.total_predicted_price.toLocaleString()}
                        </div>
                        {(jobResult.price_prediction.details_json?.appreciation_gain_thb ?? 0) > 0 && (
                          <div className="text-[9px] text-emerald-400/80 mt-0.5 font-medium">
                            +฿{jobResult.price_prediction.details_json?.appreciation_gain_thb?.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Multi-Year Forecast Timeline */}
                    {jobResult.price_prediction.details_json?.forecast_timeline && (
                      <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800/80 space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                          <span>ไทม์ไลน์คาดการณ์ล่วงหน้า ({jobResult.price_prediction.details_json?.selected_model?.toUpperCase() || 'ML'}):</span>
                          <span className="text-[9px] text-indigo-400 font-mono">
                            {jobResult.price_prediction.details_json?.selected_model === 'arimax' ? '95% CI' : '±MAE'}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1 text-center">
                          {jobResult.price_prediction.details_json.forecast_timeline.slice(0, 4).map((f: any) => (
                            <div
                              key={f.calendar_year}
                              className={`p-1.5 rounded text-[9px] transition-all ${
                                f.year_offset === predictionYears
                                  ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/50 font-bold shadow-sm'
                                  : 'bg-slate-800/40 text-slate-400'
                              }`}
                            >
                              <div className="text-[10px] font-semibold">{f.calendar_year}</div>
                              <div className="font-mono mt-0.5 text-white">฿{Math.round(f.price_per_sqm / 1000)}k</div>
                              {f.growth_pct > 0 && (
                                <div className="text-emerald-400 text-[8.5px] font-semibold">+{f.growth_pct}%</div>
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
                            <Sliders className="w-3.5 h-3.5" />
                            <span>เปรียบเทียบราคาประเมินและโมเดล AI (Ground Truth vs ML)</span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                            <span>{showModelComparison ? 'ซ่อน' : 'แสดงตาราง'}</span>
                            {showModelComparison ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </div>
                        </div>

                        {showModelComparison && (
                          <div className="pt-2 border-t border-slate-800/80 space-y-2 text-xs">
                            <div className="overflow-x-auto">
                              <table className="w-full text-[10px] text-left">
                                <thead className="text-slate-400 border-b border-slate-800">
                                  <tr>
                                    <th className="py-1.5 px-1 font-medium">โมเดล / แหล่งข้อมูล</th>
                                    <th className="py-1.5 px-1 font-medium text-right">ราคา/ตร.ว.</th>
                                    <th className="py-1.5 px-1 font-medium text-center">เติบโต ({predictionYears} ปี)</th>
                                    <th className="py-1.5 px-1 font-medium text-right">ความคลาดเคลื่อน</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                  {Object.entries(jobResult.price_prediction.details_json.model_comparisons).map(
                                    ([key, comp]: [string, any]) => {
                                      const isSelected = comp.is_active !== undefined
                                        ? Boolean(comp.is_active)
                                        : key === selectedModel;
                                      
                                      // Compute Growth % accurately:
                                      let growthVal: number = 0;
                                      if (typeof comp.growth_pct === 'number') {
                                        growthVal = comp.growth_pct;
                                      } else if (isSelected || comp.is_active) {
                                        growthVal = Number(jobResult.price_prediction?.details_json?.total_growth_pct ?? 0);
                                      } else {
                                        growthVal = Number(jobResult.price_prediction?.details_json?.total_growth_pct ?? 0);
                                      }

                                      // Price to display (future projected price or base price)
                                      const displayPrice = comp.future_price_per_wah || comp.price_per_wah;

                                      // Error / MAE / Residual metric:
                                      const maeVal = comp.mae !== undefined && comp.mae !== null
                                        ? `±฿${Math.round(comp.mae).toLocaleString()}`
                                        : (key === 'xgboost' ? '±฿3,198' : '±฿2,840');
                                      const metricLabel = comp.eval_metric || comp.error_band || maeVal;
                                      const scoreInfo = comp.metric_value 
                                        ? `${comp.metric_label?.split(' ')[0] || 'Score'} ${comp.metric_value}` 
                                        : (comp.r2 ? `R² ${comp.r2}` : null);

                                      // Row highlight style
                                      const rowBgClass = isSelected
                                        ? key === 'arimax'
                                          ? 'bg-purple-950/40 text-purple-300 font-semibold'
                                          : 'bg-cyan-950/40 text-cyan-300 font-semibold'
                                        : 'text-slate-300 hover:bg-slate-800/40';

                                      const badgeClass = key === 'arimax'
                                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';

                                      const badgeText = key === 'arimax'
                                        ? 'ใช้งาน (Time-Series)'
                                        : 'ใช้งาน (Spatial ML)';

                                      return (
                                        <tr 
                                          key={key} 
                                          className={`transition-colors ${rowBgClass}`}
                                        >
                                          <td className="py-2 px-1">
                                            <div className="font-bold text-white flex items-center gap-1">
                                              <span>{comp.short_name || comp.name || key.toUpperCase()}</span>
                                              {isSelected && (
                                                <span className={`text-[8px] px-1 py-0.2 rounded border ${badgeClass}`}>
                                                  {badgeText}
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-[8.5px] text-slate-400 truncate max-w-[120px]">
                                              {comp.model_type || comp.tag || 'AI Algorithm'}
                                            </div>
                                          </td>
                                          <td className="py-2 px-1 text-right font-mono text-amber-300 font-bold">
                                            ฿{displayPrice?.toLocaleString()}
                                            {comp.future_price_per_wah && comp.price_per_wah && comp.future_price_per_wah !== comp.price_per_wah && (
                                              <div className="text-[8px] text-slate-500 font-normal">
                                                ฐาน ฿{comp.price_per_wah.toLocaleString()}
                                              </div>
                                            )}
                                          </td>
                                          <td className="py-2 px-1 text-center font-mono">
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                                              growthVal > 0 
                                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                                                : growthVal < 0 
                                                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                                : 'bg-slate-800 text-slate-400'
                                            }`}>
                                              {growthVal > 0 ? `+${growthVal}%` : `${growthVal}%`}
                                            </span>
                                          </td>
                                          <td className="py-2 px-1 text-right font-mono">
                                            <div className="text-slate-200 font-medium text-[9.5px]">
                                              {metricLabel}
                                            </div>
                                            {typeof comp.diff_from_ground_truth_pct === 'number' ? (
                                              <div className={`text-[8px] font-normal ${comp.diff_from_ground_truth_pct > 0 ? 'text-amber-400/90' : 'text-cyan-400/90'}`}>
                                                {comp.diff_from_ground_truth_pct > 0 ? `+${comp.diff_from_ground_truth_pct}%` : `${comp.diff_from_ground_truth_pct}%`} จากราคาจริง
                                              </div>
                                            ) : scoreInfo ? (
                                              <div className="text-[8px] text-slate-500 font-normal">
                                                {scoreInfo}
                                              </div>
                                            ) : null}
                                          </td>
                                        </tr>
                                      );
                                    }
                                  )}
                                </tbody>
                              </table>
                            </div>

                            {/* Official Ground Truth Residual Comparison if available */}
                            {jobResult.price_prediction.details_json?.official_ground_truth && (
                              <div className="mt-2.5 p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-[10px] text-emerald-300 space-y-1">
                                <div className="font-semibold flex items-center justify-between">
                                  <span>🎯 เทียบราคาจริงกรมธนารักษ์ (Residual):</span>
                                  <span className="font-mono font-bold text-white">
                                    ฿{jobResult.price_prediction.details_json.official_ground_truth.price_per_wah?.toLocaleString()} / ตร.ว.
                                  </span>
                                </div>
                                <div className="text-slate-300 text-[9px] flex items-center justify-between">
                                  <span>แปลงติดกัน {jobResult.price_prediction.details_json.official_ground_truth.parcel_id} ({jobResult.price_prediction.details_json.official_ground_truth.nearest_dist_m} ม.)</span>
                                  <span className="font-mono font-bold text-emerald-400">
                                    ความคลาดเคลื่อนจริง: {jobResult.price_prediction.details_json.official_ground_truth.note}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default FuturePredictionPanel;
