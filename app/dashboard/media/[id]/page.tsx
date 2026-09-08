import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatBytes, formatDurationMs, formatResolution } from "@/lib/media/format";

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
  processing_error: unknown;
  created_at: string;
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
      "id, original_filename, storage_key, status, sha256, file_size, mime_type, duration_ms, width, height, fps, codec, bitrate, has_audio, processing_error, created_at"
    )
    .eq("id", id)
    .eq("workspace_id", auth.workspace.id) // nunca confia só no id da URL
    .maybeSingle<MediaAssetDetail>();

  if (!asset) notFound();

  const fields: [string, string][] = [
    ["Status", asset.status],
    ["Nome original", asset.original_filename ?? "—"],
    ["MIME real (magic bytes)", asset.mime_type ?? "—"],
    ["SHA-256", asset.sha256 ?? "—"],
    ["Tamanho", formatBytes(asset.file_size)],
    ["Duração", formatDurationMs(asset.duration_ms)],
    ["Resolução", formatResolution(asset.width, asset.height)],
    ["FPS", asset.fps?.toString() ?? "—"],
    ["Codec", asset.codec ?? "—"],
    ["Bitrate", asset.bitrate ? `${Math.round(asset.bitrate / 1000)} kbps` : "—"],
    ["Áudio", asset.has_audio == null ? "—" : asset.has_audio ? "Sim" : "Não"],
    ["Storage key", asset.storage_key],
    ["Enviado em", new Date(asset.created_at).toLocaleString("pt-BR")],
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard/media" className="text-sm underline opacity-70">
        ← Media Library
      </Link>

      <h1 className="mb-6 mt-2 text-2xl font-semibold break-all">
        {asset.original_filename ?? asset.id}
      </h1>

      <dl className="divide-y">
        {fields.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="opacity-60">{label}</dt>
            <dd className="text-right break-all">{value}</dd>
          </div>
        ))}
      </dl>

      {asset.status === "failed" && asset.processing_error != null && (
        <pre className="mt-6 overflow-x-auto rounded bg-red-50 p-3 text-xs text-red-700">
          {JSON.stringify(asset.processing_error, null, 2)}
        </pre>
      )}

      <p className="mt-6 text-sm opacity-60">
        Fingerprint perceptual e histórico de uso por perfil chegam na Fase 3/próximas —
        ver docs/PITCHAT_ARCHITECTURE.md.
      </p>
    </main>
  );
}
