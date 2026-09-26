import { z } from "zod";

/**
 * Guava - the AI business strategist. Everything here is shared by the API and
 * the web app: the profile structure (sections, fields, industry packs), the
 * completeness maths, and the shapes of diagnoses and follow-up answers.
 *
 * The profile is deliberately data-driven. Sections and fields are plain
 * definitions, and an industry "pack" only adds fields, focus areas and journey
 * stages on top of them - so a new industry is one entry in GUAVA_INDUSTRIES,
 * not a change to the UI or the diagnosis code.
 */

/* --------------------------------- profile -------------------------------- */

export interface GuavaField {
  key: string;
  label: string;
  /** Short helper text under the label, in plain language. */
  hint?: string;
  kind: "short" | "long";
  /** Counts toward the section's completion status and drives "what's missing". */
  important?: boolean;
  /** The plain-language question Guava asks when this field is missing. */
  ask?: string;
}

export interface GuavaSection {
  key: string;
  title: string;
  description: string;
  fields: GuavaField[];
}

/** The nine sections every business shares. Industry packs add fields to these. */
export const GUAVA_SECTIONS: GuavaSection[] = [
  {
    key: "overview",
    title: "Business overview",
    description: "What the business is and how it makes money.",
    fields: [
      { key: "name", label: "Business name", kind: "short", important: true, ask: "What is your business called?" },
      { key: "products", label: "What do you sell?", hint: "Products or services, in your own words.", kind: "long", important: true, ask: "What products or services do you sell?" },
      { key: "location", label: "Where are you based?", hint: "City, area, or 'online only'.", kind: "short", important: true, ask: "Where is the business located, and where does it serve customers?" },
      { key: "model", label: "How do you make money?", hint: "e.g. walk-in sales, orders, bookings, subscriptions, commissions.", kind: "short", ask: "How does the business earn money?" },
      { key: "stage", label: "How long have you been running?", hint: "Just starting, a year in, well established…", kind: "short" },
    ],
  },
  {
    key: "goals",
    title: "Goals",
    description: "What you want to achieve, and by when.",
    fields: [
      { key: "current", label: "Where you are today", hint: "Roughly how many sales, orders or how much revenue you get each month.", kind: "short", important: true, ask: "Roughly how much revenue, or how many orders, do you get each month right now?" },
      { key: "main", label: "Your main goal", hint: "What would a great next 6-12 months look like?", kind: "long", important: true, ask: "What is the most important thing you want to achieve in the next 6-12 months?" },
      { key: "revenueTarget", label: "Revenue target", hint: "Per month or year, in your currency.", kind: "short", important: true, ask: "What monthly or yearly revenue are you aiming for?" },
      { key: "salesTarget", label: "Sales target", hint: "Orders, bookings, units or deals per month.", kind: "short" },
      { key: "customerTarget", label: "New customers wanted", hint: "How many new customers or leads you'd like.", kind: "short" },
      { key: "timeline", label: "By when?", hint: "e.g. 90 days, end of the year, before the festive season.", kind: "short" },
    ],
  },
  {
    key: "offers",
    title: "Products and pricing",
    description: "What you charge, what you earn on it, and what makes it worth buying.",
    fields: [
      { key: "pricing", label: "Prices", hint: "Typical prices or price ranges.", kind: "long", important: true, ask: "What do your main products or services cost?" },
      { key: "margins", label: "Profit margin", hint: "Roughly how much of the price is profit. A guess is fine.", kind: "short", ask: "Roughly what is your profit margin on your main offerings?" },
      { key: "promotions", label: "Offers and discounts", hint: "What you offer today, and how often.", kind: "long" },
      { key: "sellingPoints", label: "Why customers buy from you", hint: "The strongest reasons someone picks you.", kind: "long", important: true, ask: "What are the main reasons customers choose you?" },
    ],
  },
  {
    key: "customers",
    title: "Target customers",
    description: "Who buys from you and what makes them buy.",
    fields: [
      { key: "who", label: "Who are your customers?", hint: "The types of people or businesses you serve.", kind: "long", important: true, ask: "Who are your best customers?" },
      { key: "locations", label: "Where do they come from?", kind: "short" },
      { key: "demographics", label: "Age, income, profession (if it matters)", kind: "short" },
      { key: "needs", label: "What do they need or want?", kind: "long" },
      { key: "buying", label: "How do they decide to buy?", hint: "What they compare, who they ask, how long they take.", kind: "long" },
      { key: "objections", label: "What holds them back?", hint: "Common worries or reasons they say no.", kind: "long", important: true, ask: "What do customers worry about, or say, before they decide not to buy?" },
    ],
  },
  {
    key: "marketing",
    title: "Current marketing",
    description: "What you already do to attract customers.",
    fields: [
      { key: "channels", label: "Where do you promote today?", hint: "Instagram, Google, WhatsApp, flyers, referrals…", kind: "long", important: true, ask: "Where do you currently promote the business?" },
      { key: "accounts", label: "Your social accounts and links", hint: "Handles or links to your pages.", kind: "long" },
      { key: "campaigns", label: "Recent campaigns or ads", hint: "What you ran and roughly how it went.", kind: "long" },
      { key: "budget", label: "Monthly marketing budget", hint: "Including ads and any freelancers.", kind: "short", important: true, ask: "How much can you spend on marketing each month?" },
      { key: "frequency", label: "How often do you post?", kind: "short" },
      { key: "activities", label: "Anything else you do", hint: "Events, partnerships, email or WhatsApp lists…", kind: "long" },
    ],
  },
  {
    key: "sales",
    title: "Sales process",
    description: "The path from someone finding you to paying you.",
    fields: [
      { key: "discovery", label: "How do people find you?", kind: "long", important: true, ask: "How do most new customers find out about you?" },
      { key: "inquiry", label: "How do they get in touch?", hint: "Calls, WhatsApp, walk-in, website form, DMs…", kind: "long", important: true, ask: "How do interested customers contact you?" },
      { key: "purchase", label: "How do they buy, book or order?", kind: "long" },
      { key: "handler", label: "Who handles sales?", hint: "You, a team, a sales agent…", kind: "short" },
      { key: "followup", label: "How do you follow up?", hint: "What happens when someone enquires but doesn't buy?", kind: "long", important: true, ask: "What do you do when someone enquires but doesn't buy straight away?" },
      { key: "conversion", label: "How many enquiries become sales?", hint: "A rough guess is fine.", kind: "short", ask: "Roughly what share of enquiries turn into sales?" },
    ],
  },
  {
    key: "competition",
    title: "Competition",
    description: "Who else your customers could choose.",
    fields: [
      { key: "competitors", label: "Main competitors", hint: "Names, if you know them.", kind: "long", important: true, ask: "Who are your main competitors?" },
      { key: "alternatives", label: "Other things customers might do instead", hint: "Including doing nothing or doing it themselves.", kind: "long" },
      { key: "positioning", label: "How do you present yourself?", hint: "Premium, affordable, local, specialist…", kind: "long" },
      { key: "differentiators", label: "What makes you different?", kind: "long", important: true, ask: "What do you do that competitors don't, or do better?" },
      { key: "advantages", label: "Where you feel ahead", kind: "long" },
    ],
  },
  {
    key: "challenges",
    title: "Business challenges",
    description: "What's getting in the way, and where you want help.",
    fields: [
      { key: "problems", label: "Biggest problems right now", kind: "long", important: true, ask: "What are the biggest problems in the business right now?" },
      { key: "bottlenecks", label: "Where things get stuck", hint: "Slow follow-up, low stock, no time, few leads…", kind: "long" },
      { key: "constraints", label: "Limits you work within", hint: "Budget, team size, licences, location…", kind: "short" },
      { key: "seasonality", label: "Busy and slow seasons", kind: "short" },
      { key: "helpWanted", label: "Where do you want help most?", kind: "long", important: true, ask: "Which part of the business do you most want help with?" },
    ],
  },
  {
    key: "additional",
    title: "Additional information",
    description: "Anything else that helps Guava understand you: notes, links, documents and images.",
    fields: [
      { key: "notes", label: "Notes", hint: "Anything you think Guava should know.", kind: "long" },
      { key: "links", label: "Helpful links", hint: "Website, menu, brochure, reviews page. One per line.", kind: "long" },
    ],
  },
];

