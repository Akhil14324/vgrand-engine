import {
  CalendarDays,
  Clapperboard,
  Film,
  Instagram,
  BarChart3,
  MessageCircleReply,
  MessagesSquare,
  ImageIcon,
  LayoutGrid,
  Compass,
  Contact,
  Globe,
  ListChecks,
  Rocket,
  Target,
  TrendingUp,
  Store,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  /** Optional section heading; a heading is shown when the group changes. */
  group?: string;
}

export interface NavGroup {
  icon: LucideIcon;
  label: string;
  items: NavItem[];
}

/** Top-level nav rows rendered above the collapsible groups. */
export const NAV_ITEMS: NavItem[] = [
  { icon: LayoutGrid, label: "Workspace", href: "/workspaces" },
];

/** Collapsible sidebar sections - children are real routes, same for every user. */
export const NAV_GROUPS: NavGroup[] = [
  {
    icon: Rocket,
    label: "Brand Engine",
    items: [
      { icon: Store, label: "Brand", href: "/brand" },
      { icon: ImageIcon, label: "Library", href: "/library" },
      { icon: CalendarDays, label: "Social Calendar", href: "/calendar" },
      { icon: Clapperboard, label: "Reels", href: "/reels" },
      { icon: Film, label: "Shorts Factory", href: "/shorts" },
      { icon: MessageCircleReply, label: "IG Automations", href: "/automations" },
      { icon: MessagesSquare, label: "WhatsApp", href: "/whatsapp" },
      { icon: Contact, label: "CRM", href: "/crm" },
      { icon: Globe, label: "Website to CatGPT integration", href: "/website" },
      { icon: Instagram, label: "Instagram", href: "/instagram" },
      { icon: BarChart3, label: "Instagram Insights", href: "/instagram-insights" },
      { icon: Compass, label: "Brand Strategist", href: "/guava" },
      { icon: Target, label: "B Camp", href: "/bcamp" },
      { icon: ListChecks, label: "Execution", href: "/execution" },
      { icon: TrendingUp, label: "Growth", href: "/growth" },
    ],
  },
];
