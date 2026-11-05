"use client";

import { useEffect, useState } from "react";
import {
  flushQueue,
  isProbablyOnline,
  onOfflineSynced,
  onPendingChange,
  pendingCount,
} from "@/lib/offline-store";
import { CloudOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onSynced?: () => void;
};

export function OfflineBanner({ onSynced }: Props) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const updateOnline = () => setOnline(isProbablyOnline());
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    void pendingCount().then(setPending);
    const offPending = onPendingChange(setPending);
    const offSynced = onOfflineSynced((detail) => {
      setPending(detail.remaining);
      if (detail.flushed > 0) onSynced?.();
    });

    const tryFlush = () => {
      if (!isProbablyOnline()) return;
      setSyncing(true);
      void flushQueue()
        .then((r) => setPending(r.remaining))
        .finally(() => setSyncing(false));
    };

    window.addEventListener("online", tryFlush);
    const onVis = () => {
      if (document.visibilityState === "visible") tryFlush();
    };
    document.addEventListener("visibilitychange", onVis);
    tryFlush();

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("online", tryFlush);
      document.removeEventListener("visibilitychange", onVis);
      offPending();
      offSynced();
    };
  }, [onSynced]);

  if (online && pending === 0 && !syncing) return null;

  const message = !online
    ? pending > 0
      ? `Offline — showing cached data · ${pending} change${pending === 1 ? "" : "s"} waiting to sync`
      : "Offline — showing cached data"
    : syncing
      ? `Syncing ${pending || ""} change${pending === 1 ? "" : "s"}…`
      : `${pending} change${pending === 1 ? "" : "s"} waiting to sync`;

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b px-3 py-2 text-xs sm:text-sm",
        !online
          ? "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100"
          : "border-sky-500/30 bg-sky-500/10 text-sky-950 dark:text-sky-100"
      )}
      role="status"
    >
      {!online ? (
        <CloudOff className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <RefreshCw
          className={cn("size-3.5 shrink-0", syncing && "animate-spin")}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}
