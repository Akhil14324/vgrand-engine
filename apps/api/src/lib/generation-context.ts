const FRESH_IMAGE_REQUEST =
  /\b(?:(?:brand[- ]new|new|fresh|different|another|alternative)\s+(?:(?:brand|visual|campaign)\s+)?(?:image|images|picture|pictures|photo|photos|poster|posters|design|concept|concepts|idea|ideas|creative|creatives|look|direction|artwork)|(?:entirely|totally|completely)\s+(?:new|different)\s+(?:(?:brand|visual|campaign)\s+)?(?:concept|idea|design|creative|look|direction))\b/i;

export function isFreshImageRequest(prompt: string): boolean {
  return FRESH_IMAGE_REQUEST.test(prompt);
}

export function requiresOpenAIForReferences(referenceImageUrls: string[]): boolean {
  return referenceImageUrls.length > 1;
}

export function buildGenerationReferenceUrls(input: {
  parentImageUrl?: string | null;
  userReferenceUrls?: string[];
  brandReferenceUrls?: string[];
  themeReferenceUrls?: string[];
}): string[] {
  const refs = input.parentImageUrl
    ? [input.parentImageUrl, ...(input.userReferenceUrls ?? [])]
    : [
        ...(input.brandReferenceUrls ?? []),
        ...(input.themeReferenceUrls ?? []),
        ...(input.userReferenceUrls ?? []),
      ];
  return [...new Set(refs.filter(Boolean))].slice(0, 10);
}
