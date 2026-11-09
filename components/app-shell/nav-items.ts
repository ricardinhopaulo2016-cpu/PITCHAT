import type { ComponentType, SVGProps } from "react";
import { Activity, AtSign, BarChart3, CalendarDays, Inbox, LayoutDashboard, Users, Workflow } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  comingSoon?: boolean;
};

export const INBOX_HREF = "/dashboard/inbox";

/** Texto do badge do menu pra leitor de tela: o número sozinho não diz do que é. */
export function inboxUnreadLabel(count: number): string {
  return `${count} ${count === 1 ? "conversa não lida" : "conversas não lidas"}`;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/dashboard/metrics", label: "Métricas", icon: BarChart3 },
  { href: "/dashboard/publishing", label: "Publicar", icon: CalendarDays },
  { href: "/dashboard/automations", label: "Automações", icon: Workflow },
  { href: INBOX_HREF, label: "Caixa de entrada", icon: Inbox },
  { href: "/dashboard/contacts", label: "Contatos", icon: Users },
  { href: "/dashboard/social-accounts", label: "Contas", icon: AtSign },
  { href: "/dashboard/health", label: "Saúde", icon: Activity },
];
