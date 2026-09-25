import { ChannelSwitcher, type ChannelSwitcherAccount } from "./channel-switcher";

/**
 * Top bar persistente (desktop/tablet, md+) — vive acima do PageHeader de
 * cada página, nunca o substitui. Hoje só carrega o Channel Switcher; é o
 * lugar natural pra crescer com mais contexto de workspace no futuro, sem
 * empurrar isso pro Rail estreito.
 */
export function TopBar({ accounts }: { accounts: ChannelSwitcherAccount[] }) {
  return (
    <div className="hidden items-center border-b border-border-subtle bg-bg-sidebar px-6 py-2.5 md:flex">
      <ChannelSwitcher accounts={accounts} />
    </div>
  );
}
