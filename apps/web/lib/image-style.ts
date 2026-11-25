import type { ImageStyle } from "@catgpt/types";

/** Labels for the image style picker and the gallery badges. */
export const STYLE_LABEL: Record<ImageStyle, string> = {
  auto: "Auto (AI picks)",
  realistic: "Realistic",
  cinematic: "Cinematic",
  traditional: "Traditional",
  modern: "Modern",
  "3d": "3D",
  artistic: "Artistic",
};

/** Display names for the occasion ids the API's prompt analyser returns. */
export const OCCASION_LABEL: Record<string, string> = {
  birthday: "Birthday",
  wedding: "Wedding",
  engagement: "Engagement",
  anniversary: "Anniversary",
  diwali: "Diwali",
  sankranti: "Sankranti / Pongal",
  dasara: "Dasara / Navratri",
  holi: "Holi",
  eid: "Eid",
  christmas: "Christmas",
  new_year: "New Year",
  valentines: "Valentine's Day",
  food: "Food",
  product: "Product promotion",
  business: "Business",
};

export function occasionLabel(occasion: string | null | undefined): string | null {
  if (!occasion) return null;
  return OCCASION_LABEL[occasion] ?? occasion.replace(/_/g, " ");
}
