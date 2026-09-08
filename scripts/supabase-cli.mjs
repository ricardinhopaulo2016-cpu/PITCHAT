#!/usr/bin/env node
/**
 * Wrapper não-interativo pro Supabase CLI — carrega SUPABASE_ACCESS_TOKEN e
 * SUPABASE_DB_PASSWORD só de .env.local (nunca hardcoded, nunca de um
 * argumento de linha de comando visível em texto) e repassa pro processo
 * filho `supabase`, sem nunca imprimir os valores.
 *
 * Por quê: este projeto roda num shell não-TTY (agente/CI-like), onde
 * `supabase login` (fluxo de navegador) não funciona — o próprio CLI recusa
 * ("Cannot use automatic login flow inside non-TTY environments"). A
 * alternativa oficialmente suportada é autenticação por variável de ambiente.
 *
 * Uso:
 *   node scripts/supabase-cli.mjs projects list
 *   node scripts/supabase-cli.mjs link --project-ref <ref>
 *   node scripts/supabase-cli.mjs db push --dry-run
 *   node scripts/supabase-cli.mjs db push
 *
 * Variáveis lidas de .env.local (NUNCA commitadas, NUNCA logadas):
 *   SUPABASE_ACCESS_TOKEN  — Personal Access Token da conta Supabase
 *                            (dashboard.supabase.com/account/tokens),
 *                            usado só pelo CLI/Management API.
 *   SUPABASE_DB_PASSWORD   — senha do Postgres do projeto (Settings →
 *                            Database → Reset database password se perdida),
 *                            usada só nos subcomandos `link` e `db push`.
 *
 * Nenhuma das duas é usada pelo runtime da aplicação nem exposta ao browser
 * — são exclusivas de tooling local. Ver docs/PITCHAT_ARCHITECTURE.md §2
 * e supabase/README.md pra não confundir com SUPABASE_SECRET_KEY (essa sim
 * é a credencial server-side da aplicação).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const envLocalPath = path.join(projectRoot, ".env.local");

function loadEnvLocal(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const rawLine of readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // remove aspas simples/duplas envolvendo o valor, se houver
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envLocal = loadEnvLocal(envLocalPath);
const accessToken = envLocal.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;
const dbPassword = envLocal.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD;

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Uso: node scripts/supabase-cli.mjs <comando supabase> [...args]");
  process.exit(1);
}

if (!accessToken) {
  console.error(
    "[supabase-cli] SUPABASE_ACCESS_TOKEN não está configurado em .env.local — " +
      "veja supabase/README.md ('Autenticação não-interativa do CLI') pra saber onde gerar."
  );
  process.exit(1);
}

// `link`, `db *` e `migration *` (list/repair/...) aceitam --password pra
// conexão direta com o Postgres. Mais simples e seguro injetar sempre que o
// comando é de uma dessas famílias do que manter uma lista exaustiva de
// subcomandos — sobra um --password ignorado em quem não usa, não falta em
// quem usa. Nunca sobrescreve se o caller já passou --password/-p.
const needsDbPassword = ["link", "db", "migration"].includes(args[0]);
const alreadyHasPasswordFlag = args.includes("--password") || args.includes("-p");

const finalArgs = [...args];
if (needsDbPassword && !alreadyHasPasswordFlag) {
  if (!dbPassword) {
    console.error(
      "[supabase-cli] SUPABASE_DB_PASSWORD não está configurado em .env.local — " +
        "necessário pra 'link'/'db push'. Veja supabase/README.md."
    );
    process.exit(1);
  }
  finalArgs.push("--password", dbPassword);
}

// Log só do comando, com a senha redigida — nunca o valor real.
const redactedArgs = finalArgs.map((a) => (a === dbPassword ? "***" : a));
console.log(`[supabase-cli] supabase ${redactedArgs.join(" ")}`);

// Roda o entrypoint JS do pacote "supabase" (devDependency) direto via node,
// em vez do wrapper .bin/supabase(.cmd) — evita shell:true (obrigatório pro
// .cmd no Windows, que reprocessa a string de comando) e funciona igual nos
// três SOs sem diferenciar nada aqui.
const cliEntrypoint = path.join(projectRoot, "node_modules", "supabase", "dist", "supabase.js");

const child = spawn(process.execPath, [cliEntrypoint, ...finalArgs], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_ACCESS_TOKEN: accessToken,
  },
  shell: false,
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("[supabase-cli] falha ao executar:", err.message);
  process.exit(1);
});
