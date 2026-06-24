'use client';

import { CheckCircle, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';

interface ToastProps {
  message: string;
  variant: 'success' | 'error';
  onClose: () => void;
  /** Auto-dismiss after ms. Default: 3000. Pass 0 to disable. */
  duration?: number;
}

export default function Toast({
  message,
  variant,
  onClose,
  duration = 3000,
}: ToastProps) {
  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const isSuccess = variant === 'success';

  const containerClass = [
    'flex items-center gap-3 rounded-[10px] border px-4 py-3 shadow-md text-[13px] font-medium',
    isSuccess
      ? 'border-[#A7D7B8] bg-[#DFF3E7] text-[#087443]'
      : 'border-[#F3B8AD] bg-[#FFF4F1] text-[#B42318]',
  ].join(' ');

  return (
    <div
      role="alert"
      aria-live="polite"
      className="pointer-events-auto"
    >
      <div className={containerClass}>
        {isSuccess ? (
          <CheckCircle className="h-4 w-4 shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0" />
        )}
        <span className="flex-1">{message}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 opacity-60 hover:opacity-100 transition"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
