import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatBytes, formatDurationMs, formatResolution } from "@/lib/media/format";
import { mediaStatusLabel } from "@/lib/media/status-label";
import { friendlyUploadError } from "@/lib/media/error-messages";

const PREVIEW_TTL_SECONDS = 600;

type MediaAssetDetail = {
  id: string;
  original_filename: string | null;
  storage_key: string;
  status: string;
  sha256: string | null;
  file_size: number | null;
  mime_type: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  bitrate: number | null;
  has_audio: boolean | null;
  source_type: string;
  processing_error: { reason?: string } | null;
  created_at: string;
};

type MediaUsageRow = {
  id: string;
  platform: string;
  context: string | null;
  used_at: string;
  profile: { name: string } | null;
};

export default async function MediaAssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const { data: asset } = await admin
    .from("media_assets")
    .select(
      "id, original_filename, storage_key, status, sha256, file_size, mime_type, duration_ms, width, height, fps, codec, bitrate, has_audio, source_type, processing_error, created_at"
    )
    .eq("id", id)
    .eq("workspace_id", auth.workspace.id) // nunca confia só no id da URL
    .maybeSingle<MediaAssetDetail>();

  if (!asset) notFound();

  // `usage` (depende só de asset.id) e `signed` (depende só de
  // asset.storage_key/asset.status) não dependem uma da outra — só de
  // `asset`, já resolvido acima. Paraleliza (reauditoria HEAD 24/09/2026).
  const [{ data: usage }, signed] = await Promise.all([
    admin
      .from("media_usage")
      .select("id, platform, context, used_at, profile:profiles(name)")
      .eq("media_asset_id", asset.id)
      .order("used_at", { ascending: false })
      .returns<MediaUsageRow[]>(),
    asset.status === "ready"
      ? admin.storage.from("media").createSignedUrl(asset.storage_key, PREVIEW_TTL_SECONDS)
      : Promise.resolve({ data: null }),
  ]);
  const previewUrl = signed?.data?.signedUrl ?? null;

  const isImage = asset.mime_type?.startsWith("image/");
  const isVideo = asset.mime_type?.startsWith("video/");

  const fields: [string, string][] = [
    ["Status", mediaStatusLabel(asset.status)],
    ["Duração", formatDurationMs(asset.duration_ms)],
    ["Resolução", formatResolution(asset.width, asset.height)],
    ["FPS", asset.fps?.toString() ?? "—"],
    ["Codec", asset.codec ?? "—"],
    ["Bitrate", asset.bitrate ? `${Math.round(asset.bitrate / 1000)} kbps` : "—"],
    ["Áudio", asset.has_audio == null ? "—" : asset.has_audio ? "Sim" : "Não"],
    ["Tamanho", formatBytes(asset.file_size)],
    ["MIME", asset.mime_type ?? "—"],
    ["Data de entrada", new Date(asset.created_at).toLocaleString("pt-BR")],
    ["Origem", asset.source_type === "google_drive" ? "Google Drive" : "Upload"],
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard/media" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text">
        <ChevronLeft className="h-3.5 w-3.5" /> Media Library
      </Link>

      <h1 className="mb-4 mt-3 break-all text-[26px] font-semibold tracking-[-0.025em] text-text">
        {asset.original_filename ?? asset.id}
      </h1>

      {previewUrl && isImage && (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL expira, sem sentido usar next/image
        <img src={previewUrl} alt="" className="mb-6 max-h-96 rounded-[var(--radius-panel-lg)] border border-border-subtle object-contain" />
      )}
      {previewUrl && isVideo && (
        <video src={previewUrl} controls className="mb-6 max-h-96 w-full rounded-[var(--radius-panel-lg)] border border-border-subtle" />
      )}
      {!previewUrl && asset.status === "failed" && (
        <div className="mb-6 rounded-[var(--radius-panel-lg)] border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {friendlyUploadError(asset.processing_error?.reason)}
        </div>
      )}
      {!previewUrl && (asset.status === "pending" || asset.status === "processing") && (
        <div className="mb-6 rounded-[var(--radius-panel-lg)] border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          Ainda processando…
        </div>
      )}

      <dl className="divide-y divide-border-subtle">
        {fields.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-text-muted">{label}</dt>
            <dd className="break-all text-right text-text">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium text-text-secondary">Histórico de uso</h2>
        {usage && usage.length > 0 ? (
          <ul className="divide-y divide-border-subtle text-sm">
            {usage.map((u) => (
              <li key={u.id} className="flex justify-between py-2">
                <span className="text-text">
                  {u.profile?.name ?? "Perfil removido"} · {u.platform}
                  {u.context ? ` · ${u.context}` : ""}
                </span>
                <span className="text-text-muted">
                  {new Date(u.used_at).toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">Essa mídia ainda não foi usada em nenhum perfil.</p>
        )}
      </section>

      <details className="mt-8 text-sm">
        <summary className="cursor-pointer text-text-muted">Informações técnicas</summary>
        <dl className="mt-2 divide-y divide-border-subtle">
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-text-muted">SHA-256</dt>
            <dd className="break-all text-right text-text">{asset.sha256 ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-text-muted">Storage key</dt>
            <dd className="break-all text-right text-text">{asset.storage_key}</dd>
          </div>
        </dl>
      </details>
    </main>
  );
}