export const GUAVA_SECTION_KEYS = GUAVA_SECTIONS.map((s) => s.key);

/* ------------------------------ industry packs ---------------------------- */

export interface GuavaIndustry {
  key: string;
  label: string;
  /** Lower-case words that suggest this industry from a brand's category / description. */
  keywords: string[];
  /** Extra fields, each attached to one of the shared sections. */
  fields: (GuavaField & { section: string })[];
  /** What the diagnosis should pay particular attention to for this kind of business. */
  focus: string[];
  /** The customer journey, in order - used to look for where customers drop out. */
  journey: string[];
  /** Measures that suit this business, preferred when recommending how to track success. */
  metrics: string[];
}

export const GUAVA_INDUSTRIES: GuavaIndustry[] = [
  {
    key: "restaurant",
    label: "Restaurant, cafe or food business",
    keywords: ["restaurant", "cafe", "café", "bakery", "food", "kitchen", "catering", "bar", "biryani", "pizza", "sweets", "tiffin"],
    fields: [
      { section: "offers", key: "menu", label: "Menu and best sellers", hint: "Signature dishes, price range, what sells most.", kind: "long", important: true, ask: "What are your best-selling menu items and their prices?" },
      { section: "offers", key: "avgOrderValue", label: "Average order value", hint: "What a typical table or delivery order comes to.", kind: "short", important: true, ask: "What is the average bill or order value?" },
      { section: "customers", key: "repeat", label: "Repeat customers", hint: "How many come back, and how often.", kind: "short", important: true, ask: "How many customers come back, and how often?" },
      { section: "marketing", key: "localDiscovery", label: "Google Maps and local listings", hint: "Rating, number of reviews, photos, whether the listing is up to date.", kind: "long", ask: "What is your Google rating and review count, and is your listing up to date?" },
      { section: "sales", key: "delivery", label: "Dine-in, takeaway and delivery", hint: "Split between them, and platforms used (Swiggy, Zomato, your own).", kind: "long", important: true, ask: "How do your orders split between dine-in, takeaway and delivery, and which delivery platforms do you use?" },
      { section: "sales", key: "peakTimes", label: "Busy and quiet times", hint: "Which days or hours are full or empty.", kind: "short" },
    ],
    focus: [
      "menu positioning and which items should lead the marketing",
      "local discovery: Google Maps, reviews, photos, nearby search",
      "average order value and ways to raise it (combos, add-ons)",
      "repeat visits and how to bring past customers back",
      "delivery platform dependence versus own ordering (commissions, margins)",
      "offers that fill quiet hours without training customers to wait for discounts",
      "customer experience and reviews",
    ],
    journey: ["Sees or searches for the restaurant", "Checks menu, photos and reviews", "Visits or orders", "Has the experience", "Returns or recommends"],
    metrics: ["orders or covers per week", "average order value", "share of repeat customers", "Google reviews and rating", "share of orders via own channels versus aggregators"],
  },
  {
    key: "real_estate",
    label: "Real estate",
    keywords: ["real estate", "realty", "property", "properties", "builder", "developer", "apartment", "villa", "plots", "housing", "flats"],
    fields: [
      { section: "offers", key: "projects", label: "Projects or properties", hint: "Names, locations, type (apartments, villas, plots) and status.", kind: "long", important: true, ask: "Which projects or properties are you selling, and where?" },
      { section: "offers", key: "propertyPrices", label: "Price ranges", hint: "Per unit or per square foot, and payment plans.", kind: "long", important: true, ask: "What are the price ranges and payment options?" },
      { section: "customers", key: "buyerProfiles", label: "Buyer profiles", hint: "End-users, investors, NRIs, first-time buyers…", kind: "long", important: true, ask: "Who typically buys: end-users, investors, first-time buyers?" },
      { section: "marketing", key: "leadSources", label: "Where enquiries come from", hint: "Portals, ads, referrals, walk-ins, brokers.", kind: "long", important: true, ask: "Which sources bring you the most property enquiries?" },
      { section: "sales", key: "inquiries", label: "Enquiries per month, and how many are serious", kind: "short", important: true, ask: "About how many enquiries do you get per month, and how many are genuinely interested?" },
      { section: "sales", key: "siteVisits", label: "Site visits", hint: "How many per month, and how they are arranged.", kind: "short", important: true, ask: "How many site visits happen per month, and how are they arranged?" },
      { section: "sales", key: "bookings", label: "Bookings", hint: "Bookings per month and how long a sale usually takes.", kind: "short", ask: "How many bookings do you close per month, and how long does a sale take?" },
    ],
    focus: [
      "project positioning: location, price, and who it is really for",
      "buyer profiles and what each one needs to hear",
      "quality of enquiries, not just quantity",
      "the drop-off from enquiry to site visit to booking",
      "speed and consistency of follow-up on leads",
      "trust signals: approvals, builder track record, progress updates, testimonials",
      "long decision cycles and keeping in touch until buyers are ready",
    ],
    journey: ["Discovers the project", "Enquires", "Qualified by the sales team", "Visits the site", "Negotiates and decides", "Books"],
    metrics: ["enquiries per month", "share of serious enquiries", "site visits per month", "bookings per month", "cost per site visit", "days from enquiry to booking"],
  },
  {
    key: "retail",
    label: "Retail shop or store",
    keywords: ["retail", "shop", "store", "boutique", "showroom", "garments", "jewellery", "jewelry", "electronics", "furniture", "supermarket", "kirana"],
    fields: [
      { section: "offers", key: "topProducts", label: "Best sellers and slow movers", kind: "long", important: true, ask: "Which products sell best, and which sit on the shelf?" },
      { section: "offers", key: "avgBasket", label: "Average bill value", kind: "short", important: true, ask: "What is the average bill value per customer?" },
      { section: "customers", key: "repeat", label: "Repeat customers", hint: "How many return, and what brings them back.", kind: "short", important: true, ask: "How many customers come back, and how often?" },
      { section: "sales", key: "footfall", label: "Walk-ins per day", hint: "And how many of them buy.", kind: "short", important: true, ask: "How many people visit the shop each day, and how many buy?" },
      { section: "marketing", key: "localDiscovery", label: "Google Maps and local visibility", kind: "long" },
    ],
    focus: ["footfall and walk-in conversion", "local discovery and nearby search", "hero products versus slow stock", "average bill value and bundling", "loyalty and repeat purchases", "seasonal and festival demand"],
    journey: ["Hears about or finds the shop", "Visits or enquires", "Browses and compares", "Buys", "Returns or recommends"],
    metrics: ["daily footfall", "walk-in to purchase rate", "average bill value", "share of repeat customers", "sales per product line"],
  },
  {
    key: "ecommerce",
    label: "Online store / e-commerce",
    keywords: ["ecommerce", "e-commerce", "online store", "d2c", "dropship", "marketplace", "amazon", "shopify"],
    fields: [
      { section: "offers", key: "topProducts", label: "Best sellers", kind: "long", important: true, ask: "Which products sell best online?" },
      { section: "offers", key: "avgOrderValue", label: "Average order value", kind: "short", important: true, ask: "What is your average order value?" },
      { section: "sales", key: "onlineMetrics", label: "Website numbers", hint: "Monthly visitors, share who buy, abandoned carts, returns.", kind: "long", important: true, ask: "Roughly how many people visit your store each month, and what share buy?" },
      { section: "customers", key: "repeat", label: "Repeat buyers", kind: "short", important: true, ask: "What share of customers buy again?" },
      { section: "marketing", key: "adPerformance", label: "Ad results", hint: "What you spend and what it brings back.", kind: "long" },
    ],
    focus: ["traffic sources versus conversion", "cart and checkout drop-off", "repeat purchase and customer lifetime value", "ad spend efficiency and dependence on paid traffic", "product page trust: reviews, returns policy, delivery times"],
    journey: ["Discovers the brand", "Visits the store", "Views a product", "Adds to cart", "Checks out", "Receives and reviews", "Buys again"],
    metrics: ["visitors per month", "conversion rate", "average order value", "repeat purchase rate", "return on ad spend"],
  },
  {
    key: "health_wellness",
    label: "Salon, clinic, gym or wellness",
    keywords: ["salon", "spa", "clinic", "dental", "dentist", "gym", "fitness", "yoga", "wellness", "physio", "beauty", "skin", "hospital", "doctor"],
    fields: [
      { section: "offers", key: "services", label: "Services and packages", hint: "With prices and which ones are most booked.", kind: "long", important: true, ask: "Which services or packages do you offer, and which are booked most?" },
      { section: "customers", key: "repeat", label: "Repeat clients", hint: "How often clients return, and memberships.", kind: "short", important: true, ask: "How often do clients return, and do you have memberships?" },
      { section: "sales", key: "bookings", label: "How appointments are booked", hint: "Calls, WhatsApp, app. Missed calls and no-shows.", kind: "long", important: true, ask: "How are appointments booked, and how many are missed or cancelled?" },
      { section: "marketing", key: "reviews", label: "Reviews and reputation", kind: "long" },
    ],
    focus: ["trust and reviews", "local search visibility", "booking friction and no-shows", "repeat visits, memberships and packages", "seasonal or slow-hour demand"],
    journey: ["Finds the business", "Checks reviews", "Enquires", "Books", "Visits", "Returns"],
    metrics: ["new clients per month", "appointments per week", "no-show rate", "repeat visit rate", "Google reviews"],
  },
  {
    key: "education",
    label: "Education, coaching or training",
    keywords: ["school", "coaching", "tuition", "academy", "institute", "course", "training", "college", "classes", "education"],
    fields: [
      { section: "offers", key: "courses", label: "Courses or programmes", hint: "Fees, duration, batch sizes, seats available.", kind: "long", important: true, ask: "Which courses do you offer, at what fee, and how many seats?" },
      { section: "customers", key: "decisionMakers", label: "Who decides", hint: "Students, parents, employers.", kind: "short", important: true, ask: "Who makes the decision: the student, parents or an employer?" },
      { section: "sales", key: "enquiryFlow", label: "Enquiry to admission", hint: "Demo classes, counselling, how many enquiries become admissions.", kind: "long", important: true, ask: "What happens between an enquiry and an admission, and how many enquiries convert?" },
      { section: "marketing", key: "results", label: "Results and proof", hint: "Outcomes, testimonials and placements you can show.", kind: "long" },
    ],
    focus: ["proof of results and testimonials", "trust for parents or employers", "enquiry-to-admission conversion", "seasonal admission cycles", "demo or trial experiences"],
    journey: ["Discovers the institute", "Enquires", "Attends a demo or counselling", "Decides", "Enrols", "Recommends"],
    metrics: ["enquiries per month", "demo attendance", "admissions per intake", "cost per admission", "referrals"],
  },
  {
    key: "services",
    label: "Professional or local services",
    keywords: ["agency", "consulting", "consultant", "lawyer", "legal", "accounting", "architect", "interior", "repair", "cleaning", "plumbing", "freelance", "photography", "studio", "services", "b2b", "software", "saas"],
    fields: [
      { section: "offers", key: "serviceList", label: "Services and how they're priced", hint: "Packages, hourly rates, retainers or per project.", kind: "long", important: true, ask: "Which services do you offer and how are they priced?" },
      { section: "customers", key: "clientTypes", label: "Typical clients", hint: "Industries, sizes, or types of household.", kind: "long", important: true, ask: "What kinds of clients do you usually work with?" },
      { section: "sales", key: "salesCycle", label: "From first contact to signed job", hint: "Calls, proposals, site visits and how long it takes.", kind: "long", important: true, ask: "What steps lead from first contact to a signed job, and how long does it take?" },
      { section: "marketing", key: "proof", label: "Proof of work", hint: "Case studies, portfolio, testimonials, referrals.", kind: "long" },
    ],
    focus: ["trust and proof of work", "referral and repeat-client flow", "quality of leads versus time spent on proposals", "clear packaging and pricing", "consistent follow-up on quotes"],
    journey: ["Learns of the business", "Makes contact", "Discusses needs", "Receives a proposal or quote", "Decides", "Becomes a client and refers others"],
    metrics: ["qualified leads per month", "proposals sent", "proposal-to-win rate", "average project value", "referrals"],
  },
  {
    key: "general",
    label: "Something else",
    keywords: [],
    fields: [],
    focus: [
      "the customer journey specific to this business model",
      "how customers currently discover, evaluate and choose the business",
      "where the business's own numbers or process are unclear",
    ],
    journey: ["Learns about the business", "Shows interest", "Evaluates", "Buys", "Returns or refers"],
    metrics: ["new customers per month", "enquiry-to-sale rate", "average sale value", "repeat customers"],
  },
];

