'use client';

import { useCallback, useEffect, useState } from 'react';

function normalizeMessage(message) {
  if (message == null) return 'Something needs your attention.';
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message || 'Something went wrong.';
  return String(message);
}

export default function AppAlertDialog() {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    if (current || queue.length === 0) return;
    setCurrent(queue[0]);
    setQueue((items) => items.slice(1));
  }, [current, queue]);

  useEffect(() => {
    const originalAlert = window.alert;

    window.alert = (message) => {
      setQueue((items) => [
        ...items,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          message: normalizeMessage(message),
        },
      ]);
    };

    return () => {
      window.alert = originalAlert;
    };
  }, []);

  const close = useCallback(() => {
    setCurrent(null);
  }, []);

  useEffect(() => {
    if (!current) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        close();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, current]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-alert-title"
        aria-describedby="app-alert-message"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
            <i className="ti ti-alert-circle text-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="app-alert-title" className="text-[15px] font-black text-slate-900">
              Action needed
            </h2>
            <p className="mt-1 text-[12px] font-medium text-slate-500">
              Please check the message below.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close alert"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div className="px-5 py-5">
          <p id="app-alert-message" className="whitespace-pre-wrap text-[14px] font-semibold leading-6 text-slate-800">
            {current.message}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={close}
            autoFocus
            className="min-w-[96px] rounded-xl bg-[#B00000] px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_10px_20px_rgba(176,0,0,0.22)] transition-colors hover:bg-[#930000]"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
