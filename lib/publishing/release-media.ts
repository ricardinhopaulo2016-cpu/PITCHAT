/**
 * Apaga o arquivo de uma mídia do Storage quando nenhum post dela precisa mais
 * do arquivo. Só o arquivo some: o registro da mídia e dos posts ficam.
 *
 * Regra de ouro: na dúvida, o arquivo fica. Qualquer erro aqui deixa o arquivo
 * onde está, porque um arquivo a mais custa espaço e um arquivo a menos custa
 * um post.
 */
export type ReleaseMediaDeps = {
  /** Posts da mídia que ainda podem usar o arquivo: agendado, publicando ou com erro (o "tentar de novo" reaproveita o arquivo). */
  countPostsNeedingFile(mediaAssetId: string): Promise<number>;
  /** Marca o arquivo como removido e devolve a chave dele. Só marca se ainda não estava; null = já removido ou mídia inexistente. */
  claimFileRemoval(mediaAssetId: string): Promise<string | null>;
  removeFile(storageKey: string): Promise<void>;
  /** Desfaz a marca, para a mídia não ficar como removida sem ter sido. */
  undoClaim(mediaAssetId: string): Promise<void>;
};

export type ReleaseOutcome = "removed" | "still_needed" | "already_removed" | "remove_failed";

export async function releaseMediaFile(deps: ReleaseMediaDeps, mediaAssetId: string): Promise<ReleaseOutcome> {
  // Marca antes de contar: a partir daqui a API recusa post novo com essa mídia,
  // então a contagem seguinte não perde um post que chegou no meio do caminho.
  const storageKey = await deps.claimFileRemoval(mediaAssetId);
  if (!storageKey) return "already_removed";

  try {
    if ((await deps.countPostsNeedingFile(mediaAssetId)) > 0) {
      await deps.undoClaim(mediaAssetId);
      return "still_needed";
    }
  } catch (err) {
    await deps.undoClaim(mediaAssetId).catch(() => undefined);
    throw err;
  }

  try {
    await deps.removeFile(storageKey);
    return "removed";
  } catch {
    await deps.undoClaim(mediaAssetId).catch(() => undefined);
    return "remove_failed";
  }
}
