import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Save, 
  Trash2, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ExternalLink,
  PlusCircle,
  Eye,
  Sliders,
  Layers,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Bot,
  Terminal,
  Zap
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import type { PolygonPoint, FolderInfo } from '../services/adminApi';

interface QuickPolygonEditorProps {
  onNotification?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const QuickPolygonEditor: React.FC<QuickPolygonEditorProps> = () => {
  // Folder & Images State
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('2026_07-12');
  const [availableImages, setAvailableImages] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string>('2026_07-12/img_0001.jpg');

  // Polygon & Canvas State
  const [polygons, setPolygons] = useState<PolygonPoint[]>([]);
  const [selectedPolyId, setSelectedPolyId] = useState<number | null>(null);
  const [isHumanReviewed, setIsHumanReviewed] = useState(false);
  const [confidence, setConfidence] = useState(0.25);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newPolyPoints, setNewPolyPoints] = useState<[number, number][]>([]);

  // Dragging vertex state
  const [draggingVertex, setDraggingVertex] = useState<{ polyId: number; pointIndex: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Batch Auto-Labeling State
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [batchLogs, setBatchLogs] = useState<string[]>([]);
  const [batchFinished, setBatchFinished] = useState(false);
  const batchTerminalRef = useRef<HTMLDivElement | null>(null);

  // 1. Load Folder List from MinIO dynamically
  const loadFolders = useCallback(async () => {
    try {
      const res = await adminApi.getLabelFolders();
      if (res.folders && res.folders.length > 0) {
        setFolders(res.folders);
        // Default to newest non-all folder if possible
        const defaultF = res.folders.find(f => f.name === '2026_07-12') || res.folders[1] || res.folders[0];
        if (defaultF) {
          setSelectedFolder(defaultF.name);
        }
      }
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  // 2. Load Images inside Selected Folder
  useEffect(() => {
    if (!selectedFolder) return;
    const targetQueryFolder = selectedFolder === 'all' ? '2026_07-12' : selectedFolder;

    adminApi.listLabelingImages(targetQueryFolder, 100)
      .then(res => {
        if (res.sample_images && res.sample_images.length > 0) {
          setAvailableImages(res.sample_images);
          setSelectedImage(res.sample_images[0]);
        }
      })
      .catch(err => console.error('Failed to list folder images:', err));
  }, [selectedFolder]);

  // 3. Fetch Polygons for Selected Image
  const fetchImagePolygons = useCallback(async (imgKey: string, conf: number) => {
    if (!imgKey) return;
    setLoading(true);
    setErrorMsg(null);
    setSaveSuccessMsg(null);
    setSelectedPolyId(null);
    setIsAddingNew(false);
    setNewPolyPoints([]);

    try {
      const data = await adminApi.getLabelSample(imgKey, conf);
      setPolygons(data.polygons || []);
      setIsHumanReviewed(!!data.is_human_reviewed);
    } catch (err: any) {
      console.error('Failed to load polygons:', err);
      setErrorMsg('ไม่สามารถประมวลผลหรือโหลดเส้นรอบรูป Polygon จาก MinIO ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedImage) {
      fetchImagePolygons(selectedImage, confidence);
    }
  }, [selectedImage, fetchImagePolygons]);

  // 4. Batch Auto-Labeling polling logs
  useEffect(() => {
    if (!batchJobId || batchFinished) return;

    const interval = setInterval(async () => {
      try {
        const logData = await adminApi.getJobLogs(batchJobId);
        setBatchLogs(logData.logs || []);
        if (logData.is_finished) {
          setBatchFinished(true);
          setBatchRunning(false);
          loadFolders();
          fetchImagePolygons(selectedImage, confidence);
        }
      } catch (err) {
        console.error('Error polling batch logs:', err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [batchJobId, batchFinished, selectedImage, confidence, fetchImagePolygons, loadFolders]);

  useEffect(() => {
    if (batchTerminalRef.current) {
      batchTerminalRef.current.scrollTop = batchTerminalRef.current.scrollHeight;
    }
  }, [batchLogs]);

  // Trigger Batch Auto Labeling for folder or all
  const handleTriggerBatchAutoLabel = async (targetFolder: string) => {
    setBatchRunning(true);
    setBatchFinished(false);
    setBatchLogs([`[Init] กำลังส่งคำสั่ง Batch AI Auto-Labeling (${targetFolder}) ไปยัง GPU Worker...`]);

    try {
      const res = await adminApi.triggerBatchAutoLabel(targetFolder, 0.35);
      setBatchJobId(res.job_id);
    } catch (err: any) {
      console.error('Failed to trigger batch auto label:', err);
      setBatchRunning(false);
      setBatchLogs(prev => [...prev, `[Error] ${err?.message || 'ส่งคำสั่งล้มเหลว'}`]);
    }
  };

  // Navigate Previous / Next Image
  const handlePrevImage = () => {
    const curIdx = availableImages.indexOf(selectedImage);
    if (curIdx > 0) {
      setSelectedImage(availableImages[curIdx - 1]);
    }
  };

  const handleNextImage = () => {
    const curIdx = availableImages.indexOf(selectedImage);
    if (curIdx < availableImages.length - 1) {
      setSelectedImage(availableImages[curIdx + 1]);
    }
  };

  // Convert SVG client coords to normalized (0.0 to 1.0)
  const getNormalizedCoords = (e: React.MouseEvent<SVGSVGElement>): [number, number] | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  };

  // Dragging handlers
  const handleMouseDownVertex = (e: React.MouseEvent, polyId: number, pointIndex: number) => {
    e.stopPropagation();
    setDraggingVertex({ polyId, pointIndex });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingVertex) return;
    const coords = getNormalizedCoords(e);
    if (!coords) return;

    setPolygons(prev => prev.map(poly => {
      if (poly.id !== draggingVertex.polyId) return poly;
      const newPts = [...poly.points];
      newPts[draggingVertex.pointIndex] = [parseFloat(coords[0].toFixed(5)), parseFloat(coords[1].toFixed(5))];
      return {
        ...poly,
        points: newPts,
        is_human_reviewed: true
      };
    }));
    setIsHumanReviewed(true);
  };

  const handleMouseUp = () => {
    setDraggingVertex(null);
  };

  // Canvas click for adding new polygon
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isAddingNew) return;
    const coords = getNormalizedCoords(e);
    if (!coords) return;

    const rounded: [number, number] = [parseFloat(coords[0].toFixed(5)), parseFloat(coords[1].toFixed(5))];
    const updated = [...newPolyPoints, rounded];

    if (updated.length >= 4) {
      const newId = polygons.length > 0 ? Math.max(...polygons.map(p => p.id)) + 1 : 1;
      const newPoly: PolygonPoint = {
        id: newId,
        class_id: 0,
        label: 'building',
        confidence: 1.0,
        is_human_reviewed: true,
        points: updated
      };
      setPolygons(prev => [...prev, newPoly]);
      setSelectedPolyId(newId);
      setIsAddingNew(false);
      setNewPolyPoints([]);
      setIsHumanReviewed(true);
    } else {
      setNewPolyPoints(updated);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedPolyId === null) return;
    setPolygons(prev => prev.filter(p => p.id !== selectedPolyId));
    setSelectedPolyId(null);
    setIsHumanReviewed(true);
  };

  const handleSaveToMinio = async () => {
    setSaving(true);
    setSaveSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await adminApi.savePolygonLabels(selectedImage, polygons);
      setSaveSuccessMsg(`บันทึกไฟล์ Label สำเร็จ (${res.polygons_saved} อาคาร) ไปยัง MinIO: ${res.label_file}`);
      setIsHumanReviewed(true);
      loadFolders();
    } catch (err: any) {
      console.error('Failed to save labels:', err);
      setErrorMsg('เกิดข้อผิดพลาดในการบันทึก Label ขึ้น MinIO');
    } finally {
      setSaving(false);
    }
  };

  const currentFolderMeta = folders.find(f => f.name === selectedFolder);
  const previewImageUrl = `/api/v1/admin/minio/preview?bucket=images&object_name=${encodeURIComponent(selectedImage)}`;

  return (
    <div className="space-y-6 font-sans">
      {/* Top Controls: Folder Selector + Image Navigation + Batch Auto-Label Triggers */}
      <div className="bg-slate-900/90 p-5 rounded-2xl border border-slate-800 shadow-xl space-y-4">
        {/* Row 1: Folder & Image Pickers */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Level 1: Folder Selector */}
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-amber-400" />
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                โฟลเดอร์ภาพถ่าย (MinIO):
              </label>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                disabled={loading || batchRunning}
                className="bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-xl px-3 py-2 font-mono focus:outline-none focus:border-cyan-500 font-semibold"
              >
                {folders.map(f => (
                  <option key={f.id} value={f.name}>
                    {f.label} — {f.status}
                  </option>
                ))}
              </select>
            </div>

            {/* Level 2: Image in Folder Picker */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={handlePrevImage}
                disabled={loading || availableImages.indexOf(selectedImage) <= 0}
                className="p-1 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30"
                title="รูปก่อนหน้า"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <select
                value={selectedImage}
                onChange={(e) => setSelectedImage(e.target.value)}
                disabled={loading}
                className="bg-transparent border-none text-slate-200 text-xs py-1 font-mono focus:outline-none max-w-[200px]"
              >
                {availableImages.map(img => (
                  <option key={img} value={img} className="bg-slate-900 text-slate-100">
                    {img.split('/').pop()}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleNextImage}
                disabled={loading || availableImages.indexOf(selectedImage) >= availableImages.length - 1}
                className="p-1 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30"
                title="รูปถัดไป"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => fetchImagePolygons(selectedImage, confidence)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-all"
              title="รีเซ็ตและประมวลผลใหม่จากโมเดล"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              ประมวลผลใหม่
            </button>
          </div>

          {/* Confidence Slider & Label Studio Link */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>เกณฑ์ความเชื่อมั่น (Conf):</span>
              <span className="font-mono text-cyan-400 font-semibold">{confidence.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.10"
              max="0.70"
              step="0.05"
              value={confidence}
              onChange={(e) => setConfidence(parseFloat(e.target.value))}
              className="w-24 accent-cyan-500 cursor-pointer"
            />

            <a
              href="http://localhost:8080"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition-all shadow-md"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Label Studio (Port 8080)
            </a>
          </div>
        </div>

        {/* Row 2: Batch AI Auto-Labeling Action Bar */}
        <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="text-slate-300 font-medium">ความคืบหน้าการ Label ในโฟลเดอร์นี้:</span>
            <span className="text-cyan-400 font-mono font-bold">
              {currentFolderMeta?.labeled_count || 0} / {currentFolderMeta?.total_images || 1000} ภาพ
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
              {currentFolderMeta?.status || 'พร้อม Auto-Label'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleTriggerBatchAutoLabel(selectedFolder)}
              disabled={batchRunning}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs shadow-md shadow-cyan-600/25 transition-all disabled:opacity-50"
            >
              <Bot className="w-3.5 h-3.5" />
              สั่งรัน Auto-Label โฟลเดอร์ {selectedFolder} ({currentFolderMeta?.total_images || 1000} รูป)
            </button>

            <button
              type="button"
              onClick={() => handleTriggerBatchAutoLabel('all')}
              disabled={batchRunning}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold text-xs shadow-md shadow-amber-600/25 transition-all disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5" />
              ⚡ สั่งรัน Auto-Label ทั้งหมด 10,000 รูป (ทุกโฟลเดอร์ + อนาคต)
            </button>
          </div>
        </div>
      </div>

      {/* Batch Processing Terminal Drawer (shown when running or has logs) */}
      {batchLogs.length > 0 && (
        <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4 shadow-2xl font-mono text-xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 font-sans">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <span className="font-semibold text-slate-200">
                สถานะการรัน Batch AI Auto-Labeling บน GPU Worker
              </span>
              {batchRunning && (
                <span className="flex items-center gap-1 text-[11px] text-amber-400 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin" /> กำลังประมวลผลบน RTX 5060...
                </span>
              )}
              {batchFinished && (
                <span className="text-[11px] text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  เสร็จสิ้น (Completed)
                </span>
              )}
            </div>

            <button
              onClick={() => setBatchLogs([])}
              className="text-[11px] text-slate-500 hover:text-slate-300 font-sans"
            >
              ปิดหน้าต่าง Log
            </button>
          </div>

          <div
            ref={batchTerminalRef}
            className="h-36 overflow-y-auto space-y-1 text-slate-300 pr-2 select-text"
          >
            {batchLogs.map((log, index) => (
              <div
                key={index}
                className={
                  log.includes('🎉') || log.includes('✅')
                    ? 'text-emerald-400 font-semibold'
                    : log.includes('Error')
                    ? 'text-rose-400'
                    : log.includes('Progress')
                    ? 'text-cyan-300'
                    : 'text-slate-300'
                }
              >
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor Main Canvas & Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left 3 Cols: SVG Interactive Canvas */}
        <div className="lg:col-span-3 bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                Quick Polygon Reviewer & Vertex Editor
              </h3>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                isHumanReviewed 
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                  : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
              }`}>
                {isHumanReviewed ? '✏️ มีการแก้ไขโดยมนุษย์ (Human-Reviewed)' : '🤖 สกัดอัตโนมัติด้วย YOLOv8 (AI Detected)'}
              </span>
            </div>

            <div className="text-xs text-slate-400 font-mono">
              ภาพ: <span className="text-white font-bold">{selectedImage.split('/').pop()}</span> | ตรวจพบ: <span className="text-cyan-400 font-bold">{polygons.length}</span> หลัง
            </div>
          </div>

          {/* Interactive Image & SVG Canvas */}
          <div className="relative w-full max-w-[640px] aspect-square mx-auto bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl select-none">
            {/* Background Satellite Image from MinIO */}
            <img
              src={previewImageUrl}
              alt="Satellite Tile"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />

            {/* Interactive SVG Overlay */}
            <svg
              ref={svgRef}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full cursor-crosshair"
              onClick={handleSvgClick}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {polygons.map((poly) => {
                const isSelected = poly.id === selectedPolyId;
                const pointsStr = poly.points.map(pt => `${pt[0]},${pt[1]}`).join(' ');

                return (
                  <g key={poly.id}>
                    <polygon
                      points={pointsStr}
                      fill={isSelected ? 'rgba(16, 185, 129, 0.40)' : 'rgba(6, 182, 212, 0.22)'}
                      stroke={isSelected ? '#10b981' : '#06b6d4'}
                      strokeWidth={isSelected ? '0.004' : '0.0025'}
                      className="transition-colors hover:fill-cyan-500/30 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPolyId(poly.id);
                      }}
                    />

                    {isSelected && poly.points.map((pt, idx) => (
                      <circle
                        key={idx}
                        cx={pt[0]}
                        cy={pt[1]}
                        r="0.012"
                        fill="#10b981"
                        stroke="#ffffff"
                        strokeWidth="0.002"
                        className="cursor-move hover:scale-125 transition-transform"
                        onMouseDown={(e) => handleMouseDownVertex(e, poly.id, idx)}
                      />
                    ))}
                  </g>
                );
              })}

              {isAddingNew && newPolyPoints.map((pt, idx) => (
                <circle
                  key={`new-${idx}`}
                  cx={pt[0]}
                  cy={pt[1]}
                  r="0.014"
                  fill="#f59e0b"
                  stroke="#ffffff"
                  strokeWidth="0.002"
                />
              ))}

              {isAddingNew && newPolyPoints.length > 1 && (
                <polyline
                  points={newPolyPoints.map(p => `${p[0]},${p[1]}`).join(' ')}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="0.003"
                  strokeDasharray="0.01, 0.005"
                />
              )}
            </svg>

            {loading && (
              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                <p className="text-xs text-slate-300 font-medium">กำลังรัน YOLOv8-Seg ตรวจจับอาคารบนภาพถ่าย...</p>
              </div>
            )}
          </div>

          {/* Quick Toolbar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsAddingNew(prev => !prev);
                  setNewPolyPoints([]);
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-medium transition-all ${
                  isAddingNew
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                {isAddingNew ? `กำลังวาด... (คลิก 4 จุด: ${newPolyPoints.length}/4)` : 'เพิ่มอาคารใหม่ (Add Building)'}
              </button>

              {selectedPolyId !== null && (
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-medium transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  ลบอาคารที่เลือก (#{selectedPolyId})
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleSaveToMinio}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  กำลังบันทึกไปยัง MinIO...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  บันทึก Labels เข้า MinIO (YOLO Format)
                </>
              )}
            </button>
          </div>

          {saveSuccessMsg && (
            <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Right Col: Polygon Inspector & Guide */}
        <div className="space-y-5">
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-cyan-400" /> ข้อมูลอาคารที่เลือก
            </h4>

            {selectedPolyId !== null ? (
              (() => {
                const target = polygons.find(p => p.id === selectedPolyId);
                if (!target) return null;
                return (
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">รหัสอาคาร (ID):</span>
                      <span className="text-cyan-400 font-mono font-bold">#{target.id}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">ประเภทวัตถุ (Class):</span>
                      <span className="text-slate-200 font-mono">0 (building)</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">จำนวนจุดยอด (Vertices):</span>
                      <span className="text-emerald-400 font-mono font-semibold">{target.points.length} จุด</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">ความเชื่อมั่น (Conf):</span>
                      <span className="text-slate-200 font-mono">{(target.confidence * 100).toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-1">พิกัดจุดยอดรอบรูป (Norm 0-1):</span>
                      <div className="max-h-36 overflow-y-auto bg-slate-950 p-2 rounded-lg font-mono text-[10px] text-slate-300 space-y-0.5 border border-slate-800">
                        {target.points.map((pt, i) => (
                          <div key={i} className="flex justify-between">
                            <span className="text-slate-500">P{i + 1}:</span>
                            <span>x: {pt[0].toFixed(4)}, y: {pt[1].toFixed(4)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="text-xs text-slate-500 italic py-6 text-center">
                คลิกเลือกรูปทรง Polygon บนภาพเพื่อดูรายละเอียดและลากปรับแต่งจุดยอด
              </p>
            )}
          </div>

          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl space-y-3 text-xs text-slate-300">
            <h4 className="font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-cyan-400" /> ระบบ Auto-Labeling 10,000 รูป
            </h4>
            <p className="text-slate-400 leading-relaxed">
              ระบบเชื่อมต่อกับคลังภาพถ่ายดาวเทียมทุกช่วงเวลาใน MinIO ผู้ดูแลระบบสามารถเลือกโฟลเดอร์เพื่อรันโมเดล YOLOv8 Segmentation ในการสกัด Polygon Contours ทั้งหมด 10,000 รูปแบบอัตโนมัติ และผลลัพธ์จะถูกบันทึกเป็นไฟล์ Label มาตรฐานพร้อมสำหรับการ Retrain ในขั้นตอนถัดไป
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
