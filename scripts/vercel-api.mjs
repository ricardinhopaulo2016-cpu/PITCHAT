#!/usr/bin/env node
/**
 * Wrapper mínimo pra API REST da Vercel — usado no lugar da CLI porque o
 * token atual não funciona com ela (achado real, 24/09/2026: `vercel
 * whoami`/`vercel project ls` retornam "User not found", mas a API REST
 * direta funciona normalmente pros mesmos recursos com o mesmo token).
 *
 * Token SÓ de process.env.VERCEL_TOKEN — nunca lido de arquivo nem
 * hardcoded (pedido explícito do usuário, 24/09/2026). PROJECT_ID/TEAM_ID
 * fixos abaixo, confirmados via leitura real da API — toda operação de
 * escrita reconfirma que esses IDs ainda resolvem pro projeto "pitchat"
 * antes de agir (assertProjectIdentity), falha fechado em qualquer mismatch.
 *
 * ================= POLÍTICA DE ESCRITA (nunca pular) ===================
 * READ SAFE (sempre ok, sem pedir): project:check, deployments:list,
 *   deployment:get, logs:get, env:list.
 * WRITE LOW RISK (ok quando pedido explicitamente pra ESTE projeto):
 *   env:create, env:update, env:delete de uma variável DE TESTE que a
 *   gente mesmo criou, redeploy pra Preview.
 * WRITE DESTRUCTIVE (NUNCA chamar sem confirmação explícita da pessoa
 *   pedindo, mesmo que o comando exista): env:delete de uma variável REAL
 *   em uso — este wrapper não distingue "teste" de "real" sozinho, quem
 *   decide é sempre o histórico da conversa, nunca o código. Delete de
 *   domain/project, rollback de Production, delete de deployment e
 *   redeploy com target=production NÃO estão implementados aqui de
 *   propósito — fora de escopo até serem pedidos explicitamente.
 * =========================================================================
 *
 * Uso:
 *   node scripts/vercel-api.mjs project:check
 *   node scripts/vercel-api.mjs deployments:list [limit]
 *   node scripts/vercel-api.mjs deployment:get <deploymentId>
 *   node scripts/vercel-api.mjs logs:get <deploymentId> [limit]
 *   node scripts/vercel-api.mjs env:list
 *   node scripts/vercel-api.mjs env:create <key> <value> [target...]   (default target: preview)
 *   node scripts/vercel-api.mjs env:update <envId> <value>
 *   node scripts/vercel-api.mjs env:delete <envId>
 *   node scripts/vercel-api.mjs redeploy <deploymentId>                (sempre Preview — nunca aceita target=production)
 */

const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = "prj_juGfc8T50TunAJCKJ4GYKDR5t61r";
const TEAM_ID = "team_jPaJxwz1gwRpZxxHI2i2h7aL";
const EXPECTED_PROJECT_NAME = "pitchat";
const API_BASE = "https://api.vercel.com";

if (!TOKEN) {
  console.error("[vercel-api] VERCEL_TOKEN ausente na env var da sessão — nunca lido de arquivo por este wrapper.");
  process.exit(1);
}

