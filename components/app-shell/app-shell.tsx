import type { ReactNode } from "react";
import { Rail } from "./rail";
import { TopBar } from "./top-bar";
import { MobileSidebar } from "./mobile-sidebar";
import { ToastProvider } from "@/components/ui/toast";
import type { ChannelSwitcherAccount } from "./channel-switcher";

export function AppShell({
  workspaceName,
  email,
  accounts,
  children,
}: {
  workspaceName: string;
  email: string;
  accounts: ChannelSwitcherAccount[];
  children: ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg">
        <Rail workspaceName={workspaceName} email={email} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileSidebar workspaceName={workspaceName} email={email} accounts={accounts} />
          <TopBar accounts={accounts} />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