export const DEFAULT_GUAVA_INDUSTRY = "general";

export function getGuavaIndustry(key: string | null | undefined): GuavaIndustry {
  return (
    GUAVA_INDUSTRIES.find((i) => i.key === key) ??
    GUAVA_INDUSTRIES.find((i) => i.key === DEFAULT_GUAVA_INDUSTRY)!
  );
}

/** Best-guess industry from free text (a brand's category and description), or null. */
export function suggestGuavaIndustry(...texts: (string | null | undefined)[]): string | null {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  if (!hay) return null;
  let best: { key: string; hits: number } | null = null;
  for (const ind of GUAVA_INDUSTRIES) {
    const hits = ind.keywords.filter((k) => hay.includes(k)).length;
    if (hits > (best?.hits ?? 0)) best = { key: ind.key, hits };
  }
  return best?.key ?? null;
}

/** Shared sections plus the fields the chosen industry adds to each. */
export function guavaSectionsFor(industryKey: string | null | undefined): GuavaSection[] {
  const industry = getGuavaIndustry(industryKey);
  return GUAVA_SECTIONS.map((s) => {
    const extra = industry.fields.filter((f) => f.section === s.key).map(({ section: _s, ...f }) => f);
    return extra.length ? { ...s, fields: [...s.fields, ...extra] } : s;
  });
}

