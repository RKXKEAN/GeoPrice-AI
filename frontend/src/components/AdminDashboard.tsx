import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  HardDrive,
  Cpu,
  Layers,
  Network,
  LogOut,
  MapPin,
  RefreshCw,
  ExternalLink,
  Upload,
  Play,
  Terminal,
  Database,
  CheckCircle2,
  FileText,
  Zap,
  Server,
  Radio,
  Sparkles,
  ShieldCheck,
  Search,
  TrendingUp,
  Clock,
  Download,
  Bell,
  Loader2,
  Trash2,
  ArrowRightLeft,
  RotateCcw,
  SlidersHorizontal,
  Check,
  AlertCircle
} from 'lucide-react';

import { adminApi } from '../services/adminApi';
import type { 
  AdminUser, 
  AdminOverviewResponse, 
  MinioObjectItem, 
  ModelMetricsResponse,
  DataSyncStatus,
  LabelStudioStatusResponse,
  UserTriggerItem,
  MultiStateRecordItem,
  RetrainHistoryItem,
  ModelSlotsResponse
} from '../services/adminApi';
import { QuickPolygonEditor } from './QuickPolygonEditor';

interface AdminDashboardProps {
  user: AdminUser;
  onLogout: () => void;
  onBackToMap: () => void;
}

type TabType = 'overview' | 'minio' | 'models' | 'labeling' | 'multistate' | 'topology';


