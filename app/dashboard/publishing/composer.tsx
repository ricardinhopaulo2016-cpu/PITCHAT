"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AccountTile } from "@/components/ui/account-tile";
import { formatBytes, formatDurationMs, formatResolution } from "@/lib/media/format";
import { CAPTION_MAX_LENGTH, validateAssetForPublishing, type PublishMediaType } from "@/lib/publishing/validate";
import { MediaUploadForm } from "../media/upload-form";
import { formatPostTime } from "./format";

export type ComposerAsset = {
  id: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  url: string | null;
};

export type ComposerAccount = { id: string; username: string | null; canPublish: boolean };

const fieldLabel = "text-sm font-medium text-text";

function segment(active: boolean) {
  return `h-11 flex-1 rounded-[9px] px-3 text-sm transition-colors duration-[var(--motion-fast)] ${
    active ? "bg-surface-elevated font-semibold text-white" : "font-medium text-text-secondary hover:text-text"
  }`;
}

/** Valor para o input datetime-local: próxima hora cheia, no fuso do navegador. */
function defaultWhen(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function isPastOrInvalid(value: string): boolean {
  const time = new Date(value).getTime();
  return !value || Number.isNaN(time) || time < Date.now();
}

export function Composer({ assets, accounts }: { assets: ComposerAsset[]; accounts: ComposerAccount[] }) {
  const router = useRouter();
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [mediaType, setMediaType] = useState<PublishMediaType>("REELS");
  const [selected, setSelected] = useState<string[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [shareToFeed, setShareToFeed] = useState(true);
  const [mode, setMode] = useState<"now" | "later">("later");
  const [when, setWhen] = useState(defaultWhen);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const asset = assets.find((a) => a.id === assetId) ?? null;
  const validation = useMemo(() => (asset ? validateAssetForPublishing(asset, mediaType) : { errors: [], warnings: [] }), [asset, mediaType]);
  const isReel = mediaType === "REELS";

  const accountsInOrder = accounts.filter((a) => selected.includes(a.id));
  const schedule = accountsInOrder.map((account, index) => ({
    account,
    caption: isReel ? (captions[account.id] ?? "").trim() : "",
    at: mode === "now" ? null : new Date(new Date(when).getTime() + index * intervalMinutes * 60_000),
  }));

  const repeatedCaptions = useMemo(() => {
    const filled = schedule.map((s) => s.caption).filter(Boolean);
    return new Set(filled).size < filled.length;
  }, [schedule]);

  const missingCaption = isReel && schedule.some((s) => !s.caption);
  const whenInvalid = mode === "later" && isPastOrInvalid(when);
  const canReview = !!asset && selected.length > 0 && validation.errors.length === 0 && !whenInvalid;

  function toggleAccount(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function openReview() {
    setReviewed(false);
    setProblems([]);
    setReviewOpen(true);
  }

  async function confirm() {
    if (!asset) return;
    setBusy(true);
    setProblems([]);
    const res = await fetch("/api/scheduled-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaAssetId: asset.id,
        mediaType,
        shareToFeed,
        items: schedule.map((s) => ({ socialAccountId: s.account.id, caption: s.caption, scheduledAt: s.at ? s.at.toISOString() : null })),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setProblems(json.problems ?? ["Não foi possível salvar. Tente de novo."]);
      return;
    }

    setReviewOpen(false);
    setSelected([]);
    setCaptions({});
    setDone(
      json.queueFailures > 0
        ? `${json.created} post(s) salvos, mas ${json.queueFailures} não entraram na fila. Veja os erros abaixo.`
        : mode === "now"
          ? `${json.created} post(s) enviados para publicar agora.`
          : `${json.created} post(s) agendados.`
    );
    router.refresh();
  }

  return (
    <div className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-6">
      <h2 className="mb-5 text-lg font-semibold text-text">Novo post</h2>
      <div className="flex flex-col gap-5">
        {/* Mídia */}
        <div className="flex gap-4">
          <div className="aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-[12px] bg-surface-3">
            {asset?.url && asset.mime_type?.startsWith("video/") ? (
              <video key={asset.id} src={asset.url} controls playsInline preload="metadata" className="h-full w-full object-contain" />
            ) : asset?.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL expira, next/image cacheia por tempo demais pra isso
              <img src={asset.url} alt="" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center px-2 text-center text-xs text-text-muted">Escolha ou envie um arquivo</div>
            )}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            {asset ? (
              <>
                <p className="truncate font-semibold text-text" title={asset.original_filename ?? undefined}>{asset.original_filename ?? "(sem nome)"}</p>
                <p className="mt-2 text-text-secondary">{formatDurationMs(asset.duration_ms)}</p>
                <p className="text-text-secondary">{formatResolution(asset.width, asset.height)}</p>
                <p className="text-text-secondary">{formatBytes(asset.file_size)}</p>
              </>
            ) : (
              <p className="text-text-muted">Nenhum arquivo escolhido.</p>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel} htmlFor="publish-asset">Arquivo</label>
            <Select id="publish-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              {assets.length === 0 && <option value="">Nenhum arquivo na biblioteca</option>}
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.original_filename ?? "(sem nome)"}
                </option>
              ))}
            </Select>
            <div className="mt-1">
              <MediaUploadForm onUploaded={setAssetId} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Formato</span>
            <div className="flex gap-1.5 rounded-[12px] bg-bg p-1">
              <button type="button" className={segment(isReel)} aria-pressed={isReel} onClick={() => setMediaType("REELS")}>Reel</button>
              <button type="button" className={segment(!isReel)} aria-pressed={!isReel} onClick={() => setMediaType("STORIES")}>Story</button>
            </div>
            {validation.errors.map((message) => (
              <p key={message} className="text-sm text-danger">{message}</p>
            ))}
            {validation.warnings.map((message) => (
              <p key={message} className="text-sm text-warning">{message}</p>
            ))}
            {!isReel && <p className="text-xs text-text-muted">Stories saem só com imagem ou vídeo: sem legenda, link ou figurinha.</p>}
          </div>

          <div className="flex flex-col gap-2">
            <span className={fieldLabel}>Perfis e legendas</span>
            {accounts.length === 0 && <p className="text-sm text-text-muted">Nenhuma conta conectada.</p>}
            <ul className="flex flex-col gap-2">
              {accounts.map((account) => {
                const checked = selected.includes(account.id);
                return (
                  <li key={account.id} className="rounded-[var(--radius-panel-sm)] border border-border-subtle">
                    <label className={`flex items-center gap-2.5 px-3 py-2 text-sm ${account.canPublish ? "cursor-pointer text-text" : "text-text-muted"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!account.canPublish}
                        onChange={() => toggleAccount(account.id)}
                        className="h-4 w-4 shrink-0 accent-[var(--signal)]"
                      />
                      <AccountTile username={account.username} size="sm" />
                      <span className="min-w-0 truncate">@{account.username ?? "sem username"}</span>
                      {!account.canPublish && <span className="shrink-0 text-xs text-warning">reconecte para publicar</span>}
                    </label>
                    {checked && isReel && (
                      <div className="border-t border-border-subtle p-3">
                        <Textarea
                          rows={3}
                          maxLength={CAPTION_MAX_LENGTH}
                          placeholder={`Legenda de @${account.username ?? "conta"}`}
                          aria-label={`Legenda de ${account.username ?? "conta"}`}
                          value={captions[account.id] ?? ""}
                          onChange={(e) => setCaptions((prev) => ({ ...prev, [account.id]: e.target.value }))}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {repeatedCaptions && <p className="text-sm text-warning">Há contas com a mesma legenda.</p>}
          </div>

          {isReel && (
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text">
              <input type="checkbox" checked={shareToFeed} onChange={(e) => setShareToFeed(e.target.checked)} className="h-4 w-4 accent-[var(--signal)]" />
              Mostrar também no feed do perfil
            </label>
          )}

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Quando</span>
            <div className="flex gap-1.5 rounded-[12px] bg-bg p-1">
              <button type="button" className={segment(mode === "later")} aria-pressed={mode === "later"} onClick={() => setMode("later")}>Agendar</button>
              <button type="button" className={segment(mode === "now")} aria-pressed={mode === "now"} onClick={() => setMode("now")}>Agora</button>
            </div>
            {mode === "later" && (
              <div className="mt-1 flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className={fieldLabel} htmlFor="publish-when">Data e hora</label>
                  <Input id="publish-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full" />
                </div>
                {selected.length > 1 && (
                  <div className="flex flex-col gap-1.5">
                    <label className={fieldLabel} htmlFor="publish-interval">Intervalo entre contas</label>
                    <Select id="publish-interval" value={String(intervalMinutes)} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
                      <option value="0">Mesmo horário</option>
                      <option value="15">15 minutos</option>
                      <option value="30">30 minutos</option>
                      <option value="60">1 hora</option>
                      <option value="120">2 horas</option>
                    </Select>
                  </div>
                )}
              </div>
            )}
            {whenInvalid && <p className="text-sm text-danger">Escolha um horário no futuro.</p>}
          </div>

          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="primary" disabled={!canReview} onClick={openReview} className="w-full">
              Revisar {selected.length > 0 ? `${selected.length} post${selected.length > 1 ? "s" : ""}` : ""}
            </Button>
            {done && <p className="text-sm text-success">{done}</p>}
          </div>
        </div>
      </div>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent title="Revisar antes de confirmar" description="Depois de confirmar, os posts saem sozinhos no horário.">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">
              {isReel ? "Reel" : "Story"}: {asset?.original_filename ?? "(sem nome)"}
            </p>
            <ul className="flex flex-col gap-2">
              {schedule.map((s) => (
                <li key={s.account.id} className="rounded-[var(--radius-panel-sm)] border border-border-subtle bg-surface-1 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-text">@{s.account.username ?? "sem username"}</span>
                    <span className="text-text-secondary">{s.at ? formatPostTime(s.at.toISOString()) : "Agora"}</span>
                  </div>
                  {isReel && (
                    <p className={`mt-1 whitespace-pre-wrap ${s.caption ? "text-text-secondary" : "text-warning"}`}>{s.caption || "Sem legenda"}</p>
                  )}
                </li>
              ))}
            </ul>
            {missingCaption && <p className="text-sm text-warning">Sem legenda, o Reel não pede o comentário EU QUERO.</p>}
            {validation.warnings.map((message) => (
              <p key={message} className="text-sm text-warning">{message}</p>
            ))}
            {problems.map((message) => (
              <p key={message} className="text-sm text-danger">{message}</p>
            ))}
            <label className="flex cursor-pointer items-start gap-2.5 border-t border-border-subtle pt-4 text-sm text-text">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--signal)]" />
              Revisei contas, legendas e horários
            </label>
            <div className="flex justify-end gap-3">
              <Button type="button" onClick={() => setReviewOpen(false)} disabled={busy}>Voltar</Button>
              <Button type="button" variant="primary" disabled={!reviewed || busy} onClick={confirm}>
                {busy ? "Salvando…" : mode === "now" ? "Publicar agora" : "Confirmar agendamento"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