/* ------------------------------ profile values ---------------------------- */

/** section key -> field key -> text. Everything is text: owners write "about 40 a day", not 40. */
export type GuavaValues = Record<string, Record<string, string>>;

export const GUAVA_VALUE_MAX = 2000;

export const guavaProfileUpdateSchema = z.object({
  /** null clears the choice. */
  industry: z.string().max(60).nullable().optional(),
  /** null for a field removes what the user saved, so the Brand's own answer shows through again. */
  values: z
    .record(z.string().max(40), z.record(z.string().max(40), z.string().max(GUAVA_VALUE_MAX).nullable()))
    .optional(),
  /** Sections the owner chose to skip for now. */
  skipped: z.array(z.string().max(40)).max(20).optional(),
});
export type GuavaProfileUpdate = z.infer<typeof guavaProfileUpdateSchema>;

export type GuavaSectionStatus = "empty" | "started" | "good" | "skipped";

export interface GuavaSectionProgress {
  key: string;
  status: GuavaSectionStatus;
  /** Important fields answered / important fields in the section. */
  filled: number;
  total: number;
}

export interface GuavaMissingItem {
  section: string;
  sectionTitle: string;
  field: string;
  label: string;
  question: string;
}

export interface GuavaCompleteness {
  /** 0-100, across sections that were not skipped. */
  pct: number;
  sections: GuavaSectionProgress[];
  /** Unanswered important fields in sections that were not skipped, most useful first. */
  missing: GuavaMissingItem[];
}

