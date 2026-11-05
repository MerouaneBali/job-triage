"use client";

import { useEffect, useState } from "react";
import { isProbablyOnline } from "@/lib/offline-store";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(isProbablyOnline());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
