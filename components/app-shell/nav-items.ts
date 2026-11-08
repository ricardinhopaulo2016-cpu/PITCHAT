import type { ComponentType, SVGProps } from "react";
import { Activity, AtSign, BarChart3, CalendarDays, Inbox, LayoutDashboard, Users, Workflow } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  comingSoon?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/dashboard/metrics", label: "Métricas", icon: BarChart3 },
  { href: "/dashboard/publishing", label: "Publicar", icon: CalendarDays },
  { href: "/dashboard/automations", label: "Automações", icon: Workflow },
  { href: "/dashboard/inbox", label: "Caixa de entrada", icon: Inbox },
  { href: "/dashboard/contacts", label: "Contatos", icon: Users },
  { href: "/dashboard/social-accounts", label: "Contas", icon: AtSign },
  { href: "/dashboard/health", label: "Saúde", icon: Activity },
];
