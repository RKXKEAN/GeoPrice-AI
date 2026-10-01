import React, { useState } from 'react';
import { ShieldCheck, Lock, User, ArrowLeft, KeyRound, AlertCircle, Loader2 } from 'lucide-react';
import { adminApi } from '../services/adminApi';
import type { AdminUser } from '../services/adminApi';

interface AdminLoginProps {
  onLoginSuccess: (user: AdminUser) => void;
  onBackToMap: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess, onBackToMap }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('geoprice2026');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await adminApi.login(username, password);
      localStorage.setItem('geoprice_admin_token', data.token);
      localStorage.setItem('geoprice_admin_user', JSON.stringify(data));
      onLoginSuccess(data);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err?.response?.data?.detail || 'การยืนยันตัวตนล้มเหลว กรุณาตรวจสอบชื่อผู้ใช้งานและรหัสผ่าน');
    } finally {
      setLoading(false);
    }
  };

  const handleFillDemo = () => {
    setUsername('admin');
    setPassword('geoprice2026');
    setError(null);
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Back button */}
      <button
        onClick={onBackToMap}
        className="absolute top-6 left-6 z-20 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-all text-xs font-medium shadow-lg backdrop-blur-md"
      >
        <ArrowLeft className="w-4 h-4" />
        กลับไปยังแผนที่หลัก (Map View)
      </button>

      {/* Login Card */}
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl p-8 backdrop-blur-xl relative z-10">
        {/* Brand Icon & Heading */}
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 text-cyan-400 mb-3 shadow-inner">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide">
            GeoPrice MLOps Console
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            แผงควบคุมดูแลระบบอัตโนมัติ สำหรับผู้ดูแลระบบ (Admin Maintenance)
          </p>
        </div>

        {/* Demo Credentials Auto-Fill Button */}
        <div className="mb-6 p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs">
          <div>
            <span className="text-slate-400 block font-medium">รหัสผ่านทดสอบ (Demo)</span>
            <span className="text-cyan-400 font-mono">admin / geoprice2026</span>
          </div>
          <button
            type="button"
            onClick={handleFillDemo}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition-all font-medium"
          >
            <KeyRound className="w-3 h-3" /> กรอกอัตโนมัติ
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 animate-shake">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
              ชื่อผู้ใช้งาน (Admin Username)
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ระบุชื่อผู้ใช้"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
              รหัสผ่าน (Password)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-sm shadow-lg shadow-cyan-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                กำลังตรวจสอบสิทธิ์...
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                เข้าสู่แผงควบคุม MLOps
              </>
            )}
          </button>
        </form>

        {/* Security Footer Note */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-center">
          <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1">
            <Lock className="w-3 h-3 text-slate-400" />
            ระบบรักษาความปลอดภัยแบบเข้ารหัส สำหรับการบริหารจัดการ MLOps
          </p>
        </div>
      </div>
    </div>
  );
};
