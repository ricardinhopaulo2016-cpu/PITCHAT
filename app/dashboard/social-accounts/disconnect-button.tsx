"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DisconnectButton({ socialAccountId }: { socialAccountId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (!confirm("Desconectar essa conta do Instagram? As automações dela param de funcionar.")) return;
    setBusy(true);
    await fetch(`/api/social-accounts/${socialAccountId}/disconnect`, { method: "POST" });
    router.refresh();
    setBusy(false);
  }

  return (
    <button onClick={handleClick} disabled={busy} className="text-sm text-red-600 underline">
      {busy ? "Desconectando…" : "Desconectar"}
    </button>
  );
}
