/**
 * Word timings from ElevenLabs character alignment, beat spans derived from
 * them, and word-synced burned-in captions as an ASS subtitle file.
 */

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface CharAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Groups aligned characters into words (split on whitespace). */
export function wordsFromAlignment(a: CharAlignment): WordTiming[] {
  const words: WordTiming[] = [];
  let cur = "";
  let start = 0;
  let end = 0;
  const n = Math.min(a.characters.length, a.character_start_times_seconds.length, a.character_end_times_seconds.length);
  for (let i = 0; i < n; i++) {
    const ch = a.characters[i]!;
    if (/\s/.test(ch)) {
      if (cur) words.push({ word: cur, start, end });
      cur = "";
      continue;
    }
    if (!cur) start = a.character_start_times_seconds[i]!;
    cur += ch;
    end = a.character_end_times_seconds[i]!;
  }
  if (cur) words.push({ word: cur, start, end });
  return words;
}

/** Evenly spaced word timings for a known audio length (offline fixtures, or STT unavailable). */
export function evenWordTimings(text: string, durationSec: number): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const step = durationSec / Math.max(1, words.length);
  return words.map((w, i) => ({ word: w, start: +(i * step).toFixed(3), end: +((i + 1) * step - 0.02).toFixed(3) }));
}

/**
 * Start/end second of each script segment (hook + beats) in the voiceover.
 * Segments are matched to words by count, in order. The last segment runs to `totalSec`.
 */
export function segmentSpans(segments: string[], words: WordTiming[], totalSec: number): { start: number; end: number }[] {
  const counts = segments.map((s) => s.trim().split(/\s+/).filter(Boolean).length);
  const spans: { start: number; end: number }[] = [];
  let w = 0;
  for (let i = 0; i < segments.length; i++) {
    const first = words[Math.min(w, words.length - 1)];
    const start = i === 0 ? 0 : first ? first.start : spans[i - 1]!.end;
    spans.push({ start, end: totalSec });
    if (i > 0) spans[i - 1]!.end = start;
    w += counts[i]!;
  }
  // Guard against zero/negative spans from odd alignments.
  for (const s of spans) if (s.end - s.start < 0.5) s.end = s.start + 0.5;
  return spans;
}

/**
 * Merges the hook into the first beat's clip so the first visual lasts long
 * enough (a 1.5 s hook clip would be a jarring cut). Returns spans per beat.
 */
export function beatSpans(hook: string, beats: string[], words: WordTiming[], totalSec: number): { start: number; end: number }[] {
  const spans = segmentSpans([hook, ...beats], words, totalSec);
  const [hookSpan, firstBeat, ...rest] = spans;
  return [{ start: hookSpan!.start, end: firstBeat!.end }, ...rest];
}

/* ------------------------------------ ASS ----------------------------------- */

export interface CaptionGroup {
  words: WordTiming[];
  start: number;
  end: number;
}

/** Up to 3 words or 18 characters per caption, breaking after punctuation or a pause. */
export function groupWords(words: WordTiming[], maxWords = 3, maxChars = 18): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (!cur.length) return;
    groups.push({ words: cur, start: cur[0]!.start, end: cur[cur.length - 1]!.end });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const len = cur.reduce((n, x) => n + x.word.length + 1, 0) + w.word.length;
    if (cur.length && (cur.length >= maxWords || len > maxChars || w.start - cur[cur.length - 1]!.end > 0.4)) flush();
    cur.push(w);
    if (/[.!?,;:]$/.test(w.word)) flush();
  }
  flush();
  // Keep each caption on screen until the next one starts (no flicker between groups).
  for (let i = 0; i < groups.length - 1; i++) {
    const next = groups[i + 1]!;
    if (next.start - groups[i]!.end < 0.6) groups[i]!.end = next.start;
  }
  return groups;
}

const assTime = (sec: number) => {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

/** ASS text can't contain braces or backslashes (they are override syntax). */
export const assEscape = (s: string) => s.replace(/[{}\\]/g, "").replace(/\n/g, " ");

const HIGHLIGHT = "&H0000E5FF&"; // ASS colours are &HBBGGRR&: warm yellow
const NORMAL = "&H00FFFFFF&";

/**
 * One Dialogue event per word: the whole caption group is shown and the word
 * being spoken is highlighted. Text sits in the lower-middle of the frame,
 * above where the Shorts UI overlays the title and buttons.
 */
export function buildAss(words: WordTiming[], opts: { width?: number; height?: number; font?: string } = {}): { ass: string; events: number } {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const font = opts.font ?? "Noto Sans";
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${font},84,${NORMAL},${NORMAL},&H00000000&,&H80000000&,1,0,0,0,100,100,0,0,1,6,2,2,80,80,620,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines: string[] = [];
  for (const g of groupWords(words)) {
    g.words.forEach((w, i) => {
      const start = i === 0 ? g.start : w.start;
      const end = i === g.words.length - 1 ? g.end : g.words[i + 1]!.start;
      if (end - start <= 0.01) return;
      const text = g.words
        .map((x, j) => (j === i ? `{\\c${HIGHLIGHT}}${assEscape(x.word.toUpperCase())}{\\c${NORMAL}}` : assEscape(x.word.toUpperCase())))
        .join(" ");
      lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text}`);
    });
  }
  return { ass: [...header, ...lines, ""].join("\n"), events: lines.length };
}
