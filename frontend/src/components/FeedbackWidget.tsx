import React, { useState } from 'react';
import axios from 'axios';
import { 
  ThumbsUp, 
  TrendingUp, 
  TrendingDown, 
  CheckCircle2, 
  Send, 
  AlertCircle,
  Loader2
} from 'lucide-react';

interface FeedbackWidgetProps {
  jobId: string;
}

type RatingType = 'reasonable' | 'too_high' | 'too_low' | null;

const SPATIAL_FACTOR_TAGS = [
  'ที่ตาบอด / ไม่มีทางเข้าออก',
  'รูปร่างแปลงใช้งานยาก',
  'พื้นที่น้ำท่วมขังบ่อย',
  'ใกล้แนวเวนคืน / ข้อจำกัดทางกฎหมาย'
];

export const FeedbackWidget: React.FC<FeedbackWidgetProps> = ({ jobId }) => {
  const [rating, setRating] = useState<RatingType>(null);
  const [expectedPrice, setExpectedPrice] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSelectRating = (selected: 'reasonable' | 'too_high' | 'too_low') => {
    setRating(selected);
    setErrorMessage(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!rating) return;

    setIsLoading(true);
    setErrorMessage(null);

    // Combine selected tags and user comments
    const combinedComments: string[] = [];
    if (selectedTags.length > 0) {
      combinedComments.push(`ปัจจัยเชิงพื้นที่: ${selectedTags.join(', ')}`);
    }
    if (comment.trim()) {
      combinedComments.push(comment.trim());
    }

    const payload = {
      job_id: jobId,
      rating: rating,
      expected_price: expectedPrice ? parseFloat(expectedPrice) : null,
      comment: combinedComments.length > 0 ? combinedComments.join(' | ') : null
    };

    try {
      // Send to Backend API (supports both relative path via Vite Proxy and direct backend URL)
      try {
        await axios.post('/api/v1/monitoring/feedback', payload);
      } catch (proxyError) {
        // Fallback to direct backend URL if proxy is unavailable
        await axios.post('http://localhost:8000/api/v1/monitoring/feedback', payload);
      }
      setIsSubmitted(true);
    } catch (err: any) {
      console.error('Failed to submit prediction feedback:', err);
      setErrorMessage(
        err.response?.data?.detail || 'เกิดข้อผิดพลาดในการส่งข้อมูล กรุณาลองใหม่อีกครั้ง'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // When successfully submitted
  if (isSubmitted) {
    return (
      <div className="mt-3 p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2.5 shadow-sm animate-fade-in">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>✅ ขอบคุณสำหรับข้อมูล! ระบบจะนำไปพัฒนา AI ให้แม่นยำยิ่งขึ้น</span>
      </div>
    );
  }

  return (
    <div className="mt-3.5 p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-200 text-xs space-y-3 shadow-md">
      {/* Title / Question */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-300">
          คุณคิดว่าราคาประเมินนี้แม่นยำหรือไม่?
        </span>
        <span className="text-[10px] text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 rounded-full font-medium">
          HITL Feedback
        </span>
      </div>

      {/* 3 Rating Buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => handleSelectRating('reasonable')}
          className={`py-2 px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
            rating === 'reasonable'
              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-sm shadow-emerald-500/20'
              : 'bg-slate-800/60 border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
          }`}
        >
          <ThumbsUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>สมเหตุสมผล</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectRating('too_high')}
          className={`py-2 px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
            rating === 'too_high'
              ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm shadow-rose-500/20'
              : 'bg-slate-800/60 border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span>สูงเกินไป</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectRating('too_low')}
          className={`py-2 px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
            rating === 'too_low'
              ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm shadow-amber-500/20'
              : 'bg-slate-800/60 border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
          }`}
        >
          <TrendingDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>ต่ำเกินไป</span>
        </button>
      </div>

      {/* Progressive Disclosure Form for 'too_high' or 'too_low' */}
      {(rating === 'too_high' || rating === 'too_low') && (
        <form onSubmit={handleSubmit} className="space-y-3 pt-2 border-t border-slate-800">
          {/* Expected Price Input */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-400 block">
              ราคาตลาดที่เหมาะสม (บาท) <span className="text-slate-500">(Optional)</span>
            </label>
            <input
              type="number"
              min="0"
              step="1000"
              placeholder="เช่น 15000000"
              value={expectedPrice}
              onChange={(e) => setExpectedPrice(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* Spatial Factor Checkboxes */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-400 block">
              ปัจจัยที่ AI อาจมองไม่เห็น (เลือกได้มากกว่า 1 ข้อ)
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {SPATIAL_FACTOR_TAGS.map((tag) => {
                const isChecked = selectedTags.includes(tag);
                return (
                  <label
                    key={tag}
                    onClick={() => handleTagToggle(tag)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer transition-colors ${
                      isChecked
                        ? 'bg-cyan-950/50 border-cyan-600/60 text-cyan-200'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}} // handled by parent onClick
                      className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 w-3.5 h-3.5 pointer-events-none"
                    />
                    <span>{tag}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Additional Comment Textarea */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-400 block">
              ความคิดเห็นเพิ่มเติม <span className="text-slate-500">(Optional)</span>
            </label>
            <textarea
              rows={2}
              placeholder="ระบุรายละเอียดเพิ่มเติมเพื่อช่วยปรับปรุงโมเดล..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-950/80 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 resize-none"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-3 rounded-lg font-semibold text-xs bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-[0.99] disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>กำลังบันทึกข้อมูล...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>ส่งข้อมูลประเมิน</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* If rating === 'reasonable', provide a simple 1-click submit button */}
      {rating === 'reasonable' && (
        <div className="pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isLoading}
            className="w-full py-2 px-3 rounded-lg font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-[0.99] disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>กำลังบันทึกข้อมูล...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>ส่งข้อมูลประเมิน</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-[11px] text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};

export default FeedbackWidget;
