"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function CompanyLogo({
  src,
  company,
  className,
}: {
  src?: string | null;
  company?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (company || "?").trim().charAt(0).toUpperCase() || "?";

  if (!src || failed) {
    return (
      <span
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground",
          className
        )}
        aria-hidden
      >
        {initial}
      </span>
    );
  }

  return (
    // LinkedIn CDN logos; decorative next to company name
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={32}
      height={32}
      className={cn("size-8 shrink-0 rounded-md object-contain bg-white", className)}
      onError={() => setFailed(true)}
    />
  );
}
