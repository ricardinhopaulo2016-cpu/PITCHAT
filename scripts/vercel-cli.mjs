#!/usr/bin/env node
/**
 * Wrapper não-interativo pra Vercel CLI — lê VERCEL_TOKEN SÓ da env var real
 * do processo (`process.env.VERCEL_TOKEN`), NUNCA de .env.local ou qualquer
 * arquivo. Diferente de scripts/supabase-cli.mjs de propósito: o usuário
 * pediu explicitamente pra este token nunca tocar disco (nunca salvo em
 * arquivo, nunca commitado, nunca em Environment Variables do projeto na
 * própria Vercel) — só existe na env var da sessão de terminal atual.
 *
 * Uso:
 *   node scripts/vercel-cli.mjs whoami
 *   node scripts/vercel-cli.mjs ls
 *   node scripts/vercel-cli.mjs project inspect <nome-ou-id>
 *   node scripts/vercel-cli.mjs env ls production
 *   node scripts/vercel-cli.mjs link --yes
 *
 * Pré-requisito: VERCEL_TOKEN precisa já estar exportado na env var do
 * processo que chamou este script (nunca colado em arquivo por este
 * wrapper).
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const token = process.env.VERCEL_TOKEN;
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Uso: node scripts/vercel-cli.mjs <comando vercel> [...args]");
  process.exit(1);
}

if (!token) {
  console.error(
    "[vercel-cli] VERCEL_TOKEN não está presente na env var desta sessão — nunca lido de arquivo por este wrapper (pedido explícito do usuário)."
  );
  process.exit(1);
}

console.log(`[vercel-cli] vercel ${args.join(" ")}`);

const cliEntrypoint = path.join(projectRoot, "node_modules", "vercel", "dist", "vc.js");

const child = spawn(process.execPath, [cliEntrypoint, ...args], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    VERCEL_TOKEN: token,
  },
  shell: false,
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("[vercel-cli] falha ao executar:", err.message);
  process.exit(1);
});
