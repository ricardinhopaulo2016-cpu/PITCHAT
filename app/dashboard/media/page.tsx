import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatBytes, formatDurationMs, formatResolution } from "@/lib/media/format";
import { MediaUploadForm } from "./upload-form";

type MediaAssetListRow = {
  id: string;
  original_filename: string | null;
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
          "id, original_filename, status, file_size, duration_ms, width, height, mime_type, created_at"
        )
        .eq("workspace_id", auth.workspace.id)
        .neq("status", "duplicate") // linhas 'duplicate' são só log interno, não aparecem na listagem
        .order("created_at", { ascending: false })
        .returns<MediaAssetListRow[]>()
    : { data: null, error: null };

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Media Library</h1>
        <Link href="/dashboard" className="text-sm underline opacity-70">
          Voltar
        </Link>
      </div>

      <div className="mb-8 rounded border p-4">
        <MediaUploadForm />
      </div>

      {error && <p className="text-sm text-red-600">Erro ao carregar: {error.message}</p>}

      {!error && (!assets || assets.length === 0) && (
        <p className="text-sm opacity-60">Nenhuma mídia ainda. Envie um arquivo acima.</p>
      )}

      {assets && assets.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Arquivo</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Duração</th>
                <th className="py-2 pr-4">Resolução</th>
                <th className="py-2 pr-4">Tamanho</th>
                <th className="py-2 pr-4">Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-b">
                  <td className="py-2 pr-4">
                    <Link href={`/dashboard/media/${asset.id}`} className="underline">
                      {asset.original_filename ?? "(sem nome)"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{asset.status}</td>
                  <td className="py-2 pr-4">{formatDurationMs(asset.duration_ms)}</td>
                  <td className="py-2 pr-4">
                    {formatResolution(asset.width, asset.height)}
                  </td>
                  <td className="py-2 pr-4">{formatBytes(asset.file_size)}</td>
                  <td className="py-2 pr-4">
                    {new Date(asset.created_at).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
