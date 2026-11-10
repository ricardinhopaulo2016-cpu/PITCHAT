import {
  COLLISION_WINDOW_MS,
  accountCanPublish,
  collides,
  validateAssetForPublishing,
  type PublishMediaType,
  type PublishableAsset,
} from "./validate";

/**
 * Planeja um lote de posts (vários vídeos, várias contas) sem tocar no banco.
 * Quem chama carrega os dados, chama aqui e só grava se `ok` vier true: o lote
 * é tudo ou nada. A mesma regra serve à tela e à API, então as duas recusam
 * exatamente as mesmas coisas.
 */

export const MAX_SCHEDULE_AHEAD_MS = 90 * 24 * 60 * 60_000;
export const MAX_BATCH_ITEMS = 100;

export type BatchItemInput = {
  clientRef: string | null;
  mediaAssetId: string;
  /** id da conta ou @username. */
  account: string;
  mediaType: PublishMediaType;
  caption: string;
  /** null = publicar agora. */
  scheduledAt: string | null;
  shareToFeed: boolean;
};

export type BatchAsset = PublishableAsset & { id: string; status: string; storage_removed_at: string | null; original_filename?: string | null };
export type BatchAccount = { id: string; username: string | null; status: string; permissions: string[] | null };
export type ExistingPost = { social_account_id: string; media_asset_id: string; media_type: string; scheduled_at: string; status: string };
export type ExistingRef = { id: string; client_ref: string; status: string; scheduled_at: string };

export type PlannedRow = {
  social_account_id: string;
  media_asset_id: string;
  media_type: PublishMediaType;
  caption: string | null;
  share_to_feed: boolean;
  scheduled_at: string;
  client_ref: string | null;
};

export type PlannedItem = {
  index: number;
  clientRef: string | null;
  /** "existing" = o código já tinha virado post: nada é criado de novo. */
  outcome: "new" | "existing";
  existingPostId: string | null;
  accountId: string | null;
  username: string | null;
  scheduledAt: string | null;
  problems: string[];
  warnings: string[];
  row: PlannedRow | null;
};

export type BatchPlan = { ok: boolean; items: PlannedItem[]; toCreate: PlannedRow[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findAccount(accounts: BatchAccount[], ref: string): BatchAccount | undefined {
  const trimmed = ref.trim();
  if (UUID_RE.test(trimmed)) return accounts.find((a) => a.id === trimmed);
  const handle = trimmed.replace(/^@/, "").toLowerCase();
  return accounts.find((a) => a.username?.toLowerCase() === handle);
}

export function planBatch(input: {
  items: BatchItemInput[];
  assets: BatchAsset[];
  accounts: BatchAccount[];
  existingPosts: ExistingPost[];
  existingRefs: ExistingRef[];
  now: Date;
}): BatchPlan {
  const { now } = input;
  const assetById = new Map(input.assets.map((a) => [a.id, a]));
  const refByCode = new Map(input.existingRefs.map((r) => [r.client_ref, r]));
  const seenRefs = new Set<string>();
  // Posts já aceitos neste lote, para checar colisão entre itens do próprio lote.
  const accepted: ExistingPost[] = [];
  const assetChecked = new Map<string, { errors: string[]; warnings: string[] }>();

  const items: PlannedItem[] = input.items.map((item, index) => {
    const problems: string[] = [];
    const warnings: string[] = [];
    const clientRef = item.clientRef?.trim() || null;
    const base = { index, clientRef, existingPostId: null, problems, warnings, row: null };

    if (clientRef) {
      if (seenRefs.has(clientRef)) problems.push(`O código ${clientRef} aparece duas vezes no lote.`);
      seenRefs.add(clientRef);
      const existing = refByCode.get(clientRef);
      // Reenvio do mesmo código: não duplica, só informa o post que já existe.
      if (existing && !problems.length) {
        return { ...base, outcome: "existing" as const, existingPostId: existing.id, accountId: null, username: null, scheduledAt: existing.scheduled_at };
      }
    }

    const account = findAccount(input.accounts, item.account);
    const name = account?.username ? `@${account.username}` : item.account;
    if (!account) problems.push(`Conta ${item.account} não encontrada.`);
    else if (!accountCanPublish(account)) problems.push(`${name} precisa ser reconectada para publicar.`);

    const asset = assetById.get(item.mediaAssetId);
    if (!asset || asset.status !== "ready") {
      problems.push("Essa mídia não está pronta.");
    } else if (asset.storage_removed_at) {
      problems.push("O arquivo desse vídeo foi apagado depois de publicar. Envie o vídeo de novo para postar.");
    } else {
      const key = `${asset.id}:${item.mediaType}`;
      if (!assetChecked.has(key)) assetChecked.set(key, validateAssetForPublishing(asset, item.mediaType));
      const check = assetChecked.get(key)!;
      problems.push(...check.errors);
      warnings.push(...check.warnings);
    }

    const when = item.scheduledAt ? new Date(item.scheduledAt) : now;
    if (Number.isNaN(when.getTime())) problems.push("Horário inválido.");
    else {
      if (when.getTime() < now.getTime() - 60_000) problems.push(`${name}: o horário já passou.`);
      if (when.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) problems.push(`${name}: agende com até 90 dias de antecedência.`);
    }

    if (account && asset && !Number.isNaN(when.getTime())) {
      for (const other of [...input.existingPosts, ...accepted]) {
        if (other.social_account_id !== account.id || other.media_type !== item.mediaType) continue;
        if (item.mediaType === "REELS" && other.media_asset_id === asset.id) {
          problems.push(`${name} já tem esse vídeo como Reel.`);
        } else if (other.status !== "published" && collides(when, new Date(other.scheduled_at))) {
          problems.push(`${name} já tem um post a menos de ${COLLISION_WINDOW_MS / 60_000} minutos desse horário.`);
        }
      }
    }

    const unique = [...new Set(problems)];
    problems.length = 0;
    problems.push(...unique);

    if (problems.length || !account || !asset) {
      return { ...base, outcome: "new" as const, accountId: account?.id ?? null, username: account?.username ?? null, scheduledAt: item.scheduledAt };
    }

    const row: PlannedRow = {
      social_account_id: account.id,
      media_asset_id: asset.id,
      media_type: item.mediaType,
      // Stories não aceitam legenda pela API.
      caption: item.mediaType === "REELS" ? item.caption.trim() || null : null,
      share_to_feed: item.shareToFeed,
      scheduled_at: when.toISOString(),
      client_ref: clientRef,
    };
    accepted.push({ social_account_id: account.id, media_asset_id: asset.id, media_type: item.mediaType, scheduled_at: row.scheduled_at, status: "scheduled" });
    return { ...base, outcome: "new" as const, accountId: account.id, username: account.username, scheduledAt: row.scheduled_at, row };
  });

  const ok = items.every((i) => i.problems.length === 0);
  return { ok, items, toCreate: ok ? items.flatMap((i) => (i.row ? [i.row] : [])) : [] };
}
