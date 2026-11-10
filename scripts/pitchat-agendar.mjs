#!/usr/bin/env node
/**
 * Sobe e agenda uma remessa de Reels pela API do PITCHAT, sem navegador.
 *
 * Uso:
 *   node scripts/pitchat-agendar.mjs <plano.json>              (revisão: sobe os vídeos e confere, não agenda)
 *   node scripts/pitchat-agendar.mjs <plano.json> --confirmar  (agenda de verdade)
 *
 * plano.json: { "posts": [ { "arquivo", "conta", "horario", "legenda", "codigo", "tipo"? } ] }
 *   arquivo  caminho do vídeo no PC
 *   conta    @username da conta (ex.: @pit_viagens)
 *   horario  ISO com fuso (ex.: 2026-11-12T08:00:00-03:00); vazio = publicar agora
 *   legenda  texto do Reel
 *   codigo   código do post (ex.: R2-PIT-R685-HA-261112-0800). Reenviar o mesmo código
 *            não duplica: o post que já existe é mantido.
 *   tipo     REELS (padrão) ou STORIES
 *
 * Vídeo acima de 45 MB é comprimido com ffmpeg antes de subir (limite de 50 MB
 * do Supabase gratuito). O original nunca é alterado.
 *
 * Lê de .env.local: PITCHAT_API_TOKEN (gerado em Contas > Acesso pela API),
 * NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. PITCHAT_URL
 * opcional (padrão: produção). Nunca imprime o token.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { createClient } = require("@supabase/supabase-js");

const MB = 1024 * 1024;
const COMPRESS_ABOVE = 45 * MB;
const TARGET_BYTES = 42 * MB;
const UPLOAD_LIMIT = 50 * MB;

function loadEnv() {
  const file = path.join(root, ".env.local");
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const BASE = (env.PITCHAT_URL || "https://pitchat-xi.vercel.app").replace(/\/$/, "");
const TOKEN = env.PITCHAT_API_TOKEN;
const args = process.argv.slice(2);
const planPath = args.find((a) => !a.startsWith("--"));
const confirm = args.includes("--confirmar");

if (!planPath) {
  console.error("Uso: node scripts/pitchat-agendar.mjs <plano.json> [--confirmar]");
  process.exit(1);
}
if (!TOKEN?.startsWith("pct_")) {
  console.error("Falta PITCHAT_API_TOKEN no .env.local (gere em Contas > Acesso pela API).");
  process.exit(1);
}

async function api(method, route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function probeDuration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString().trim();
  const seconds = Number(out);
  if (!seconds) throw new Error(`ffprobe não leu a duração de ${file}`);
  return seconds;
}

/** Cópia leve em H.264/AAC, até 1080 de largura, perto de 42 MB. Tenta de novo mais leve se passar. */
function compress(file, workDir) {
  const seconds = probeDuration(file);
  let factor = 1;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const totalKbps = (TARGET_BYTES * 8 * factor) / seconds / 1000;
    const videoKbps = Math.max(300, Math.floor(totalKbps - 128));
    const out = path.join(workDir, `${path.parse(file).name}-leve-${attempt}.mp4`);
    execFileSync(
      "ffmpeg",
      ["-y", "-v", "error", "-i", file, "-vf", "scale='min(1080,iw)':-2", "-c:v", "libx264", "-preset", "medium",
        "-b:v", `${videoKbps}k`, "-maxrate", `${Math.floor(videoKbps * 1.4)}k`, "-bufsize", `${videoKbps * 2}k`,
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out],
      { stdio: "inherit" }
    );
    const size = statSync(out).size;
    if (size <= COMPRESS_ABOVE) return out;
    factor *= 0.8;
  }
  throw new Error(`Não consegui deixar ${path.basename(file)} abaixo de 45 MB.`);
}

