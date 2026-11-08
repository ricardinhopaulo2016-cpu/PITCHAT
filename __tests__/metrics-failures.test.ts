import { describe, expect, it } from "vitest";
import {
  buildIncidents,
  buildNodeFailures,
  groupErrors,
  nodeLabel,
  parseRunParam,
  sanitizeFailureText,
  type RawIncident,
} from "@/lib/metrics/failures";

const TECHNICAL = "Causa registrada em formato técnico, conteúdo oculto.";

describe("sanitizeFailureText", () => {
  it("vazio vira null", () => {
    expect(sanitizeFailureText("")).toBeNull();
    expect(sanitizeFailureText("   ")).toBeNull();
    expect(sanitizeFailureText(null)).toBeNull();
    expect(sanitizeFailureText(undefined)).toBeNull();
  });

  it.each([
    ['{"error":{"message":"x"}}'],
    ["[1,2,3]"],
    ["Falha <html><body>erro</body></html>"],
    ["  { com espaço antes"],
  ])("oculta conteúdo técnico: %s", (raw) => {
    expect(sanitizeFailureText(raw)).toBe(TECHNICAL);
  });

  it.each([
    ["Bearer", "Falha com Bearer abc.def-123 no envio", "abc.def-123"],
    ["access_token", "erro access_token=abc123 aqui", "abc123"],
    ["appsecret_proof", "appsecret_proof: deadbeef", "deadbeef"],
    ["client_secret", "client_secret=shh, tentou", "shh"],
    ["token", "o token: abc999 expirou", "abc999"],
    ["secret", "secret=abc", "abc"],
    ["signature", "signature = xyz", "xyz"],
    ["authorization", "Authorization: Bearer abc", "abc"],
    ["password", "password=hunter2", "hunter2"],
    ["token entre aspas", 'veio "access_token":"zzz" na resposta', "zzz"],
    ["EAA", "chave EAAGm0PX4ZCpsBA vazou", "EAAGm0PX4ZCpsBA"],
    ["IGAA", "chave IGAAabcd123 vazou", "IGAAabcd123"],
    ["IGQV", "chave IGQVJabc_d-1 vazou", "IGQVJabc_d-1"],
    ["sha256", "assinatura sha256=abcdef0123 falhou", "abcdef0123"],
    ["fbtrace_id", "erro fbtrace_id: AbCdEf123 fim", "AbCdEf123"],
  ])("esconde %s", (_name, raw, secret) => {
    const text = sanitizeFailureText(raw)!;
    expect(text).not.toContain(secret);
    expect(text).toContain("[oculto]");
  });

  it("URL fica oculta", () => {
    expect(sanitizeFailureText("falha em https://graph.instagram.com/v21/123?x=1 agora")).toBe("falha em [link oculto] agora");
  });

  it("id longo fica oculto", () => {
    expect(sanitizeFailureText("mídia 17912345678901234 sumiu")).toBe("mídia [id oculto] sumiu");
  });

  it("preserva a mensagem da Meta sem segredo", () => {
    expect(sanitizeFailureText("Invalid OAuth access token.")).toBe("Invalid OAuth access token.");
  });

  it("colapsa espaços e troca o travessão longo", () => {
    expect(sanitizeFailureText("erro   de\n envio — retry")).toBe("erro de envio, retry");
  });

  it("corta em 180 caracteres com reticências", () => {
    const text = sanitizeFailureText("a".repeat(300))!;
    expect(text).toHaveLength(180);
    expect(text.endsWith("...")).toBe(true);
  });

  it("180 exatos não são cortados", () => {
    expect(sanitizeFailureText("a".repeat(180))).toBe("a".repeat(180));
  });
});

describe("groupErrors", () => {
  it("reagrupa depois de sanitizar, em ordem decrescente", () => {
    expect(
      groupErrors([
        { cause: "Outro erro", failures: 3 },
        { cause: "mídia 17912345678901234 sumiu", failures: 1 },
        { cause: "mídia 17998765432109876 sumiu", failures: 4 },
        { cause: null, failures: 9 },
      ])
    ).toEqual([
      { cause: "mídia [id oculto] sumiu", failures: 5 },
      { cause: "Outro erro", failures: 3 },
    ]);
  });

  it("limita a 10 grupos", () => {
    expect(groupErrors(Array.from({ length: 15 }, (_, i) => ({ cause: `erro ${i}`, failures: 1 })))).toHaveLength(10);
  });
});

