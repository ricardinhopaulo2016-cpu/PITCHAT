"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatBytes } from "@/lib/media/format";
import { friendlyUploadError } from "@/lib/media/error-messages";
import { uploadMediaFile } from "@/lib/media/upload-client";
import { CAPTION_MAX_LENGTH, type PublishMediaType } from "@/lib/publishing/validate";
import { distributeSchedule } from "@/lib/publishing/batch-schedule";
import type { ComposerAccount } from "./composer";

/** Limite real por arquivo no plano gratuito do Supabase. Acima disso o Claude comprime pelo script. */
const BROWSER_UPLOAD_LIMIT = 50 * 1024 * 1024;
const ACCEPT = "video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp";

type Phase = "waiting" | "uploading" | "processing" | "ready" | "failed";

type Row = {
  key: string;
  /** Código do post: reenviar o mesmo lote (clique duplo, rede caiu) não duplica. */
  clientRef: string;
  file: File;
  phase: Phase;
  mediaAssetId: string | null;
  duplicate: boolean;
  error: string | null;
  accountId: string;
  when: string;
  caption: string;
  problems: string[];
  warnings: string[];
};

type ReviewItem = { index: number; problems: string[]; warnings: string[]; outcome: "new" | "existing" };

const fieldLabel = "text-xs font-medium text-text-secondary";

