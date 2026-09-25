/**
 * Pick the closest supported output language from the visible text instead of
 * forcing the language used for the enrollment recording.
 */
export function detectSpeakLanguage(
  text: string,
  fallback: string,
  supported: readonly string[] | undefined,
): string {
  const counts = {
    te: (text.match(/\p{Script=Telugu}/gu) ?? []).length,
    hi: (text.match(/\p{Script=Devanagari}/gu) ?? []).length,
    en: (text.match(/[A-Za-z]/g) ?? []).length,
  };
  const preferred = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const language = preferred && preferred[1] > 0 ? preferred[0] : fallback;
  return supported?.includes(language) ? language : fallback;
}