const has = (values: GuavaValues, section: string, field: string) =>
  !!values[section]?.[field]?.trim();

export function computeGuavaCompleteness(
  values: GuavaValues,
  industryKey: string | null | undefined,
  skipped: string[] = [],
): GuavaCompleteness {
  const sections: GuavaSectionProgress[] = [];
  const missing: GuavaMissingItem[] = [];
  let filledAll = 0;
  let totalAll = 0;

  for (const s of guavaSectionsFor(industryKey)) {
    const important = s.fields.filter((f) => f.important);
    const filled = important.filter((f) => has(values, s.key, f.key)).length;
    const anyFilled = s.fields.some((f) => has(values, s.key, f.key));
    const isSkipped = skipped.includes(s.key) && !anyFilled;
    // A section with no important fields (Additional information) is optional.
    const total = important.length;
    let status: GuavaSectionStatus;
    if (isSkipped) status = "skipped";
    else if (!anyFilled) status = "empty";
    else if (total === 0 || filled >= Math.ceil(total * 0.7)) status = "good";
    else status = "started";
    sections.push({ key: s.key, status, filled, total });

    if (isSkipped || total === 0) continue;
    filledAll += filled;
    totalAll += total;
    for (const f of important) {
      if (!has(values, s.key, f.key)) {
        missing.push({
          section: s.key,
          sectionTitle: s.title,
          field: f.key,
          label: f.label,
          question: f.ask ?? `${f.label}?`,
        });
      }
    }
  }
  return {
    pct: totalAll ? Math.round((filledAll / totalAll) * 100) : 0,
    sections,
    missing,
  };
}

