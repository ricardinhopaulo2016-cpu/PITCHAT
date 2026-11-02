"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import type { FlowStep, FlowStepType } from "@/lib/automation/flow-spec";
import type { ConditionRule } from "@/lib/automation/node-handlers";
import { SignalMarker, type SignalMarkerType } from "@/components/icons/pitchat";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { PublishReviewDialog } from "./publish-review-dialog";
import type { ProfileAccountSummary } from "@/lib/social-accounts/repo";

const STEP_LABELS: Record<FlowStepType, string> = {
  KEYWORD_MATCH: "Palavra-chave",
  PUBLIC_REPLY: "Resposta pública",
  PRIVATE_REPLY: "Primeira DM",
  SEND_MESSAGE: "Enviar mensagem",
  QUICK_REPLY: "Mensagem com opções",
  DELAY: "Espera",
  CONDITION: "Condição",
  ADD_TAG: "Adicionar tag",
  REMOVE_TAG: "Remover tag",
  SET_CUSTOM_FIELD: "Preencher campo",
};

/** Marker da Signal Rail por tipo de step — ver docs/PITCHAT_DESIGN_SYSTEM.md §10/§13. */
const STEP_MARKER: Record<FlowStepType, SignalMarkerType> = {
  KEYWORD_MATCH: "logic",
  CONDITION: "logic",
  DELAY: "wait",
  PUBLIC_REPLY: "action",
  PRIVATE_REPLY: "action",
  SEND_MESSAGE: "action",
  QUICK_REPLY: "action",
  ADD_TAG: "action",
  REMOVE_TAG: "action",
  SET_CUSTOM_FIELD: "action",
};

/** Categorias do menu "+" (seção 29 do briefing) — só nodes já suportados, nunca inventar feature. */
const ADD_STEP_CATEGORIES: { label: string; types: FlowStepType[] }[] = [
  { label: "Lógica", types: ["KEYWORD_MATCH", "CONDITION"] },
  { label: "Mensagem", types: ["PUBLIC_REPLY", "PRIVATE_REPLY", "SEND_MESSAGE", "QUICK_REPLY"] },
  { label: "Dados", types: ["ADD_TAG", "REMOVE_TAG", "SET_CUSTOM_FIELD"] },
];

function defaultStepFor(type: FlowStepType): FlowStep {
  switch (type) {
    case "KEYWORD_MATCH":
      return { type, keywords: [{ value: "", matchType: "CONTAINS" }] };
    case "PUBLIC_REPLY":
      return { type, variants: [""] };
    case "PRIVATE_REPLY":
      return { type, text: "" };
    case "SEND_MESSAGE":
      return { type, text: "" };
    case "QUICK_REPLY":
      return { type, text: "", options: [{ key: "yes", title: "" }] };
    case "DELAY":
      return { type, minutes: 5 };
    case "CONDITION":
      return { type, rule: { type: "conversation_automation_enabled" } };
    case "ADD_TAG":
      return { type, tagName: "" };
    case "REMOVE_TAG":
      return { type, tagName: "" };
    case "SET_CUSTOM_FIELD":
      return { type, key: "", value: "" };
  }
}

