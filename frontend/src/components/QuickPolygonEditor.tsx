import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Save, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ExternalLink, 
  PlusCircle, 
  Eye, 
  FolderOpen, 
  ChevronLeft, 
  ChevronRight, 
  Bot, 
  Zap, 
  Sparkles, 
  Clock, 
  RefreshCw,
  Box,
  MapPin
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import type { PolygonPoint, FolderInfo, UserTriggerItem } from '../services/adminApi';

interface QuickPolygonEditorProps {
  onNotification?: (msg: string, type: 'success' | 'error' | 'info') => void;
  selectedTriggerId?: number | null;
  onTriggerSelect?: (id: number | null) => void;
}

export const QuickPolygonEditor: React.FC<QuickPolygonEditorProps> = ({
  selectedTriggerId: propSelectedTriggerId,
  onTriggerSelect
}) => {
  // Mode Selection: 'scheduled' (6-month MinIO folders) vs 'user_triggers' (User AOI Sessions)
  const [dataMode, setDataMode] = useState<'user_triggers' | 'scheduled'>(
    propSelectedTriggerId ? 'user_triggers' : 'user_triggers'
  );

  // User Trigger States
  const [userTriggers, setUserTriggers] = useState<UserTriggerItem[]>([]);
  const [selectedTrigger, setSelectedTrigger] = useState<UserTriggerItem | null>(null);
  const [loadingTriggers, setLoadingTriggers] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalculateSuccess, setRecalculateSuccess] = useState<string | null>(null);

  // Scheduled Folders & Images State
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('2026_07-12');
  const [availableImages, setAvailableImages] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string>('2026_07-12/img_0001.jpg');

  // Polygon / BBox & Canvas State
  const [polygons, setPolygons] = useState<PolygonPoint[]>([]);
  const [selectedPolyId, setSelectedPolyId] = useState<number | null>(null);
  const [isHumanReviewed, setIsHumanReviewed] = useState(false);
  const confidence = 0.25;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newPolyPoints, setNewPolyPoints] = useState<[number, number][]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);

  // Vision retrain trigger state
  const [retrainingVision, setRetrainingVision] = useState(false);
  const [retrainNotice, setRetrainNotice] = useState<string | null>(null);

  // Dragging vertex state
  const [draggingVertex, setDraggingVertex] = useState<{ polyId: number; pointIndex: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // 1. Load User Triggers (Pending HITL Review)
  const loadUserTriggers = useCallback(async (preferredId?: number) => {
    setLoadingTriggers(true);
    try {
      const res = await adminApi.getPendingTriggers(50);
      setUserTriggers(res.triggers || []);
      if (res.triggers && res.triggers.length > 0) {
        if (preferredId) {
          const match = res.triggers.find(t => t.id === preferredId);
          if (match) setSelectedTrigger(match);
          else setSelectedTrigger(res.triggers[0]);
        } else if (propSelectedTriggerId) {
          const match = res.triggers.find(t => t.id === propSelectedTriggerId);
          if (match) setSelectedTrigger(match);
          else setSelectedTrigger(res.triggers[0]);
        } else {
          setSelectedTrigger(prev => {
            if (prev) {
              const stillExists = res.triggers.find(t => t.id === prev.id);
              if (stillExists) return stillExists;
            }
            return res.triggers[0];
          });
        }
      } else {
        setSelectedTrigger(null);
      }
    } catch (err) {
      console.error('Failed to load pending triggers:', err);
    } finally {
      setLoadingTriggers(false);
    }
  }, [propSelectedTriggerId]);

  useEffect(() => {
    loadUserTriggers();
  }, [loadUserTriggers]);

  // Sync prop changes
  useEffect(() => {
    if (propSelectedTriggerId && userTriggers.length > 0) {
      const match = userTriggers.find(t => t.id === propSelectedTriggerId);
      if (match) {
        setDataMode('user_triggers');
        setSelectedTrigger(match);
      }
    }
  }, [propSelectedTriggerId, userTriggers]);

  // 2. Load Folder List from MinIO dynamically
  const loadFolders = useCallback(async () => {
    try {
      const res = await adminApi.getLabelFolders();
      if (res.folders && res.folders.length > 0) {
        setFolders(res.folders);
        const defaultF = res.folders.find(f => f.name === '2026_07-12') || res.folders[1] || res.folders[0];
        if (defaultF) setSelectedFolder(defaultF.name);
      }
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  // 3. Load Images inside Selected Folder
  useEffect(() => {
    if (dataMode !== 'scheduled' || !selectedFolder) return;
    const targetQueryFolder = selectedFolder === 'all' ? '2026_07-12' : selectedFolder;

    adminApi.listLabelingImages(targetQueryFolder, 100)
      .then(res => {
        if (res.sample_images && res.sample_images.length > 0) {
          setAvailableImages(res.sample_images);
          setSelectedImage(res.sample_images[0]);
        }
      })
      .catch(err => console.error('Failed to list folder images:', err));
  }, [selectedFolder, dataMode]);

  // 4. Fetch Polygons for Scheduled Images
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
      setErrorMsg('ไม่สามารถโหลดเส้นรอบรูปจาก MinIO ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dataMode === 'scheduled' && selectedImage) {
      fetchImagePolygons(selectedImage, confidence);
    }
  }, [selectedImage, confidence, dataMode, fetchImagePolygons]);

  // Helper: Project Geo coordinates (lat, lon) to normalized image pixels (0.0 to 1.0) on Zoom 19 tile patch
  const geoToNormalized = (lat: number, lon: number, centerLat: number, centerLon: number): [number, number] => {
    const zoom = 19;
    const n = Math.pow(2, zoom);
    const latRad = (centerLat * Math.PI) / 180.0;
    const marginM = 15.0;
    const latMargin = (200.0 + marginM) / 110574.0;
    const lonMargin = (200.0 + marginM) / (111320.0 * Math.cos(latRad));

    const minTx = Math.floor(((centerLon - lonMargin + 180.0) / 360.0) * n);
    const maxTx = Math.floor(((centerLon + lonMargin + 180.0) / 360.0) * n);
    const minTy = Math.floor((1.0 - Math.asinh(Math.tan(((centerLat + latMargin) * Math.PI) / 180.0)) / Math.PI) / 2.0 * n);
    const maxTy = Math.floor((1.0 - Math.asinh(Math.tan(((centerLat - latMargin) * Math.PI) / 180.0)) / Math.PI) / 2.0 * n);

    const imgW = (maxTx - minTx + 1) * 256.0;
    const imgH = (maxTy - minTy + 1) * 256.0;

    const targetLatRad = (lat * Math.PI) / 180.0;
    const gx = ((lon + 180.0) / 360.0) * (256.0 * n);
    const gy = (1.0 - Math.asinh(Math.tan(targetLatRad)) / Math.PI) / 2.0 * (256.0 * n);

    const px = gx - minTx * 256.0;
    const py = gy - minTy * 256.0;
    return [
      Math.max(0.005, Math.min(0.995, px / imgW)),
      Math.max(0.005, Math.min(0.995, py / imgH))
    ];
  };

  // 5. Populate Canvas when a User Trigger is Selected (Real MinIO Labels & Precise Fallback)
  useEffect(() => {
    if (dataMode === 'user_triggers' && selectedTrigger) {
      setSaveSuccessMsg(null);
      setRecalculateSuccess(null);
      setErrorMsg(null);
      setIsAddingNew(false);
      setNewPolyPoints([]);

      const imgKey = selectedTrigger.raw_image_url || `user_triggers/${selectedTrigger.job_id}.jpg`;
      setLoading(true);

      const parseFromTriggerFallback = () => {
        const bboxesList: PolygonPoint[] = [];
        const centerLat = selectedTrigger.latitude;
        const centerLon = selectedTrigger.longitude;

        // 1. Target building from initial_polygons
        if (selectedTrigger.initial_polygons) {
          const poly = selectedTrigger.initial_polygons;
          if (Array.isArray(poly.normalized_polygon) && poly.normalized_polygon.length >= 3) {
            bboxesList.push({
              id: 1,
              class_id: 0,
              label: 'Target Building (อาคารเป้าหมาย)',
              confidence: 1.0,
              is_human_reviewed: selectedTrigger.is_verified,
              points: poly.normalized_polygon
            });
          } else if (Array.isArray(poly.target_box_normalized) && poly.target_box_normalized.length === 4) {
            const [x1, y1, x2, y2] = poly.target_box_normalized;
            bboxesList.push({
              id: 1,
              class_id: 0,
              label: 'Target Building (อาคารเป้าหมาย)',
              confidence: 1.0,
              is_human_reviewed: selectedTrigger.is_verified,
              points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
            });
          } else if (Array.isArray(poly.coordinates) && poly.coordinates.length >= 3) {
            const pts = poly.coordinates.map((coord: any) => 
              geoToNormalized(coord[1], coord[0], centerLat, centerLon)
            );
            bboxesList.push({
              id: 1,
              class_id: 0,
              label: 'Target Building (อาคารเป้าหมาย)',
              confidence: 1.0,
              is_human_reviewed: selectedTrigger.is_verified,
              points: pts
            });
          }
        }

        // 2. Surrounding buildings from initial_bboxes
        if (Array.isArray(selectedTrigger.initial_bboxes)) {
          selectedTrigger.initial_bboxes.slice(0, 60).forEach((b: any, idx: number) => {
            let pts: [number, number][] = [];
            if (Array.isArray(b.norm_bbox) && b.norm_bbox.length === 4) {
              const [x1, y1, x2, y2] = b.norm_bbox;
              pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
            } else if (Array.isArray(b.coordinates) && b.coordinates.length >= 4) {
              pts = b.coordinates.slice(0, 4).map((coord: any) =>
                geoToNormalized(coord[1], coord[0], centerLat, centerLon)
              );
            }
            if (pts.length >= 3) {
              bboxesList.push({
                id: idx + 2,
                class_id: 0,
                label: b.id || `Building #${idx + 2}`,
                confidence: b.confidence || 0.85,
                is_human_reviewed: false,
                points: pts
              });
            }
          });
        }

        setPolygons(bboxesList);
        setSelectedPolyId(1);
        setIsHumanReviewed(selectedTrigger.is_verified);
      };

      // Attempt loading real labels directly from MinIO
      adminApi.getLabelSample(imgKey, 0.25)
        .then(data => {
          if (data && data.polygons && data.polygons.length > 0) {
            setPolygons(data.polygons);
            setSelectedPolyId(1);
            setIsHumanReviewed(selectedTrigger.is_verified || !!data.is_human_reviewed);
          } else {
            parseFromTriggerFallback();
          }
        })
        .catch(() => {
          parseFromTriggerFallback();
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [selectedTrigger, dataMode]);

  // Convert SVG client coords to normalized (0.0 to 1.0)
  const getNormalizedCoords = (e: React.MouseEvent<SVGSVGElement>): [number, number] | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  };

  // Dragging vertex handlers
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
      newPts[draggingVertex.pointIndex] = [parseFloat(coords[0].toFixed(4)), parseFloat(coords[1].toFixed(4))];
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

  // Add new building box / polygon
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isAddingNew) return;
    const coords = getNormalizedCoords(e);
    if (!coords) return;

    const rounded: [number, number] = [parseFloat(coords[0].toFixed(4)), parseFloat(coords[1].toFixed(4))];
    const updated = [...newPolyPoints, rounded];

    if (updated.length >= 4) {
      const newId = polygons.length > 0 ? Math.max(...polygons.map(p => p.id)) + 1 : 1;
      const newPoly: PolygonPoint = {
        id: newId,
        class_id: 0,
        label: `building-${newId}`,
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

  // Save Scheduled labels to MinIO
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

  // 7. HITL RECALCULATE & APPROVE (STATE 2)
  const handleRecalculateAndApprove = async () => {
    if (!selectedTrigger) return;
    setRecalculating(true);
    setRecalculateSuccess(null);
    setErrorMsg(null);

    try {
      // Find target building (ID #1 or selected)
      const targetPoly = polygons.find(p => p.id === 1) || polygons[0];
      const pts = targetPoly?.points || [[0.44, 0.44], [0.56, 0.44], [0.56, 0.56], [0.44, 0.56]];
      const xs = pts.map(p => p[0]);
      const ys = pts.map(p => p[1]);

      const targetBbox = {
        xmin: Math.min(...xs),
        ymin: Math.min(...ys),
        xmax: Math.max(...xs),
        ymax: Math.max(...ys)
      };

      const bboxesPayload = polygons.map(p => {
        const pxs = p.points.map(pt => pt[0]);
        const pys = p.points.map(pt => pt[1]);
        return {
          id: p.id,
          class_id: p.class_id || 0,
          xmin: Math.min(...pxs),
          ymin: Math.min(...pys),
          xmax: Math.max(...pxs),
          ymax: Math.max(...pys)
        };
      });

      const res = await adminApi.correctAndRecalculateTrigger(selectedTrigger.id, bboxesPayload, targetBbox);
      setRecalculateSuccess(`✅ ${res.message}`);
      setIsHumanReviewed(true);

      // Update local trigger state
      setSelectedTrigger(prev => prev ? {
        ...prev,
        recalculated_price: res.recalculated_price,
        is_verified: true
      } : null);

      loadUserTriggers();
    } catch (err: any) {
      console.error('Failed to recalculate trigger:', err);
      setErrorMsg(`เกิดข้อผิดพลาดในการคำนวณราคาใหม่: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setRecalculating(false);
    }
  };

  // 8. TRIGGER DUAL-SOURCE VISION RETRAINING
  const handleTriggerVisionRetrain = async () => {
    setRetrainingVision(true);
    setRetrainNotice(null);
    try {
      const res = await adminApi.triggerVisionModelRetrain('2026_07-12', 5);
      setRetrainNotice(res.message);
    } catch (err: any) {
      setRetrainNotice(`เกิดข้อผิดพลาด: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setRetrainingVision(false);
    }
  };

  const previewImageUrl = dataMode === 'user_triggers' && selectedTrigger
    ? `/api/v1/admin/minio/preview?bucket=images&object_name=${encodeURIComponent(selectedTrigger.raw_image_url || `user_triggers/${selectedTrigger.job_id}.jpg`)}`
    : `/api/v1/admin/minio/preview?bucket=images&object_name=${encodeURIComponent(selectedImage)}`;

  useEffect(() => {
    setImageLoaded(false);
    setImageLoadError(false);
  }, [previewImageUrl]);

  return (
    <div className="space-y-6 font-sans">
      {/* Mode Switcher Banner: User AOI Triggers vs Scheduled MinIO Folders */}
      <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => {
                setDataMode('user_triggers');
                loadUserTriggers();
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                dataMode === 'user_triggers'
                  ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>ข้อมูลจริงจากผู้ใช้ (User AOI Triggers)</span>
              {userTriggers.filter(t => !t.is_verified).length > 0 && (
                <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold animate-pulse">
                  {userTriggers.filter(t => !t.is_verified).length}
                </span>
              )}
            </button>

            <button
              onClick={() => setDataMode('scheduled')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                dataMode === 'scheduled'
                  ? 'bg-cyan-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>ภาพถ่ายตามรอบ 6 เดือน (Scheduled Imagery)</span>
            </button>
          </div>
        </div>

        {/* Grace Period & Auto-Proceed Policy Notice */}
        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-slate-300">Grace Period Auto-Proceed:</span>
          <span className="text-emerald-400 font-semibold">24 ชั่วโมง</span>
        </div>
      </div>

      {/* Mode Controls Bar */}
      {dataMode === 'user_triggers' ? (
        /* User Trigger Picker Strip */
        <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-4 h-4" /> เลือกรายการประเมิน (Session):
              </label>

              <select
                value={selectedTrigger?.id || ''}
                onChange={(e) => {
                  const found = userTriggers.find(t => t.id === parseInt(e.target.value));
                  if (found) {
                    setSelectedTrigger(found);
                    onTriggerSelect?.(found.id);
                  }
                }}
                disabled={loadingTriggers}
                className="bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-xl px-3 py-2 font-mono focus:outline-none focus:border-amber-500 font-semibold max-w-[340px]"
              >
                {userTriggers.map(t => (
                  <option key={t.id} value={t.id}>
                    #{t.id} — {t.plot_name || `AOI (${t.latitude.toFixed(3)}, ${t.longitude.toFixed(3)})`} [{t.is_verified ? '✅ Verified' : '⏳ Pending'}]
                  </option>
                ))}
              </select>

              <button
                onClick={() => loadUserTriggers()}
                disabled={loadingTriggers}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-all"
                title="รีเฟรชรายการคำขอ"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTriggers ? 'animate-spin' : ''}`} />
                รีเฟรช
              </button>
            </div>

            {/* Quick Summary Pill */}
            {selectedTrigger && (
              <div className="flex items-center gap-3 text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                  พิกัด: <span className="font-mono text-cyan-400 font-semibold">{selectedTrigger.latitude.toFixed(4)}, {selectedTrigger.longitude.toFixed(4)}</span>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                  ราคาเดิม: <span className="font-mono text-emerald-400 font-bold">฿{Math.round(selectedTrigger.initial_price).toLocaleString()}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Scheduled Folders Controls */
        <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <FolderOpen className="w-5 h-5 text-cyan-400" />
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                โฟลเดอร์ภาพถ่าย (MinIO):
              </label>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                disabled={loading}
                className="bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-xl px-3 py-2 font-mono focus:outline-none focus:border-cyan-500 font-semibold"
              >
                {folders.map(f => (
                  <option key={f.id} value={f.name}>
                    {f.label} — {f.status}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    const idx = availableImages.indexOf(selectedImage);
                    if (idx > 0) setSelectedImage(availableImages[idx - 1]);
                  }}
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
                  onClick={() => {
                    const idx = availableImages.indexOf(selectedImage);
                    if (idx < availableImages.length - 1) setSelectedImage(availableImages[idx + 1]);
                  }}
                  disabled={loading || availableImages.indexOf(selectedImage) >= availableImages.length - 1}
                  className="p-1 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-30"
                  title="รูปถัดไป"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
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
        </div>
      )}

      {/* Editor Main Canvas & Inspection Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left 3 Cols: SVG Interactive Canvas */}
        <div className="lg:col-span-3 bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                {dataMode === 'user_triggers' 
                  ? 'HITL Bounding Box Editor & Target Contour Reviewer' 
                  : 'Quick BBox & Polygon Reviewer'}
              </h3>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium ${
                isHumanReviewed 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>
                {isHumanReviewed ? '✅ ตรวจสอบแล้ว (State 2: Verified)' : '⏳ รอการตรวจสอบ (State 1: Pending)'}
              </span>
            </div>

            <div className="text-xs text-slate-400 font-mono">
              ตรวจพบ: <span className="text-cyan-400 font-bold">{polygons.length}</span> กรอบ BBox
            </div>
          </div>

          {/* Interactive Image & SVG Canvas */}
          <div className="relative w-full max-w-[640px] aspect-square mx-auto bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl select-none">
            {/* Image Loading State */}
            {!imageLoaded && !imageLoadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/80 z-10 pointer-events-none">
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-2" />
                <span className="text-xs text-slate-300 font-medium">กำลังโหลดภาพถ่ายดาวเทียม...</span>
                <span className="text-[11px] text-slate-500 mt-1">ระบบกำลังเตรียมภาพความละเอียดสูงจาก MinIO</span>
              </div>
            )}

            {/* Image Error Fallback */}
            {imageLoadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/90 z-10 pointer-events-none">
                <AlertCircle className="w-8 h-8 text-amber-400 mb-2" />
                <span className="text-xs text-slate-200 font-semibold">ไม่พบไฟล์ภาพถ่ายในระบบจัดเก็บ</span>
                <span className="text-[11px] text-slate-400 mt-1 max-w-sm">
                  รายการนี้อาจถูกล้างประวัติไปแล้ว หรือระบบกำลังเตรียมภาพใหม่ — คุณสามารถคลิกสแกนใหม่จากหน้าแผนที่หลักได้ตลอดเวลา
                </span>
              </div>
            )}

            <img
              src={previewImageUrl}
              alt="Satellite Tile"
              onLoad={() => {
                setImageLoaded(true);
                setImageLoadError(false);
              }}
              onError={() => {
                setImageLoaded(false);
                setImageLoadError(true);
              }}
              className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300 ${
                imageLoaded ? 'opacity-100' : 'opacity-20'
              }`}
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
                const isTarget = poly.id === 1;
                const pointsStr = poly.points.map(pt => `${pt[0]},${pt[1]}`).join(' ');

                return (
                  <g key={poly.id}>
                    <polygon
                      points={pointsStr}
                      fill={
                        isTarget 
                          ? (isSelected ? 'rgba(16, 185, 129, 0.45)' : 'rgba(245, 158, 11, 0.35)')
                          : (isSelected ? 'rgba(6, 182, 212, 0.40)' : 'rgba(6, 182, 212, 0.18)')
                      }
                      stroke={isTarget ? (isSelected ? '#10b981' : '#f59e0b') : (isSelected ? '#38bdf8' : '#06b6d4')}
                      strokeWidth={isTarget ? (isSelected ? '0.005' : '0.004') : (isSelected ? '0.0035' : '0.002')}
                      strokeDasharray={isTarget ? 'none' : '0.01, 0.004'}
                      className="transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPolyId(poly.id);
                      }}
                    />

                    {/* Corner / Vertex Dragging Handles */}
                    {isSelected && poly.points.map((pt, idx) => (
                      <circle
                        key={idx}
                        cx={pt[0]}
                        cy={pt[1]}
                        r="0.014"
                        fill={isTarget ? '#10b981' : '#06b6d4'}
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
                <p className="text-xs text-slate-300 font-medium">กำลังโหลดภาพและประมวลผลกรอบ BBox...</p>
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
                {isAddingNew ? `กำลังวาด... (คลิก 4 มุม: ${newPolyPoints.length}/4)` : 'ตีกรอบอาคารใหม่ (+ Box)'}
              </button>

              {selectedPolyId !== null && (
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-medium transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  ลบกรอบที่เลือก (#{selectedPolyId})
                </button>
              )}
            </div>

            {/* Action Button: Recalculate & Approve vs Save to MinIO */}
            {dataMode === 'user_triggers' ? (
              <button
                type="button"
                onClick={handleRecalculateAndApprove}
                disabled={recalculating || !selectedTrigger}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-semibold shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50"
              >
                {recalculating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    กำลังคำนวณพื้นที่สุทธิ & ราคาใหม่...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    คำนวณพื้นที่ใหม่ & อนุมัติ State 2 (Recalculate & Approve)
                  </>
                )}
              </button>
            ) : (
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
            )}
          </div>

          {recalculateSuccess && (
            <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{recalculateSuccess}</span>
            </div>
          )}

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

        {/* Right Col: HITL Multi-State Comparison & Retrain Gate */}
        <div className="space-y-5">
          {/* State Comparison Card (When in user_triggers mode) */}
          {dataMode === 'user_triggers' && selectedTrigger && (
            <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl space-y-4">
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-800 pb-2">
                <Sparkles className="w-4 h-4 text-amber-400" /> การเปรียบเทียบผลลัพธ์ Multi-State
              </h4>

              {/* State 1 */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-amber-400 font-semibold">State 1: ประเมินรอบแรก (Initial)</span>
                  <span className="text-[10px] text-slate-500">AI YOLO + OpenCV</span>
                </div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-xs text-slate-400">ราคาทำนายแรก:</span>
                  <span className="text-sm font-mono font-bold text-slate-200">
                    ฿{Math.round(selectedTrigger.initial_price).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-xs text-slate-400">
                  <span>พื้นที่หลังคา:</span>
                  <span className="font-mono text-slate-300">{selectedTrigger.initial_area_sqm || 160} ตร.ม.</span>
                </div>
              </div>

              {/* State 2 */}
              <div className={`p-3 rounded-xl border space-y-1 transition-all ${
                selectedTrigger.is_verified
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-slate-950/40 border-slate-800/60'
              }`}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-400 font-semibold">State 2: คำนวณซ้ำหลังตรวจแก้ (HITL)</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    selectedTrigger.is_verified ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {selectedTrigger.is_verified ? 'Verified' : 'Pending'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-xs text-slate-400">ราคาที่คำนวณใหม่:</span>
                  <span className="text-base font-mono font-bold text-emerald-400">
                    {selectedTrigger.recalculated_price 
                      ? `฿${Math.round(selectedTrigger.recalculated_price).toLocaleString()}` 
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Dual-Source Retraining Trigger Button */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <button
                  type="button"
                  onClick={handleTriggerVisionRetrain}
                  disabled={retrainingVision}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50"
                >
                  {retrainingVision ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      กำลังส่งคำสั่ง Retrain...
                    </>
                  ) : (
                    <>
                      <Bot className="w-3.5 h-3.5" />
                      อนุมัติ & สั่ง Retrain Vision Model (Dual-Source)
                    </>
                  )}
                </button>

                {retrainNotice && (
                  <p className="text-[11px] text-cyan-300 bg-cyan-950/50 p-2 rounded-lg border border-cyan-800/50">
                    {retrainNotice}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Active BBox Property Inspector */}
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-cyan-400" /> ข้อมูลกรอบ BBox ที่เลือก
            </h4>

            {selectedPolyId !== null ? (
              (() => {
                const target = polygons.find(p => p.id === selectedPolyId);
                if (!target) return null;
                const xs = target.points.map(pt => pt[0]);
                const ys = target.points.map(pt => pt[1]);
                const w = Math.max(...xs) - Math.min(...xs);
                const h = Math.max(...ys) - Math.min(...ys);

                return (
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">ชื่อวัตถุ (Label):</span>
                      <span className="text-cyan-400 font-mono font-bold">{target.label}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Class YOLO:</span>
                      <span className="text-slate-200 font-mono">0 (House / Building)</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">ขนาดกรอบ (W x H):</span>
                      <span className="text-emerald-400 font-mono font-semibold">
                        {(w * 100).toFixed(1)}% × {(h * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">ความเชื่อมั่น (Conf):</span>
                      <span className="text-slate-200 font-mono">{(target.confidence * 100).toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-1">พิกัด 4 มุม Bounding Box (Norm):</span>
                      <div className="bg-slate-950 p-2 rounded-lg font-mono text-[10px] text-slate-300 space-y-0.5 border border-slate-800">
                        {target.points.map((pt, i) => (
                          <div key={i} className="flex justify-between">
                            <span className="text-slate-500">Corner {i + 1}:</span>
                            <span>x: {pt[0].toFixed(3)}, y: {pt[1].toFixed(3)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="text-xs text-slate-500 italic py-6 text-center">
                คลิกเลือกกรอบสี่เหลี่ยม BBox บนภาพเพื่อลากปรับขนาดหรือตำแหน่ง
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
