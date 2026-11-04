import { Badge } from "@/components/ui/badge";
import type { TaggedItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const TAG_STYLES: Record<TaggedItem["tag"], string> = {
  match:
    "border-emerald-600/30 bg-emerald-600/15 text-emerald-900 dark:text-emerald-200",
  partial_match:
    "border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100",
  gap: "border-rose-500/40 bg-rose-500/15 text-rose-900 dark:text-rose-200",
  unknown:
    "border-zinc-400/40 bg-zinc-500/10 text-zinc-800 dark:text-zinc-200",
};

const ROW_STYLES: Record<TaggedItem["tag"], string> = {
  match: "border-l-4 border-l-emerald-600 bg-emerald-50/80",
  partial_match: "border-l-4 border-l-amber-500 bg-amber-50/80",
  gap: "border-l-4 border-l-rose-500 bg-rose-50/80",
  unknown: "border-l-4 border-l-zinc-400 bg-zinc-50/80",
};

export function TagList({
  items,
  empty = "None",
}: {
  items?: TaggedItem[] | null;
  empty?: string;
}) {
  if (!items?.length) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((t, i) => (
        <li
          key={`${t.item}-${i}`}
          className={cn("rounded-md border px-3 py-2", ROW_STYLES[t.tag])}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium leading-snug">{t.item}</span>
            <Badge variant="outline" className={TAG_STYLES[t.tag]}>
              {t.tag.replace("_", " ")}
            </Badge>
          </div>
          {t.evidence ? (
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {t.evidence}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
