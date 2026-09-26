import {
  CalendarDays,
  ImageIcon,
  LayoutGrid,
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

/** Single source for sidebar navigation - new feature pages are added here. */
export const NAV_ITEMS: NavItem[] = [
  { icon: LayoutGrid, label: "Workspace", href: "/workspaces" },
  { icon: Store, label: "Brand", href: "/brand" },
  { icon: ImageIcon, label: "Library", href: "/library" },
  { icon: CalendarDays, label: "Social Calendar", href: "/calendar" },
];
