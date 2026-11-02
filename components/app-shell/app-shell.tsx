import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { MobileSidebar } from "./mobile-sidebar";
import { ToastProvider } from "@/components/ui/toast";
import type { ChannelAccount } from "@/lib/channel/repo";

export function AppShell({
  workspaceName,
  email,
  accounts,
  children,
}: {
  workspaceName: string;
  email: string;
  accounts: ChannelAccount[];
  children: ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg">
        <div className="sticky top-0 hidden h-screen shrink-0 md:block">
          <Sidebar workspaceName={workspaceName} email={email} accounts={accounts} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileSidebar workspaceName={workspaceName} email={email} accounts={accounts} />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
