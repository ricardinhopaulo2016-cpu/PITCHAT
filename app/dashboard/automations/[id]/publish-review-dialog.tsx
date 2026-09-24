"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { FlowStep } from "@/lib/automation/flow-spec";
import { compileFlowToGraph } from "@/lib/automation/flow-spec";
import { computeGraphReviewHash } from "@/lib/automation/review-hash";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Gate de revisão antes de publicar (B3, auditoria 24/09/2026): foi possível
 * publicar conteúdo real inadequado sem revisão nenhuma nesta mesma sessão.
 * Mostra TUDO que vai sair pro Instagram — nunca deixa "Publicar automação"
 * habilitado sem o checkbox marcado. Se o conteúdo mudar depois de aberto
 * (outra aba, por exemplo), o hash mandado ao servidor não bate mais e a
 * publicação é recusada (ver lib/automation/review-hash.ts).
 */
function Section({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <ul className="flex flex-col gap-1">
        {items.map((text, i) => (
          <li key={i} className="whitespace-pre-wrap rounded-[var(--radius-panel-sm)] border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-sm text-text">
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PublishReviewDialog({
  open,
  onOpenChange,
  accountUsername,
  steps,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountUsername: string | null;
  steps: FlowStep[];
  onConfirm: (reviewedGraphHash: string) => void;
  confirming: boolean;
}) {
  const checkboxId = useId();
  const [reviewed, setReviewed] = useState(false);
  const [hash, setHash] = useState<string | null>(null);

  // Recalcula o hash toda vez que o modal abre. O cleanup (não o corpo do
  // effect) reseta checkbox/hash — roda tanto quando o usuário fecha (Radix
  // chama onOpenChange) quanto quando o pai fecha externamente depois de
  // publicar (confirmPublish em flow-editor.tsx muda `open` direto, sem
  // passar por onOpenChange) — nunca reaproveita uma revisão antiga.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    computeGraphReviewHash(compileFlowToGraph({ steps })).then((h) => {
      if (!cancelled) setHash(h);
    });
    return () => {
      cancelled = true;
      setReviewed(false);
      setHash(null);
    };
  }, [open, steps]);

  const keywords = useMemo(
    () =>
      steps
        .filter((s): s is Extract<FlowStep, { type: "KEYWORD_MATCH" }> => s.type === "KEYWORD_MATCH")
        .flatMap((s) => s.keywords.map((k) => `${k.matchType === "EXACT" ? "Exato" : "Contém"}: "${k.value}"`)),
    [steps]
  );
  const publicReplies = useMemo(
    () => steps.filter((s): s is Extract<FlowStep, { type: "PUBLIC_REPLY" }> => s.type === "PUBLIC_REPLY").flatMap((s) => s.variants),
    [steps]
  );
  const privateReplies = useMemo(
    () => steps.filter((s): s is Extract<FlowStep, { type: "PRIVATE_REPLY" }> => s.type === "PRIVATE_REPLY").map((s) => s.text),
    [steps]
  );
  const quickReplies = useMemo(
    () =>
      steps
        .filter((s): s is Extract<FlowStep, { type: "QUICK_REPLY" }> => s.type === "QUICK_REPLY")
        .map((s) => `${s.text}\n${s.options.map((o) => `[${o.title}]`).join("  ")}`),
    [steps]
  );
  const sendMessages = useMemo(
    () => steps.filter((s): s is Extract<FlowStep, { type: "SEND_MESSAGE" }> => s.type === "SEND_MESSAGE").map((s) => s.text),
    [steps]
  );
  const delays = useMemo(
    () => steps.filter((s): s is Extract<FlowStep, { type: "DELAY" }> => s.type === "DELAY").map((s) => `${s.minutes} minuto(s)`),
    [steps]
  );

  const canConfirm = reviewed && !!hash && !confirming;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Publicar automação" description="Confira exatamente o que vai sair pro Instagram antes de confirmar.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Conta</p>
            <p className="text-sm text-text">{accountUsername ? `@${accountUsername}` : "Nenhuma conta conectada a este perfil"}</p>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Trigger</p>
            <p className="text-sm text-text">Instagram Comment</p>
          </div>

          <Section label="Keywords" items={keywords} />
          <Section label="Public Replies" items={publicReplies} />
          <Section label="Private Replies" items={privateReplies} />
          <Section label="Quick Replies" items={quickReplies} />
          <Section label="Send Messages" items={sendMessages} />
          <Section label="Delays" items={delays} />

          {steps.length === 0 && (
            <p className="text-sm text-text-muted">Este flow não tem nenhum step além do trigger — nada será enviado.</p>
          )}

          <label htmlFor={checkboxId} className="mt-2 flex cursor-pointer items-start gap-2.5 border-t border-border-subtle pt-4 text-sm text-text">
            <input
              id={checkboxId}
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--signal)]"
            />
            Revisei as mensagens e ações acima
          </label>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={confirming}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" disabled={!canConfirm} onClick={() => hash && onConfirm(hash)}>
              {confirming ? "Publicando…" : "Publicar automação"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
