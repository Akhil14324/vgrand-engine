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
    promptTemplate: `You are a senior architectural visualization artist creating a poster or render for an infrastructure/construction brand. A brand reference poster is attached as the base image — keep its branding consistent: the logo, brand name, dark premium color scheme, gold accents, and the footer/contact strip should match the reference, while the central artwork and headline follow the user's request. Create a professional, high-detail architectural render: accurate materials, natural lighting, correct scale and perspective, and a polished marketing-grade finish. If text or signage is requested, keep it minimal, legible and correctly spelled.`,
    styleGuide: {
      palette: ["#1F2937", "#6B7280", "#D97706", "#F3F4F6"],
      negativePrompt: "cartoon, illustration, distorted geometry, watermark",
      layoutHints: "wide establishing shot, rule of thirds",
      preferredProvider: "openai",
      referenceImageUrls: ["/theme-assets/infra.png"],
    },
  },
  {
    slug: "ad",
    label: "Ad Creatives",
    description: "Scroll-stopping ad visuals for social feeds and display",
    icon: "megaphone",
    promptTemplate: `You are a direct-response advertising designer creating a paid ad creative. The ad must stop the scroll: one dominant visual hook, a short bold headline, and a clear call to action. Follow the hierarchy of a real ad — product or offer hero, headline, one supporting line, CTA button or badge. If brand or reference images are attached, keep the logo, brand name, colors and tone consistent with them. Render all text crisply and spell it exactly as given — no lorem ipsum, no placeholder copy.`,
    styleGuide: {
      palette: ["#F97316", "#111827", "#FFFFFF"],
      negativePrompt: "cluttered layout, tiny unreadable text, watermark, stock-photo look",
      layoutHints: "single focal point, headline top or bottom third, CTA badge corner",
      preferredProvider: "openai",
    },
  },
  {
    slug: "offer",
    label: "Offers & Promotions",
    description: "Sale, discount and limited-time offer posters",
    icon: "tag",
    promptTemplate: `You are a promotional designer creating an offer or sale poster. The deal is the hero: make the discount or price the largest element on the canvas, with urgency cues (limited time, this weekend only) when the user mentions them. Bold, high-contrast typography; festive but clean energy; a clear shop/brand name placement. If brand or reference images are attached, match their logo, colors and footer strip. Render prices, percentages and dates exactly as given — never invent numbers the user did not provide.`,
    styleGuide: {
      palette: ["#DC2626", "#FBBF24", "#111827", "#FFFBEB"],
      negativePrompt: "washed-out colors, blurry text, wrong currency symbols, watermark",
      layoutHints: "offer/price dominant center, urgency ribbon, brand strip bottom",
      preferredProvider: "openai",
    },
  },
  {
    slug: "listing",
    label: "Product Listings",
    description: "Clean e-commerce product shots and catalogue images",
    icon: "package",
    promptTemplate: `You are an e-commerce product photographer creating a marketplace listing image. The product is the entire subject — sharp focus, true-to-life colors, soft even lighting, and a clean background (white or subtle gradient unless the user asks otherwise). Show the product at a flattering angle with realistic scale and shadow. If a product photo is attached, preserve its exact appearance, label text and branding — fix lighting and composition only. No props or text unless requested.`,
    styleGuide: {
      palette: ["#FFFFFF", "#F3F4F6", "#111827"],
      negativePrompt: "cluttered background, distorted product, changed label text, harsh shadows",
      layoutHints: "product centered, 10-15% margin, soft contact shadow",
      preferredProvider: "openai",
    },
  },
  {
    slug: "pitch",
    label: "Pitch & Brand Visuals",
    description: "Deck covers, hero visuals and brand-story graphics",
    icon: "presentation",
    promptTemplate: `You are a brand designer creating a hero visual for a pitch deck, sales presentation or company profile. Aim for confident and premium: strong composition, generous negative space, one clear message. Abstract or metaphorical imagery is welcome when it reinforces the message — growth arrows, skyline, hands, light. If brand or reference images are attached, match the logo, colors and typography style. Keep any text minimal — a title and at most one supporting line, spelled exactly as given.`,
    styleGuide: {
      palette: ["#1E3A8A", "#0F172A", "#F59E0B", "#F8FAFC"],
      negativePrompt: "clip-art look, crowded collage, cheesy stock imagery, watermark",
      layoutHints: "title left or top, visual anchor right, wide margins",
      preferredProvider: "openai",
    },
  },
  {
    slug: "festival",
    label: "Festival & Event",
    description: "Festive greetings and event announcement creatives",
    icon: "sparkles",
    promptTemplate: `You are a festive graphic designer creating a celebration or event announcement creative. Rich, joyful, culturally warm styling — diyas, lanterns, flowers, confetti, fireworks or decorations appropriate to the occasion the user names. The greeting or event name is the headline, rendered in elegant decorative typography, spelled exactly as given. If brand or reference images are attached, place the logo and brand name tastefully without breaking the festive mood.`,
    styleGuide: {
      palette: ["#7C3AED", "#F59E0B", "#DC2626", "#FFF7ED"],
      negativePrompt: "flat corporate look, dim colors, misspelled greetings, watermark",
      layoutHints: "greeting centered, decorative frame or corners, brand mark bottom",
      preferredProvider: "openai",
    },
  },
  {
    slug: "realestate",
    label: "Real Estate",
    description: "Property listings, launch announcements and brochure creatives",
    icon: "home",
    promptTemplate: `You are a real-estate marketing designer creating a property creative. Show the property aspirational but believable: golden-hour or bright daylight exteriors, clean interiors, accurate perspective. Leave clear space for the essentials — project name, location, starting price or "now open" line, and contact strip — rendered crisply and spelled exactly as given. If brand or reference images are attached, keep the developer logo, colors and footer consistent.`,
    styleGuide: {
      palette: ["#0F766E", "#134E4A", "#F59E0B", "#F8FAFC"],
      negativePrompt: "distorted architecture, warped windows, cartoon style, watermark",
      layoutHints: "property hero shot, headline band, price + contact strip bottom",
      preferredProvider: "openai",
    },
  },
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
