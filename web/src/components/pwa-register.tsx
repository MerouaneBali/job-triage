"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const IOS_HINT_KEY = "jt-ios-install-hint-dismissed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function isIosSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !isStandalone();
}

export function PwaRegister() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Ignore — common on plain HTTP / insecure contexts.
      });
    }

    if (isStandalone()) return;

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    try {
      if (isIosSafari() && sessionStorage.getItem(IOS_HINT_KEY) !== "1") {
        setShowIos(true);
      }
    } catch {
      // sessionStorage blocked
    }

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (!deferred && !showIos) return null;

  return (
    <div className="fixed bottom-20 left-3 right-3 z-40 mx-auto flex max-w-md items-start gap-2 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur md:bottom-4">
      {deferred ? (
        <>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Install Job triage on this phone for a home-screen app.
          </p>
          <Button
            className="min-h-11 shrink-0"
            onClick={async () => {
              await deferred.prompt();
              setDeferred(null);
            }}
          >
            <Download data-icon="inline-start" />
            Install
          </Button>
        </>
      ) : (
        <>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            On iPhone: Share →{" "}
            <span className="font-medium text-foreground">
              Add to Home Screen
            </span>
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 shrink-0"
            aria-label="Dismiss"
            onClick={() => {
              try {
                sessionStorage.setItem(IOS_HINT_KEY, "1");
              } catch {
                // ignore
              }
              setShowIos(false);
            }}
          >
            <X className="size-4" />
          </Button>
        </>
      )}
    </div>
  );
}
