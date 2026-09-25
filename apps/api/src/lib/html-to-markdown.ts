/**
 * Minimal HTML -> Markdown for mammoth's clean .docx output (headings,
 * paragraphs, nested lists, bold/italic, links, tables). Token-walking rather
 * than regex-nesting so nested lists and inline marks stay correct. Images
 * are dropped; anything unknown is stripped down to its text.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToMarkdown(html: string): string {
  const blocks: { text: string; list: "ul" | "ol" | null }[] = [];
  let buf = "";
  let heading = 0;
  const lists: { ordered: boolean; n: number }[] = [];
  let pendingMarker: string | null = null;
  let pendingKind: "ul" | "ol" = "ul";
  let table: string[][] | null = null;
  let row: string[] | null = null;
  const hrefs: string[] = [];

  const clean = (s: string) =>
    s
      .replace(/\s+/g, " ")
      .replace(/\*\*\s*\*\*/g, "")
      .trim();

  const flush = () => {
    const text = clean(buf);
    buf = "";
    if (!text) return;
    if (heading) {
      blocks.push({ text: `${"#".repeat(Math.min(heading, 4))} ${text}`, list: null });
    } else if (pendingMarker !== null) {
      blocks.push({ text: `${pendingMarker}${text}`, list: pendingKind });
      pendingMarker = null;
    } else {
      blocks.push({ text, list: null });
    }
  };

  const tokens = html.replace(/<img[^>]*>/gi, "").split(/(<[^>]+>)/g);
  for (const tok of tokens) {
    if (!tok) continue;
    const m = tok.match(/^<(\/?)([a-z0-9]+)([^>]*)>$/i);
    if (!m) {
      buf += decode(tok);
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? "";

    if (/^h[1-6]$/.test(tag)) {
      flush();
      heading = closing ? 0 : Number(tag[1]);
    } else if (tag === "p") {
      if (!table) flush();
    } else if (tag === "ul" || tag === "ol") {
      flush();
      if (closing) lists.pop();
      else lists.push({ ordered: tag === "ol", n: 0 });
    } else if (tag === "li") {
      flush();
      if (!closing) {
        const cur = lists[lists.length - 1];
        const indent = "  ".repeat(Math.max(0, lists.length - 1));
        if (cur?.ordered) cur.n += 1;
        pendingMarker = `${indent}${cur?.ordered ? `${cur.n}. ` : "- "}`;
        pendingKind = cur?.ordered ? "ol" : "ul";
      } else {
        pendingMarker = null;
      }
    } else if (tag === "strong" || tag === "b") {
      buf += "**";
    } else if (tag === "em" || tag === "i") {
      buf += "*";
    } else if (tag === "a") {
      if (!closing) {
        hrefs.push(attrs.match(/href="([^"]*)"/i)?.[1] ?? "");
        buf += "[";
      } else {
        const href = hrefs.pop() ?? "";
        buf += href ? `](${decode(href)})` : "]";
      }
    } else if (tag === "br") {
      buf += " ";
    } else if (tag === "table") {
      flush();
      if (!closing) table = [];
      else {
        if (table?.length) {
          const width = Math.max(...table.map((r) => r.length));
          const lines = table.map(
            (r) =>
              `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`,
          );
          lines.splice(1, 0, `| ${Array(width).fill("---").join(" | ")} |`);
          blocks.push({ text: lines.join("\n"), list: null });
        }
        table = null;
      }
    } else if (tag === "tr") {
      if (!closing) row = [];
      else if (row && table) {
        table.push(row);
        row = null;
      }
    } else if (tag === "td" || tag === "th") {
      if (!closing) buf = "";
      else if (row) {
        row.push(clean(buf).replaceAll("|", "/"));
        buf = "";
      }
    }
  }
  flush();

  let out = "";
  blocks.forEach((b, i) => {
    if (i === 0) out = b.text;
    else out += (b.list && b.list === blocks[i - 1]!.list ? "\n" : "\n\n") + b.text;
  });
  return out;
}
