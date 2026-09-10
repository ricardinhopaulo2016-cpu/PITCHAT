import type { ComponentType, SVGProps } from "react";
import { OverviewIcon, FlowIcon, ChannelIcon, InboxSignalIcon, ContactThreadIcon } from "@/components/icons/pitchat";

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
  { href: "/dashboard/inbox", label: "Inbox", icon: InboxSignalIcon, comingSoon: true },
  { href: "/dashboard/contacts", label: "Contacts", icon: ContactThreadIcon, comingSoon: true },
];