describe("nodeLabel", () => {
  it("traduz nó conhecido", () => {
    expect(nodeLabel("PRIVATE_REPLY")).toBe("Primeira DM");
    expect(nodeLabel("QUICK_REPLY_RESUME")).toBe("Retomada após botão");
  });

  it("desconhecido, null e chave herdada viram Outra etapa", () => {
    expect(nodeLabel("NOVO_NO")).toBe("Outra etapa");
    expect(nodeLabel(null)).toBe("Outra etapa");
    expect(nodeLabel("constructor")).toBe("Outra etapa");
  });
});

describe("buildNodeFailures", () => {
  it("calcula taxa e rótulo", () => {
    const [node] = buildNodeFailures([{ automation_id: "a", automation_name: "Fluxo", node_id: "n1", node_type: "SEND_MESSAGE", failures: 2, reached: 8 }]);
    expect(node).toEqual({ automationId: "a", automationName: "Fluxo", nodeId: "n1", nodeLabel: "Enviar mensagem", failures: 2, reached: 8, rate: { kind: "value", value: 0.25 } });
  });

  it("reached 0 é no_base", () => {
    const [node] = buildNodeFailures([{ automation_id: "a", automation_name: "F", node_id: "n", node_type: null, failures: 1, reached: 0 }]);
    expect(node.rate).toEqual({ kind: "no_base" });
  });
});

describe("buildIncidents", () => {
  const base: RawIncident = {
    run_id: "a1940a6a-2222-3333-4444-555555555555",
    status: "failed",
    started_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:05:00Z",
    automation_id: "auto",
    automation_name: "Fluxo",
    automation_status: "paused",
    social_account_id: "acc",
    node_id: "n1",
    node_type: "PRIVATE_REPLY",
    step_status: "failed",
    cause: "Invalid OAuth access token.",
  };

  it("mostra nó e causa do run", () => {
    expect(buildIncidents([base])[0]).toEqual({
      runShort: "a1940a6a",
      status: "failed",
      at: "2026-11-01T10:05:00Z",
      automationName: "Fluxo",
      automationInactive: true,
      accountId: "acc",
      nodeLabel: "Primeira DM",
      nodeId: "n1",
      cause: "Invalid OAuth access token.",
    });
  });

  it("causa nula vira Causa não registrada", () => {
    expect(buildIncidents([{ ...base, cause: null }])[0].cause).toBe("Causa não registrada");
  });

  it("run presa sem step falho", () => {
    expect(buildIncidents([{ ...base, status: "running", step_status: "succeeded", cause: null }])[0].cause).toBe("Execução presa, sem falha registrada.");
  });

  it("run presa com step falho mostra a causa", () => {
    expect(buildIncidents([{ ...base, status: "running" }])[0].cause).toBe("Invalid OAuth access token.");
  });

  it("sanitiza a causa", () => {
    expect(buildIncidents([{ ...base, cause: "token=abc123" }])[0].cause).toBe("[oculto]");
  });

  it("run sem step tem nó nulo", () => {
    expect(buildIncidents([{ ...base, node_id: null, node_type: null, step_status: null, cause: null }])[0]).toMatchObject({ nodeLabel: null, nodeId: null });
  });

  it("não vaza campo extra nem o UUID inteiro", () => {
    const row = { ...base, input: { access_token: "vazou" }, output: "payload" } as RawIncident;
    const serialized = JSON.stringify(buildIncidents([row]));
    expect(serialized).not.toContain("vazou");
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain(base.run_id);
  });
});

describe("parseRunParam", () => {
  it("aceita 8 hex e devolve minúsculo", () => {
    expect(parseRunParam("A1940A6A")).toBe("a1940a6a");
  });

  it("aceita UUID e devolve 8 hex", () => {
    expect(parseRunParam("a1940a6a-2222-3333-4444-555555555555")).toBe("a1940a6a");
  });

  it.each(["a1940a%", "a1940a6%", "' or 1=1 --", "a1940a6", "a1940a6a0", "a1940a6g", "", "a1940a6a-2222"])("recusa %s", (raw) => {
    expect(parseRunParam(raw)).toBeNull();
  });

  it("recusa undefined e lista", () => {
    expect(parseRunParam(undefined)).toBeNull();
    expect(parseRunParam(["a1940a6a"])).toBeNull();
  });
});
