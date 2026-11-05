import { Badge } from "@/components/ui/badge";
import type { TrackStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  CheckCircle2,
  CircleDashed,
  Hourglass,
  XCircle,
} from "lucide-react";

const META: Record<
  TrackStatus,
  {
    label: string;
    icon: typeof CircleDashed;
    className: string;
  }
> = {
  todo: {
    label: "Todo",
    icon: CircleDashed,
    className:
      "border-transparent bg-sky-600/15 text-sky-900 dark:text-sky-200",
  },
  applied: {
    label: "Applied",
    icon: CheckCircle2,
    className:
      "border-transparent bg-emerald-600/15 text-emerald-800 dark:text-emerald-300",
  },
  waiting: {
    label: "Waiting",
    icon: Hourglass,
    className:
      "border-transparent bg-amber-500/15 text-amber-900 dark:text-amber-200",
  },
  closed: {
    label: "Closed",
    icon: XCircle,
    className:
      "border-transparent bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  },
};

export function TrackStatusBadge({
  status,
  className,
}: {
  status?: TrackStatus | null;
  className?: string;
}) {
  if (!status) {
    return (
      <Badge
        variant="outline"
        className={cn("gap-1 font-normal text-muted-foreground", className)}
      >
        <Briefcase className="size-3 opacity-50" aria-hidden />
        —
      </Badge>
    );
  }
  const meta = META[status];
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium", meta.className, className)}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {meta.label}
    </Badge>
  );
}

export const TRACK_STATUS_META = META;
