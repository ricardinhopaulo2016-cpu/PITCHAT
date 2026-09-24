import type { ComponentType, SVGProps } from "react";
import { OverviewIcon, FlowIcon, ChannelIcon, InboxSignalIcon, ContactThreadIcon, PulseIcon } from "@/components/icons/pitchat";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  comingSoon?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: OverviewIcon },
  { href: "/dashboard/automations", label: "Automations", icon: FlowIcon },
  { href: "/dashboard/social-accounts", label: "Social Accounts", icon: ChannelIcon },
  { href: "/dashboard/health", label: "Health", icon: PulseIcon },
  { href: "/dashboard/inbox", label: "Inbox", icon: InboxSignalIcon },
  { href: "/dashboard/contacts", label: "Contacts", icon: ContactThreadIcon },
];