async function vercelFetch(path, opts = {}) {
  const url = new URL(`${API_BASE}${path}`);
  if (!url.searchParams.has("teamId")) url.searchParams.set("teamId", TEAM_ID);
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`, // nunca logado — só usado aqui dentro do header real da requisição
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/** Confirma que PROJECT_ID/TEAM_ID ainda resolvem pro projeto certo — chamado antes de QUALQUER write. Falha fechado. */
async function assertProjectIdentity() {
  const { ok, status, json } = await vercelFetch(`/v9/projects/${PROJECT_ID}`);
  if (!ok) throw new Error(`Falha ao confirmar identidade do projeto antes do write: HTTP ${status}`);
  if (json.name !== EXPECTED_PROJECT_NAME || json.id !== PROJECT_ID) {
    throw new Error(
      `MISMATCH DE PROJETO — resolvido "${json.name}" (${json.id}), esperado "${EXPECTED_PROJECT_NAME}" (${PROJECT_ID}). Abortando write, nada foi alterado.`
    );
  }
}

/** Nunca deixa passar valor de env/Authorization na saída, mesmo que a resposta bruta da Vercel inclua algo. */
function sanitize(obj) {
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "value" || k.toLowerCase().includes("authorization")) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return obj;
}

function print(data) {
  console.log(JSON.stringify(sanitize(data), null, 2));
}

const [, , op, ...rest] = process.argv;

async function main() {
  switch (op) {
    case "project:check": {
      const { ok, status, json } = await vercelFetch(`/v9/projects/${PROJECT_ID}`);
      print({ ok, status, name: json.name, id: json.id, matchesExpected: json.name === EXPECTED_PROJECT_NAME && json.id === PROJECT_ID });
      break;
    }

    case "deployments:list": {
      const limit = rest[0] || "10";
      const { ok, status, json } = await vercelFetch(`/v6/deployments?projectId=${PROJECT_ID}&limit=${limit}`);
      print({
        ok,
        status,
        deployments: (json.deployments ?? []).map((d) => ({
          uid: d.uid,
          url: d.url,
          target: d.target,
          state: d.state,
          created: new Date(d.created).toISOString(),
        })),
      });
      break;
    }

    case "deployment:get": {
      const id = rest[0];
      if (!id) throw new Error("uso: deployment:get <deploymentId>");
      const { ok, status, json } = await vercelFetch(`/v13/deployments/${id}`);
      print({ ok, status, uid: json.id ?? id, url: json.url, target: json.target, readyState: json.readyState });
      break;
    }

    case "logs:get": {
      const id = rest[0];
      const limit = rest[1] || "20";
      if (!id) throw new Error("uso: logs:get <deploymentId> [limit]");
      const { ok, status, json } = await vercelFetch(`/v3/deployments/${id}/events?limit=${limit}`);
      const events = Array.isArray(json) ? json : [];
      print({ ok, status, events: events.map((e) => ({ type: e.type, text: e.text, created: new Date(e.created).toISOString() })) });
      break;
    }

    case "env:list": {
      const { ok, status, json } = await vercelFetch(`/v9/projects/${PROJECT_ID}/env`);
      print({ ok, status, envs: (json.envs ?? []).map((e) => ({ id: e.id, key: e.key, type: e.type, target: e.target })) });
      break;
    }

    case "env:create": {
      await assertProjectIdentity();
      const [key, value, ...targets] = rest;
      if (!key || value === undefined) throw new Error("uso: env:create <key> <value> [target...] (default: preview)");
      const target = targets.length ? targets : ["preview"];
      const { ok, status, json } = await vercelFetch(`/v10/projects/${PROJECT_ID}/env`, {
        method: "POST",
        body: JSON.stringify({ key, value, type: "encrypted", target }),
      });
      print({ ok, status, id: json.id, key: json.key, target: json.target });
      break;
    }

    case "env:update": {
      await assertProjectIdentity();
      const [envId, value] = rest;
      if (!envId || value === undefined) throw new Error("uso: env:update <envId> <value>");
      const { ok, status, json } = await vercelFetch(`/v9/projects/${PROJECT_ID}/env/${envId}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      });
      print({ ok, status, id: json.id, key: json.key, target: json.target });
      break;
    }

    case "env:delete": {
      await assertProjectIdentity();
      const [envId] = rest;
      if (!envId) throw new Error("uso: env:delete <envId>");
      const { ok, status, json } = await vercelFetch(`/v9/projects/${PROJECT_ID}/env/${envId}`, { method: "DELETE" });
      print({ ok, status, ...json });
      break;
    }

    case "redeploy": {
      await assertProjectIdentity();
      const [deploymentId] = rest;
      if (!deploymentId) throw new Error("uso: redeploy <deploymentId>");
      // `target` NUNCA é passado aqui — API docs (fetched 24/09/2026):
      // "If omitted, the target will be `preview`." Sem isso, sempre Preview,
      // nunca toca no alias/domínio de produção. Redeploy pra produção fora
      // de escopo deste comando de propósito.
      const { ok, status, json } = await vercelFetch(`/v13/deployments`, {
        method: "POST",
        body: JSON.stringify({ name: EXPECTED_PROJECT_NAME, project: PROJECT_ID, deploymentId }),
      });
      print({ ok, status, uid: json.id, url: json.url, readyState: json.readyState, target: json.target });
      break;
    }

    default:
      console.error(
        "Operação desconhecida ou ausente. Suportadas: project:check, deployments:list [limit], " +
          "deployment:get <id>, logs:get <id> [limit], env:list, env:create <key> <value> [target...], " +
          "env:update <envId> <value>, env:delete <envId>, redeploy <deploymentId> (sempre Preview)."
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[vercel-api] erro:", err.message);
  process.exit(1);
});
