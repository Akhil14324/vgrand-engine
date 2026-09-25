import {
  Building2,
  Home,
  Megaphone,
  Package,
  Presentation,
  Sparkles,
  Tag,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/** Theme slug icons — seeded themes carry an `icon` name that maps here. */
export const THEME_ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed,
  building: Building2,
  sparkles: Sparkles,
  home: Home,
  megaphone: Megaphone,
  tag: Tag,
  package: Package,
  presentation: Presentation,
};
