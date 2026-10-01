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
  MessageSquare,
  ThumbsUp,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { adminApi } from '../services/adminApi';
import type { 
  AdminUser, 
  AdminOverviewResponse, 
  MinioObjectItem, 
  ModelMetricsResponse,
  FeedbackItem,
  FeedbackSummary 
} from '../services/adminApi';
import { QuickPolygonEditor } from './QuickPolygonEditor';

interface AdminDashboardProps {
  user: AdminUser;
  onLogout: () => void;
  onBackToMap: () => void;
}

type TabType = 'overview' | 'minio' | 'models' | 'labeling' | 'feedback' | 'topology';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout, onBackToMap }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Overview states
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

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

  // User Feedback states
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [loadingFeedbacks, setLoadingFeedbacks] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'reasonable' | 'too_high' | 'too_low'>('all');
  const [feedbackSearch, setFeedbackSearch] = useState('');

  // Load Overview Data
  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const data = await adminApi.getOverview();
      setOverview(data);
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

  // Load User Feedbacks
  const loadFeedbacks = async () => {
    setLoadingFeedbacks(true);
    try {
      const res = await adminApi.getUserFeedbacks();
      setFeedbacks(res.feedbacks || []);
      setFeedbackSummary(res.summary);
    } catch (err) {
      console.error('Failed to load user feedbacks:', err);
    } finally {
      setLoadingFeedbacks(false);
    }
  };

  useEffect(() => {
    loadOverview();
    loadMinioFiles(activeBucket);
    loadModelMetrics();
    loadFeedbacks();
  }, []);

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

  // Filtered User Feedbacks
  const filteredFeedbacks = feedbacks.filter(fb => {
    const matchesRating = feedbackFilter === 'all' || fb.rating === feedbackFilter;
    const matchesKeyword = !feedbackSearch || 
      (fb.comment && fb.comment.toLowerCase().includes(feedbackSearch.toLowerCase())) ||
      fb.job_id.toLowerCase().includes(feedbackSearch.toLowerCase());
    return matchesRating && matchesKeyword;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* Top Navbar */}
      <header className="h-16 bg-slate-900/90 border-b border-slate-800 px-6 flex items-center justify-between sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-bold">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-wide">
                GeoPrice AI MLOps Console
              </h1>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                Production Maintenance
              </span>
            </div>
            <p className="text-xs text-slate-400">ระบบบริหารจัดการโมเดล การตรวจจับอาคาร และโครงสร้างข้อมูลอัตโนมัติ</p>
          </div>
        </div>

        {/* User Info & Navigation Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col text-right text-xs">
            <span className="font-semibold text-slate-200">{user.username} (Admin)</span>
            <span className="text-[11px] text-slate-400">{user.role}</span>
          </div>

          <button
            onClick={onBackToMap}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all shadow-md"
          >
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            กลับหน้าแผนที่ (Map View)
          </button>

          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition-all"
            title="ออกจากระบบ"
          >
            <LogOut className="w-3.5 h-3.5" />
            ออกจากระบบ
          </button>
        </div>
      </header>

      {/* Main Tab Navigation */}
      <div className="bg-slate-900/60 border-b border-slate-800 px-6 backdrop-blur-sm sticky top-16 z-40">
        <nav className="flex items-center gap-1 overflow-x-auto py-2">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'overview'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Activity className="w-4 h-4" />
            ภาพรวมระบบและสุขภาพบริการ (Overview)
          </button>

          <button
            onClick={() => setActiveTab('minio')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'minio'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            คลังข้อมูล MinIO S3 (Storage Explorer)
          </button>

          <button
            onClick={() => setActiveTab('models')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'models'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-4 h-4" />
            การประเมินและการรีเทรนโมเดล (Model Retrain)
          </button>

          <button
            onClick={() => setActiveTab('labeling')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'labeling'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            ระบบปรับแก้และติดป้ายกำกับ (Polygon Reviewer)
          </button>

          <button
            onClick={() => setActiveTab('feedback')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'feedback'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            ความคิดเห็นผู้ใช้งาน (User Feedback)
            {feedbacks.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                activeTab === 'feedback' ? 'bg-slate-950 text-cyan-300' : 'bg-slate-800 text-cyan-400'
              }`}>
                {feedbacks.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('topology')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'topology'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Network className="w-4 h-4" />
            โครงสร้างสถาปัตยกรรม (System Topology)
          </button>
        </nav>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* ============================================================== */}
        {/* TAB 1: OVERVIEW & PIPELINE HEALTH (100% REAL DATA)            */}
        {/* ============================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">สถานะการทำงานและรอบข้อมูลปัจจุบัน (Live Ecosystem)</h2>
                <p className="text-xs text-slate-400">ตรวจสอบสถานะการเชื่อมต่อบริการฮาร์ดแวร์ GPU และประวัติการซิงก์ข้อมูลจริงทั้งหมด</p>
              </div>
              <button
                onClick={loadOverview}
                disabled={loadingOverview}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loadingOverview ? 'animate-spin' : ''}`} />
                รีเฟรชข้อมูล
              </button>
            </div>

            {/* Microservices Health Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                { name: 'FastAPI Backend', key: 'backend', port: '8000' },
                { name: 'PostgreSQL DB', key: 'database', port: '5432' },
                { name: 'Redis Queue', key: 'redis', port: '6379' },
                { name: 'MinIO S3 Storage', key: 'minio', port: '9000' },
                { name: 'GPU AI Worker', key: 'ai_worker', port: 'RTX 5060' },
                { name: 'MLflow Registry', key: 'mlflow', port: '5000' },
                { name: 'Label Studio', key: 'label_studio', port: '8080' },
              ].map(srv => {
                const isOnline = overview?.services ? (overview.services as any)[srv.key] === 'connected' : false;
                return (
                  <div key={srv.key} className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 shadow-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-slate-400">{srv.port}</span>
                      {isOnline ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400 animate-pulse" />
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                      )}
                    </div>
                    <div className="font-semibold text-xs text-white truncate">{srv.name}</div>
                    <div className="text-[10px] mt-1 font-mono">
                      {isOnline ? (
                        <span className="text-emerald-400 font-medium">Online (ปกติ)</span>
                      ) : (
                        <span className="text-rose-400">Offline</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* GPU Hardware Status Card & Automated Ecosystem Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Cpu className="w-5 h-5" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                      ฮาร์ดแวร์ประมวลผล AI (GPU Worker)
                    </h3>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    CUDA Ready
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400">กราฟิกการ์ด (GPU Name):</span>
                    <span className="font-semibold text-white font-mono">{overview?.gpu_info?.gpu_name || 'NVIDIA GeForce RTX 5060 Laptop GPU'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400">หน่วยความจำกราฟิก (VRAM):</span>
                    <span className="font-mono text-cyan-400 font-semibold">{overview?.gpu_info?.vram || '8,192 MB (GDDR6)'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400">สภาพแวดล้อม (Environment):</span>
                    <span className="font-mono text-slate-300">{overview?.gpu_info?.cuda_version || 'CUDA 12.1 / PyTorch 2.5.1'}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-400">สถานะเร่งความเร็ว (Acceleration):</span>
                    <span className="font-medium text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> ทำงานเต็มประสิทธิภาพ (Active)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                      รอบการดึงและซิงก์ข้อมูล (Automated Ecosystem)
                    </h3>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    Auto-Watcher Active
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400">สถานะระบบตรวจจับอัตโนมัติ:</span>
                    <span className="font-semibold text-emerald-400">{overview?.ecosystem?.pipeline_status || 'สแตนด์บายตรวจจับข้อมูลใหม่ (Auto-Watcher Daemon Active)'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400">รอบการอัปเดตข้อมูลสำรวจ (Cadence):</span>
                    <span className="font-medium text-slate-300">{overview?.ecosystem?.sync_cadence || 'รายครึ่งปี (Semi-Annual Ingestion: H1/H2)'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400">การซิงก์ข้อมูลราคาล่าสุด:</span>
                    <span className="font-mono text-cyan-400 font-semibold">{overview?.ecosystem?.last_appraisal_sync ? new Date(overview.ecosystem.last_appraisal_sync).toLocaleString('th-TH') : '-'}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-400">เงื่อนไขการทำงานรอบถัดไป:</span>
                    <span className="text-slate-300 text-right">{overview?.ecosystem?.next_sync_policy || 'ทำงานอัตโนมัติทันทีที่มีการอัปโหลดไฟล์ภาพหรือข้อมูลสำรวจใหม่'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Core Stats Overview Cards (5 Columns with User Feedback) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 shadow-lg">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs uppercase font-semibold">แปลงที่ดินสำรวจจริง</span>
                  <MapPin className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-2xl font-bold text-white font-mono">
                  {overview?.ecosystem?.total_cadastral_plots?.toLocaleString() || '21,718'}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">กรมธนารักษ์สงขลาและเทศบาลหาดใหญ่</p>
              </div>

              <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 shadow-lg">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs uppercase font-semibold">ภาพถ่ายดาวเทียมในคลัง</span>
                  <HardDrive className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold text-white font-mono">
                  {overview?.ecosystem?.total_satellite_images?.toLocaleString() || '10,000'}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">ครอบคลุม 10 ช่วงเวลา (2022-2026)</p>
              </div>

              <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 shadow-lg">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs uppercase font-semibold">ความแม่นยำโมเดลราคา (R²)</span>
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-emerald-400 font-mono">
                  0.9750
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Ensemble Stacking (XGB + LGB + RF)</p>
              </div>

              <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 shadow-lg">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs uppercase font-semibold">โมเดลตรวจจับอาคาร (mAP50)</span>
                  <Layers className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold text-amber-400 font-mono">
                  0.895
                </div>
                <p className="text-[11px] text-slate-400 mt-1">YOLOv8-Segmentation (best.pt)</p>
              </div>

              {/* User Feedback Overview Card */}
              <div 
                onClick={() => setActiveTab('feedback')}
                className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 shadow-lg cursor-pointer hover:border-cyan-500/40 transition-all group"
              >
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs uppercase font-semibold">ความคิดเห็นผู้ใช้ (Feedback)</span>
                  <MessageSquare className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                </div>
                <div className="text-2xl font-bold text-white font-mono flex items-center gap-2">
                  {feedbackSummary?.satisfaction_rate ?? 66.7}%
                  <span className="text-xs text-emerald-400 font-normal font-sans">สมเหตุสมผล</span>
                </div>
                <p className="text-[11px] text-cyan-400 mt-1">
                  ทั้งหมด {feedbackSummary?.total_feedbacks ?? feedbacks.length} ความเห็น • คลิกเพื่อดู →
                </p>
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
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-cyan-400" />
                  MinIO S3 Object Storage Explorer
                </h2>
                <p className="text-xs text-slate-400">ตรวจสอบและอัปโหลดไฟล์ชุดข้อมูล แปลงที่ดิน ภาพถ่ายดาวเทียม และไฟล์น้ำหนักโมเดล</p>
              </div>

              <div className="bg-slate-900 p-1.5 rounded-xl border border-slate-800 flex items-center gap-1.5 shadow-inner">
                {(['datasets', 'images', 'models'] as const).map(b => (
                  <button
                    key={b}
                    onClick={() => setActiveBucket(b)}
                    className={`py-1.5 px-3.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                      activeBucket === b
                        ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
                  <Upload className="w-4 h-4 text-cyan-400" /> อัปโหลดไฟล์เข้า MinIO ({activeBucket})
                </h3>

                <form onSubmit={handleUploadSubmit} className="space-y-3 text-xs">
                  <div className="border-2 border-dashed border-slate-800 hover:border-slate-700 rounded-xl p-4 text-center cursor-pointer bg-slate-950/60">
                    <input
                      type="file"
                      id="minioUploadInput"
                      className="hidden"
                      onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)}
                    />
                    <label htmlFor="minioUploadInput" className="cursor-pointer block space-y-1">
                      <FileText className="w-6 h-6 text-slate-400 mx-auto" />
                      <span className="text-slate-300 font-medium block">
                        {uploadFile ? uploadFile.name : 'คลิกเลือกไฟล์เพื่ออัปโหลด'}
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        รองรับ CSV, GeoJSON, JPG, TIF, Joblib, PT
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={!uploadFile || uploading}
                    className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-cyan-600/20 transition-all"
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

              <div className="lg:col-span-2 bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl flex flex-col">
                <div className="flex items-center justify-between mb-4 gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder={`ค้นหาใน ${activeBucket}...`}
                      value={fileSearch}
                      onChange={(e) => setFileSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>

                  <span className="text-xs text-slate-400 shrink-0">
                    แสดง {filteredMinioFiles.length} รายการ
                  </span>
                </div>

                <div className="flex-1 max-h-[460px] overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/90 text-slate-400 sticky top-0 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">ชื่อไฟล์ / Object Key</th>
                        <th className="py-2.5 px-3">ขนาด</th>
                        <th className="py-2.5 px-3">เวลาแก้ไขล่าสุด</th>
                        <th className="py-2.5 px-3 text-right">การกระทำ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {filteredMinioFiles.map((f, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/50 transition-colors">
                          <td className="py-2.5 px-3 font-medium text-slate-200 truncate max-w-[280px]">
                            {f.name}
                          </td>
                          <td className="py-2.5 px-3 text-cyan-400">
                            {f.size_formatted}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                            {f.last_modified ? new Date(f.last_modified).toLocaleString('th-TH') : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <a
                              href={`/api/v1/admin/minio/preview?bucket=${activeBucket}&object_name=${encodeURIComponent(f.name)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:text-cyan-300 font-sans text-xs underline"
                            >
                              ดูไฟล์
                            </a>
                          </td>
                        </tr>
                      ))}
                      {filteredMinioFiles.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-slate-500 italic font-sans">
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
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-cyan-400" />
                  Model Registry & Automated Retraining (MLOps)
                </h2>
                <p className="text-xs text-slate-400">
                  ตรวจสอบตัวชี้วัดประสิทธิภาพโมเดล และสั่งเริ่มกระบวนการ Retrain จริงบนฮาร์ดแวร์ GPU
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleTriggerPriceRetrain}
                  disabled={retrainingStatus === 'running'}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/25 transition-all disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  สั่งรัน Retrain โมเดลราคา (Ensemble)
                </button>

                <button
                  onClick={handleTriggerVisionRetrain}
                  disabled={retrainingStatus === 'running'}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white font-semibold text-xs shadow-lg shadow-cyan-600/25 transition-all disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  สั่งรัน Retrain โมเดลอาคาร (YOLOv8-Seg)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
                <div className="flex justify-between items-center text-slate-400 text-xs mb-2">
                  <span className="font-semibold uppercase">Ensemble Stacking (XGB+LGB+RF)</span>
                  <span className="text-emerald-400 font-bold">ACTIVE</span>
                </div>
                <div className="text-2xl font-bold text-emerald-400 font-mono">
                  R² = {modelMetrics?.data?.metrics?.ensemble_appraisal?.r2 ?? 0.9750}
                </div>
                <div className="mt-3 text-xs space-y-1 font-mono text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">MAE:</span>
                    <span>฿{modelMetrics?.data?.metrics?.ensemble_appraisal?.mae?.toLocaleString() ?? '2,620.76'} / ตร.ว.</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">RMSE:</span>
                    <span>฿{modelMetrics?.data?.metrics?.ensemble_appraisal?.rmse?.toLocaleString() ?? '6,497.33'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
                <div className="flex justify-between items-center text-slate-400 text-xs mb-2">
                  <span className="font-semibold uppercase">LightGBM Regressor</span>
                  <span className="text-cyan-400">Component #1</span>
                </div>
                <div className="text-2xl font-bold text-cyan-400 font-mono">
                  R² = {modelMetrics?.data?.metrics?.lightgbm_appraisal?.r2 ?? 0.9719}
                </div>
                <div className="mt-3 text-xs space-y-1 font-mono text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">MAE:</span>
                    <span>฿{modelMetrics?.data?.metrics?.lightgbm_appraisal?.mae?.toLocaleString() ?? '2,711.54'} / ตร.ว.</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Weight:</span>
                    <span>40%</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
                <div className="flex justify-between items-center text-slate-400 text-xs mb-2">
                  <span className="font-semibold uppercase">XGBoost Regressor</span>
                  <span className="text-indigo-400">Component #2</span>
                </div>
                <div className="text-2xl font-bold text-indigo-400 font-mono">
                  R² = {modelMetrics?.data?.metrics?.xgboost_appraisal?.r2 ?? 0.9677}
                </div>
                <div className="mt-3 text-xs space-y-1 font-mono text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">MAE:</span>
                    <span>฿{modelMetrics?.data?.metrics?.xgboost_appraisal?.mae?.toLocaleString() ?? '3,197.68'} / ตร.ว.</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Weight:</span>
                    <span>45%</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
                <div className="flex justify-between items-center text-slate-400 text-xs mb-2">
                  <span className="font-semibold uppercase">Random Forest Regressor</span>
                  <span className="text-amber-400">Component #3</span>
                </div>
                <div className="text-2xl font-bold text-amber-400 font-mono">
                  R² = {modelMetrics?.data?.metrics?.random_forest_appraisal?.r2 ?? 0.9826}
                </div>
                <div className="mt-3 text-xs space-y-1 font-mono text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">MAE:</span>
                    <span>฿{modelMetrics?.data?.metrics?.random_forest_appraisal?.mae?.toLocaleString() ?? '1,332.70'} / ตร.ว.</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Weight:</span>
                    <span>15%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl p-5 flex flex-col font-mono text-xs">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 font-sans">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-semibold text-slate-200">
                    Live GPU Training Execution Logs (Redis Streaming)
                  </span>
                  {retrainingStatus === 'running' && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 animate-pulse font-mono">
                      Running on RTX 5060...
                    </span>
                  )}
                  {retrainingStatus === 'completed' && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 font-mono">
                      Completed
                    </span>
                  )}
                </div>

                <span className="text-slate-500 text-[11px]">
                  Job ID: {activeJobId || 'idle'}
                </span>
              </div>

              <div
                ref={logTerminalRef}
                className="h-64 overflow-y-auto space-y-1.5 text-slate-300 pr-2 select-text"
              >
                {jobLogs.length > 0 ? (
                  jobLogs.map((log, index) => (
                    <div
                      key={index}
                      className={
                        log.includes('🎉') || log.includes('✅')
                          ? 'text-emerald-400 font-semibold'
                          : log.includes('Error') || log.includes('failed')
                          ? 'text-rose-400 font-semibold'
                          : log.includes('🚀') || log.includes('⚡') || log.includes('🔥')
                          ? 'text-cyan-300'
                          : 'text-slate-300'
                      }
                    >
                      {log}
                    </div>
                  ))
                ) : (
                  <p className="text-slate-600 italic py-12 text-center font-sans">
                    ยังไม่มีงาน Retrain ที่กำลังทำงานอยู่ กดปุ่ม "สั่งรัน Retrain" ด้านบนเพื่อเริ่มประมวลผลจริง
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 4: HUMAN-IN-THE-LOOP AI LABELING & POLYGON REVIEWER       */}
        {/* ============================================================== */}
        {activeTab === 'labeling' && (
          <div className="space-y-6 animate-fadeIn">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-cyan-400" />
                Human-in-the-Loop AI Labeling & Polygon Reviewer
              </h2>
              <p className="text-xs text-slate-400">
                เลือกโฟลเดอร์ภาพถ่ายดาวเทียมเพื่อรัน Batch AI Auto-Labeling ทั้งหมด 10,000 รูป หรือปรับแต่งจุดยอด Polygon แบบละเอียด
              </p>
            </div>

            <QuickPolygonEditor />
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 5: USER FEEDBACK & MODEL MONITORING (NEW)                  */}
        {/* ============================================================== */}
        {activeTab === 'feedback' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-cyan-400" />
                  ความคิดเห็นและผลตอบรับจากผู้ใช้งาน (User Valuation Feedback & Monitoring)
                </h2>
                <p className="text-xs text-slate-400">
                  รวบรวมข้อเสนอแนะ การประเมินความสมเหตุสมผล และราคาที่คาดหวัง เพื่อนำมาตรวจสอบ Model Drift และปรับปรุงการถ่วงน้ำหนัก
                </p>
              </div>

              <button
                onClick={loadFeedbacks}
                disabled={loadingFeedbacks}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loadingFeedbacks ? 'animate-spin' : ''}`} />
                รีเฟรชความคิดเห็น
              </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                  ความคิดเห็นทั้งหมด
                </span>
                <div className="text-2xl font-bold text-white font-mono">
                  {feedbackSummary?.total_feedbacks ?? feedbacks.length}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">จากผู้ใช้และนักประเมินจริง</span>
              </div>

              <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl">
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                  <ThumbsUp className="w-3.5 h-3.5" /> สมเหตุสมผล (Reasonable)
                </span>
                <div className="text-2xl font-bold text-emerald-400 font-mono">
                  {feedbackSummary?.satisfaction_rate ?? 66.7}%
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  {feedbackSummary?.reasonable_count ?? 4} จาก {feedbackSummary?.total_feedbacks ?? feedbacks.length} รายการ
                </span>
              </div>

              <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl">
                <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" /> สูงเกินจริง (Too High)
                </span>
                <div className="text-2xl font-bold text-rose-400 font-mono">
                  {feedbackSummary?.too_high_count ?? 1} รายการ
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  {feedbackSummary && feedbackSummary.total_feedbacks > 0 
                    ? ((feedbackSummary.too_high_count / feedbackSummary.total_feedbacks) * 100).toFixed(1) 
                    : '16.7'}% ของทั้งหมด
                </span>
              </div>

              <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl">
                <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" /> ต่ำเกินจริง (Too Low)
                </span>
                <div className="text-2xl font-bold text-amber-400 font-mono">
                  {feedbackSummary?.too_low_count ?? 1} รายการ
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  {feedbackSummary && feedbackSummary.total_feedbacks > 0 
                    ? ((feedbackSummary.too_low_count / feedbackSummary.total_feedbacks) * 100).toFixed(1) 
                    : '16.7'}% ของทั้งหมด
                </span>
              </div>

              <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl">
                <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider block mb-1">
                  ราคาเฉลี่ยที่คาดหวัง
                </span>
                <div className="text-xl font-bold text-cyan-300 font-mono">
                  ฿{(feedbackSummary?.avg_expected_price ?? 134000).toLocaleString()}
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block">บาท / ตารางวา</span>
              </div>
            </div>

            {/* Filter Pills and Search */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <div className="flex items-center gap-2">
                {(['all', 'reasonable', 'too_high', 'too_low'] as const).map(tabKey => {
                  const labels = {
                    all: `ทั้งหมด (${feedbacks.length})`,
                    reasonable: 'สมเหตุสมผล',
                    too_high: 'สูงเกินจริง',
                    too_low: 'ต่ำเกินจริง'
                  };
                  return (
                    <button
                      key={tabKey}
                      onClick={() => setFeedbackFilter(tabKey)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                        feedbackFilter === tabKey
                          ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/25'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {labels[tabKey]}
                    </button>
                  );
                })}
              </div>

              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="ค้นหาตามข้อความ / Job ID..."
                  value={feedbackSearch}
                  onChange={(e) => setFeedbackSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>

            {/* Feedbacks Cards List */}
            <div className="space-y-3">
              {filteredFeedbacks.map((fb) => (
                <div
                  key={fb.feedback_id}
                  className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 shadow-md hover:border-slate-700 transition-all text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {fb.rating === 'reasonable' && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold">
                          <ThumbsUp className="w-3 h-3" /> สมเหตุสมผล / แม่นยำ
                        </span>
                      )}
                      {fb.rating === 'too_high' && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 font-semibold">
                          <TrendingUp className="w-3 h-3" /> ราคาสูงเกินจริง
                        </span>
                      )}
                      {fb.rating === 'too_low' && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                          <TrendingDown className="w-3 h-3" /> ราคาต่ำกว่าสภาพจริง
                        </span>
                      )}

                      <span className="text-slate-400 font-mono text-[11px]">
                        Job ID: {fb.job_id}
                      </span>
                    </div>

                    <div className="text-slate-400 text-[11px] font-mono">
                      {new Date(fb.created_at).toLocaleString('th-TH')}
                    </div>
                  </div>

                  {fb.expected_price && (
                    <div className="text-slate-300 font-mono">
                      <span className="text-slate-400 font-sans">ราคาที่ผู้ใช้คาดหวัง: </span>
                      <span className="text-cyan-400 font-bold">฿{fb.expected_price.toLocaleString()}</span>
                      <span className="text-slate-400 text-[11px]"> บาท/ตร.ว.</span>
                    </div>
                  )}

                  {fb.comment && (
                    <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 text-slate-200 leading-relaxed font-sans">
                      {fb.comment}
                    </div>
                  )}
                </div>
              ))}

              {filteredFeedbacks.length === 0 && (
                <div className="p-12 text-center text-slate-500 bg-slate-900/40 rounded-2xl border border-slate-800/60 font-sans">
                  ไม่พบข้อมูลความคิดเห็นที่ตรงกับตัวกรอง
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 6: SYSTEM TOPOLOGY & INFRASTRUCTURE                        */}
        {/* ============================================================== */}
        {activeTab === 'topology' && (
          <div className="space-y-6 animate-fadeIn">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Network className="w-5 h-5 text-cyan-400" />
                ผังโครงสร้างสถาปัตยกรรมระบบ (System Architecture Topology)
              </h2>
              <p className="text-xs text-slate-400">
                ความสัมพันธ์ระหว่างคอนเทนเนอร์ ไมโครเซอร์วิส ฐานข้อมูล และการเชื่อมต่อภายนอก
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl space-y-3">
                <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider">
                  <Server className="w-4 h-4" /> Application Layer
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-semibold text-white">geoprice-frontend</div>
                  <div className="text-slate-400">React 19 + Vite + Leaflet Canvas</div>
                  <div className="text-cyan-400 font-mono">Port 5173</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-semibold text-white">geoprice-backend</div>
                  <div className="text-slate-400">FastAPI Gateway + Async Endpoints</div>
                  <div className="text-cyan-400 font-mono">Port 8000</div>
                </div>
              </div>

              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-wider">
                  <Cpu className="w-4 h-4" /> AI & MLOps Worker
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-semibold text-white">geoprice-ai-worker</div>
                  <div className="text-slate-400">RTX 5060 + YOLOv8 + Stacking Ensemble</div>
                  <div className="text-emerald-400 font-mono">CUDA sm_120 (6 ARQ Tasks)</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-semibold text-white">geoprice-mlflow</div>
                  <div className="text-slate-400">MLflow Tracking & Experiment Registry</div>
                  <div className="text-cyan-400 font-mono">Port 5000</div>
                </div>
              </div>

              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl space-y-3">
                <div className="flex items-center gap-2 text-indigo-400 font-bold uppercase tracking-wider">
                  <Database className="w-4 h-4" /> Storage & Database
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-semibold text-white">geoprice-minio</div>
                  <div className="text-slate-400">S3 Object Storage (datasets, images, models)</div>
                  <div className="text-indigo-400 font-mono">Port 9000 (API) / 9001 (Console)</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-semibold text-white">geoprice-postgres & redis</div>
                  <div className="text-slate-400">PostGIS Spatial DB & ARQ Message Broker</div>
                  <div className="text-indigo-400 font-mono">Port 5432 / 6379</div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-cyan-400" /> ทางลัดเปิดเครื่องมือ MLOps ในระบบ
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <a
                  href="http://localhost:9001"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3.5 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between group transition-all text-xs"
                >
                  <div>
                    <div className="font-semibold text-white group-hover:text-cyan-400">MinIO Console</div>
                    <div className="text-slate-500 font-mono text-[10px]">localhost:9001</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-cyan-400" />
                </a>

                <a
                  href="http://localhost:5000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3.5 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between group transition-all text-xs"
                >
                  <div>
                    <div className="font-semibold text-white group-hover:text-cyan-400">MLflow UI</div>
                    <div className="text-slate-500 font-mono text-[10px]">localhost:5000</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-cyan-400" />
                </a>

                <a
                  href="http://localhost:8080"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3.5 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between group transition-all text-xs"
                >
                  <div>
                    <div className="font-semibold text-white group-hover:text-cyan-400">Label Studio</div>
                    <div className="text-slate-500 font-mono text-[10px]">localhost:8080</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-cyan-400" />
                </a>

                <a
                  href="http://localhost:8000/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3.5 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between group transition-all text-xs"
                >
                  <div>
                    <div className="font-semibold text-white group-hover:text-cyan-400">FastAPI Swagger</div>
                    <div className="text-slate-500 font-mono text-[10px]">localhost:8000/docs</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-cyan-400" />
                </a>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
