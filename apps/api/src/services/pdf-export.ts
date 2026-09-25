import PDFDocument from "pdfkit";

/**
 * Markdown -> PDF rendering for exporting chat replies. Built-in PDF fonts
 * only (Helvetica/Courier) — no font files, renders in a few ms.
 */

export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

export type Block =
  | { type: "table"; rows: Segment[][][] }
  | { type: "heading"; level: number; segments: Segment[] }
  | { type: "paragraph"; segments: Segment[] }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; items: Segment[][] }
  | { type: "quote"; segments: Segment[] }
  | { type: "hr" };

/** Inline markdown: **bold**, *italic*, `code`, [text](url). */
export function parseInline(text: string): Segment[] {
  const re =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ text: text.slice(last, idx) });
    const tok = m[0];
    if (tok.startsWith("**")) {
      segments.push({ text: tok.slice(2, -2), bold: true });
    } else if (tok.startsWith("*")) {
      segments.push({ text: tok.slice(1, -1), italic: true });
    } else if (tok.startsWith("`")) {
      segments.push({ text: tok.slice(1, -1), code: true });
    } else {
      const label = tok.match(/^\[([^\]]+)\]/)?.[1] ?? tok;
      const url = tok.match(/\(([^)\s]+)\)$/)?.[1];
      segments.push({ text: label, link: url });
    }
    last = idx + tok.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.length ? segments : [{ text: "" }];
}

/** Split raw markdown into renderable blocks. */
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isListItem = (l: string) => /^\s*([-*•]|\d+[.)])\s+/.test(l);
  const listOrdered = (l: string) => /^\s*\d+[.)]\s+/.test(l);
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isTableRule = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l);
  const splitTableRow = (l: string) =>
    l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i]!;

    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // closing fence
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      blocks.push({
        type: "heading",
        level: h[1]!.length,
        segments: parseInline(h[2]!),
      });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", segments: parseInline(buf.join(" ")) });
      continue;
    }
    if (isTableRow(line)) {
      const rows: Segment[][][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) {
        // The |---|---| separator row carries no content.
        if (!isTableRule(lines[i]!)) {
          rows.push(splitTableRow(lines[i]!).map(parseInline));
        }
        i++;
      }
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    if (isListItem(line)) {
      const ordered = listOrdered(line);
      const items: Segment[][] = [];
      while (i < lines.length && isListItem(lines[i]!)) {
        items.push(
          parseInline(lines[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, "")),
        );
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: consume until blank line or a block starter.
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^```/.test(lines[i]!) &&
      !/^#{1,4}\s/.test(lines[i]!) &&
      !/^\s*>\s?/.test(lines[i]!) &&
      !isListItem(lines[i]!) &&
      !isTableRow(lines[i]!) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i++;
    }
    blocks.push({ type: "paragraph", segments: parseInline(buf.join(" ")) });
  }
  return blocks;
}

const BODY = 11;
const HEADING_SIZE: Record<number, number> = { 1: 20, 2: 16, 3: 13, 4: 12 };

export function renderMarkdownPdf(
  title: string,
  markdown: string,
  /** bare: no "Exported from CatGPT" title block — the markdown is the whole document. */
  opts: { bare?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: { Title: title, Creator: "CatGPT" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const contentWidth = () =>
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Header: title + timestamp, then a rule.
    if (!opts.bare) {
      doc.font("Helvetica-Bold").fontSize(17).fillColor("#111").text(title, {
        lineGap: 4,
      });
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#888")
        .text(`Exported from CatGPT · ${new Date().toLocaleString()}`);
      doc.moveDown(0.4);
      doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor("#ddd")
        .lineWidth(0.7)
        .stroke();
      doc.moveDown(0.9);
    }

    const writeSegments = (segments: Segment[], baseSize: number) => {
      segments.forEach((seg, idx) => {
        const last = idx === segments.length - 1;
        const font = seg.code
          ? "Courier"
          : seg.bold
            ? "Helvetica-Bold"
            : seg.italic
              ? "Helvetica-Oblique"
              : "Helvetica";
        doc
          .font(font)
          .fontSize(seg.code ? baseSize - 1 : baseSize)
          .fillColor(seg.link ? "#2563eb" : "#111")
          .text(seg.text, {
            continued: !last,
            link: seg.link ?? null,
            underline: Boolean(seg.link),
            lineGap: 3.5,
          });
      });
    };

    for (const block of parseBlocks(markdown)) {
      switch (block.type) {
        case "heading": {
          doc.moveDown(0.5);
          const size = HEADING_SIZE[block.level] ?? 12;
          // Manual bold headings — segment styling is dropped for simplicity.
          const text = block.segments.map((s) => s.text).join("");
          doc
            .font("Helvetica-Bold")
            .fontSize(size)
            .fillColor("#111")
            .text(text, { lineGap: 3 });
          doc.moveDown(0.2);
          break;
        }
        case "paragraph":
          doc.font("Helvetica").fontSize(BODY).fillColor("#111");
          writeSegments(block.segments, BODY);
          doc.moveDown(0.55);
          break;
        case "list": {
          block.items.forEach((item, idx) => {
            const marker = block.ordered ? `${idx + 1}.` : "•";
            doc.font("Helvetica").fontSize(BODY).fillColor("#111");
            doc.text(marker, { indent: 14, continued: true, lineGap: 3.5 });
            doc.text(" ", { continued: true });
            writeSegments(item, BODY);
          });
          doc.moveDown(0.55);
          break;
        }
        case "quote": {
          const startY = doc.y;
          doc.font("Helvetica-Oblique").fontSize(BODY).fillColor("#444");
          doc.x += 14;
          writeSegments(block.segments, BODY);
          doc.x -= 14;
          const endY = doc.y;
          doc
            .moveTo(doc.page.margins.left + 4, startY - 1)
            .lineTo(doc.page.margins.left + 4, endY)
            .strokeColor("#bbb")
            .lineWidth(2)
            .stroke();
          doc.moveDown(0.55);
          break;
        }
        case "code": {
          const text = block.text || " ";
          doc.font("Courier").fontSize(9.5);
          const h = doc.heightOfString(text, {
            width: contentWidth() - 20,
            lineGap: 2.5,
          });
          if (doc.y + h + 16 > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
          }
          const y = doc.y;
          doc
            .roundedRect(
              doc.page.margins.left,
              y,
              contentWidth(),
              h + 16,
              5,
            )
            .fill("#f3f4f6");
          doc
            .fillColor("#1f2937")
            .text(text, doc.page.margins.left + 10, y + 8, {
              width: contentWidth() - 20,
              lineGap: 2.5,
            });
          doc.y = y + h + 16;
          doc.moveDown(0.55);
          break;
        }
        case "table": {
          // pdfkit has no table primitive — rows render as pipe-separated
          // monospace lines, which stays readable and never overflows.
          const text = block.rows
            .map((r) => r.map((c) => c.map((s) => s.text).join("")).join(" | "))
            .join("\n");
          doc.font("Courier").fontSize(9.5).fillColor("#111");
          doc.text(text, { lineGap: 2.5 });
          doc.moveDown(0.55);
          break;
        }
        case "hr":
          doc.moveDown(0.3);
          doc
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor("#ddd")
            .lineWidth(0.7)
            .stroke();
          doc.moveDown(0.6);
          break;
      }
    }
    doc.end();
  });
}