async function upload(file) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const size = statSync(file).size;
  if (size > UPLOAD_LIMIT) throw new Error(`${path.basename(file)} tem ${(size / MB).toFixed(1)} MB, acima do limite.`);

  const signed = await api("POST", "/api/media/upload-url", { filename: path.basename(file), fileSize: size });
  if (!signed.ok) throw new Error(`upload-url ${signed.status}: ${JSON.stringify(signed.json)}`);

  const { error } = await supabase.storage
    .from("media")
    .uploadToSignedUrl(signed.json.storageKey, signed.json.token, readFileSync(file), {
      contentType: path.extname(file).toLowerCase() === ".mov" ? "video/quicktime" : "video/mp4",
    });
  if (error) throw new Error(`Envio ao Storage falhou: ${error.message}`);

  const fin = await api("POST", "/api/media/finalize", { mediaAssetId: signed.json.mediaAssetId });
  if (!fin.ok) throw new Error(`finalize ${fin.status}: ${JSON.stringify(fin.json)}`);
  if (fin.json.status === "EXACT_DUPLICATE") return { id: fin.json.existingAssetId, duplicate: true };
  return { id: fin.json.mediaAssetId, duplicate: false };
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const rawPosts = Array.isArray(plan) ? plan : plan.posts;
if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
  console.error("O plano não tem posts.");
  process.exit(1);
}
const posts = rawPosts.map((p) => ({
  file: p.arquivo ?? p.file,
  account: p.conta ?? p.account,
  scheduledAt: (p.horario ?? p.scheduledAt) || null,
  caption: p.legenda ?? p.caption ?? "",
  clientRef: p.codigo ?? p.clientRef ?? null,
  mediaType: (p.tipo ?? p.mediaType ?? "REELS").toUpperCase(),
}));

for (const p of posts) {
  if (!p.file || !existsSync(p.file)) throw new Error(`Arquivo não encontrado: ${p.file}`);
  if (!p.account) throw new Error(`Post sem conta: ${p.file}`);
}

// Código que já virou post não precisa subir o vídeo de novo.
const refs = posts.map((p) => p.clientRef).filter(Boolean);
const existingRefs = new Set();
if (refs.length) {
  const qs = refs.map((r) => `clientRef=${encodeURIComponent(r)}`).join("&");
  const found = await api("GET", `/api/scheduled-posts/batch?${qs}`);
  if (!found.ok) throw new Error(`Consulta de códigos falhou (${found.status}): ${JSON.stringify(found.json)}`);
  for (const post of found.json.posts) existingRefs.add(post.client_ref);
}

const workDir = mkdtempSync(path.join(tmpdir(), "pitchat-agendar-"));
const assetByHash = new Map();
try {
  for (const p of posts) {
    if (p.clientRef && existingRefs.has(p.clientRef)) {
      console.log(`= ${p.clientRef}: já agendado, não sobe de novo`);
      continue;
    }
    const hash = sha256File(p.file);
    if (!assetByHash.has(hash)) {
      let toSend = p.file;
      const size = statSync(p.file).size;
      if (size > COMPRESS_ABOVE) {
        console.log(`~ ${path.basename(p.file)}: ${(size / MB).toFixed(1)} MB, comprimindo...`);
        toSend = compress(p.file, workDir);
        console.log(`  ficou com ${(statSync(toSend).size / MB).toFixed(1)} MB`);
      }
      const asset = await upload(toSend);
      console.log(`↑ ${path.basename(p.file)}: ${asset.duplicate ? "já estava no PITCHAT" : "enviado"} (${asset.id})`);
      assetByHash.set(hash, asset.id);
    }
    p.mediaAssetId = assetByHash.get(hash);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const batch = posts
  .filter((p) => p.mediaAssetId)
  .map((p) => ({ clientRef: p.clientRef, mediaAssetId: p.mediaAssetId, account: p.account, mediaType: p.mediaType, caption: p.caption, scheduledAt: p.scheduledAt }));

if (batch.length === 0) {
  console.log("Nada novo para agendar.");
  process.exit(0);
}

const review = await api("POST", "/api/scheduled-posts/batch", { dryRun: true, posts: batch });
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "agora");
console.log("\nRevisão:");
for (const item of review.json.items ?? []) {
  const p = batch[item.index];
  const mark = item.problems.length ? "✗" : item.outcome === "existing" ? "=" : "✓";
  console.log(`${mark} ${p.clientRef ?? "(sem código)"} | @${item.username ?? p.account.replace(/^@/, "")} | ${fmt(item.scheduledAt)}`);
  for (const problem of item.problems) console.log(`    ${problem}`);
  for (const warning of item.warnings ?? []) console.log(`    aviso: ${warning}`);
}

if (!review.ok) {
  console.error(`\nLote recusado (${review.status}). Nada foi agendado.${review.json.problems ? " " + review.json.problems.join(" ") : ""}`);
  process.exit(2);
}
if (!confirm) {
  console.log(`\n${review.json.toCreate} post(s) prontos. Nada foi agendado: rode de novo com --confirmar.`);
  process.exit(0);
}

const created = await api("POST", "/api/scheduled-posts/batch", { posts: batch });
if (!created.ok) {
  console.error(`\nFalhou ao agendar (${created.status}): ${JSON.stringify(created.json)}`);
  process.exit(3);
}
console.log(`\nAgendados: ${created.json.created.length}. Lote ${created.json.batchId}. Falhas na fila: ${created.json.queueFailures}.`);
