import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getMaxUploadSizeBytes } from "@/lib/media/limits";

export const runtime = "nodejs";

/**
 * Passo 1 do pipeline de ingest: emite uma signed upload URL do Storage
 * (bucket privado "media") pro cliente mandar os bytes DIRETO pro Supabase,
 * sem passar pelo corpo desta function — evita o limite de payload de
 * Route Handler serverless da Vercel pra arquivos de vídeo grandes.
 *
 * O nome do arquivo e o mimeType aqui são só o que o CLIENTE declarou —
 * nunca confiar nisso pra identidade/validação real. A checagem
 * autoritativa (magic bytes + SHA-256 + ffprobe) acontece em /api/media/finalize,
 * depois que os bytes de verdade chegaram no Storage.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const filename = typeof body?.filename === "string" ? body.filename : null;
  const fileSize = typeof body?.fileSize === "number" ? body.fileSize : null;

  if (!filename || fileSize == null) {
    return NextResponse.json(
      { error: "INVALID_BODY", detail: "filename e fileSize são obrigatórios" },
      { status: 400 }
    );
  }

  if (fileSize <= 0 || fileSize > getMaxUploadSizeBytes()) {
    return NextResponse.json(
      { error: "FILE_TOO_LARGE", maxBytes: getMaxUploadSizeBytes() },
      { status: 413 }
    );
  }

  const mediaAssetId = randomUUID();
  // Sanitiza o nome só pra virar um path de Storage válido — o filename
  // original de verdade fica em original_filename, sem influenciar nada.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-200);
  const storageKey = `${auth.workspace.id}/${mediaAssetId}/${safeName}`;

  const { error: insertError } = await admin.from("media_assets").insert({
    id: mediaAssetId,
    workspace_id: auth.workspace.id,
    original_filename: filename,
    storage_key: storageKey,
    source_type: "upload",
    status: "pending",
    uploaded_by: auth.userId,
  });

  if (insertError) {
    return NextResponse.json(
      { error: "DB_INSERT_FAILED", detail: insertError.message },
      { status: 500 }
    );
  }

  const { data: signed, error: signError } = await admin.storage
    .from("media")
    .createSignedUploadUrl(storageKey);

  if (signError || !signed) {
    await admin.from("media_assets").delete().eq("id", mediaAssetId);
    return NextResponse.json(
      { error: "SIGNED_URL_FAILED", detail: signError?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    mediaAssetId,
    storageKey,
    signedUrl: signed.signedUrl,
    token: signed.token,
  });
}
