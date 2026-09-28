export interface ProductImageReference {
  id: string;
  label: string | null;
  url: string;
}

export type ProductImageResolution =
  | { status: "none" }
  | { status: "match"; asset: ProductImageReference }
  | { status: "missing"; requestedName: string }
  | { status: "ambiguous"; names: string[] };

export function requestsImageFromProductImage(
  prompt: string,
  resolution: ProductImageResolution,
): boolean {
  return (
    resolution.status !== "none" &&
    /\b(?:create|make|generate|design|draw|render|produce|build)\b/i.test(prompt) &&
    /\b(?:product\s+)?(?:image|photo|picture)\b/i.test(prompt)
  );
}

export function normalizeProductImageName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function includesName(prompt: string, name: string): boolean {
  return ` ${prompt} `.includes(` ${name} `);
}

function explicitRequestedName(prompt: string): string | null {
  const selector =
    /\b(?:use|select|reference|refer to|feature|show|include|add)\s+(?:the\s+)?(.{1,100}?)\s+(?:product\s+)?(?:image|photo|picture)\b/i.exec(prompt);
  if (!selector?.[1]) return null;
  const candidate = selector[1].trim();
  if (/\b(?:text|caption|headline|title|copy|phrase|words?|in|on|with|for|as|about)\b/i.test(candidate)) {
    return null;
  }
  const ignoredWords = new Set([
    "a",
    "an",
    "the",
    "my",
    "our",
    "brand",
    "product",
    "attached",
    "uploaded",
    "provided",
    "selected",
    "reference",
    "current",
    "this",
    "that",
    "real",
    "actual",
  ]);
  const meaningfulWords = selector[1]
    .trim()
    .split(/\s+/)
    .filter(
      (word) => !ignoredWords.has(normalizeProductImageName(word)),
    );
  return meaningfulWords.length ? meaningfulWords.join(" ") : null;
}

export function resolveProductImageReference(
  prompt: string,
  products: ProductImageReference[],
): ProductImageResolution {
  const normalizedPrompt = normalizeProductImageName(prompt);
  const labeled = products
    .map((asset) => ({ asset, name: normalizeProductImageName(asset.label ?? "") }))
    .filter((item) => item.name);
  const quotedNames = explicitQuotedNames(prompt);
  if (quotedNames.length) {
    const quotedMatches: { asset: ProductImageReference; name: string }[] = [];
    for (const requestedName of quotedNames) {
      const normalizedName = normalizeProductImageName(requestedName);
      const exactMatches = labeled.filter((item) => item.name === normalizedName);
      if (!exactMatches.length) return { status: "missing", requestedName };
      quotedMatches.push(...exactMatches);
    }
    return resolutionFor(quotedMatches);
  }

  const requestedName = explicitRequestedName(prompt);
  if (requestedName) {
    const requestedNormalized = normalizeProductImageName(requestedName);
    const exactMatches = labeled.filter((item) => item.name === requestedNormalized);
    return exactMatches.length
      ? resolutionFor(exactMatches)
      : { status: "missing", requestedName };
  }

  const matches = labeled.filter((item) => includesName(normalizedPrompt, item.name));
  if (matches.length) {
    const mostSpecific = matches.filter(
      (item) =>
        !matches.some(
          (other) =>
            other.name !== item.name &&
            ` ${other.name} `.includes(` ${item.name} `),
        ),
    );
    return resolutionFor(mostSpecific);
  }

  return { status: "none" };
}

function explicitQuotedNames(prompt: string): string[] {
  const quotes = /["“]([^"”]+)["”]|['‘]([^'’]+)['’]/gu;
  const names: string[] = [];
  for (const match of prompt.matchAll(quotes)) {
    const start = match.index ?? 0;
    const before = prompt.slice(Math.max(0, start - 80), start);
    const after = prompt.slice(start + match[0].length, start + match[0].length + 60);
    const name = (match[1] ?? match[2] ?? "").trim();
    if (
      name &&
      /\b(?:use|select|reference|refer to|feature|show|include|add)\b/i.test(before) &&
      /^\s*(?:product\s+)?(?:image|photo|picture)\b/i.test(after)
    ) {
      names.push(name);
    }
  }
  return names;
}

function resolutionFor(
  matches: { asset: ProductImageReference; name: string }[],
): ProductImageResolution {
  const uniqueMatches = [...new Map(matches.map((match) => [match.asset.id, match])).values()];
  const byName = new Map<string, ProductImageReference[]>();
  for (const { asset, name } of uniqueMatches) {
    byName.set(name, [...(byName.get(name) ?? []), asset]);
  }
  if (byName.size !== 1) {
    return { status: "ambiguous", names: [...byName.keys()] };
  }
  const [name, assets] = [...byName.entries()][0]!;
  if (assets.length !== 1) return { status: "ambiguous", names: [name] };
  return { status: "match", asset: assets[0]! };
}
