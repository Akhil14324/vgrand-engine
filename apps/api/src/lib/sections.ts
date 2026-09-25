/** Pack blank-line-separated paragraphs into sections of at most `size` chars. */
export function packSections(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= size) {
      pieces.push(para);
      continue;
    }
    // A monster paragraph (e.g. an unbroken PDF page): fall back to its lines,
    // hard-splitting any single line that is itself too long. The rewrite
    // step rejoins fragments, so extra breaks here are harmless.
    for (const line of para.split("\n")) {
      for (let s = 0; s < line.length || s === 0; s += size) {
        pieces.push(line.slice(s, s + size));
      }
    }
  }
  const sections: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > size) {
      sections.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) sections.push(cur);
  return sections;
}