function nextHourLocal(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function segment(active: boolean) {
  return `h-9 flex-1 rounded-[9px] px-3 text-sm transition-colors duration-[var(--motion-fast)] ${
    active ? "bg-surface-elevated font-semibold text-white" : "font-medium text-text-secondary hover:text-text"
  }`;
}

export function BatchComposer({ accounts }: { accounts: ComposerAccount[] }) {
  const router = useRouter();
  const publishable = accounts.filter((a) => a.canPublish);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [mediaType, setMediaType] = useState<PublishMediaType>("REELS");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [defaultAccount, setDefaultAccount] = useState(publishable[0]?.id ?? "");
  const [start, setStart] = useState(nextHourLocal);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [reviewOk, setReviewOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  const isReel = mediaType === "REELS";
  const uploading = rows.some((r) => r.phase === "waiting" || r.phase === "uploading" || r.phase === "processing");
  const failedUploads = rows.filter((r) => r.phase === "failed").length;
  const canReview = rows.length > 0 && !uploading && failedUploads === 0 && rows.every((r) => r.accountId && r.when);

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Qualquer mudança na tabela invalida a revisão: o que foi conferido precisa ser o que vai ser gravado. */
  function edit(key: string, patch: Partial<Row>) {
    patchRow(key, { ...patch, problems: [], warnings: [] });
    setReviewOk(false);
    setMessage(null);
  }

  async function upload(row: Row) {
    if (row.file.size > BROWSER_UPLOAD_LIMIT) {
      patchRow(row.key, { phase: "failed", error: `Tem ${formatBytes(row.file.size)}. Acima de 50 MB: peça ao Claude para comprimir e subir.` });
      return;
    }
    try {
      const result = await uploadMediaFile(row.file, (phase) => patchRow(row.key, { phase }));
      patchRow(row.key, { phase: "ready", mediaAssetId: result.mediaAssetId, duplicate: result.duplicate && !result.restored, error: null });
    } catch (err) {
      patchRow(row.key, { phase: "failed", error: friendlyUploadError(err instanceof Error ? err.message : null) });
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const existing = rows.length;
    const added: Row[] = Array.from(files).map((file) => ({
      key: crypto.randomUUID(),
      clientRef: `LOTE-${crypto.randomUUID()}`,
      file,
      phase: "waiting",
      mediaAssetId: null,
      duplicate: false,
      error: null,
      accountId: defaultAccount,
      when: "",
      caption: "",
      problems: [],
      warnings: [],
    }));
    const all = [...rows, ...added];
    const times = distributeSchedule(all, start, intervalMinutes);
    for (let i = existing; i < all.length; i++) all[i].when = times[i];
    setRows(all);
    setReviewOk(false);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = "";
    // Um por vez: vários envios grandes juntos derrubam a conexão de casa.
    for (const row of added) await upload(row);
    router.refresh();
  }

  function redistribute() {
    const times = distributeSchedule(rows, start, intervalMinutes);
    setRows((prev) => prev.map((r, i) => ({ ...r, when: times[i], problems: [], warnings: [] })));
    setReviewOk(false);
  }

  function applyDefaultAccount() {
    setRows((prev) => prev.map((r) => ({ ...r, accountId: defaultAccount, problems: [], warnings: [] })));
    setReviewOk(false);
  }

  function remove(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setReviewOk(false);
  }

  function payload(dryRun: boolean) {
    return {
      dryRun,
      posts: rows.map((r) => ({
        clientRef: r.clientRef,
        mediaAssetId: r.mediaAssetId,
        account: r.accountId,
        mediaType,
        caption: isReel ? r.caption.trim() : "",
        scheduledAt: new Date(r.when).toISOString(),
        shareToFeed,
      })),
    };
  }

  async function review() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/scheduled-posts/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(true)) });
      const json = (await res.json().catch(() => ({}))) as { items?: ReviewItem[]; problems?: string[] };
      const byIndex = new Map((json.items ?? []).map((item) => [item.index, item]));
      setRows((prev) => prev.map((r, i) => ({ ...r, problems: byIndex.get(i)?.problems ?? [], warnings: byIndex.get(i)?.warnings ?? [] })));
      if (res.ok) {
        setReviewOk(true);
        const existing = (json.items ?? []).filter((i) => i.outcome === "existing").length;
        setMessage({ tone: "success", text: `Tudo certo.${existing ? ` ${existing} já estavam agendados e não serão duplicados.` : ""} Confira a tabela e agende.` });
      } else {
        setReviewOk(false);
        setMessage({ tone: "danger", text: json.problems?.[0] ?? "Há problemas nas linhas marcadas em vermelho. Nada foi agendado." });
      }
    } catch {
      setMessage({ tone: "danger", text: "Não foi possível revisar agora. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  async function schedule() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/scheduled-posts/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(false)) });
      const json = (await res.json().catch(() => ({}))) as { created?: unknown[]; queueFailures?: number; items?: ReviewItem[] };
      if (!res.ok) {
        const byIndex = new Map((json.items ?? []).map((item) => [item.index, item]));
        setRows((prev) => prev.map((r, i) => ({ ...r, problems: byIndex.get(i)?.problems ?? [] })));
        setReviewOk(false);
        setMessage({ tone: "danger", text: res.status === 409 ? "Esse lote já foi agendado. Atualize a página." : "Nada foi agendado. Revise de novo." });
        return;
      }
      const created = json.created?.length ?? 0;
      setRows([]);
      setReviewOk(false);
      setMessage({
        tone: json.queueFailures ? "danger" : "success",
        text: json.queueFailures
          ? `${created} post(s) salvos, mas ${json.queueFailures} não entraram na fila. Veja "Com erro" na página.`
          : `${created} post(s) agendados.`,
      });
      router.refresh();
    } catch {
      setMessage({ tone: "danger", text: "A conexão caiu. Clique em Revisar de novo: o que já foi agendado não duplica." });
      setReviewOk(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-text">Vários vídeos</h2>
      <p className="mt-1 text-sm text-text-secondary">Sobe a remessa de uma vez, com perfil, horário e legenda por vídeo.</p>
      <Button type="button" className="mt-4 w-full" onClick={() => setOpen(true)}>
        {rows.length > 0 ? `Continuar lote (${rows.length})` : "Agendar em lote"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" title="Agendar em lote" description="Revisar confere tudo sem gravar nada. Um problema em qualquer linha segura o lote inteiro.">
          <div className="flex flex-col gap-5" {...(uploading ? { "data-realtime-hold": "" } : {})}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[170px_minmax(0,1fr)_210px_160px_auto]">
              <div className="flex flex-col gap-1">
                <span className={fieldLabel}>Formato</span>
                <div className="flex gap-1 rounded-[12px] bg-bg p-1">
                  <button type="button" className={segment(isReel)} aria-pressed={isReel} onClick={() => { setMediaType("REELS"); setReviewOk(false); }}>Reel</button>
                  <button type="button" className={segment(!isReel)} aria-pressed={!isReel} onClick={() => { setMediaType("STORIES"); setReviewOk(false); }}>Story</button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className={fieldLabel} htmlFor="batch-account">Perfil padrão</label>
                <div className="flex gap-2">
                  <Select id="batch-account" value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)}>
                    {publishable.map((a) => (
                      <option key={a.id} value={a.id}>@{a.username ?? "sem username"}</option>
                    ))}
                  </Select>
                  {rows.length > 0 && (
                    <Button type="button" variant="tertiary" onClick={applyDefaultAccount} className="shrink-0">Aplicar a todos</Button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className={fieldLabel} htmlFor="batch-start">Primeiro horário</label>
                <Input id="batch-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className={fieldLabel} htmlFor="batch-interval">Intervalo por conta</label>
                <Select id="batch-interval" value={String(intervalMinutes)} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
                  <option value="30">30 minutos</option>
                  <option value="60">1 hora</option>
                  <option value="120">2 horas</option>
                  <option value="180">3 horas</option>
                  <option value="240">4 horas</option>
                  <option value="360">6 horas</option>
                  <option value="1440">1 dia</option>
                </Select>
              </div>
              <div className="flex items-end">
                <Button type="button" variant="tertiary" disabled={rows.length === 0} onClick={redistribute}>Redistribuir horários</Button>
              </div>
            </div>

            {isReel && (
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text">
                <input type="checkbox" checked={shareToFeed} onChange={(e) => { setShareToFeed(e.target.checked); setReviewOk(false); }} className="h-4 w-4 accent-[var(--signal)]" />
                Mostrar também no feed do perfil
              </label>
            )}

            <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              className="flex flex-col items-center gap-2 rounded-[var(--radius-panel-sm)] border border-dashed border-border px-4 py-5 text-center"
            >
              <p className="text-sm text-text-secondary">Arraste os vídeos aqui ou</p>
              <Button type="button" onClick={() => inputRef.current?.click()}>Escolher vídeos</Button>
              <p className="text-xs text-text-muted">Até 50 MB por vídeo. Sobem um por vez; o mesmo vídeo não sobe duas vezes.</p>
            </div>

            {rows.length > 0 && (
              <ul className="flex flex-col divide-y divide-border-subtle rounded-[var(--radius-panel-sm)] border border-border-subtle">
                {rows.map((row, index) => (
                  <li key={row.key} className={`flex flex-col gap-2 p-3 ${row.problems.length ? "bg-danger-soft" : ""}`}>
                    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.1fr)_200px_200px_minmax(0,1.6fr)_32px]">
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium text-text" title={row.file.name}>
                          <span className="mr-1.5 text-text-muted tabular-nums">{index + 1}.</span>
                          {row.file.name}
                        </p>
                        <UploadStatus row={row} />
                      </div>
                      <Select aria-label={`Perfil do vídeo ${index + 1}`} value={row.accountId} onChange={(e) => edit(row.key, { accountId: e.target.value })}>
                        {publishable.map((a) => (
                          <option key={a.id} value={a.id}>@{a.username ?? "sem username"}</option>
                        ))}
                      </Select>
                      <Input aria-label={`Horário do vídeo ${index + 1}`} type="datetime-local" value={row.when} onChange={(e) => edit(row.key, { when: e.target.value })} />
                      {isReel ? (
                        <Textarea
                          rows={2}
                          maxLength={CAPTION_MAX_LENGTH}
                          placeholder="Legenda deste vídeo"
                          aria-label={`Legenda do vídeo ${index + 1}`}
                          value={row.caption}
                          onChange={(e) => edit(row.key, { caption: e.target.value })}
                          className="min-h-11"
                        />
                      ) : (
                        <p className="text-xs text-text-muted">Story sai sem legenda.</p>
                      )}
                      <button
                        type="button"
                        aria-label={`Tirar o vídeo ${index + 1} do lote`}
                        onClick={() => remove(row.key)}
                        className="grid h-8 w-8 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-text"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {row.phase === "failed" && (
                      <div className="flex items-center gap-3">
                        <p className="text-sm text-danger">{row.error}</p>
                        {row.file.size <= BROWSER_UPLOAD_LIMIT && (
                          <Button type="button" variant="tertiary" onClick={() => upload(row)}>Tentar de novo</Button>
                        )}
                      </div>
                    )}
                    {row.problems.map((p) => (
                      <p key={p} className="text-sm text-danger">{p}</p>
                    ))}
                    {row.warnings.map((w) => (
                      <p key={w} className="text-sm text-warning">{w}</p>
                    ))}
                    {isReel && row.phase === "ready" && !row.caption.trim() && (
                      <p className="text-xs text-warning">Sem legenda, o Reel não pede o comentário EU QUERO.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-3 border-t border-border-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                {message && <p className={message.tone === "danger" ? "text-danger" : "text-success"}>{message.text}</p>}
                {!message && uploading && <p className="text-text-secondary">Enviando os vídeos…</p>}
                {!message && failedUploads > 0 && !uploading && <p className="text-danger">Tire ou reenvie os vídeos com falha antes de revisar.</p>}
              </div>
              <div className="flex shrink-0 gap-3">
                <Button type="button" disabled={!canReview || busy} onClick={review}>
                  {busy && !reviewOk ? "Conferindo…" : "Revisar"}
                </Button>
                <Button type="button" variant="primary" disabled={!reviewOk || busy} onClick={schedule}>
                  {busy && reviewOk ? "Agendando…" : `Agendar ${rows.length} post${rows.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UploadStatus({ row }: { row: Row }) {
  const size = <span className="text-text-muted">{formatBytes(row.file.size)} · </span>;
  switch (row.phase) {
    case "waiting":
      return <p className="text-xs">{size}<span className="text-text-muted">Na fila para subir</span></p>;
    case "uploading":
      return <p className="text-xs">{size}<span className="text-warning">Enviando…</span></p>;
    case "processing":
      return <p className="text-xs">{size}<span className="text-warning">Processando…</span></p>;
    case "ready":
      return <p className="text-xs">{size}<span className="text-success">{row.duplicate ? "Já estava na biblioteca" : "Pronto"}</span></p>;
    case "failed":
      return <p className="text-xs">{size}<span className="text-danger">Falhou</span></p>;
  }
}
