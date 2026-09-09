import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatBytes, formatDurationMs, formatResolution } from "@/lib/media/format";
import { mediaStatusLabel } from "@/lib/media/status-label";
import { MediaUploadForm } from "./upload-form";
import { AutoRefreshWhilePending } from "./auto-refresh";

const THUMBNAIL_TTL_SECONDS = 300;

type MediaAssetListRow = {
  id: string;
  original_filename: string | null;
  storage_key: string;
  status: string;
  file_size: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  created_at: string;
};

export default async function MediaLibraryPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  const { data: assets, error } = admin
    ? await admin
        .from("media_assets")
        .select(
          "id, original_filename, storage_key, status, file_size, duration_ms, width, height, mime_type, created_at"
        )
        .eq("workspace_id", auth.workspace.id)
        .neq("status", "duplicate") // linhas 'duplicate' são só log interno, não aparecem na listagem
        .order("created_at", { ascending: false })
        .returns<MediaAssetListRow[]>()
    : { data: null, error: null };

  // Thumbnail real só pra imagem (signed URL, bucket é privado). Vídeo ganha
  // um ícone genérico por enquanto — extrair frame de vídeo é um pipeline à
  // parte que ainda não construímos, não vou fingir que existe.
  const thumbnails = new Map<string, string>();
  if (admin && assets?.length) {
    const imageAssets = assets.filter((a) => a.mime_type?.startsWith("image/"));
    await Promise.all(
      imageAssets.map(async (a) => {
        const { data: signed } = await admin.storage
          .from("media")
          .createSignedUrl(a.storage_key, THUMBNAIL_TTL_SECONDS);
        if (signed) thumbnails.set(a.id, signed.signedUrl);
      })
    );
  }

  const hasPending = (assets ?? []).some(
    (a) => a.status === "pending" || a.status === "processing"
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <AutoRefreshWhilePending active={hasPending} />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Media Library</h1>
        <Link href="/dashboard" className="text-sm underline opacity-70">
          Voltar
        </Link>
      </div>

      <div className="mb-8">
        <MediaUploadForm />
      </div>

      {error && (
        <p className="text-sm text-red-600">
          Não foi possível carregar a biblioteca agora. Tente de novo em instantes.
        </p>
      )}

      {!error && (!assets || assets.length === 0) && (
        <div className="rounded border border-dashed p-8 text-center">
          <p className="font-medium">Nenhuma mídia na biblioteca ainda.</p>
          <p className="text-sm opacity-60">Envie seu primeiro vídeo para começar.</p>
        </div>
      )}

      {assets && assets.length > 0 && (
        <ul className="divide-y">
          {assets.map((asset) => (
            <li key={asset.id} className="flex items-center gap-4 py-3">
              <Thumbnail mimeType={asset.mime_type} url={thumbnails.get(asset.id)} />

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {asset.original_filename ?? "(sem nome)"}
                </p>
                <p className="text-sm opacity-60">
                  <StatusBadge status={asset.status} /> ·{" "}
                  {formatDurationMs(asset.duration_ms)} ·{" "}
                  {formatResolution(asset.width, asset.height)} ·{" "}
                  {formatBytes(asset.file_size)} ·{" "}
                  {new Date(asset.created_at).toLocaleDateString("pt-BR")}
                </p>
              </div>

              <Link
                href={`/dashboard/media/${asset.id}`}
                className="shrink-0 rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Abrir
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Thumbnail({ mimeType, url }: { mimeType: string | null; url?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- signed URL expira, next/image cacheia por tempo demais pra isso
    return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />;
  }

  const isVideo = mimeType?.startsWith("video/");
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400">
      {isVideo ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = mediaStatusLabel(status);
  const tone =
    status === "failed"
      ? "text-red-600"
      : status === "pending" || status === "processing"
        ? "text-amber-600"
        : "text-green-700";
  return <span className={tone}>{label}</span>;
}
