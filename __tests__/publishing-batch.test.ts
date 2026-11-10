import { describe, expect, it } from "vitest";
import { planBatch, type BatchAccount, type BatchAsset, type BatchItemInput, type ExistingPost, type ExistingRef } from "@/lib/publishing/batch";

const NOW = new Date("2026-11-10T12:00:00Z");

const asset = (id: string, extra: Partial<BatchAsset> = {}): BatchAsset => ({
  id,
  status: "ready",
  storage_removed_at: null,
  mime_type: "video/mp4",
  file_size: 20 * 1024 * 1024,
  duration_ms: 30_000,
  width: 1080,
  height: 1920,
  fps: 30,
  codec: "h264",
  ...extra,
});

const PUBLISH = ["instagram_business_content_publish"];
const accounts: BatchAccount[] = [
  { id: "11111111-1111-4111-8111-111111111111", username: "pit_viagens", status: "connected", permissions: PUBLISH },
  { id: "22222222-2222-4222-8222-222222222222", username: "papagaio_milhas", status: "connected", permissions: PUBLISH },
  { id: "33333333-3333-4333-8333-333333333333", username: "sem_permissao", status: "connected", permissions: [] },
];

const item = (over: Partial<BatchItemInput> = {}): BatchItemInput => ({
  clientRef: null,
  mediaAssetId: "a1",
  account: "@pit_viagens",
  mediaType: "REELS",
  caption: "Legenda",
  scheduledAt: "2026-11-11T11:00:00Z",
  shareToFeed: true,
  ...over,
});

function plan(items: BatchItemInput[], opts: { assets?: BatchAsset[]; existingPosts?: ExistingPost[]; existingRefs?: ExistingRef[] } = {}) {
  return planBatch({
    items,
    assets: opts.assets ?? [asset("a1"), asset("a2"), asset("a3")],
    accounts,
    existingPosts: opts.existingPosts ?? [],
    existingRefs: opts.existingRefs ?? [],
    now: NOW,
  });
}

describe("planBatch", () => {
  it("vários vídeos em várias contas viram um lote válido", () => {
    const result = plan([
      item({ clientRef: "R2-PIT-1", mediaAssetId: "a1", account: "@pit_viagens" }),
      item({ clientRef: "R2-PAP-1", mediaAssetId: "a2", account: "papagaio_milhas", scheduledAt: "2026-11-11T12:00:00Z" }),
      item({ mediaAssetId: "a3", account: accounts[0].id, scheduledAt: "2026-11-11T15:00:00Z" }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.toCreate).toHaveLength(3);
    expect(result.toCreate[1]).toMatchObject({ social_account_id: accounts[1].id, client_ref: "R2-PAP-1", caption: "Legenda" });
  });

  it("acha a conta pelo @ sem diferenciar maiúscula", () => {
    expect(plan([item({ account: "@PIT_Viagens" })]).ok).toBe(true);
  });

  it("um problema em qualquer item recusa o lote inteiro", () => {
    const result = plan([item(), item({ mediaAssetId: "a2", account: "@sem_permissao" })]);
    expect(result.ok).toBe(false);
    expect(result.toCreate).toEqual([]);
    expect(result.items[1].problems).toContain("@sem_permissao precisa ser reconectada para publicar.");
  });

  it("conta desconhecida, mídia não pronta e horário passado viram problema", () => {
    const result = plan(
      [item({ account: "@nao_existe" }), item({ mediaAssetId: "pendente" }), item({ mediaAssetId: "a2", scheduledAt: "2026-11-09T12:00:00Z" })],
      { assets: [asset("a1"), asset("a2"), asset("pendente", { status: "pending" })] }
    );
    expect(result.items[0].problems).toContain("Conta @nao_existe não encontrada.");
    expect(result.items[1].problems).toContain("Essa mídia não está pronta.");
    expect(result.items[2].problems).toContain("@pit_viagens: o horário já passou.");
  });

  it("mesmo vídeo como Reel duas vezes na mesma conta, dentro do lote, é barrado", () => {
    const result = plan([item(), item({ scheduledAt: "2026-11-12T11:00:00Z" })]);
    expect(result.ok).toBe(false);
    expect(result.items[1].problems).toContain("@pit_viagens já tem esse vídeo como Reel.");
  });

  it("vídeo já publicado como Reel na conta é barrado", () => {
    const existing: ExistingPost = { social_account_id: accounts[0].id, media_asset_id: "a1", media_type: "REELS", scheduled_at: "2026-11-01T11:00:00Z", status: "published" };
    expect(plan([item()], { existingPosts: [existing] }).items[0].problems).toContain("@pit_viagens já tem esse vídeo como Reel.");
  });

  it("dois posts a menos de 15 minutos na mesma conta colidem, inclusive dentro do lote", () => {
    const result = plan([item(), item({ mediaAssetId: "a2", scheduledAt: "2026-11-11T11:10:00Z" })]);
    expect(result.items[1].problems[0]).toMatch(/a menos de 15 minutos/);
  });

  it("código já usado não cria outro post: devolve o existente", () => {
    const result = plan([item({ clientRef: "R2-PIT-1" })], {
      existingRefs: [{ id: "post-velho", client_ref: "R2-PIT-1", status: "scheduled", scheduled_at: "2026-11-11T11:00:00Z" }],
    });
    expect(result.ok).toBe(true);
    expect(result.items[0]).toMatchObject({ outcome: "existing", existingPostId: "post-velho" });
    expect(result.toCreate).toEqual([]);
  });

  it("o mesmo código duas vezes no lote é problema", () => {
    const result = plan([item({ clientRef: "X" }), item({ clientRef: "X", mediaAssetId: "a2", scheduledAt: "2026-11-11T13:00:00Z" })]);
    expect(result.items[1].problems).toContain("O código X aparece duas vezes no lote.");
  });

  it("Story não leva legenda e vídeo fora das regras da Meta é barrado", () => {
    const story = plan([item({ mediaType: "STORIES" })]);
    expect(story.toCreate[0].caption).toBeNull();
    const longo = plan([item()], { assets: [asset("a1", { fps: 120 })] });
    expect(longo.items[0].problems).toContain("O vídeo precisa ter entre 23 e 60 FPS.");
  });

  it("null em scheduledAt publica agora", () => {
    expect(plan([item({ scheduledAt: null })]).toCreate[0].scheduled_at).toBe(NOW.toISOString());
  });
});