function StepFields({ step, onChange }: { step: FlowStep; onChange: (next: FlowStep) => void }) {
  switch (step.type) {
    case "KEYWORD_MATCH":
      return (
        <div className="flex flex-col gap-2">
          {step.keywords.map((kw, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={kw.value}
                placeholder="ex: eu quero"
                onChange={(e) => {
                  const keywords = [...step.keywords];
                  keywords[i] = { ...kw, value: e.target.value };
                  onChange({ ...step, keywords });
                }}
              />
              <div className="w-36 shrink-0">
              <Select
                value={kw.matchType}
                onChange={(e) => {
                  const keywords = [...step.keywords];
                  keywords[i] = { ...kw, matchType: e.target.value as "EXACT" | "CONTAINS" };
                  onChange({ ...step, keywords });
                }}
              >
                <option value="CONTAINS">Contém</option>
                <option value="EXACT">Exato</option>
              </Select>
              </div>
              <RemoveFieldButton onClick={() => onChange({ ...step, keywords: step.keywords.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <AddFieldButton
            label="palavra-chave"
            onClick={() => onChange({ ...step, keywords: [...step.keywords, { value: "", matchType: "CONTAINS" }] })}
          />
        </div>
      );

    case "PUBLIC_REPLY":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-muted">Uma entre várias respostas possíveis (seleção aleatória).</p>
          {step.variants.map((v, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={v}
                placeholder="ex: Te mandei no direct! 👀"
                onChange={(e) => {
                  const variants = [...step.variants];
                  variants[i] = e.target.value;
                  onChange({ ...step, variants });
                }}
              />
              <RemoveFieldButton onClick={() => onChange({ ...step, variants: step.variants.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <AddFieldButton label="variante" onClick={() => onChange({ ...step, variants: [...step.variants, ""] })} />
        </div>
      );

    case "PRIVATE_REPLY": {
      const options = step.quickReplyOptions ?? [];
      return (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={2}
            value={step.text}
            placeholder="Mensagem inicial da DM…"
            onChange={(e) => onChange({ ...step, text: e.target.value })}
          />
          {options.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={opt.title}
                maxLength={20}
                placeholder="Botão, ex: Me manda o vídeo (até 20 caracteres)"
                onChange={(e) => {
                  const next = [...options];
                  next[i] = { ...opt, title: e.target.value };
                  onChange({ ...step, quickReplyOptions: next });
                }}
              />
              <RemoveFieldButton
                onClick={() => {
                  const next = options.filter((_, j) => j !== i);
                  onChange({ ...step, quickReplyOptions: next.length > 0 ? next : undefined });
                }}
              />
            </div>
          ))}
          {options.length < 13 && (
            <AddFieldButton
              label="botão de resposta"
              onClick={() =>
                onChange({ ...step, quickReplyOptions: [...options, { key: `opt${options.length}`, title: "" }] })
              }
            />
          )}
        </div>
      );
    }

    case "SEND_MESSAGE":
      return (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={2}
            value={step.text}
            placeholder="Texto da mensagem…"
            onChange={(e) => onChange({ ...step, text: e.target.value })}
          />
          {step.button ? (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2">
              <Input
                value={step.button.title}
                maxLength={20}
                placeholder="Texto do botão (até 20 caracteres)"
                onChange={(e) => onChange({ ...step, button: { ...step.button!, title: e.target.value } })}
              />
              <Input
                value={step.button.url}
                placeholder="https://…"
                onChange={(e) => onChange({ ...step, button: { ...step.button!, url: e.target.value } })}
              />
              <RemoveFieldButton onClick={() => onChange({ ...step, button: undefined })} />
            </div>
          ) : (
            <AddFieldButton label="botão com link" onClick={() => onChange({ ...step, button: { title: "", url: "" } })} />
          )}
        </div>
      );

    case "QUICK_REPLY":
      return (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={2}
            value={step.text}
            placeholder="Pergunta antes dos botões…"
            onChange={(e) => onChange({ ...step, text: e.target.value })}
          />
          {step.options.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={opt.title}
                maxLength={20}
                placeholder="ex: Me manda o vídeo (até 20 caracteres)"
                onChange={(e) => {
                  const options = [...step.options];
                  options[i] = { ...opt, title: e.target.value };
                  onChange({ ...step, options });
                }}
              />
              <RemoveFieldButton onClick={() => onChange({ ...step, options: step.options.filter((_, j) => j !== i) })} />
            </div>
          ))}
          {step.options.length < 13 && (
            <AddFieldButton
              label="opção"
              onClick={() =>
                onChange({ ...step, options: [...step.options, { key: `opt${step.options.length}`, title: "" }] })
              }
            />
          )}
        </div>
      );

    case "DELAY":
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            className="!w-24"
            value={step.minutes}
            onChange={(e) => onChange({ ...step, minutes: Number(e.target.value) || 1 })}
          />
          <span className="text-sm text-text-muted">minutos</span>
        </div>
      );

    case "CONDITION":
      return <ConditionFields rule={step.rule} onChange={(rule) => onChange({ ...step, rule })} />;

    case "ADD_TAG":
    case "REMOVE_TAG":
      return (
        <Input value={step.tagName} placeholder="ex: pediu_o_video" onChange={(e) => onChange({ ...step, tagName: e.target.value })} />
      );

    case "SET_CUSTOM_FIELD":
      return (
        <div className="flex gap-2">
          <Input value={step.key} placeholder="chave" onChange={(e) => onChange({ ...step, key: e.target.value })} />
          <Input
            value={String(step.value ?? "")}
            placeholder="valor"
            onChange={(e) => onChange({ ...step, value: e.target.value })}
          />
        </div>
      );
  }
}

function AddFieldButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="self-start text-xs text-text-secondary hover:text-signal">
      + {label}
    </button>
  );
}

function RemoveFieldButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remover" className="text-text-muted hover:text-danger">
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

function ConditionFields({ rule, onChange }: { rule: ConditionRule; onChange: (rule: ConditionRule) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={rule.type}
        onChange={(e) => {
          const type = e.target.value as ConditionRule["type"];
          switch (type) {
            case "user_replied":
            case "conversation_automation_enabled":
              onChange({ type });
              break;
            case "quick_reply_clicked":
              onChange({ type, optionKey: "" });
              break;
            case "tag_exists":
              onChange({ type, tagName: "" });
              break;
            case "custom_field":
            case "variable":
              onChange({ type, key: "", equals: "" });
              break;
          }
        }}
      >
        <option value="conversation_automation_enabled">Automação ainda ativa na conversa</option>
        <option value="user_replied">A pessoa respondeu</option>
        <option value="quick_reply_clicked">Clicou numa opção específica</option>
        <option value="tag_exists">Contato tem a tag</option>
        <option value="custom_field">Campo igual a</option>
        <option value="variable">Variável do fluxo igual a</option>
      </Select>

      {rule.type === "quick_reply_clicked" && (
        <Input value={rule.optionKey} placeholder="chave da opção (ex: sim)" onChange={(e) => onChange({ ...rule, optionKey: e.target.value })} />
      )}
      {rule.type === "tag_exists" && (
        <Input value={rule.tagName} placeholder="nome da tag" onChange={(e) => onChange({ ...rule, tagName: e.target.value })} />
      )}
      {(rule.type === "custom_field" || rule.type === "variable") && (
        <div className="flex gap-2">
          <Input value={rule.key} placeholder="chave" onChange={(e) => onChange({ ...rule, key: e.target.value })} />
          <Input
            value={String(rule.equals ?? "")}
            placeholder="valor esperado"
            onChange={(e) => onChange({ ...rule, equals: e.target.value })}
          />
        </div>
      )}
      <p className="text-xs text-text-muted">
        Se verdadeiro, o flow continua pro próximo step. Se falso, encerra (END) — o editor sequencial ainda não
        suporta um segundo caminho editável (o canvas visual fica pra uma fase futura).
      </p>
    </div>
  );
}

/** "+" entre nodes — Radix menu categorizado, só nodes já suportados (seção 29 do briefing). */
function AddStepControl({ onAdd }: { onAdd: (type: FlowStepType) => void }) {
  return (
    <div className="group relative flex h-6 items-center justify-center">
      <div className="absolute h-full w-px bg-border" aria-hidden="true" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label="Adicionar passo"
            className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted opacity-40 transition-opacity duration-[var(--motion-fast)] hover:border-signal hover:text-signal hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
          >
            <Plus className="h-3 w-3" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="center"
            sideOffset={6}
            className="w-60 rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated p-1 text-sm shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
          >
            {ADD_STEP_CATEGORIES.map((category, i) => (
              <div key={category.label}>
                {i > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />}
                <DropdownMenu.Label className="px-2.5 py-1 text-xs text-text-muted">
                  {category.label}
                </DropdownMenu.Label>
                {category.types.map((type) => (
                  <DropdownMenu.Item
                    key={type}
                    onSelect={() => onAdd(type)}
                    className="cursor-pointer rounded-[var(--radius-panel-sm)] px-2.5 py-1.5 text-text outline-none data-[highlighted]:bg-surface-2"
                  >
                    {STEP_LABELS[type]}
                  </DropdownMenu.Item>
                ))}
              </div>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

export function FlowEditor({
  automationId,
  initialSteps,
  decompileFailed,
  hasDraft,
  accounts,
}: {
  automationId: string;
  initialSteps: FlowStep[];
  decompileFailed: boolean;
  hasDraft: boolean;
  accounts: ProfileAccountSummary[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [steps, setSteps] = useState<FlowStep[]>(initialSteps);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (decompileFailed) {
    return (
      <div className="mx-6 rounded-[var(--radius-panel-lg)] border border-warning bg-warning-soft px-4 py-3 text-sm text-text md:mx-8">
        Este fluxo tem um formato que o editor sequencial ainda não sabe exibir (provavelmente foi criado num
        formato diferente do compilador atual). Nada foi alterado — duplique-o pra começar do zero.
      </div>
    );
  }

  function updateStep(index: number, next: FlowStep) {
    setSteps((prev) => prev.map((s, i) => (i === index ? next : s)));
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function insertStepAt(index: number, type: FlowStepType) {
    setSteps((prev) => [...prev.slice(0, index), defaultStepFor(type), ...prev.slice(index)]);
  }

  async function saveDraft() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/automations/${automationId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) return setError(json.detail ?? json.error ?? "Falha ao salvar");
    router.refresh();
  }

  // Gate de revisão (B3, auditoria 24/09/2026): "Publicar" nunca mais
  // publica direto — primeiro salva o draft, depois abre o modal de revisão.
  // A publicação de fato só acontece em confirmPublish, depois do checkbox
  // marcado (ver publish-review-dialog.tsx).
  async function openReview() {
    setError(null);
    setSaving(true);
    const saveRes = await fetch(`/api/automations/${automationId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    setSaving(false);
    if (!saveRes.ok) {
      const json = await saveRes.json();
      setError(json.detail ?? json.error ?? "Falha ao salvar antes de publicar");
      toast("Não foi possível publicar a automação.", "danger");
      return;
    }
    router.refresh();
    setReviewOpen(true);
  }

  async function confirmPublish(reviewedGraphHash: string) {
    setPublishing(true);
    setError(null);
    const res = await fetch(`/api/automations/${automationId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, reviewedGraphHash }),
    });
    const json = await res.json();
    setPublishing(false);
    if (!res.ok) {
      // REVIEW_STALE = o conteúdo mudou desde que o modal abriu (outra aba,
      // por exemplo) — nunca publica com uma revisão que não é mais a atual.
      const message =
        json.error === "REVIEW_STALE"
          ? "O conteúdo mudou desde que você abriu a revisão — reabra e confira de novo."
          : (json.detail ?? json.error ?? "Falha ao publicar");
      setError(message);
      toast("Não foi possível publicar a automação.", "danger");
      return;
    }
    setReviewOpen(false);
    toast(`Automação publicada (v${json.publishedVersion}).`, "success");
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-0 border-t border-border-subtle md:grid-cols-[1fr_260px]">
      <div className="border-border-subtle px-6 py-6 md:border-r md:px-8">
        <h2 className="mb-5 text-lg font-semibold text-text">Fluxo</h2>

        {/* Trigger — fixo, único suportado no V1 */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <SignalMarker type="trigger" className="text-text-secondary" />
          </div>
          <div className="flex-1 pb-1">
            <p className="text-sm font-medium text-text">Comentário no Instagram</p>
            <p className="text-xs text-text-muted">É o que inicia o fluxo</p>
          </div>
        </div>

        <div className="ml-[6.5px]">
          <AddStepControl onAdd={(type) => insertStepAt(0, type)} />
        </div>

        {steps.map((step, i) => (
          <div key={i}>
            <div className="flex gap-3">
              <div className="flex flex-col items-center pt-1">
                <SignalMarker type={STEP_MARKER[step.type]} className="text-text-secondary" />
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text">{STEP_LABELS[step.type]}</p>
                  <div className="flex items-center gap-0.5 text-text-muted">
                    <button
                      type="button"
                      onClick={() => moveStep(i, -1)}
                      disabled={i === 0}
                      aria-label="Mover pra cima"
                      className="rounded p-1 hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(i, 1)}
                      disabled={i === steps.length - 1}
                      aria-label="Mover pra baixo"
                      className="rounded p-1 hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      aria-label="Remover passo"
                      className="rounded p-1 hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <StepFields step={step} onChange={(next) => updateStep(i, next)} />
              </div>
            </div>
            <div className="ml-[6.5px]">
              <AddStepControl onAdd={(type) => insertStepAt(i + 1, type)} />
            </div>
          </div>
        ))}

        <div className="flex gap-3">
          <SignalMarker type="end" className="text-text-secondary" />
          <p className="pt-0.5 text-sm text-text-muted">Fim do fluxo</p>
        </div>

        <div className="mt-7 flex items-center gap-3 border-t border-border-subtle pt-5">
          <Button variant="secondary" onClick={saveDraft} disabled={saving || publishing}>
            {saving ? "Salvando…" : "Salvar rascunho"}
          </Button>
          <Button variant="primary" onClick={openReview} disabled={saving || publishing}>
            {saving ? "Salvando…" : "Publicar"}
          </Button>
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
        {!hasDraft && !error && (
          <p className="mt-2 text-xs text-text-muted">Salvar guarda um rascunho. O que está no ar só muda quando você publica.</p>
        )}
      </div>

      <div className="px-6 py-6 md:px-6">
        <h2 className="mb-3 text-lg font-semibold text-text">Detalhes</h2>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs text-text-muted">Passos</dt>
            <dd className="text-text">{steps.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Rascunho pendente</dt>
            <dd className="text-text">{hasDraft ? "Sim" : "Não"}</dd>
          </div>
        </dl>
      </div>

      <PublishReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        accounts={accounts}
        steps={steps}
        onConfirm={confirmPublish}
        confirming={publishing}
      />
    </div>
  );
}
