import { Globe } from "lucide-react";
import type { WebSource } from "@catgpt/types";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Citations under a web-searched answer — each opens the source in a new tab. */
export function SourceChips({ sources }: { sources: WebSource[] }) {
  // Search often returns several pages from one site - show each site once.
  const seen = new Set<string>();
  const unique = sources.filter((s) => {
    // Only http(s) — never render javascript:/data: links.
    if (!/^https?:\/\//i.test(s.url)) return false;
    const host = hostOf(s.url);
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Globe className="h-3 w-3" />
        Sources
      </span>
      {unique.slice(0, 6).map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={s.title}
          className="max-w-[14rem] truncate rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {hostOf(s.url)}
        </a>
      ))}
    </div>
  );
}
