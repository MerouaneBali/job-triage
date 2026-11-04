import { Badge } from "@/components/ui/badge";
import type { Decision } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DecisionBadge({ decision }: { decision?: Decision }) {
  if (!decision) {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        —
      </Badge>
    );
  }
  return (
    <Badge
      className={cn(
        "capitalize font-medium",
        decision === "apply" &&
          "border-transparent bg-emerald-600/15 text-emerald-800 dark:text-emerald-300",
        decision === "maybe" &&
          "border-transparent bg-amber-500/15 text-amber-900 dark:text-amber-200",
        decision === "skip" &&
          "border-transparent bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
      )}
      variant="outline"
    >
      {decision}
    </Badge>
  );
}