/** Field-by-field differences between two profiles, for "what changed since last time". */
export interface GuavaProfileChange {
  section: string;
  field: string;
  label: string;
  before: string;
  after: string;
}

export function diffGuavaValues(
  before: GuavaValues,
  after: GuavaValues,
  industryKey: string | null | undefined,
): GuavaProfileChange[] {
  const out: GuavaProfileChange[] = [];
  for (const s of guavaSectionsFor(industryKey)) {
    for (const f of s.fields) {
      const b = before[s.key]?.[f.key]?.trim() ?? "";
      const a = after[s.key]?.[f.key]?.trim() ?? "";
      if (a !== b) out.push({ section: s.key, field: f.key, label: f.label, before: b, after: a });
    }
  }
  return out;
}

/* ----------------------------- platform activity ---------------------------- */

/**
 * What the platform itself knows about this business's marketing activity.
 * These are counts of things done inside the app: they show effort, not results,
 * and never prove sales - the diagnosis is told so explicitly.
 */
export interface GuavaPlatformSnapshot {
  windowDays: number;
  connectedAccounts: { platform: string; handle: string | null }[];
  posts: { published: number; scheduled: number; failed: number; lastPublishedAt: string | null };
  campaigns: { plans: number; postsPlanned: number; postsApproved: number };
  content: { imagesCreated: number };
  brand: { hasLogo: boolean; hasVoice: boolean; documents: number; assets: number };
  /** Metrics such as reach, engagement, revenue or leads are not collected. */
  hasPerformanceData: false;
}

