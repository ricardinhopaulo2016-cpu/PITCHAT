import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeMediaFile } from "@/lib/media/ffprobe";

const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("probeMediaFile (ffprobe real, não mockado)", () => {
  it(
    "extrai width/height de um PNG 1x1 real gravado em disco",
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "pitchat-ffprobe-"));
      const filePath = join(tempDir, "fixture.png");
      await writeFile(filePath, Buffer.from(MINIMAL_PNG_BASE64, "base64"));

      const result = await probeMediaFile(filePath);

      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      // imagem estática: sem stream de áudio, sem duração/fps de vídeo
      expect(result.hasAudio).toBe(false);
    },
    // Cold start do binário ffprobe (spawn de processo + possível scan de
    // antivírus no Windows) pode passar de 5s na primeira chamada.
    15_000
  );
});
