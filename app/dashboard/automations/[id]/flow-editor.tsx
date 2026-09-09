"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FlowStep, FlowStepType } from "@/lib/automation/flow-spec";
import type { ConditionRule } from "@/lib/automation/node-handlers";

const STEP_LABELS: Record<FlowStepType, string> = {
  KEYWORD_MATCH: "Keywords",
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

const STEP_ORDER: FlowStepType[] = [
  "KEYWORD_MATCH",
  "PUBLIC_REPLY",
  "PRIVATE_REPLY",
  "QUICK_REPLY",
  "SEND_MESSAGE",
  "DELAY",
  "CONDITION",
  "ADD_TAG",
  "REMOVE_TAG",
  "SET_CUSTOM_FIELD",
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

const inputClass = "w-full rounded border px-2 py-1 text-sm";

function StepFields({ step, onChange }: { step: FlowStep; onChange: (next: FlowStep) => void }) {
  switch (step.type) {
    case "KEYWORD_MATCH":
      return (
        <div className="flex flex-col gap-2">
          {step.keywords.map((kw, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputClass}
                value={kw.value}
                placeholder="ex: eu quero"
                onChange={(e) => {
                  const keywords = [...step.keywords];
                  keywords[i] = { ...kw, value: e.target.value };
                  onChange({ ...step, keywords });
                }}
              />
              <select
                className="rounded border px-2 py-1 text-sm"
                value={kw.matchType}
                onChange={(e) => {
                  const keywords = [...step.keywords];
                  keywords[i] = { ...kw, matchType: e.target.value as "EXACT" | "CONTAINS" };
                  onChange({ ...step, keywords });
                }}
              >
                <option value="CONTAINS">Contém</option>
                <option value="EXACT">Exato</option>
              </select>
              <button
                type="button"
                onClick={() => onChange({ ...step, keywords: step.keywords.filter((_, j) => j !== i) })}
                className="text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...step, keywords: [...step.keywords, { value: "", matchType: "CONTAINS" }] })}
            className="self-start text-sm underline"
          >
            + keyword
          </button>
        </div>
      );

    case "PUBLIC_REPLY":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs opacity-60">Uma entre várias respostas possíveis (seleção aleatória).</p>
          {step.variants.map((v, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputClass}
                value={v}
                placeholder="ex: Te mandei no direct! 👀"
                onChange={(e) => {
                  const variants = [...step.variants];
                  variants[i] = e.target.value;
                  onChange({ ...step, variants });
                }}
              />
              <button
                type="button"
                onClick={() => onChange({ ...step, variants: step.variants.filter((_, j) => j !== i) })}
                className="text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...step, variants: [...step.variants, ""] })}
            className="self-start text-sm underline"
          >
            + variante
          </button>
        </div>
      );

    case "PRIVATE_REPLY":
    case "SEND_MESSAGE":
      return (
        <textarea
          className={inputClass}
          rows={2}
          value={step.text}
          placeholder={step.type === "PRIVATE_REPLY" ? "Mensagem inicial da DM…" : "Texto da mensagem…"}
          onChange={(e) => onChange({ ...step, text: e.target.value })}
        />
      );

    case "QUICK_REPLY":
      return (
        <div className="flex flex-col gap-2">
          <textarea
            className={inputClass}
            rows={2}
            value={step.text}
            placeholder="Pergunta antes dos botões…"
            onChange={(e) => onChange({ ...step, text: e.target.value })}
          />
          {step.options.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputClass}
                value={opt.title}
                maxLength={20}
                placeholder="ex: Me manda o vídeo (máx. 20 chars)"
                onChange={(e) => {
                  const options = [...step.options];
                  options[i] = { ...opt, title: e.target.value };
                  onChange({ ...step, options });
                }}
              />
              <button
                type="button"
                onClick={() => onChange({ ...step, options: step.options.filter((_, j) => j !== i) })}
                className="text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
          {step.options.length < 13 && (
            <button
              type="button"
              onClick={() =>
                onChange({ ...step, options: [...step.options, { key: `opt${step.options.length}`, title: "" }] })
              }
              className="self-start text-sm underline"
            >
              + opção
            </button>
          )}
        </div>
      );

    case "DELAY":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            className="w-24 rounded border px-2 py-1 text-sm"
            value={step.minutes}
            onChange={(e) => onChange({ ...step, minutes: Number(e.target.value) || 1 })}
          />
          <span className="text-sm opacity-60">minutos</span>
        </div>
      );

    case "CONDITION":
      return <ConditionFields rule={step.rule} onChange={(rule) => onChange({ ...step, rule })} />;

    case "ADD_TAG":
    case "REMOVE_TAG":
      return (
        <input
          className={inputClass}
          value={step.tagName}
          placeholder="ex: lead_video_requested"
          onChange={(e) => onChange({ ...step, tagName: e.target.value })}
        />
      );

    case "SET_CUSTOM_FIELD":
      return (
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={step.key}
            placeholder="chave"
            onChange={(e) => onChange({ ...step, key: e.target.value })}
          />
          <input
            className={inputClass}
            value={String(step.value ?? "")}
            placeholder="valor"
            onChange={(e) => onChange({ ...step, value: e.target.value })}
          />
        </div>
      );
  }
}

function ConditionFields({ rule, onChange }: { rule: ConditionRule; onChange: (rule: ConditionRule) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <select
        className="rounded border px-2 py-1 text-sm"
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
      </select>

      {rule.type === "quick_reply_clicked" && (
        <input
          className={inputClass}
          value={rule.optionKey}
          placeholder="key da opção (ex: yes)"
          onChange={(e) => onChange({ ...rule, optionKey: e.target.value })}
        />
      )}
      {rule.type === "tag_exists" && (
        <input
          className={inputClass}
          value={rule.tagName}
          placeholder="nome da tag"
          onChange={(e) => onChange({ ...rule, tagName: e.target.value })}
        />
      )}
      {(rule.type === "custom_field" || rule.type === "variable") && (
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={rule.key}
            placeholder="chave"
            onChange={(e) => onChange({ ...rule, key: e.target.value })}
          />
          <input
            className={inputClass}
            value={String(rule.equals ?? "")}
            placeholder="valor esperado"
            onChange={(e) => onChange({ ...rule, equals: e.target.value })}
          />
        </div>
      )}
      <p className="text-xs opacity-60">
        Se verdadeiro, o flow continua pro próximo step. Se falso, encerra (END) — editor sequencial V1 não
        suporta um segundo caminho editável ainda (seção 28 do briefing: canvas visual fica pra depois).
      </p>
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
  const [steps, setSteps] = useState<FlowStep[]>(initialSteps);
  const [addType, setAddType] = useState<FlowStepType>("KEYWORD_MATCH");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (decompileFailed) {
    return (
      <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Este fluxo tem um formato que o editor sequencial V1 não sabe exibir (provavelmente foi criado num
        formato diferente do compilador atual). Nada foi alterado — aguarde o editor visual (Fase J) pra
        editar este fluxo, ou duplique-o pra começar do zero.
      </p>
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

  async function saveDraft() {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/automations/${automationId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) return setMessage({ kind: "error", text: json.detail ?? json.error ?? "Falha ao salvar" });
    setMessage({ kind: "ok", text: `Rascunho salvo (v${json.version}).` });
    router.refresh();
  }

  async function publish() {
    setPublishing(true);
    setMessage(null);
    const saveRes = await fetch(`/api/automations/${automationId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    if (!saveRes.ok) {
      setPublishing(false);
      const json = await saveRes.json();
      return setMessage({ kind: "error", text: json.detail ?? json.error ?? "Falha ao salvar antes de publicar" });
    }
    const res = await fetch(`/api/automations/${automationId}/publish`, { method: "POST" });
    const json = await res.json();
    setPublishing(false);
    if (!res.ok) return setMessage({ kind: "error", text: json.detail ?? json.error ?? "Falha ao publicar" });
    setMessage({ kind: "ok", text: `Publicado como v${json.publishedVersion}. Ative na lista de automações quando quiser que rode de verdade.` });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border p-3 text-sm opacity-70">
        <strong>Trigger:</strong> Instagram Comment (único trigger suportado no V1)
      </div>

      {steps.map((step, i) => (
        <div key={i} className="rounded border p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">
              {i + 1}. {STEP_LABELS[step.type]}
            </span>
            <div className="flex gap-2 text-sm">
              <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="disabled:opacity-30">
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveStep(i, 1)}
                disabled={i === steps.length - 1}
                className="disabled:opacity-30"
              >
                ↓
              </button>
              <button type="button" onClick={() => removeStep(i)} className="text-red-600">
                Remover
              </button>
            </div>
          </div>
          <StepFields step={step} onChange={(next) => updateStep(i, next)} />
        </div>
      ))}

      <div className="rounded border border-dashed p-4">
        <div className="flex items-center gap-2">
          <select
            className="rounded border px-2 py-1 text-sm"
            value={addType}
            onChange={(e) => setAddType(e.target.value as FlowStepType)}
          >
            {STEP_ORDER.map((t) => (
              <option key={t} value={t}>
                {STEP_LABELS[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSteps((prev) => [...prev, defaultStepFor(addType)])}
            className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            + adicionar step
          </button>
        </div>
      </div>

      <div className="rounded border p-3 text-sm opacity-70">
        <strong>END</strong> (automático — todo caminho termina aqui)
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={saveDraft}
          disabled={saving || publishing}
          className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
        >
          {saving ? "Salvando…" : "Salvar rascunho"}
        </button>
        <button
          onClick={publish}
          disabled={saving || publishing}
          className="rounded border bg-black px-4 py-2 text-sm text-white hover:opacity-90"
        >
          {publishing ? "Publicando…" : "Publicar versão"}
        </button>
        {message && (
          <span className={message.kind === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"}>
            {message.text}
          </span>
        )}
      </div>
      {!hasDraft && (
        <p className="text-xs opacity-50">
          Nenhum rascunho pendente ainda — editar e salvar cria automaticamente uma nova versão draft.
        </p>
      )}
    </div>
  );
}