/* -------------------------------- diagnosis ------------------------------- */

/** How well-founded a statement is. Shown to the owner on every finding. */
export const GUAVA_EVIDENCE = ["fact", "provided", "estimate", "hypothesis"] as const;
export type GuavaEvidence = (typeof GUAVA_EVIDENCE)[number];

export const GUAVA_EVIDENCE_LABELS: Record<GuavaEvidence, { label: string; hint: string }> = {
  fact: { label: "Verified", hint: "Seen in your activity on this platform." },
  provided: { label: "You told us", hint: "Taken from what you entered in your profile." },
  estimate: { label: "Estimate", hint: "Worked out from your numbers; treat as approximate." },
  hypothesis: { label: "Needs checking", hint: "A reasoned guess Guava could not confirm." },
};

// Model output is untrusted: every field falls back to a safe default so one
// malformed item never throws away the whole report.
const text = z.string().catch("");
const evidence = z.enum(GUAVA_EVIDENCE).catch("hypothesis");
const textList = z.array(z.string()).catch([]);
const items = <T extends z.ZodTypeAny>(item: T) =>
  z.array(z.unknown()).catch([]).transform((arr) =>
    arr.flatMap((v) => {
      const r = item.safeParse(v);
      return r.success ? [r.data as z.infer<T>] : [];
    }),
  );

export const guavaFindingSchema = z.object({
  title: text,
  detail: text,
  evidence,
});
export type GuavaFinding = z.infer<typeof guavaFindingSchema>;

