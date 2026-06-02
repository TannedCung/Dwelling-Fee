"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icon";

/**
 * App-wide toast notifications — the single channel for transient user feedback
 * (errors and confirmations) from client components, replacing the per-component
 * inline `setErr`/`setMsg` state. Mounted once in the root layout via
 * <ToastProvider>; components call `useToast().notify({ type, message })`.
 *
 * Live, in-place progress (e.g. a long geocode loop's running count) stays inline
 * in its component — toasts are for outcomes, not continuous status.
 */

export type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  notify: (toast: { type?: ToastType; message: string; duration?: number }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const ICON: Record<ToastType, string> = {
  success: "check-circle",
  error: "triangle-alert",
  info: "info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<ToastApi["notify"]>(
    ({ type = "info", message, duration }) => {
      const id = (nextId.current += 1);
      setToasts((list) => [...list, { id, type, message }]);
      const ms = duration ?? (type === "error" ? 8000 : 4000);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ notify, dismiss }}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role={t.type === "error" ? "alert" : "status"}>
            <Icon name={ICON[t.type]} size={16} />
            <span className="toast-msg">{t.message}</span>
            <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
