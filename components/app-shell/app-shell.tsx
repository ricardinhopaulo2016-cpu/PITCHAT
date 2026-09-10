import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { MobileSidebar } from "./mobile-sidebar";
import { ToastProvider } from "@/components/ui/toast";

export function AppShell({
  workspaceName,
  email,
  children,
}: {
  workspaceName: string;
  email: string;
  children: ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg">
        <Sidebar workspaceName={workspaceName} email={email} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileSidebar workspaceName={workspaceName} email={email} />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
