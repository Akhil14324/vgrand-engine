import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Themes are data, not code. Add new entries here and run `pnpm db:seed`
 * (upserts by slug, so re-running is safe). They appear in the `/` menu
 * automatically once isActive=true.
 *
 * `styleGuide.preferredProvider` optionally overrides the default
 * gpt-image-2.5-flare routing for the theme ("openai" | "flux" | "ideogram").
 * If the pinned provider errors, the worker falls back to OpenAI.
 */
const THEMES = [
  {
    slug: "restaurant",
    label: "Restaurant & Food Posters",
    description: "Promo posters, menus and offer creatives for food brands",
    icon: "utensils",
    promptTemplate: `You are a professional graphic designer creating a promotional poster for a restaurant or food brand. A brand reference poster is attached as the base image — keep its branding consistent: the logo, brand name, taglines, color scheme, and the footer/contact strip should match the reference, while the central artwork, headline and offer text follow the user's request. Use warm, appetizing colors, clean bold typography for any offer text or prices, and appetizing food photography styling. The layout should look like a finished marketing poster — headline, supporting copy, offer badge — not a plain photo. Render all text crisply and spell it exactly as given.`,
    styleGuide: {
      palette: ["#C0392B", "#F39C12", "#2C3E50", "#FFF8E7"],
      negativePrompt: "blurry, watermark, distorted text, misspelled words",
      layoutHints: "headline top, food hero center, offer badge corner",
      preferredProvider: "openai",
      referenceImageUrls: ["/theme-assets/restaurant.png"],
    },
  },
  {
    slug: "infra",
    label: "Infrastructure & Construction",
    description: "Photorealistic renders and visuals for infra/construction projects",
    icon: "building",
    promptTemplate: `You are a senior architectural visualization artist creating a poster or render for an infrastructure/construction brand. A brand reference poster is attached as the base image — keep its branding consistent: the logo, brand name, dark premium color scheme, gold accents, and the footer/contact strip should match the reference, while the central artwork and headline follow the user's request. Create a photorealistic, professional result: accurate materials, realistic lighting, correct scale and perspective, and a polished marketing-grade finish. If text or signage is requested, keep it minimal, legible and correctly spelled.`,
    styleGuide: {
      palette: ["#1F2937", "#6B7280", "#D97706", "#F3F4F6"],
      negativePrompt: "cartoon, illustration, distorted geometry, watermark",
      layoutHints: "wide establishing shot, rule of thirds",
      preferredProvider: "openai",
      referenceImageUrls: ["/theme-assets/infra.png"],
    },
  },
  // Uncomment or extend — then run `pnpm db:seed` again:
  // {
  //   slug: "festival",
  //   label: "Festival & Event Posters",
  //   description: "Vibrant creatives for festivals and events",
  //   icon: "sparkles",
  //   promptTemplate: `...`,
  //   styleGuide: { palette: ["#7C3AED", "#F59E0B"], preferredProvider: "openai" },
  // },
  // {
  //   slug: "realestate",
  //   label: "Real Estate",
  //   description: "Property listings and brochure creatives",
  //   icon: "home",
  //   promptTemplate: `...`,
  //   styleGuide: { preferredProvider: "flux" },
  // },
];

async function main() {
  for (const theme of THEMES) {
    const { slug, ...data } = theme;
    await prisma.theme.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
    console.log(`seeded theme: /${slug}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
