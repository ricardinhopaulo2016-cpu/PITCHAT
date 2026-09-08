import { NextResponse } from "next/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { detectAndValidateMime } from "@/lib/media/mime";
import { sha256Buffer } from "@/lib/media/hash";
import { probeMediaFile } from "@/lib/media/ffprobe";
import { findExactDuplicate } from "@/lib/media/duplicate";
import { getMaxUploadSizeBytes } from "@/lib/media/limits";

export const runtime = "nodejs";

type MediaAssetRow = {
  id: string;
  workspace_id: string;
  storage_key: string;
  status: string;
};

async function markFailed(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  assetId: string,
  reason: string,
  detail?: unknown
) {
  await admin
    ?.from("media_assets")
    .update({ status: "failed", processing_error: { reason, detail } })
    .eq("id", assetId);
}

/**
 * Passo 2 do pipeline: os bytes já estão no Storage (via signed URL). Agora
 * fazemos a checagem AUTORITATIVA — baixa o objeto de volta, valida MIME real
 * (magic bytes), calcula SHA-256 de verdade, roda ffprobe, decide
 * EXACT_DUPLICATE vs NEW_ASSET. Nada disso confia no que o cliente declarou
 * no passo 1.
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
  const mediaAssetId = typeof body?.mediaAssetId === "string" ? body.mediaAssetId : null;
  if (!mediaAssetId) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { data: asset, error: fetchError } = await admin
    .from("media_assets")
    .select("id, workspace_id, storage_key, status")
    .eq("id", mediaAssetId)
    .eq("workspace_id", auth.workspace.id) // nunca confia só no id — sempre escopado ao workspace do request
    .maybeSingle<MediaAssetRow>();

  if (fetchError || !asset) {
    return NextResponse.json({ error: "ASSET_NOT_FOUND" }, { status: 404 });
  }

  if (asset.status !== "pending") {
    return NextResponse.json(
      { error: "ALREADY_FINALIZED", status: asset.status },
      { status: 409 }
    );
  }

  await admin.from("media_assets").update({ status: "processing" }).eq("id", asset.id);

  const { data: fileBlob, error: downloadError } = await admin.storage
    .from("media")
    .download(asset.storage_key);

  if (downloadError || !fileBlob) {
    await markFailed(admin, asset.id, "DOWNLOAD_FAILED", downloadError?.message);
    return NextResponse.json({ error: "DOWNLOAD_FAILED" }, { status: 502 });
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer());

  if (buffer.byteLength === 0 || buffer.byteLength > getMaxUploadSizeBytes()) {
    await admin.storage.from("media").remove([asset.storage_key]);
    await markFailed(admin, asset.id, "FILE_SIZE_INVALID", { size: buffer.byteLength });
    return NextResponse.json({ error: "FILE_SIZE_INVALID" }, { status: 413 });
  }

  const mimeResult = await detectAndValidateMime(buffer);
  if (!mimeResult.ok) {
    // Arquivo inválido/não permitido: não faz sentido manter ocupando Storage.
    await admin.storage.from("media").remove([asset.storage_key]);
    await markFailed(admin, asset.id, mimeResult.reason, {
      detectedMimeType: "detectedMimeType" in mimeResult ? mimeResult.detectedMimeType : null,
    });
    return NextResponse.json(
      { error: "INVALID_MIME_TYPE", reason: mimeResult.reason },
      { status: 422 }
    );
  }

  const sha256 = sha256Buffer(buffer);

  const duplicateCheck = await findExactDuplicate(admin, auth.workspace.id, sha256).catch(
    (err: Error) => err
  );
  if (duplicateCheck instanceof Error) {
    await markFailed(admin, asset.id, "DUPLICATE_CHECK_FAILED", duplicateCheck.message);
    return NextResponse.json({ error: "DUPLICATE_CHECK_FAILED" }, { status: 500 });
  }

  if (duplicateCheck.isDuplicate) {
    // Mesmo conteúdo já existe (ready) neste workspace — não guarda uma
    // segunda cópia física. Remove o objeto recém-enviado do Storage e marca
    // esta linha como 'duplicate' só pra log/observabilidade.
    await admin.storage.from("media").remove([asset.storage_key]);
    await admin
      .from("media_assets")
      .update({ status: "duplicate", sha256 })
      .eq("id", asset.id);

    return NextResponse.json({
      status: "EXACT_DUPLICATE",
      existingAssetId: duplicateCheck.existingAssetId,
    });
  }

  let tempDir: string | null = null;
  try {
    tempDir = await mkdtemp(join(tmpdir(), "pitchat-media-"));
    const tempPath = join(tempDir, "asset");
    await writeFile(tempPath, buffer);

    const probe = await probeMediaFile(tempPath);

    const { error: updateError } = await admin
      .from("media_assets")
      .update({
        sha256,
        file_size: buffer.byteLength,
        mime_type: mimeResult.mimeType,
        duration_ms: probe.durationMs,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        codec: probe.codec,
        bitrate: probe.bitrate,
        has_audio: probe.hasAudio,
        status: "ready",
        processing_error: null,
      })
      .eq("id", asset.id);

    if (updateError) {
      await markFailed(admin, asset.id, "DB_UPDATE_FAILED", updateError.message);
      return NextResponse.json({ error: "DB_UPDATE_FAILED" }, { status: 500 });
    }

    return NextResponse.json({ status: "READY", mediaAssetId: asset.id });
  } catch (err) {
    await markFailed(admin, asset.id, "FFPROBE_FAILED", (err as Error).message);
    return NextResponse.json({ error: "FFPROBE_FAILED" }, { status: 422 });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}