export const GUAVA_PRIORITY_LEVELS = ["high", "medium", "low"] as const;
const level = z.enum(GUAVA_PRIORITY_LEVELS).catch("medium");

export const guavaRecommendationSchema = z.object({
  title: text,
  /** What the business should do. */
  what: text,
  why: text,
  /** Which diagnosed problem this addresses. */
  problem: text,
  how: textList,
  resources: text,
  measure: text,
  risks: text,
  priority: level,
  timeframe: text,
});
export type GuavaRecommendation = z.infer<typeof guavaRecommendationSchema>;

export const guavaReportSchema = z.object({
  headline: text,
  summary: text,
  understanding: z
    .object({
      sells: text,
      customers: text,
      goals: text,
      acquisition: text,
    })
    .catch({ sells: "", customers: "", goals: "", acquisition: "" }),
  position: z
    .object({
      summary: text,
      channels: textList,
      salesProcess: text,
      performance: text,
    })
    .catch({ summary: "", channels: [], salesProcess: "", performance: "" }),
  strengths: items(guavaFindingSchema),
  weaknesses: items(guavaFindingSchema),
  opportunities: items(guavaFindingSchema),
  salesObstacles: items(
    z.object({ stage: text, issue: text, evidence }),
  ),
  priorities: items(
    z.object({
      title: text,
      why: text,
      evidence,
      assumptions: text,
      level,
    }),
  ),
  direction: z
    .object({
      summary: text,
      focusAreas: textList,
      firstSteps: textList,
    })
    .catch({ summary: "", focusAreas: [], firstSteps: [] }),
  recommendations: items(guavaRecommendationSchema),
  /** Parts of the diagnosis that are shaky, and what would firm them up. */
  uncertainties: items(z.object({ area: text, why: text, needed: text })),
});
export type GuavaReport = z.infer<typeof guavaReportSchema>;

export const guavaComparisonSchema = z.object({
  summary: text,
  confirmed: items(z.object({ assumption: text, note: text })),
  disproved: items(z.object({ assumption: text, note: text })),
  newInfoEffects: items(z.object({ info: text, effect: text })),
  improved: textList,
  newConcerns: textList,
});
export type GuavaComparison = z.infer<typeof guavaComparisonSchema> & {
  /** Computed from the two profiles, not by the model. */
  profileChanges: GuavaProfileChange[];
  previousId: string;
  previousAt: string;
};

export const GUAVA_DIAGNOSIS_STATUSES = ["processing", "completed", "failed"] as const;
export type GuavaDiagnosisStatus = (typeof GUAVA_DIAGNOSIS_STATUSES)[number];

export interface GuavaDiagnosisSummaryDto {
  id: string;
  status: GuavaDiagnosisStatus;
  industry: string | null;
  headline: string;
  completenessPct: number;
  recommendationCount: number;
  priorityCount: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface GuavaMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface GuavaDiagnosisDto extends GuavaDiagnosisSummaryDto {
  brandId: string;
  report: GuavaReport | null;
  comparison: GuavaComparison | null;
  platform: GuavaPlatformSnapshot | null;
  /** The profile exactly as it was when this diagnosis ran. */
  profile: GuavaValues;
  messages: GuavaMessageDto[];
}

export interface GuavaProfileDto {
  brandId: string;
  brandName: string;
  industry: string | null;
  /** Guess from the Brand's category, offered when no industry is chosen yet. */
  suggestedIndustry: string | null;
  /** Saved answers, with the Brand's own answers filling gaps. */
  values: GuavaValues;
  /** "section.field" keys whose shown value comes from the Brand, not from Guava. */
  inheritedKeys: string[];
  skipped: string[];
  completeness: GuavaCompleteness;
  platform: GuavaPlatformSnapshot;
  /** Owners can edit and diagnose; workspace members can only read. */
  canEdit: boolean;
  updatedAt: string | null;
}

export const guavaAskSchema = z.object({
  question: z.string().trim().min(1).max(1000),
});
export type GuavaAskRequest = z.infer<typeof guavaAskSchema>;
