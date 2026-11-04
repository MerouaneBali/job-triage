import { Badge } from "@/components/ui/badge";
import type { TaggedItem } from "@/lib/types";

const TAG_STYLES: Record<TaggedItem["tag"], string> = {
  match: "bg-emerald-600/15 text-emerald-800 border-transparent",
  partial_match: "bg-amber-500/15 text-amber-900 border-transparent",
  gap: "bg-rose-500/15 text-rose-800 border-transparent",
  unknown: "bg-zinc-500/15 text-zinc-700 border-transparent",
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
        <li key={`${t.item}-${i}`} className="rounded-md border px-3 py-2">
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
