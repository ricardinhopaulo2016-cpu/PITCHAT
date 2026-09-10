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

const STEP_LABELS: Record<FlowStepType, string> = {
  KEYWORD_MATCH: "Keyword Match",
  PUBLIC_REPLY: "Public Reply",
  PRIVATE_REPLY: "Private Reply / DM",
  SEND_MESSAGE: "Send Message",
  QUICK_REPLY: "Quick Reply",
  DELAY: "Delay",
  CONDITION: "Condition",
  ADD_TAG: "Add Tag",
  REMOVE_TAG: "Remove Tag",
  SET_CUSTOM_FIELD: "Set Custom Field",
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
  { label: "Logic", types: ["KEYWORD_MATCH", "CONDITION"] },
  { label: "Message", types: ["PUBLIC_REPLY", "PRIVATE_REPLY", "SEND_MESSAGE", "QUICK_REPLY"] },
  { label: "Data", types: ["ADD_TAG", "REMOVE_TAG", "SET_CUSTOM_FIELD"] },
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
              <Select
                className="w-28"
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
              <RemoveFieldButton onClick={() => onChange({ ...step, keywords: step.keywords.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <AddFieldButton
            label="keyword"
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

    case "PRIVATE_REPLY":
    case "SEND_MESSAGE":
      return (
        <Textarea
          rows={2}
          value={step.text}
          placeholder={step.type === "PRIVATE_REPLY" ? "Mensagem inicial da DM…" : "Texto da mensagem…"}
          onChange={(e) => onChange({ ...step, text: e.target.value })}
        />
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
                placeholder="ex: Me manda o vídeo (máx. 20 chars)"
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
            className="w-20"
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
        <Input value={step.tagName} placeholder="ex: lead_video_requested" onChange={(e) => onChange({ ...step, tagName: e.target.value })} />
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
        <option value="user_replied">Usuário respondeu</option>
        <option value="quick_reply_clicked">Quick reply clicado (opção específica)</option>
        <option value="tag_exists">Contato tem a tag</option>
        <option value="custom_field">Custom field igual a</option>
        <option value="variable">Variável do flow igual a</option>
      </Select>

      {rule.type === "quick_reply_clicked" && (
        <Input value={rule.optionKey} placeholder="key da opção (ex: yes)" onChange={(e) => onChange({ ...rule, optionKey: e.target.value })} />
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
            aria-label="Adicionar step"
            className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted opacity-40 transition-opacity duration-[var(--motion-fast)] hover:border-signal hover:text-signal hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
          >
            <Plus className="h-3 w-3" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="center"
            sideOffset={6}
            className="w-48 rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated p-1 text-sm shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
          >
            {ADD_STEP_CATEGORIES.map((category, i) => (
              <div key={category.label}>
                {i > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />}
                <DropdownMenu.Label className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
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
}: {
  automationId: string;
  initialSteps: FlowStep[];
  decompileFailed: boolean;
  hasDraft: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [steps, setSteps] = useState<FlowStep[]>(initialSteps);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
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

  async function publish() {
    setPublishing(true);
    setError(null);
    const saveRes = await fetch(`/api/automations/${automationId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    if (!saveRes.ok) {
      setPublishing(false);
      const json = await saveRes.json();
      setError(json.detail ?? json.error ?? "Falha ao salvar antes de publicar");
      toast("Não foi possível publicar a automação.", "danger");
      return;
    }
    const res = await fetch(`/api/automations/${automationId}/publish`, { method: "POST" });
    const json = await res.json();
    setPublishing(false);
    if (!res.ok) {
      setError(json.detail ?? json.error ?? "Falha ao publicar");
      toast("Não foi possível publicar a automação.", "danger");
      return;
    }
    toast(`Automação publicada (v${json.publishedVersion}).`, "success");
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-0 border-t border-border-subtle md:grid-cols-[1fr_260px]">
      <div className="border-border-subtle px-6 py-6 md:border-r md:px-8">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-wide text-text-muted">Flow</p>

        {/* Trigger — fixo, único suportado no V1 */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <SignalMarker type="trigger" className="text-text-secondary" />
          </div>
          <div className="flex-1 pb-1">
            <p className="text-sm font-medium text-text">Instagram Comment</p>
            <p className="text-xs text-text-muted">Trigger — único suportado nesta versão</p>
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
                      aria-label="Remover step"
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
          <p className="pt-0.5 text-sm text-text-muted">END — todo caminho termina aqui</p>
        </div>

        <div className="mt-7 flex items-center gap-3 border-t border-border-subtle pt-5">
          <Button variant="secondary" onClick={saveDraft} disabled={saving || publishing}>
            {saving ? "Salvando…" : "Salvar rascunho"}
          </Button>
          <Button variant="primary" onClick={publish} disabled={saving || publishing}>
            {publishing ? "Publicando…" : "Publicar versão"}
          </Button>
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
        {!hasDraft && !error && (
          <p className="mt-2 text-xs text-text-muted">Editar e salvar cria automaticamente uma nova versão draft.</p>
        )}
      </div>

      <div className="px-6 py-6 md:px-6">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-muted">Details</p>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs text-text-muted">Steps</dt>
            <dd className="text-text">{steps.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Rascunho pendente</dt>
            <dd className="text-text">{hasDraft ? "Sim" : "Não"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
