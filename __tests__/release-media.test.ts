import { describe, expect, it, vi } from "vitest";
import { releaseMediaFile, type ReleaseMediaDeps } from "@/lib/publishing/release-media";

function makeDeps(overrides: Partial<ReleaseMediaDeps> = {}) {
  const calls: string[] = [];
  const deps: ReleaseMediaDeps = {
    claimFileRemoval: vi.fn(async () => {
      calls.push("claim");
      return "ws/asset-1.mp4";
    }),
    countPostsNeedingFile: vi.fn(async () => {
      calls.push("count");
      return 0;
    }),
    removeFile: vi.fn(async () => {
      calls.push("remove");
    }),
    undoClaim: vi.fn(async () => {
      calls.push("undo");
    }),
    ...overrides,
  };
  return { deps, calls };
}

describe("releaseMediaFile", () => {
  it("apaga o arquivo quando nenhum post precisa mais dele", async () => {
    const { deps, calls } = makeDeps();
    await expect(releaseMediaFile(deps, "asset-1")).resolves.toBe("removed");
    expect(deps.removeFile).toHaveBeenCalledWith("ws/asset-1.mp4");
    // Marca antes de contar, e só apaga depois de contar: assim post novo no meio do caminho é visto.
    expect(calls).toEqual(["claim", "count", "remove"]);
  });

  it("mantém o arquivo quando ainda há post agendado, publicando ou com erro", async () => {
    const { deps, calls } = makeDeps({ countPostsNeedingFile: vi.fn(async () => 2) });
    await expect(releaseMediaFile(deps, "asset-1")).resolves.toBe("still_needed");
    expect(deps.removeFile).not.toHaveBeenCalled();
    expect(calls).toContain("undo");
  });

  it("não faz nada quando o arquivo já tinha sido apagado", async () => {
    const { deps } = makeDeps({ claimFileRemoval: vi.fn(async () => null) });
    await expect(releaseMediaFile(deps, "asset-1")).resolves.toBe("already_removed");
    expect(deps.countPostsNeedingFile).not.toHaveBeenCalled();
    expect(deps.removeFile).not.toHaveBeenCalled();
  });

  it("na dúvida o arquivo fica: erro ao contar não apaga e desfaz a marca", async () => {
    const { deps } = makeDeps({
      countPostsNeedingFile: vi.fn(async () => {
        throw new Error("banco fora");
      }),
    });
    await expect(releaseMediaFile(deps, "asset-1")).rejects.toThrow("banco fora");
    expect(deps.removeFile).not.toHaveBeenCalled();
    expect(deps.undoClaim).toHaveBeenCalledWith("asset-1");
  });

  it("se o Storage recusar apagar, desfaz a marca e não finge que apagou", async () => {
    const { deps } = makeDeps({
      removeFile: vi.fn(async () => {
        throw new Error("storage fora");
      }),
    });
    await expect(releaseMediaFile(deps, "asset-1")).resolves.toBe("remove_failed");
    expect(deps.undoClaim).toHaveBeenCalledWith("asset-1");
  });

  it("falha ao desfazer a marca não esconde o erro original", async () => {
    const { deps } = makeDeps({
      countPostsNeedingFile: vi.fn(async () => {
        throw new Error("banco fora");
      }),
      undoClaim: vi.fn(async () => {
        throw new Error("undo falhou");
      }),
    });
    await expect(releaseMediaFile(deps, "asset-1")).rejects.toThrow("banco fora");
  });
});