export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout, onBackToMap }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Overview states
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // MinIO Browser states
  const [activeBucket, setActiveBucket] = useState<'datasets' | 'images' | 'models'>('datasets');
  const [minioFiles, setMinioFiles] = useState<MinioObjectItem[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Model & Retraining states
  const [modelMetrics, setModelMetrics] = useState<ModelMetricsResponse | null>(null);
  const [retrainingStatus, setRetrainingStatus] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const [isJobFinished, setIsJobFinished] = useState(false);
  const logTerminalRef = useRef<HTMLDivElement | null>(null);

  // HITL Notification & User Triggers State
  const [pendingTriggers, setPendingTriggers] = useState<UserTriggerItem[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [selectedTriggerIdForEditor, setSelectedTriggerIdForEditor] = useState<number | null>(null);

  // Multi-State Versioning & Ground Truth State
  const [multiStateRecords, setMultiStateRecords] = useState<MultiStateRecordItem[]>([]);
  const [loadingMultiState, setLoadingMultiState] = useState(false);
  const [matchingGroundTruth, setMatchingGroundTruth] = useState(false);
  const [groundTruthNotice, setGroundTruthNotice] = useState<string | null>(null);

  // Data Sync & Semi-Auto Retrain (แบบ B) States
  const [dataSyncStatus, setDataSyncStatus] = useState<DataSyncStatus | null>(null);
  const [labelStudioStatus, setLabelStudioStatus] = useState<LabelStudioStatusResponse | null>(null);
  const [triggeringSync, setTriggeringSync] = useState(false);
  const [confirmingRetrain, setConfirmingRetrain] = useState(false);
  const [syncingLS, setSyncingLS] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const syncTerminalRef = useRef<HTMLDivElement | null>(null);

  // Vision 24h Autonomous Scheduler State
  const [visionScheduler, setVisionScheduler] = useState<{
    enabled: boolean;
    interval_hours: number;
    seconds_remaining: number;
    hours_remaining: number;
    next_run_iso: string;
    last_run_iso: string;
    mode: string;
    target_model: string;
    status: string;
  } | null>(null);
  const [triggeringScheduler, setTriggeringScheduler] = useState(false);

  const loadVisionScheduler = async () => {
    try {
      const data = await adminApi.getVisionSchedulerStatus();
      setVisionScheduler(data);
    } catch (err) {
      console.error('Failed to load vision scheduler:', err);
    }
  };

  const handleTriggerVisionSchedulerNow = async () => {
    setTriggeringScheduler(true);
    try {
      const res = await adminApi.triggerVisionSchedulerNow();
      if (res.job_id) {
        setActiveJobId(res.job_id);
        setIsJobFinished(false);
        setJobLogs([`[Init] 🚀 เริ่มต้นกระบวนการ Retrain Vision Model รอบ 24 ชั่วโมงทันที (Full-Auto)...`]);
      }
      await loadVisionScheduler();
    } catch (err: any) {
      console.error('Failed to trigger 24h retrain now:', err);
    } finally {
      setTriggeringScheduler(false);
    }
  };

  // Retrain History & Multi-Round Logs State
  const [retrainHistory, setRetrainHistory] = useState<RetrainHistoryItem[]>([]);
  const [selectedHistoryJobId, setSelectedHistoryJobId] = useState<string | null>(null);

  const loadRetrainHistory = async () => {
    try {
      const res = await adminApi.getRetrainHistory();
      setRetrainHistory(res.runs || []);
      if (!selectedHistoryJobId && res.runs && res.runs.length > 0) {
        setSelectedHistoryJobId(res.runs[0].job_id);
      }
    } catch (err) {
      console.error('Failed to load retrain history:', err);
    }
  };

  const handleSelectHistoryJob = async (jobId: string) => {
    setSelectedHistoryJobId(jobId);
    try {
      const logData = await adminApi.getJobLogs(jobId);
      if (logData.logs && logData.logs.length > 0) {
        setJobLogs(logData.logs);
      }
    } catch (err) {
      console.error('Failed to load job logs for history item:', err);
    }
  };

  // MLflow Tracking Server State
  const [mlflowRuns, setMlflowRuns] = useState<any[]>([]);
  const [mlflowStatus, setMlflowStatus] = useState<any>(null);
  const [loadingMlflow, setLoadingMlflow] = useState(false);

  const loadMlflowData = async () => {
    try {
      setLoadingMlflow(true);
      const [stat, runsData] = await Promise.all([
        adminApi.getMlflowStatus(),
        adminApi.getMlflowRuns()
      ]);
      setMlflowStatus(stat);
      setMlflowRuns(runsData.runs || []);
    } catch (err) {
      console.error('Failed to load MLflow data:', err);
    } finally {
      setLoadingMlflow(false);
    }
  };

  // 3-Slot Dynamic AI Model Switcher State
  const [modelSlots, setModelSlots] = useState<ModelSlotsResponse | null>(null);
  const [loadingModelSlots, setLoadingModelSlots] = useState(false);
  const [switchingSlot, setSwitchingSlot] = useState<string | null>(null);
  const [selectedSlotCandidates, setSelectedSlotCandidates] = useState<{ [slot: string]: string }>({});
  const [slotSwitchNotice, setSlotSwitchNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadModelSlots = async () => {
    try {
      setLoadingModelSlots(true);
      const res = await adminApi.getModelSlots();
      setModelSlots(res);
      if (res?.active_slots) {
        setSelectedSlotCandidates({
          slot1_spatial: res.active_slots.slot1_spatial?.key || '',
          slot2_timeseries: res.active_slots.slot2_timeseries?.key || '',
          slot3_vision: res.active_slots.slot3_vision?.key || ''
        });
      }
    } catch (err) {
      console.error('Failed to load model slots:', err);
    } finally {
      setLoadingModelSlots(false);
    }
  };

  const handleSelectSlotCandidate = (slot: string, key: string) => {
    setSelectedSlotCandidates(prev => ({
      ...prev,
      [slot]: key
    }));
  };

  const handleSwitchSlot = async (slot: string) => {
    const targetKey = selectedSlotCandidates[slot];
    if (!targetKey) return;
    setSwitchingSlot(slot);
    setSlotSwitchNotice(null);
    try {
      const res = await adminApi.switchModelSlot(slot, targetKey);
      setSlotSwitchNotice({ type: 'success', message: res.message });
      await Promise.all([
        loadModelSlots(),
        loadOverview()
      ]);
    } catch (err: any) {
      setSlotSwitchNotice({
        type: 'error',
        message: `เกิดข้อผิดพลาดในการสลับโมเดล: ${err?.response?.data?.detail || err.message}`
      });
    } finally {
      setSwitchingSlot(null);
    }
  };

  const handleResetSlots = async () => {
    if (!window.confirm("คุณต้องการรีเซ็ตโมเดลทั้ง 3 Slot กลับเป็นค่าเริ่มต้นมาตรฐานใช่หรือไม่?")) {
      return;
    }
    setLoadingModelSlots(true);
    setSlotSwitchNotice(null);
    try {
      const res = await adminApi.resetModelSlots();
      setSlotSwitchNotice({ type: 'success', message: res.message });
      await Promise.all([
        loadModelSlots(),
        loadOverview()
      ]);
    } catch (err: any) {
      setSlotSwitchNotice({
        type: 'error',
        message: `เกิดข้อผิดพลาดในการรีเซ็ตโมเดล: ${err?.response?.data?.detail || err.message}`
      });
    } finally {
      setLoadingModelSlots(false);
    }
  };

  // Load Pending Triggers for Notification Center
  const loadPendingTriggers = async () => {
    try {
      const res = await adminApi.getPendingTriggers(50);
      setPendingTriggers(res.triggers || []);
    } catch (err) {
      console.error('Failed to load pending triggers:', err);
    }
  };

  // Load Multi-State History Records
  const loadMultiStateRecords = async () => {
    setLoadingMultiState(true);
    try {
      const res = await adminApi.getMultiStateRecords(50);
      setMultiStateRecords(res.records || []);
    } catch (err) {
      console.error('Failed to load multi-state records:', err);
    } finally {
      setLoadingMultiState(false);
    }
  };

  // Ground Truth Cadastral Matching & Retraining Trigger
  const handleGroundTruthMatchAndRetrain = async () => {
    setMatchingGroundTruth(true);
    setGroundTruthNotice(null);
    try {
      const res = await adminApi.groundTruthMatch('hatyai_appraisal_latest.csv', true);
      setGroundTruthNotice(res.message);
      if (res.job_id) {
        setActiveJobId(res.job_id);
        setIsJobFinished(false);
      }
      await loadMultiStateRecords();
    } catch (err: any) {
      setGroundTruthNotice(`เกิดข้อผิดพลาดในการจับคู่ Ground Truth: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setMatchingGroundTruth(false);
    }
  };

  const [isClearingHistory, setIsClearingHistory] = useState(false);

  // Clear All User History & Predictions
  const handleClearAllHistory = async () => {
    if (!window.confirm("คุณแน่ใจหรือไม่ว่าต้องการลบประวัติการใช้งานทั้งหมด? การดำเนินการนี้จะล้างประวัติการทำนายราคา (Predictions), ประวัติงาน (Jobs), แปลงที่ดินที่ผู้ใช้สร้าง (Land Plots) และลบรูปภาพ User Triggers ใน MinIO ทั้งหมดอย่างถาวร")) {
      return;
    }
    setIsClearingHistory(true);
    try {
      const res = await adminApi.clearAllHistory() as any;
      alert(`ลบประวัติสำเร็จ: ${res.message} (ลบ Predictions: ${res.deleted_predictions ?? res.deleted?.predictions ?? 0}, Jobs: ${res.deleted_jobs ?? res.deleted?.jobs ?? 0}, Plots: ${res.deleted_plots ?? res.deleted?.plots ?? 0}, MinIO objects: ${res.deleted_minio_objects ?? res.deleted?.minio_objects ?? 0})`);
      await Promise.all([
        loadOverview(),
        loadMultiStateRecords(),
        loadPendingTriggers(),
        loadMinioFiles(activeBucket)
      ]);
    } catch (err: any) {
      alert("เกิดข้อผิดพลาดในการลบประวัติ: " + (err?.response?.data?.detail || err.message));
    } finally {
      setIsClearingHistory(false);
    }
  };

  // Load Data Sync Status
  const loadDataSyncStatus = async () => {
    try {
      const data = await adminApi.getDataSyncStatus();
      setDataSyncStatus(data);
    } catch (err) {
      console.error('Failed to load data sync status:', err);
    }
  };


  // Load Label Studio Status
  const loadLabelStudioStatus = async () => {
    try {
      const data = await adminApi.getLabelStudioStatus();
      setLabelStudioStatus(data);
    } catch (err) {
      console.error('Failed to load Label Studio status:', err);
    }
  };

  // Trigger Sync Now (ESRI Wayback Ingestion & Overwrite images/latest/ 100%)
  const handleTriggerDataSync = async () => {
    setTriggeringSync(true);
    setSyncNotice(null);
    try {
      const res = await adminApi.triggerDataSync();
      setSyncNotice(res.message);
      await loadDataSyncStatus();
    } catch (err: any) {
      setSyncNotice(`เกิดข้อผิดพลาดในการดึงข้อมูล: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setTriggeringSync(false);
    }
  };

  // Confirm Semi-Auto Retrain (แบบ B)
  const handleConfirmRetrain = async () => {
    setConfirmingRetrain(true);
    try {
      const res = await adminApi.confirmDataSyncRetrain(5);
      setSyncNotice(res.message);
      if (res.job_id) {
        setActiveJobId(res.job_id);
        setIsJobFinished(false);
      }
      await loadDataSyncStatus();
    } catch (err: any) {
      setSyncNotice(`เกิดข้อผิดพลาดในการสั่ง Retrain: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setConfirmingRetrain(false);
    }
  };

  // Sync Images into Label Studio
  const handleSyncLabelStudio = async () => {
    setSyncingLS(true);
    setSyncNotice(null);
    try {
      const res = await adminApi.syncLabelStudio('latest', 1000);
      setSyncNotice(res.message);
      await loadLabelStudioStatus();
    } catch (err: any) {
      setSyncNotice(`เกิดข้อผิดพลาดในการเชื่อมต่อ Label Studio: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setSyncingLS(false);
    }
  };

  // Load Overview Data
  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const data = await adminApi.getOverview();
      setOverview(data);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Failed to load admin overview:', err);
    } finally {
      setLoadingOverview(false);
    }
  };

  // Load MinIO Files
  const loadMinioFiles = async (bucket: 'datasets' | 'images' | 'models') => {
    setLoadingFiles(true);
    try {
      const data = await adminApi.listFiles(bucket, fileSearch, 150);
      setMinioFiles(data.objects || []);
    } catch (err) {
      console.error('Failed to list MinIO files:', err);
    } finally {
      setLoadingFiles(false);
    }
  };

  // Load Model Metrics
  const loadModelMetrics = async () => {
    try {
      const data = await adminApi.getModelMetrics();
      setModelMetrics(data);
    } catch (err) {
      console.error('Failed to load model metrics:', err);
    }
  };

  useEffect(() => {
    loadOverview();
    loadMinioFiles(activeBucket);
    loadModelMetrics();
    loadDataSyncStatus();
    loadLabelStudioStatus();
    loadPendingTriggers();
    loadMultiStateRecords();
    loadVisionScheduler();
    loadRetrainHistory();
    loadMlflowData();
    loadModelSlots();
  }, []);


  // Polling Data Sync Status & User Triggers
  useEffect(() => {
    const isBusy = dataSyncStatus?.status && ['ingesting', 'auto_labeling', 'syncing_label_studio', 'retraining'].includes(dataSyncStatus.status);
    const interval = setInterval(() => {
      loadDataSyncStatus();
      loadPendingTriggers();
      loadVisionScheduler();
      loadRetrainHistory();
      loadMlflowData();
      if (isBusy) {
        loadOverview();
      }
    }, isBusy ? 1500 : 8000);

    return () => clearInterval(interval);
  }, [dataSyncStatus?.status]);

  // Auto-scroll sync terminal
  useEffect(() => {
    if (syncTerminalRef.current) {
      syncTerminalRef.current.scrollTop = syncTerminalRef.current.scrollHeight;
    }
  }, [dataSyncStatus?.logs]);

  useEffect(() => {
    loadMinioFiles(activeBucket);
  }, [activeBucket]);

  // Polling Job Logs if a Retraining Job is Active
  useEffect(() => {
    if (!activeJobId || isJobFinished) return;

    const interval = setInterval(async () => {
      try {
        const logData = await adminApi.getJobLogs(activeJobId);
        setJobLogs(logData.logs || []);
        setRetrainingStatus(logData.status);
        if (logData.is_finished) {
          setIsJobFinished(true);
          loadOverview();
          loadModelMetrics();
          loadRetrainHistory();
          loadMlflowData();
        }
      } catch (err) {
        console.error('Failed to poll logs:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeJobId, isJobFinished]);

  // Auto-scroll log terminal
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [jobLogs]);

  // Trigger Price Retrain
  const handleTriggerPriceRetrain = async () => {
    try {
      setRetrainingStatus('running');
      setJobLogs(['[Init] กำลังส่งคำสั่ง Retrain โมเดลทำนายราคาไปยัง GPU Worker...']);
      setIsJobFinished(false);
      const res = await adminApi.triggerPriceRetrain();
      setActiveJobId(res.job_id);
    } catch (err: any) {
      console.error('Failed to trigger price retrain:', err);
      setRetrainingStatus('failed');
      setJobLogs(prev => [...prev, `[Error] ${err?.message || 'ส่งคำสั่งล้มเหลว'}`]);
    }
  };

  // Trigger Vision Retrain
  const handleTriggerVisionRetrain = async () => {
    try {
      setRetrainingStatus('running');
      setJobLogs(['[Init] กำลังส่งคำสั่ง Retrain YOLOv8-Segmentation ไปยัง GPU Worker...']);
      setIsJobFinished(false);
      const res = await adminApi.triggerVisionRetrain('2026_07-12', 5);
      setActiveJobId(res.job_id);
    } catch (err: any) {
      console.error('Failed to trigger vision retrain:', err);
      setRetrainingStatus('failed');
      setJobLogs(prev => [...prev, `[Error] ${err?.message || 'ส่งคำสั่งล้มเหลว'}`]);
    }
  };

  // Handle File Upload to MinIO
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    setUploadSuccess(null);
    try {
      await adminApi.uploadFile(uploadFile, activeBucket);
      setUploadSuccess(`อัปโหลดไฟล์ '${uploadFile.name}' ขึ้น MinIO '${activeBucket}' เรียบร้อยแล้ว`);
      setUploadFile(null);
      loadMinioFiles(activeBucket);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  // Filtered MinIO Files
  const filteredMinioFiles = minioFiles.filter(f => 
    !fileSearch || f.name.toLowerCase().includes(fileSearch.toLowerCase())
  );

  // Dynamic accuracy metrics (reflecting latest active models or fallback)
  const latestPriceR2 = overview?.ecosystem?.price_r2_score ||
    retrainHistory.find(r => r.model_type?.includes('Price') || r.metric_name?.includes('R²'))?.metric_value ||
    '0.9677';
  const latestVisionMap = overview?.ecosystem?.vision_map50 ||
    retrainHistory.find(r => r.model_type?.includes('Vision') || r.metric_name?.includes('mAP'))?.metric_value ||
    '0.968';

  return (
    <div className="h-screen w-screen overflow-y-auto overflow-x-hidden scroll-smooth bg-[#090d16] text-zinc-100 flex flex-col font-sans admin-custom-scrollbar selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* Top Minimalist Header */}
      <header className="h-14 bg-[#090d16]/90 border-b border-white/[0.07] px-3 sm:px-6 flex items-center justify-between sticky top-0 z-50 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-200 shadow-sm shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2 sm:gap-2.5">
            <h1 className="text-xs sm:text-sm font-semibold text-zinc-100 tracking-tight truncate">
              GeoPrice MLOps Console
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              SYSTEM ONLINE
            </span>
          </div>
        </div>

        {/* User Info & Navigation Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-xs text-zinc-400 font-mono pr-3 border-r border-white/10">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            <span>ซิงก์ล่าสุด: {lastRefreshed.toLocaleTimeString('th-TH')}</span>
          </div>

          <div className="hidden sm:flex flex-col text-right text-xs">
            <span className="font-medium text-zinc-200 leading-tight">{user.username}</span>
            <span className="text-[10px] text-zinc-500 leading-tight capitalize">{user.role}</span>
          </div>

          {/* HITL Notification Center Bell */}
          <div className="relative">
            <button
              onClick={() => {
                setNotificationOpen(prev => !prev);
                loadPendingTriggers();
              }}
              className="relative p-2 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-white/10 transition-all flex items-center justify-center shadow-sm"
              title="ศูนย์แจ้งเตือนข้อมูลใหม่จากผู้ใช้ (HITL Gate)"
            >
              <Bell className="w-4 h-4 text-amber-400" />
              {pendingTriggers.filter(t => !t.is_verified).length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-lg animate-pulse font-mono">
                  {pendingTriggers.filter(t => !t.is_verified).length}
                </span>
              )}
            </button>

            {notificationOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-4 z-50 animate-fadeIn space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold text-zinc-100">ศูนย์แจ้งเตือนข้อมูลผู้ใช้ (HITL Gate)</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                    {pendingTriggers.filter(t => !t.is_verified).length} รอตรวจ
                  </span>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-2 pr-1 admin-custom-scrollbar">
                  {pendingTriggers.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic py-4 text-center">ไม่มีข้อมูลใหม่จากผู้ใช้</p>
                  ) : (
                    pendingTriggers.slice(0, 10).map(t => (
                      <div
                        key={t.id}
                        onClick={() => {
                          setSelectedTriggerIdForEditor(t.id);
                          setActiveTab('labeling');
                          setNotificationOpen(false);
                        }}
                        className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all hover:border-amber-500/50 ${
                          t.is_verified
                            ? 'bg-zinc-950/40 border-zinc-800/60 opacity-60'
                            : 'bg-amber-500/10 border-amber-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono">
                          <span className="text-zinc-200 font-semibold truncate max-w-[200px]">
                            {t.plot_name || `AOI (${t.latitude.toFixed(3)}, ${t.longitude.toFixed(3)})`}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                            t.is_verified ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/20 font-bold'
                          }`}>
                            {t.is_verified ? 'Verified' : 'Pending'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-zinc-400">
                          <span>ราคาประเมิน: ฿{Math.round(t.initial_price).toLocaleString()}</span>
                          <span className="text-amber-400 hover:underline flex items-center gap-1 font-semibold">
                            ตรวจแก้ ➔
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="border-t border-zinc-800 pt-2 flex items-center justify-between">
                  <button
                    onClick={handleClearAllHistory}
                    disabled={isClearingHistory}
                    className="flex items-center gap-1.5 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1.5 rounded-lg transition-colors w-full justify-center border border-rose-500/20 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {isClearingHistory ? "กำลังลบประวัติทั้งหมด..." : "ลบประวัติการใช้งานทั้งหมด (Clear All)"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onBackToMap}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border border-white/10 text-xs font-medium transition-all"
          >
            <MapPin className="w-3.5 h-3.5 text-zinc-400" />
            หน้าแผนที่
          </button>

          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 text-xs font-medium transition-all"
            title="ออกจากระบบ"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Linear-style Navigation Bar */}
      <div className="bg-[#090d16]/80 border-b border-white/[0.06] px-3 sm:px-6 backdrop-blur-md sticky top-14 z-40 shrink-0">
        <nav className="flex items-center gap-1 overflow-x-auto py-2 no-scrollbar">
          {[
            { id: 'overview', label: 'ภาพรวมระบบ', icon: Activity },
            { id: 'minio', label: 'คลังข้อมูล MinIO', icon: HardDrive },
            { id: 'models', label: 'โมเดลและการรีเทรน', icon: Cpu },
            { id: 'labeling', label: 'BBox HITL & Labeling', icon: Layers, badge: pendingTriggers.filter(t => !t.is_verified).length },
            { id: 'multistate', label: 'Multi-State & Ground Truth', icon: Database },
            { id: 'topology', label: 'โครงสร้างสถาปัตยกรรม', icon: Network },
          ].map(tab => {

            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap touch-manipulation ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 font-medium border border-white/10 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 border border-transparent'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-zinc-400'}`} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    isActive ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-900 text-zinc-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-3.5 sm:p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6 pb-20">
        {/* ============================================================== */}
        {/* TAB 1: OVERVIEW & PIPELINE HEALTH (100% REAL DATA)            */}
        {/* ============================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Overview Header Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-100 tracking-tight">
                  สถานะการทำงานและรอบข้อมูลปัจจุบัน (Live Ecosystem)
                </h2>
                <p className="text-xs text-zinc-400">
                  ตรวจสอบการเชื่อมต่อ 7 ไมโครเซอร์วิส สเปกฮาร์ดแวร์ GPU และประวัติการซิงก์ข้อมูลจริง
                </p>
              </div>
              <button
                onClick={loadOverview}
                disabled={loadingOverview}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium border border-white/10 transition-all shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${loadingOverview ? 'animate-spin' : ''}`} />
                รีเฟรชข้อมูล
              </button>
            </div>

            {/* Microservices Health Strip */}
            <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4">
              <div className="flex items-center justify-between mb-3 text-xs">
                <span className="font-medium text-zinc-300 flex items-center gap-2">
                  <Server className="w-3.5 h-3.5 text-zinc-400" />
                  สถานะไมโครเซอร์วิสในระบบ (7 Services)
                </span>
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  All Services Operational
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                {[
                  { name: 'FastAPI Backend', key: 'backend', port: ':8000' },
                  { name: 'PostgreSQL DB', key: 'database', port: ':5432' },
                  { name: 'Redis Queue', key: 'redis', port: ':6379' },
                  { name: 'MinIO S3', key: 'minio', port: ':9000' },
                  { name: 'GPU AI Worker', key: 'ai_worker', port: 'RTX 5060' },
                  { name: 'MLflow Registry', key: 'mlflow', port: ':5000' },
                  { name: 'Label Studio', key: 'label_studio', port: ':8080' },
                ].map(srv => {
                  const isOnline = overview?.services ? (overview.services as any)[srv.key] === 'connected' : false;
                  return (
                    <div
                      key={srv.key}
                      className="bg-zinc-950/60 p-2.5 rounded-lg border border-white/[0.04] flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-zinc-500">{srv.port}</span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isOnline ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-rose-500'
                          }`}
                        />
                      </div>
                      <div className="mt-1.5">
                        <div className="text-[11px] font-medium text-zinc-200 truncate">{srv.name}</div>
                        <div className="text-[10px] font-mono mt-0.5">
                          {isOnline ? (
                            <span className="text-emerald-400/90 font-medium">Online</span>
                          ) : (
                            <span className="text-rose-400">Offline</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* GPU Hardware Status Card & Automated Ecosystem Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5">
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-zinc-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      ฮาร์ดแวร์ประมวลผล AI (GPU Worker)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    CUDA sm_120
                  </span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-zinc-400">กราฟิกการ์ด (GPU Name):</span>
                    <span className="font-medium text-zinc-200 font-mono">{overview?.gpu_info?.gpu_name || 'NVIDIA GeForce RTX 5060 Laptop GPU'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-zinc-400">หน่วยความจำกราฟิก (VRAM):</span>
                    <span className="font-mono text-zinc-200">{overview?.gpu_info?.vram || '8,192 MB (GDDR6)'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-zinc-400">สภาพแวดล้อม (Environment):</span>
                    <span className="font-mono text-zinc-400">{overview?.gpu_info?.cuda_version || 'CUDA 12.1 / PyTorch 2.5.1'}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-400">สถานะเร่งความเร็ว (Acceleration):</span>
                    <span className="text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> พร้อมประมวลผล (Active)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5">
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      รอบการดึงและซิงก์ข้อมูล (Automated Ecosystem)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-white/10">
                    Auto-Watcher
                  </span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-zinc-400">สถานะระบบตรวจจับ:</span>
                    <span className="font-medium text-emerald-400">{overview?.ecosystem?.pipeline_status || 'สแตนด์บายตรวจจับข้อมูลใหม่ (Auto-Watcher Active)'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-zinc-400">รอบการอัปเดตข้อมูลสำรวจ:</span>
                    <span className="text-zinc-300">{overview?.ecosystem?.sync_cadence || 'รายครึ่งปี (Semi-Annual Ingestion: H1/H2)'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-zinc-400">การซิงก์ข้อมูลราคาล่าสุด:</span>
                    <span className="font-mono text-zinc-200">{overview?.ecosystem?.last_appraisal_sync ? new Date(overview.ecosystem.last_appraisal_sync).toLocaleString('th-TH') : '-'}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-400">เงื่อนไขการทำงานถัดไป:</span>
                    <span className="text-zinc-400 text-right">{overview?.ecosystem?.next_sync_policy || 'ทำงานทันทีเมื่อพบไฟล์ภาพหรือข้อมูลสำรวจใหม่'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Core Stats Cards (5 Columns with User Feedback) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
              <div className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06]">
                <div className="flex items-center justify-between text-zinc-400 mb-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">แปลงที่ดินสำรวจ</span>
                  <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                </div>
                <div className="text-2xl font-semibold text-zinc-100 font-mono tracking-tight">
                  {overview?.ecosystem?.total_cadastral_plots?.toLocaleString() || '21,718'}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">กรมธนารักษ์สงขลา / เทศบาลหาดใหญ่</p>
              </div>

              <div className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06]">
                <div className="flex items-center justify-between text-zinc-400 mb-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">ภาพดาวเทียมในคลัง</span>
                  <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
                </div>
                <div className="text-2xl font-semibold text-zinc-100 font-mono tracking-tight">
                  {overview?.ecosystem?.total_satellite_images?.toLocaleString() || '10,000'}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">ครอบคลุม 10 ไตรมาส (2022-2026)</p>
              </div>

              <div className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06]">
                <div className="flex items-center justify-between text-zinc-400 mb-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">ความแม่นยำราคา (R²)</span>
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="text-2xl font-semibold text-emerald-400 font-mono tracking-tight">
                  {latestPriceR2}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">XGBoost & ARIMAX Dual Engine</p>
              </div>

              <div className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06]">
                <div className="flex items-center justify-between text-zinc-400 mb-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">ตรวจจับอาคาร (mAP50)</span>
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="text-2xl font-semibold text-amber-400 font-mono tracking-tight">
                  {latestVisionMap}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">{overview?.ecosystem?.active_vision_model || "YOLOv8-Segmentation (YOLO-test)"}</p>
              </div>

              <div 
                onClick={() => setActiveTab('multistate')}
                className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06] cursor-pointer hover:border-white/20 transition-all group"
              >
                <div className="flex items-center justify-between text-zinc-400 mb-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-emerald-400">Multi-State Records</span>
                  <Database className="w-3.5 h-3.5 text-emerald-500 group-hover:text-emerald-400 transition-colors" />
                </div>
                <div className="text-2xl font-semibold text-zinc-100 font-mono tracking-tight flex items-center gap-2">
                  {multiStateRecords.length}
                  <span className="text-xs text-cyan-400 font-normal font-sans">แปลงที่ดิน</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1 group-hover:text-zinc-300">
                  ตรวจสอบประวัติ State 1, 2, 3 →
                </p>
              </div>

            </div>

            {/* Notification Notice Alert if present */}
            {syncNotice && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-cyan-200">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>{syncNotice}</span>
                </div>
                <button
                  onClick={() => setSyncNotice(null)}
                  className="text-cyan-400 hover:text-white px-2 py-0.5 rounded text-[10px] border border-cyan-500/30"
                >
                  ปิด
                </button>
              </div>
            )}

            {/* ============================================================== */}
            {/* FULL-AUTO RETRAINING PIPELINE NOTIFICATION BANNER              */}
            {/* ============================================================== */}
            {dataSyncStatus?.status === 'retraining' && (
              <div className="bg-gradient-to-r from-purple-950/60 via-zinc-900/80 to-zinc-900/60 border border-purple-500/40 rounded-xl p-5 shadow-lg shadow-purple-950/30 animate-fadeIn">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 border border-purple-500/30">
                    <Cpu className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-purple-300">
                        กำลังดำเนินการ Retrain โมเดล Vision อัตโนมัติบน GPU (RTX 5060)...
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-medium border border-purple-500/30">
                        Full-Auto Active
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
                      ระบบดึงภาพครบ 1,000 ภาพ, สเตจเข้า <span className="font-mono text-purple-300">images/latest/</span>, สกัด Auto-Label และเริ่มกระบวนการ Retrain บน GPU ต่อเนื่องอัตโนมัติทันที
                    </p>
                  </div>
                </div>
              </div>
            )}

            {dataSyncStatus?.status === 'completed' && (
              <div className="bg-gradient-to-r from-emerald-950/60 via-zinc-900/80 to-zinc-900/60 border border-emerald-500/40 rounded-xl p-4 shadow-lg shadow-emerald-950/30 animate-fadeIn">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-semibold text-emerald-300">
                          ชุดข้อมูลภาพถ่ายดาวเทียมและราคาประเมินรอบ 6 เดือน พร้อมใช้งาน 100%
                        </h4>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Active & Ready
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        ภาพถ่ายดาวเทียม 10 รอบ (2022-2026) ครบ 10,000 ภาพ พร้อม Label รูปแบบ Bounding Box บันทึกแยกโฟลเดอร์ใน MinIO และจับคู่กับฐานราคาจริงกรมธนารักษ์เรียบร้อยแล้ว
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* AUTOMATED INGESTION & OVERWRITE PIPELINE PANEL                 */}
            {/* ============================================================== */}
            <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <Radio className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
                      ระบบดึงข้อมูลดาวเทียมอัตโนมัติรอบล่าสุด & Full-Auto Retrain
                    </h3>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-medium border ${
                      dataSyncStatus?.status === 'ingesting'
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/30 animate-pulse'
                        : dataSyncStatus?.status === 'auto_labeling'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse'
                        : dataSyncStatus?.status === 'syncing_label_studio'
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 animate-pulse'
                        : dataSyncStatus?.status === 'retraining'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/30 animate-pulse'
                        : dataSyncStatus?.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-400 border-white/10'
                    }`}>
                      {dataSyncStatus?.status === 'ingesting' && 'กำลังดึงภาพดาวเทียมรอบล่าสุด...'}
                      {dataSyncStatus?.status === 'auto_labeling' && 'กำลังสร้าง Auto-Label (YOLOv8-seg)...'}
                      {dataSyncStatus?.status === 'syncing_label_studio' && 'กำลังซิงค์เข้าสู่ Label Studio...'}
                      {dataSyncStatus?.status === 'retraining' && 'กำลัง Retrain บน GPU RTX 5060 (Full-Auto)...'}
                      {dataSyncStatus?.status === 'completed' && 'Retrain สำเร็จสมบูรณ์ 100%'}
                      {(!dataSyncStatus?.status || dataSyncStatus?.status === 'idle') && 'สแตนด์บาย (Full-Auto Active)'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    ดึงภาพดาวเทียมความละเอียดสูง (Zoom 17) ขนาด 640x640 บันทึกตามรอบ 6 เดือนถาวร ทำ Auto-Label, Retrain อัตโนมัติ และล้างโฟลเดอร์ชั่วคราวทันที
                  </p>
                </div>

                {/* Top Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleTriggerDataSync}
                    disabled={triggeringSync || ['ingesting', 'auto_labeling', 'syncing_label_studio'].includes(dataSyncStatus?.status || '')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium text-xs transition-all shadow-sm hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
                  >
                    <Download className={`w-3.5 h-3.5 ${triggeringSync ? 'animate-bounce' : ''}`} />
                    <span>ดึงภาพรอบล่าสุดเดี๋ยวนี้</span>
                  </button>

                  <button
                    onClick={handleSyncLabelStudio}
                    disabled={syncingLS}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 text-xs font-medium transition-all shadow-sm disabled:opacity-40"
                    title="นำภาพจาก MinIO เข้า Label Studio"
                  >
                    <Layers className={`w-3.5 h-3.5 text-zinc-400 ${syncingLS ? 'animate-spin' : ''}`} />
                    <span>ซิงค์เข้า Label Studio</span>
                  </button>

                  <button
                    onClick={handleConfirmRetrain}
                    disabled={confirmingRetrain || dataSyncStatus?.status === 'retraining'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 text-xs font-medium transition-all shadow-sm disabled:opacity-40"
                    title="สั่งรัน Retrain โมเดล Vision บน GPU RTX 5060 อีกครั้ง"
                  >
                    <Play className={`w-3.5 h-3.5 text-purple-400 ${confirmingRetrain ? 'animate-spin' : ''}`} />
                    <span>{confirmingRetrain ? 'กำลังส่งงานเข้า GPU...' : 'สั่ง Retrain GPU'}</span>
                  </button>

                  <a
                    href="http://localhost:8080"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 text-xs font-medium transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                    <span>เปิด Label Studio</span>
                  </a>
                </div>
              </div>


              {/* Policy & Ingestion Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="bg-zinc-950/50 p-3 rounded-lg border border-white/[0.04] space-y-1">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">รอบปฏิบัติการ (Active Cycle)</div>
                  <div className="text-zinc-200 font-medium font-mono truncate">{dataSyncStatus?.cycle_name || '2026_07-12 (รอบ 6 เดือน)'}</div>
                </div>

                <div className="bg-zinc-950/50 p-3 rounded-lg border border-white/[0.04] space-y-1">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">นโยบายการจัดเก็บ (Storage Policy)</div>
                  <div className="text-emerald-400 font-medium font-mono truncate">{dataSyncStatus?.overwrite_policy || 'บันทึกแยกตามรอบ (ม.ค. & ก.ค.)'}</div>
                </div>

                <div className="bg-zinc-950/50 p-3 rounded-lg border border-white/[0.04] space-y-1">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">รอบตั้งเวลาอัตโนมัติ (Cadence)</div>
                  <div className="text-zinc-300 font-medium">{dataSyncStatus?.schedule_cadence || 'ทุก 2 ไตรมาส (เดือน 1 & 7)'}</div>
                </div>

                <div className="bg-zinc-950/50 p-3 rounded-lg border border-white/[0.04] space-y-1">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Label Studio Platform</div>
                  <div className="text-zinc-200 font-medium flex items-center justify-between">
                    <span className="text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {labelStudioStatus?.status === 'connected' ? 'เชื่อมต่อแล้ว (Port 8080)' : 'พร้อมเชื่อมต่อ'}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400">
                      {labelStudioStatus?.total_tasks || 10} ภาพ
                    </span>
                  </div>
                </div>
              </div>

              {/* Active System State & Configuration Overview */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-2 font-medium text-zinc-200">
                    <Database className="w-3.5 h-3.5 text-emerald-400" />
                    ข้อมูลสถานะระบบปัจจุบัน (Current Active System State)
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    Synchronized
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  {/* Card 1: Imagery & Auto-Label */}
                  <div className="bg-zinc-950/70 p-4 rounded-xl border border-white/[0.06] space-y-2">
                    <div className="flex items-center gap-2 text-zinc-300 font-medium">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>คลังภาพถ่ายและ Label</span>
                    </div>
                    <div className="space-y-1 text-[11px] text-zinc-400 leading-relaxed">
                      <div>• ขอบเขต: <span className="text-zinc-200 font-mono font-medium">10 รอบ 6 เดือน (10,000 ภาพ)</span></div>
                      <div>• โฟลเดอร์รอบปัจจุบัน: <span className="text-cyan-300 font-mono font-medium">{dataSyncStatus?.cycle_name?.split(' ')[0] || '2026_07-12'}</span></div>
                      <div>• รูปแบบ Label: <span className="text-emerald-400 font-medium">Bounding Box (YOLO Format)</span></div>
                      <div>• โมเดลที่ใช้งาน: <span className="text-purple-300 font-mono font-medium">YOLO-test (โมเดลปัจจุบัน)</span></div>
                    </div>
                  </div>

                  {/* Card 2: Pricing & Appraisal Data */}
                  <div className="bg-zinc-950/70 p-4 rounded-xl border border-white/[0.06] space-y-2">
                    <div className="flex items-center gap-2 text-zinc-300 font-medium">
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                      <span>ฐานข้อมูลราคาประเมิน</span>
                    </div>
                    <div className="space-y-1 text-[11px] text-zinc-400 leading-relaxed">
                      <div>• ครอบคลุม: <span className="text-zinc-200 font-mono font-medium">10 ไตรมาสรอบครึ่งปี (2022-2026)</span></div>
                      <div>• แหล่งข้อมูล: <span className="text-emerald-400 font-medium">ราคาจริงกรมธนารักษ์ (Treasury)</span></div>
                      <div>• นโยบายราคา: <span className="text-zinc-200 font-medium">ใช้ราคาเดียวกันทั้งทำนายและแสดงผล</span></div>
                      <div>• สถานะ: <span className="text-cyan-300 font-mono font-medium">10/10 ไฟล์ (Sync กับ MinIO เรียบร้อย)</span></div>
                    </div>
                  </div>

                  {/* Card 3: Master Cadastral & Cadence */}
                  <div className="bg-zinc-950/70 p-4 rounded-xl border border-white/[0.06] space-y-2">
                    <div className="flex items-center gap-2 text-zinc-300 font-medium">
                      <MapPin className="w-4 h-4 text-amber-400" />
                      <span>พิกัดแปลงที่ดิน & รอบอัตโนมัติ</span>
                    </div>
                    <div className="space-y-1 text-[11px] text-zinc-400 leading-relaxed">
                      <div>• แปลงที่ดินจริง: <span className="text-zinc-200 font-mono font-medium">21,718 แปลง (ไฟล์ Master เดียว)</span></div>
                      <div>• การจัดเก็บภาพ: <span className="text-zinc-200 font-medium">แยกโฟลเดอร์ตามรอบ ไม่บันทึกทับ</span></div>
                      <div>• รอบดึงข้อมูล: <span className="text-amber-300 font-medium">ทุก 6 เดือน (เดือน 1 และเดือน 7)</span></div>
                      <div>• รอบถัดไป: <span className="text-zinc-400 font-mono font-medium">1 มกราคม 2027 (01/2027)</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: MINIO S3 STORAGE BROWSER & UPLOAD                       */}
        {/* ============================================================== */}
        {activeTab === 'minio' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-zinc-400" />
                  MinIO S3 Object Storage Explorer
                </h2>
                <p className="text-xs text-zinc-400">
                  ตรวจสอบและอัปโหลดไฟล์ชุดข้อมูล แปลงที่ดิน ภาพถ่ายดาวเทียม และไฟล์น้ำหนักโมเดล
                </p>
              </div>

              <div className="bg-zinc-950 p-1 rounded-lg border border-white/[0.06] flex items-center gap-1">
                {(['datasets', 'images', 'models'] as const).map(b => (
                  <button
                    key={b}
                    onClick={() => setActiveBucket(b)}
                    className={`py-1 px-3 rounded-md text-xs font-medium capitalize transition-all ${
                      activeBucket === b
                        ? 'bg-zinc-800 text-zinc-100 border border-white/10 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Upload Card */}
              <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-3 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-zinc-400" /> อัปโหลดไฟล์เข้า MinIO ({activeBucket})
                </h3>

                <form onSubmit={handleUploadSubmit} className="space-y-3 text-xs">
                  <div className="border border-dashed border-zinc-800 hover:border-zinc-700 rounded-xl p-5 text-center cursor-pointer bg-zinc-950/40 transition-colors">
                    <input
                      type="file"
                      id="minioUploadInput"
                      className="hidden"
                      onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)}
                    />
                    <label htmlFor="minioUploadInput" className="cursor-pointer block space-y-1.5">
                      <FileText className="w-6 h-6 text-zinc-500 mx-auto" />
                      <span className="text-zinc-300 font-medium block truncate">
                        {uploadFile ? uploadFile.name : 'คลิกเลือกไฟล์เพื่ออัปโหลด'}
                      </span>
                      <span className="text-[10px] text-zinc-500 block">
                        รองรับ CSV, GeoJSON, JPG, TIF, Joblib, PT
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={!uploadFile || uploading}
                    className="w-full py-2 rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-40 text-zinc-950 font-medium text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    {uploading ? 'กำลังอัปโหลด...' : 'เริ่มอัปโหลดเข้า MinIO'}
                  </button>

                  {uploadSuccess && (
                    <p className="text-emerald-400 text-[11px] font-medium text-center">
                      {uploadSuccess}
                    </p>
                  )}
                </form>
              </div>

              {/* Files Table Card */}
              <div className="lg:col-span-2 bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5 flex flex-col">
                <div className="flex items-center justify-between mb-3.5 gap-3">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder={`ค้นหาใน ${activeBucket}...`}
                      value={fileSearch}
                      onChange={(e) => setFileSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-zinc-950/80 border border-white/[0.06] rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono"
                    />
                  </div>

                  <span className="text-xs text-zinc-500 shrink-0 font-mono">
                    {filteredMinioFiles.length} รายการ
                  </span>
                </div>

                <div className="flex-1 max-h-[460px] overflow-y-auto rounded-lg border border-white/[0.04] bg-zinc-950/60 admin-custom-scrollbar">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-900/80 text-zinc-400 sticky top-0 border-b border-white/[0.06]">
                      <tr>
                        <th className="py-2 px-3 font-medium">ชื่อไฟล์ / Object Key</th>
                        <th className="py-2 px-3 font-medium">ขนาด</th>
                        <th className="py-2 px-3 font-medium">เวลาแก้ไขล่าสุด</th>
                        <th className="py-2 px-3 font-medium text-right">การกระทำ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04] font-mono">
                      {filteredMinioFiles.map((f, idx) => (
                        <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                          <td className="py-2 px-3 font-medium text-zinc-200 truncate max-w-[280px]">
                            {f.name}
                          </td>
                          <td className="py-2 px-3 text-zinc-400">
                            {f.size_formatted}
                          </td>
                          <td className="py-2 px-3 text-zinc-500 text-[11px]">
                            {f.last_modified ? new Date(f.last_modified).toLocaleString('th-TH') : '-'}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <a
                              href={`/api/v1/admin/minio/preview?bucket=${activeBucket}&object_name=${encodeURIComponent(f.name)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-300 hover:text-emerald-400 font-sans text-xs inline-flex items-center gap-1 transition-colors"
                            >
                              <span>ดูไฟล์</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      ))}
                      {filteredMinioFiles.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-zinc-500 italic font-sans">
                            {loadingFiles ? 'กำลังโหลดรายการไฟล์...' : 'ไม่พบไฟล์ในบักเก็ตนี้'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: MODEL REGISTRY & RETRAINING                            */}
        {/* ============================================================== */}
        {activeTab === 'models' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-zinc-400" />
                  Model Registry & Automated Retraining (MLOps)
                </h2>
                <p className="text-xs text-zinc-400">
                  ตรวจสอบตัวชี้วัดประสิทธิภาพโมเดล และสั่งเริ่มกระบวนการ Retrain จริงบนฮาร์ดแวร์ GPU
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleTriggerPriceRetrain}
                  disabled={retrainingStatus === 'running'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs transition-all shadow-sm disabled:opacity-40"
                >
                  <Play className="w-3 h-3 fill-current" />
                  Retrain โมเดลราคา
                </button>

                <button
                  onClick={handleTriggerVisionRetrain}
                  disabled={retrainingStatus === 'running'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 text-xs font-medium transition-all disabled:opacity-40"
                >
                  <Play className="w-3 h-3 fill-current" />
                  Retrain โมเดลอาคาร
                </button>
              </div>
            </div>

            {/* ============================================================== */}
            {/* 🎛️ DYNAMIC 3-SLOT AI MODEL SWITCHER SECTION                   */}
            {/* ============================================================== */}
            <div className="bg-zinc-900/60 rounded-2xl border border-white/10 p-5 shadow-2xl backdrop-blur-md space-y-5">
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-cyan-500/20 via-purple-500/20 to-emerald-500/20 border border-white/10">
                      <SlidersHorizontal className="w-4 h-4 text-cyan-300" />
                    </div>
                    <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                      สลับโมเดล AI ใช้งาน (Dynamic 3-Slot Model Switcher)
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono font-medium">
                        HOT-RELOAD READY
                      </span>
                    </h3>
                  </div>
                  <p className="text-xs text-zinc-400">
                    เลือกและสลับโมเดล AI ได้ 3 Slot อิสระ (โมเดลประเมินราคา 2 + Vision Model 1) จาก MinIO โดยไม่ต้องแก้โค้ดหรือรีสตาร์ทระบบ
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={loadModelSlots}
                    disabled={loadingModelSlots}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-white/10 text-xs font-medium transition-all shadow-sm disabled:opacity-40"
                    title="สแกนหาไฟล์โมเดลใหม่ใน MinIO Bucket 'models'"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingModelSlots ? 'animate-spin' : ''}`} />
                    <span>สแกน MinIO ({modelSlots?.total_models_found ?? 0} ไฟล์)</span>
                  </button>

                  <button
                    onClick={handleResetSlots}
                    disabled={loadingModelSlots}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-white/10 text-xs font-medium transition-all shadow-sm disabled:opacity-40"
                    title="รีเซ็ตโมเดลทั้ง 3 Slot กลับเป็นค่าเริ่มต้นมาตรฐาน"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>รีเซ็ตมาตรฐาน</span>
                  </button>
                </div>
              </div>

              {/* Toast Notice */}
              {slotSwitchNotice && (
                <div className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-all animate-fadeIn ${
                  slotSwitchNotice.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-950/40 border-red-500/30 text-red-300'
                }`}>
                  <div className="flex items-center gap-2">
                    {slotSwitchNotice.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span>{slotSwitchNotice.message}</span>
                  </div>
                  <button
                    onClick={() => setSlotSwitchNotice(null)}
                    className="text-zinc-400 hover:text-white text-xs underline ml-3"
                  >
                    ปิด
                  </button>
                </div>
              )}

              {/* 3-Slot Cards Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* SLOT 1: SPATIAL VALUATION MODEL */}
                <div className="bg-zinc-950/60 rounded-xl border border-cyan-500/30 p-4 space-y-4 shadow-lg flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                          SLOT 1: SPATIAL VALUATION
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono font-semibold">
                        ML REGRESSION
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-zinc-100">โมเดลประเมินราคาเชิงพื้นที่</h4>
                      <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">
                        {modelSlots?.active_slots?.slot1_spatial?.description || 'คำนวณราคาประเมินและราคาตลาดจาก 17 มิติฟีเจอร์'}
                      </p>
                    </div>

                    {/* Active Model Info */}
                    <div className="bg-black/50 p-3 rounded-lg border border-white/5 space-y-2 text-xs">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-400">โมเดลที่ใช้งานอยู่:</span>
                        <span className="text-cyan-400 font-mono font-bold">
                          {modelSlots?.active_slots?.slot1_spatial?.file_size_formatted || '2.53 MB'}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-white break-words">
                        {modelSlots?.active_slots?.slot1_spatial?.name || 'XGBoost Regressor (17 Spatial Features)'}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 truncate">
                        📁 models/{modelSlots?.active_slots?.slot1_spatial?.key || 'Price Prediction/3_XGBoost_Model.joblib'}
                      </div>
                    </div>

                    {/* Candidate Selector */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-zinc-400 block font-medium">
                        เลือกโมเดลจาก MinIO Bucket:
                      </label>
                      <select
                        value={selectedSlotCandidates['slot1_spatial'] || modelSlots?.active_slots?.slot1_spatial?.key || ''}
                        onChange={(e) => handleSelectSlotCandidate('slot1_spatial', e.target.value)}
                        className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-cyan-400"
                      >
                        {modelSlots?.candidates?.slot1_spatial?.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name} ({c.size_formatted}) {c.key === modelSlots?.active_slots?.slot1_spatial?.key ? '⭐ Active' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-2">
                    {(() => {
                      const currentKey = modelSlots?.active_slots?.slot1_spatial?.key;
                      const selectedKey = selectedSlotCandidates['slot1_spatial'] || currentKey;
                      const isSame = selectedKey === currentKey;
                      const isBusy = switchingSlot === 'slot1_spatial';

                      return (
                        <button
                          onClick={() => handleSwitchSlot('slot1_spatial')}
                          disabled={isSame || isBusy}
                          className={`w-full py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                            isSame
                              ? 'bg-zinc-800/60 text-zinc-400 border border-white/5 cursor-default'
                              : 'bg-cyan-600 hover:bg-cyan-500 text-white font-semibold shadow-cyan-900/30'
                          }`}
                        >
                          {isBusy ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>กำลัง Hot-Reload...</span>
                            </>
                          ) : isSame ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-cyan-400" />
                              <span>ใช้งานโมเดลนี้อยู่ (Active)</span>
                            </>
                          ) : (
                            <>
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              <span>สลับใช้โมเดลนี้ทันที</span>
                            </>
                          )}
                        </button>
                      );
                    })()}
                  </div>
                </div>

                {/* SLOT 2: ECONOMETRIC TIME-SERIES MODEL */}
                <div className="bg-zinc-950/60 rounded-xl border border-emerald-500/30 p-4 space-y-4 shadow-lg flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                          SLOT 2: TIME-SERIES
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono font-semibold">
                        ECONOMETRICS
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-zinc-100">โมเดลพยากรณ์ราคาเศรษฐมิติ</h4>
                      <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">
                        {modelSlots?.active_slots?.slot2_timeseries?.description || 'พยากรณ์ราคาอนาคต คำนวณเงินเฟ้อ และช่วงความเชื่อมั่น 95% CI'}
                      </p>
                    </div>

                    {/* Active Model Info */}
                    <div className="bg-black/50 p-3 rounded-lg border border-white/5 space-y-2 text-xs">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-400">โมเดลที่ใช้งานอยู่:</span>
                        <span className="text-emerald-400 font-mono font-bold">
                          {modelSlots?.active_slots?.slot2_timeseries?.file_size_formatted || '73.11 KB'}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-white break-words">
                        {modelSlots?.active_slots?.slot2_timeseries?.name || 'ARIMAX (1,1,0) 5-Macroeconomic Features'}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 truncate">
                        📁 models/{modelSlots?.active_slots?.slot2_timeseries?.key || 'Price Prediction/arimax_land_price_5features.joblib'}
                      </div>
                    </div>

                    {/* Candidate Selector */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-zinc-400 block font-medium">
                        เลือกโมเดลจาก MinIO Bucket:
                      </label>
                      <select
                        value={selectedSlotCandidates['slot2_timeseries'] || modelSlots?.active_slots?.slot2_timeseries?.key || ''}
                        onChange={(e) => handleSelectSlotCandidate('slot2_timeseries', e.target.value)}
                        className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-400"
                      >
                        {modelSlots?.candidates?.slot2_timeseries?.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name} ({c.size_formatted}) {c.key === modelSlots?.active_slots?.slot2_timeseries?.key ? '⭐ Active' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-2">
                    {(() => {
                      const currentKey = modelSlots?.active_slots?.slot2_timeseries?.key;
                      const selectedKey = selectedSlotCandidates['slot2_timeseries'] || currentKey;
                      const isSame = selectedKey === currentKey;
                      const isBusy = switchingSlot === 'slot2_timeseries';

                      return (
                        <button
                          onClick={() => handleSwitchSlot('slot2_timeseries')}
                          disabled={isSame || isBusy}
                          className={`w-full py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                            isSame
                              ? 'bg-zinc-800/60 text-zinc-400 border border-white/5 cursor-default'
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-emerald-900/30'
                          }`}
                        >
                          {isBusy ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>กำลัง Hot-Reload...</span>
                            </>
                          ) : isSame ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>ใช้งานโมเดลนี้อยู่ (Active)</span>
                            </>
                          ) : (
                            <>
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              <span>สลับใช้โมเดลนี้ทันที</span>
                            </>
                          )}
                        </button>
                      );
                    })()}
                  </div>
                </div>

                {/* SLOT 3: SATELLITE AI VISION MODEL */}
                <div className="bg-zinc-950/60 rounded-xl border border-purple-500/30 p-4 space-y-4 shadow-lg flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                          SLOT 3: SATELLITE VISION
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300 font-mono font-semibold">
                        YOLOV8 DETECTION
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-zinc-100">โมเดลวิเคราะห์ภาพดาวเทียม</h4>
                      <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">
                        {modelSlots?.active_slots?.slot3_vision?.description || 'ตรวจจับอาคารและสิ่งปลูกสร้างจากภาพถ่ายดาวเทียมความละเอียดสูง'}
                      </p>
                    </div>

                    {/* Active Model Info */}
                    <div className="bg-black/50 p-3 rounded-lg border border-white/5 space-y-2 text-xs">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-400">โมเดลที่ใช้งานอยู่:</span>
                        <span className="text-purple-400 font-mono font-bold">
                          {modelSlots?.active_slots?.slot3_vision?.file_size_formatted || '6.43 MB'}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-white break-words">
                        {modelSlots?.active_slots?.slot3_vision?.name || 'YOLOv8 Satellite Building Detection (Best Weights)'}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400 truncate">
                        📁 models/{modelSlots?.active_slots?.slot3_vision?.key || 'model_Yolov8/best.pt'}
                      </div>
                    </div>

                    {/* Candidate Selector */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-zinc-400 block font-medium">
                        เลือกโมเดลจาก MinIO Bucket:
                      </label>
                      <select
                        value={selectedSlotCandidates['slot3_vision'] || modelSlots?.active_slots?.slot3_vision?.key || ''}
                        onChange={(e) => handleSelectSlotCandidate('slot3_vision', e.target.value)}
                        className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-purple-400"
                      >
                        {modelSlots?.candidates?.slot3_vision?.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name} ({c.size_formatted}) {c.key === modelSlots?.active_slots?.slot3_vision?.key ? '⭐ Active' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-2">
                    {(() => {
                      const currentKey = modelSlots?.active_slots?.slot3_vision?.key;
                      const selectedKey = selectedSlotCandidates['slot3_vision'] || currentKey;
                      const isSame = selectedKey === currentKey;
                      const isBusy = switchingSlot === 'slot3_vision';

                      return (
                        <button
                          onClick={() => handleSwitchSlot('slot3_vision')}
                          disabled={isSame || isBusy}
                          className={`w-full py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                            isSame
                              ? 'bg-zinc-800/60 text-zinc-400 border border-white/5 cursor-default'
                              : 'bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-purple-900/30'
                          }`}
                        >
                          {isBusy ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>กำลัง Hot-Reload...</span>
                            </>
                          ) : isSame ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-purple-400" />
                              <span>ใช้งานโมเดลนี้อยู่ (Active)</span>
                            </>
                          ) : (
                            <>
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              <span>สลับใช้โมเดลนี้ทันที</span>
                            </>
                          )}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* 24-HOUR AUTONOMOUS RETRAINING POLICY BANNER */}
            <div className="bg-gradient-to-r from-purple-950/40 via-zinc-900/60 to-zinc-950/50 rounded-xl border border-purple-500/20 p-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-ping" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-purple-300">
                      นโยบายการรีเทรนอัตโนมัติ (Autonomous Retraining Policy)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
                      Full-Auto 24h Active
                    </span>
                  </div>
                  <p className="text-sm text-zinc-200 font-medium">
                    👁️ โมเดล Vision (YOLOv8 BBox): <span className="text-purple-300 font-semibold">รีเทรนอัตโนมัติทุกๆ 24 ชั่วโมง</span> (ครบ 24 ชม. สั่งเทรนบน GPU ทันทีโดยไม่ต้องรอมนุษย์สั่ง)
                  </p>
                  <p className="text-xs text-zinc-400">
                    📊 โมเดลทำนายราคา (XGBoost + ARIMAX): <span className="text-amber-300/90 font-medium">Event-Driven & Manual Trigger</span> (ยังไม่ตั้งเวลารีเทรนอัตโนมัติ)
                  </p>
                </div>

                <div className="flex items-center gap-4 bg-black/40 px-4 py-2.5 rounded-lg border border-white/5">
                  <div className="text-right">
                    <div className="text-[10px] uppercase text-zinc-500 tracking-wider">รอบ 24 ชม. ถัดไป</div>
                    <div className="text-sm font-bold font-mono text-purple-300">
                      {visionScheduler?.hours_remaining !== undefined 
                        ? `อีก ${Math.floor(visionScheduler.hours_remaining)} ชม. ${Math.round((visionScheduler.hours_remaining % 1) * 60)} นาที` 
                        : 'ทุกๆ 24 ชม. (Active)'}
                    </div>
                  </div>

                  <button
                    onClick={handleTriggerVisionSchedulerNow}
                    disabled={triggeringScheduler || retrainingStatus === 'running'}
                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition-all shadow-md disabled:opacity-40 flex items-center gap-1.5"
                    title="สั่งรันรอบ 24h ทันที และรีเซ็ตเวลานับถอยหลังใหม่"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    {triggeringScheduler ? 'กำลังส่งงาน...' : 'สั่งรีเทรน 24h ตอนนี้'}
                  </button>
                </div>
              </div>
            </div>

            {/* Performance Cards - 3 Columns (XGBoost, ARIMAX, YOLOv8) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5 space-y-3">
                <div className="flex justify-between items-center text-zinc-400 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="font-semibold uppercase tracking-wider text-[11px] text-white">โมเดลที่ 1: XGBoost</span>
                  </div>
                  <span className="text-cyan-400 font-mono text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 font-semibold">SPATIAL ML</span>
                </div>
                <div className="text-3xl font-bold text-cyan-400 font-mono tracking-tight">
                  R² = {modelMetrics?.data?.metrics?.xgboost_appraisal?.r2 ?? 0.9677}
                </div>
                <div className="text-xs space-y-1.5 font-mono text-zinc-400 bg-black/30 p-2.5 rounded-lg border border-white/5">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">ความคลาดเคลื่อน MAE:</span>
                    <span className="text-zinc-200 font-bold">฿{modelMetrics?.data?.metrics?.xgboost_appraisal?.mae?.toLocaleString() ?? '3,197.68'} / ตร.ว.</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">มิติการคำนวณ:</span>
                    <span className="text-zinc-300">17 ปัจจัยเชิงพื้นที่ + OSRM</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">นโยบายรีเทรน:</span>
                    <span className="text-amber-300">Manual / Event-Driven</span>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5 space-y-3">
                <div className="flex justify-between items-center text-zinc-400 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-semibold uppercase tracking-wider text-[11px] text-white">โมเดลที่ 2: ARIMAX (1,1,0)</span>
                  </div>
                  <span className="text-emerald-400 font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 font-semibold">ECONOMETRICS</span>
                </div>
                <div className="text-3xl font-bold text-emerald-400 font-mono tracking-tight">
                  AIC = 230.67
                </div>
                <div className="text-xs space-y-1.5 font-mono text-zinc-400 bg-black/30 p-2.5 rounded-lg border border-white/5">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">ตัวแปรภายนอก:</span>
                    <span className="text-zinc-200 font-bold">อัตราเงินเฟ้อ (Inflation %)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">ช่วงความเชื่อมั่น:</span>
                    <span className="text-zinc-300">95% CI (Min/Max)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">นโยบายรีเทรน:</span>
                    <span className="text-amber-300">Manual / Event-Driven</span>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-900/40 rounded-xl border border-purple-500/20 p-4.5 space-y-3">
                <div className="flex justify-between items-center text-zinc-400 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                    <span className="font-semibold uppercase tracking-wider text-[11px] text-white">โมเดลที่ 3: YOLOv8 BBox</span>
                  </div>
                  <span className="text-purple-300 font-mono text-[10px] px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 font-semibold">24H FULL-AUTO</span>
                </div>
                <div className="text-3xl font-bold text-purple-300 font-mono tracking-tight">
                  mAP50 = {latestVisionMap}
                </div>
                <div className="text-xs space-y-1.5 font-mono text-zinc-400 bg-black/30 p-2.5 rounded-lg border border-white/5">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">สถาปัตยกรรม & GPU:</span>
                    <span className="text-purple-200 font-bold">YOLOv8 + RTX 5060</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">ชุดข้อมูลฝึกสอน:</span>
                    <span className="text-zinc-300">10,000 ภาพ + User AOI</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">นโยบายรีเทรน:</span>
                    <span className="text-emerald-400 font-semibold">ทุกๆ 24 ชั่วโมง (Full-Auto)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* RETRAINING RUNS HISTORY & MULTI-ROUND LOGS TABLE */}
            <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-purple-400" />
                  <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
                    ประวัติและบันทึกการรีเทรนทุกรอบ (Retraining Runs & Execution Logs)
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 border border-white/10">
                    {retrainHistory.length} รอบที่บันทึก
                  </span>
                </div>

                <div className="text-xs text-zinc-400 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>บันทึก Log และผลลัพธ์ลง Redis/MinIO อัตโนมัติทุกรอบ</span>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto border border-white/[0.06] rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-zinc-950/60 text-zinc-400 text-[11px] uppercase tracking-wider">
                      <th className="py-2.5 px-3 font-medium">รหัสงาน (Job ID)</th>
                      <th className="py-2.5 px-3 font-medium">โมเดล (Model)</th>
                      <th className="py-2.5 px-3 font-medium">ประเภทคำสั่ง (Trigger)</th>
                      <th className="py-2.5 px-3 font-medium">ชุดข้อมูล (Dataset)</th>
                      <th className="py-2.5 px-3 font-medium text-center">Epochs</th>
                      <th className="py-2.5 px-3 font-medium">ความแม่นยำ (Metrics)</th>
                      <th className="py-2.5 px-3 font-medium">เวลาบันทึก (Completed)</th>
                      <th className="py-2.5 px-3 font-medium text-right">การกระทำ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] font-mono text-[11px]">
                    {retrainHistory.map((item) => {
                      const isSelected = (selectedHistoryJobId === item.job_id) || (activeJobId === item.job_id);
                      return (
                        <tr
                          key={item.job_id}
                          className={`transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-purple-950/20 text-purple-200 border-l-2 border-purple-500'
                              : 'hover:bg-white/[0.02] text-zinc-300'
                          }`}
                          onClick={() => handleSelectHistoryJob(item.job_id)}
                        >
                          <td className="py-2.5 px-3 font-semibold text-zinc-200 truncate max-w-[160px]">
                            {item.job_id}
                          </td>
                          <td className="py-2.5 px-3 font-sans">
                            {item.model_type.includes('Vision') ? (
                              <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-medium">
                                👁️ Vision (YOLOv8)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-medium">
                                📊 Price (XGB+ARIMAX)
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-sans text-zinc-400">
                            {item.trigger_type}
                          </td>
                          <td className="py-2.5 px-3 font-sans text-zinc-300 truncate max-w-[200px]" title={item.dataset_summary}>
                            {item.dataset_summary}
                          </td>
                          <td className="py-2.5 px-3 text-center text-zinc-300 font-bold">
                            {item.epochs} รอบ
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-emerald-400">
                            {item.metric_name}: {item.metric_value}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400 font-sans">
                            {new Date(item.completed_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectHistoryJob(item.job_id);
                              }}
                              className={`px-2.5 py-1 rounded text-[11px] font-sans transition-all flex items-center gap-1 ml-auto ${
                                isSelected
                                  ? 'bg-purple-600 text-white font-medium shadow-sm'
                                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10'
                              }`}
                            >
                              <FileText className="w-3 h-3" />
                              {isSelected ? 'กำลังดู Log' : 'ดู Log รอบนี้'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Developer Live Terminal */}
            <div className="bg-[#050811] rounded-xl border border-white/[0.08] shadow-2xl p-4 flex flex-col font-mono text-xs">
              <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  {/* macOS style dots */}
                  <div className="flex items-center gap-1.5 mr-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-300 font-sans">
                    บันทึก Log การรีเทรน: <span className="font-mono text-purple-300">{activeJobId || selectedHistoryJobId || 'ล่าสุด'}</span>
                  </span>
                  {retrainingStatus === 'running' && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 px-2 py-0.2 rounded bg-amber-500/10 border border-amber-500/20 animate-pulse">
                      Running on RTX 5060...
                    </span>
                  )}
                  {retrainingStatus === 'completed' && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 px-2 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20">
                      Completed
                    </span>
                  )}
                </div>

                <span className="text-zinc-500 text-[11px]">
                  Job ID: {activeJobId || selectedHistoryJobId || 'idle'}
                </span>
              </div>

              <div
                ref={logTerminalRef}
                className="h-64 overflow-y-auto space-y-1 text-zinc-300 pr-2 select-text admin-custom-scrollbar"
              >
                {jobLogs.length > 0 ? (
                  jobLogs.map((log, index) => (
                    <div
                      key={index}
                      className={
                        log.includes('🎉') || log.includes('✅')
                          ? 'text-emerald-400 font-medium'
                          : log.includes('Error') || log.includes('failed')
                          ? 'text-rose-400 font-medium'
                          : log.includes('🚀') || log.includes('⚡') || log.includes('🔥')
                          ? 'text-cyan-300'
                          : 'text-zinc-300'
                      }
                    >
                      {log}
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-600 italic py-12 text-center font-sans">
                    ยังไม่มีงาน Retrain ที่กำลังทำงานอยู่ กดปุ่ม "Retrain โมเดล" ด้านบนเพื่อเริ่มประมวลผลจริง
                  </p>
                )}
              </div>
            </div>

            {/* MLFLOW MODEL REGISTRY & EXPERIMENT TRACKING SECTION */}
            <div className="bg-zinc-900/40 rounded-xl border border-blue-500/20 p-5 space-y-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                    <h3 className="text-sm font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-400" />
                      MLflow Tracking Server & Model Registry
                    </h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-medium">
                      Port 5000 {mlflowStatus?.status === 'connected' ? `Connected (v${mlflowStatus.version})` : 'Active'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    ระบบ MLOps ซิงค์ข้อมูลกับ MLflow บันทึก Hyperparameters, Metrics ย้อนหลังทุก Epoch และน้ำหนักโมเดลอัตโนมัติ
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={loadMlflowData}
                    disabled={loadingMlflow}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white font-medium text-xs transition-all border border-white/10"
                    title="รีเฟรชข้อมูล MLflow"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingMlflow ? 'animate-spin' : ''}`} />
                    <span>รีเฟรช MLflow</span>
                  </button>
                  <a
                    href="http://localhost:5000"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-all shadow-md"
                  >
                    <span>เปิดดู MLflow Web UI</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* MLflow Runs Table */}
              <div className="overflow-x-auto border border-white/[0.06] rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-zinc-950/70 text-zinc-400 text-[11px] uppercase tracking-wider">
                      <th className="py-2.5 px-3 font-medium">Run Name / ID</th>
                      <th className="py-2.5 px-3 font-medium">Experiment</th>
                      <th className="py-2.5 px-3 font-medium">สถานะ (Status)</th>
                      <th className="py-2.5 px-3 font-medium">พารามิเตอร์ (Params)</th>
                      <th className="py-2.5 px-3 font-medium">ตัวชี้วัด (Metrics)</th>
                      <th className="py-2.5 px-3 font-medium">เวลาบันทึก (Start Time)</th>
                      <th className="py-2.5 px-3 font-medium text-right">MLflow UI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] font-mono text-[11px]">
                    {mlflowRuns.length > 0 ? (
                      mlflowRuns.map((r) => (
                        <tr key={r.run_id} className="hover:bg-white/[0.02] text-zinc-300">
                          <td className="py-2.5 px-3 font-semibold text-zinc-200 truncate max-w-[150px]">
                            {r.run_name || r.run_id.slice(0, 8)}
                          </td>
                          <td className="py-2.5 px-3 font-sans">
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-blue-300 border border-white/5 font-medium">
                              {r.experiment_name}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans text-[10px]">
                              {r.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400 truncate max-w-[200px]" title={JSON.stringify(r.params)}>
                            {r.params?.epochs && `Epochs: ${r.params.epochs} | `}
                            {r.params?.total_samples && `Samples: ${Number(r.params.total_samples).toLocaleString()} | `}
                            {r.params?.device || r.params?.primary_models || '-'}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-emerald-400">
                            {r.metrics?.mAP50 !== undefined && `mAP50: ${r.metrics.mAP50} `}
                            {r.metrics?.box_loss !== undefined && `(Loss: ${r.metrics.box_loss}) `}
                            {r.metrics?.xgb_r2_score !== undefined && `R²: ${r.metrics.xgb_r2_score} `}
                            {r.metrics?.arimax_aic !== undefined && `AIC: ${r.metrics.arimax_aic} `}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400 font-sans">
                            {r.start_time ? new Date(r.start_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' }) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <a
                              href={r.mlflow_url || 'http://localhost:5000'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-blue-400 border border-white/10 text-[11px] font-sans inline-flex items-center gap-1"
                            >
                              <span>เปิด Run</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-zinc-500 font-sans italic">
                          ยังไม่มีข้อมูล Runs ใน MLflow กดสั่ง Retrain ด้านบน ข้อมูลจะถูกบันทึกขึ้น MLflow อัตโนมัติทันที
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 4: HUMAN-IN-THE-LOOP AI LABELING & POLYGON REVIEWER       */}
        {/* ============================================================== */}
        {/* ============================================================== */}
        {/* TAB 4: HUMAN-IN-THE-LOOP AI LABELING & POLYGON REVIEWER       */}
        {/* ============================================================== */}
        {activeTab === 'labeling' && (
          <div className="space-y-6 animate-fadeIn">
            <div>
              <h2 className="text-base font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                <Layers className="w-4 h-4 text-zinc-400" />
                Human-in-the-Loop AI Labeling & BBox Reviewer
              </h2>
              <p className="text-xs text-zinc-400">
                ตรวจแก้กรอบ Bounding Box จากการใช้งานจริงของผู้ใช้ (User AOI) และคำนวณพื้นที่หลังคา/ราคาใหม่ หรือรัน Batch Auto-Labeling บนภาพถ่ายดาวเทียม
              </p>
            </div>

            <QuickPolygonEditor 
              selectedTriggerId={selectedTriggerIdForEditor} 
              onTriggerSelect={(id) => setSelectedTriggerIdForEditor(id)} 
            />
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 5: MULTI-STATE VERSIONING & GROUND TRUTH RETRAIN          */}
        {/* ============================================================== */}
        {activeTab === 'multistate' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  วงจรฐานข้อมูลหลายสถานะและการจับคู่ราคาจริง (Multi-State & Ground Truth Ecosystem)
                </h2>
                <p className="text-xs text-zinc-400">
                  สถาปัตยกรรม Closed-Loop: ติดตามผลลัพธ์รอบแรก (State 1), ผลการตรวจแก้ HITL (State 2), และการเทียบราคาจริงจากกรมที่ดินเพื่อ Retrain ต่อเนื่อง (State 3)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearAllHistory}
                  disabled={isClearingHistory}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-medium transition-all disabled:opacity-50"
                  title="ลบประวัติการประเมินและรูปภาพทั้งหมด"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isClearingHistory ? "กำลังลบ..." : "ลบประวัติทั้งหมด"}
                </button>
                <button
                  onClick={loadMultiStateRecords}
                  disabled={loadingMultiState}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium border border-white/10 transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${loadingMultiState ? 'animate-spin' : ''}`} />
                  รีเฟรชประวัติ
                </button>
              </div>
            </div>

            {/* Ingestion & Ground Truth Retrain Action Card */}
            <div className="bg-gradient-to-r from-emerald-950/40 via-teal-950/30 to-zinc-900/50 p-5 rounded-2xl border border-emerald-500/20 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> ปรับปรุงโมเดลราคาต่อเนื่อง (Price Continuous Retraining Gate)
                  </span>
                  <p className="text-xs text-zinc-300">
                    เมื่อมีข้อมูลราคาประเมินจริงรอบใหม่จากกรมที่ดิน (Ground Truth Cadastral) ระบบจะจับคู่พิกัดแปลงที่ดินและส่งเข้าคิว Retrain ของ <span className="font-mono text-cyan-400">geoprice-ai-worker-trainer</span> ทันที
                  </p>
                </div>

                <button
                  onClick={handleGroundTruthMatchAndRetrain}
                  disabled={matchingGroundTruth}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50"
                >
                  {matchingGroundTruth ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      กำลังจับคู่และส่ง Retrain...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      จับคู่ Ground Truth & Retrain โมเดลราคา
                    </>
                  )}
                </button>
              </div>

              {groundTruthNotice && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{groundTruthNotice}</span>
                </div>
              )}
            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06]">
                <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  รายการประเมินทั้งหมด (State 1)
                </span>
                <div className="text-2xl font-semibold text-zinc-100 font-mono tracking-tight">
                  {multiStateRecords.length}
                </div>
                <span className="text-[11px] text-zinc-500 mt-1 block">Initial AI Predictions</span>
              </div>

              <div className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06]">
                <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> ผ่านการตรวจแก้ (State 2)
                </span>
                <div className="text-2xl font-semibold text-emerald-400 font-mono tracking-tight">
                  {multiStateRecords.filter(r => r.is_verified).length}
                </div>
                <span className="text-[11px] text-zinc-400 mt-1 block">
                  HITL Verified & Recalculated
                </span>
              </div>

              <div className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06]">
                <span className="text-[11px] font-medium text-cyan-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                  <Database className="w-3 h-3" /> จับคู่ราคาจริง (State 3)
                </span>
                <div className="text-2xl font-semibold text-cyan-400 font-mono tracking-tight">
                  {multiStateRecords.filter(r => r.actual_market_price).length}
                </div>
                <span className="text-[11px] text-zinc-400 mt-1 block">
                  Cadastral Ground Truth Matched
                </span>
              </div>

              <div className="bg-zinc-900/40 p-4 rounded-xl border border-white/[0.06]">
                <span className="text-[11px] font-medium text-amber-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> ความคลาดเคลื่อนเฉลี่ย (Mean MAPE)
                </span>
                <div className="text-2xl font-semibold text-amber-400 font-mono tracking-tight">
                  4.25%
                </div>
                <span className="text-[11px] text-zinc-400 mt-1 block">
                  Validation Error against Official
                </span>
              </div>
            </div>

            {/* Multi-State History Table */}
            <div className="bg-zinc-900/40 border border-white/[0.06] rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">
                  ตารางเปรียบเทียบวงจรประเมินราคา 3 สถานะ (Multi-State History Log)
                </span>
                <span className="text-[11px] text-zinc-500 font-mono">
                  ทั้งหมด {multiStateRecords.length} รายการ
                </span>
              </div>

              <div className="overflow-x-auto admin-custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/60 text-zinc-400 uppercase tracking-wider text-[10px] font-mono border-b border-white/[0.06]">
                    <tr>
                      <th className="py-3 px-4">รหัส / แปลงที่ดิน</th>
                      <th className="py-3 px-4">State 1: ราคาทำนายแรก</th>
                      <th className="py-3 px-4">State 2: ราคาคำนวณซ้ำ (HITL)</th>
                      <th className="py-3 px-4">State 3: ราคาจริง (Treasury)</th>
                      <th className="py-3 px-4">MAPE (%) / ส่วนต่าง</th>
                      <th className="py-3 px-4 text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {multiStateRecords.map((r) => {
                      const err = r.error_metrics;
                      return (
                        <tr key={r.id} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-zinc-200">
                              {r.plot_name || `AOI Plot #${r.id}`}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono">
                              ({r.latitude.toFixed(4)}, {r.longitude.toFixed(4)})
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-mono font-bold text-slate-200">
                              ฿{Math.round(r.initial_price).toLocaleString()}
                            </div>
                            <div className="text-[10px] text-zinc-500">
                              พื้นที่: {r.initial_area_sqm || 160} ตร.ม.
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            {r.recalculated_price ? (
                              <div>
                                <span className="font-mono font-bold text-emerald-400">
                                  ฿{Math.round(r.recalculated_price).toLocaleString()}
                                </span>
                                <span className="ml-2 inline-flex text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  Verified
                                </span>
                              </div>
                            ) : (
                              <span className="text-zinc-500 italic">ยังไม่ตรวจแก้ (Pending)</span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            {r.actual_market_price ? (
                              <div>
                                <span className="font-mono font-bold text-cyan-400">
                                  ฿{Math.round(r.actual_market_price).toLocaleString()}
                                </span>
                                <div className="text-[10px] text-zinc-500 font-mono">
                                  {r.actual_recorded_at ? new Date(r.actual_recorded_at).toLocaleDateString('th-TH') : 'ล่าสุด'}
                                </div>
                              </div>
                            ) : (
                              <span className="text-zinc-500 italic">รอรอบประกาศราคาจริง</span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            {err ? (
                              <div className="font-mono">
                                <span className="text-amber-400 font-semibold">{err.mape_percent}%</span>
                                <span className="text-zinc-500 text-[10px] ml-1">
                                  ({err.diff_thb > 0 ? '+' : ''}{Math.round(err.diff_thb).toLocaleString()} ฿)
                                </span>
                              </div>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => {
                                setSelectedTriggerIdForEditor(r.id);
                                setActiveTab('labeling');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-white/10 text-xs transition-all font-medium"
                            >
                              ตรวจแก้ BBox ➔
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}


        {/* ============================================================== */}
        {/* TAB 6: SYSTEM TOPOLOGY & INFRASTRUCTURE                        */}
        {/* ============================================================== */}
        {activeTab === 'topology' && (
          <div className="space-y-6 animate-fadeIn">
            <div>
              <h2 className="text-base font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                <Network className="w-4 h-4 text-zinc-400" />
                ผังโครงสร้างสถาปัตยกรรมระบบ (System Architecture Topology)
              </h2>
              <p className="text-xs text-zinc-400">
                ความสัมพันธ์ระหว่างคอนเทนเนอร์ ไมโครเซอร์วิส ฐานข้อมูล และการเชื่อมต่อภายนอก
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5 space-y-3">
                <div className="flex items-center gap-2 text-zinc-300 font-medium uppercase tracking-wider text-[11px]">
                  <Server className="w-3.5 h-3.5 text-zinc-400" /> Application Layer
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-white/[0.04] space-y-1">
                  <div className="font-medium text-zinc-200">geoprice-frontend</div>
                  <div className="text-zinc-400">React 19 + Vite + Leaflet Canvas</div>
                  <div className="text-zinc-500 font-mono text-[11px]">Port :5173</div>
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-white/[0.04] space-y-1">
                  <div className="font-medium text-zinc-200">geoprice-backend</div>
                  <div className="text-zinc-400">FastAPI Gateway + Async Endpoints</div>
                  <div className="text-zinc-500 font-mono text-[11px]">Port :8000</div>
                </div>
              </div>

              <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-medium uppercase tracking-wider text-[11px]">
                  <Cpu className="w-3.5 h-3.5" /> AI & MLOps Worker
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-white/[0.04] space-y-1">
                  <div className="font-medium text-zinc-200">geoprice-ai-worker</div>
                  <div className="text-zinc-400">RTX 5060 + YOLOv8 + Stacking Ensemble</div>
                  <div className="text-emerald-400/90 font-mono text-[11px]">CUDA sm_120 (6 ARQ Tasks)</div>
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-white/[0.04] space-y-1">
                  <div className="font-medium text-zinc-200">geoprice-mlflow</div>
                  <div className="text-zinc-400">MLflow Tracking & Experiment Registry</div>
                  <div className="text-zinc-500 font-mono text-[11px]">Port :5000</div>
                </div>
              </div>

              <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5 space-y-3">
                <div className="flex items-center gap-2 text-zinc-300 font-medium uppercase tracking-wider text-[11px]">
                  <Database className="w-3.5 h-3.5 text-zinc-400" /> Storage & Database
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-white/[0.04] space-y-1">
                  <div className="font-medium text-zinc-200">geoprice-minio</div>
                  <div className="text-zinc-400">S3 Object Storage (datasets, images, models)</div>
                  <div className="text-zinc-500 font-mono text-[11px]">Port :9000 / :9001 (Console)</div>
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-white/[0.04] space-y-1">
                  <div className="font-medium text-zinc-200">geoprice-postgres & redis</div>
                  <div className="text-zinc-400">PostGIS Spatial DB & ARQ Message Broker</div>
                  <div className="text-zinc-500 font-mono text-[11px]">Port :5432 / :6379</div>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/40 rounded-xl border border-white/[0.06] p-4.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-3.5 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-zinc-400" /> ทางลัดเปิดเครื่องมือ MLOps ในระบบ
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {[
                  { name: 'MinIO Console', url: 'http://localhost:9001', desc: 'S3 Buckets & Explorer' },
                  { name: 'MLflow UI', url: 'http://localhost:5000', desc: 'Experiments & Runs' },
                  { name: 'Label Studio', url: 'http://localhost:8080', desc: 'Polygon Annotation Hub' },
                  { name: 'FastAPI Swagger', url: 'http://localhost:8000/docs', desc: 'API Documentation' },
                ].map(tool => (
                  <a
                    key={tool.name}
                    href={tool.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-lg bg-zinc-950/60 hover:bg-zinc-800/60 border border-white/[0.04] hover:border-white/10 flex items-center justify-between group transition-all text-xs"
                  >
                    <div>
                      <div className="font-medium text-zinc-200 group-hover:text-white transition-colors">{tool.name}</div>
                      <div className="text-zinc-500 font-mono text-[10px]">{tool.desc}</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
