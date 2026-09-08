import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobeStatic from "ffprobe-static";
// Sem "server-only" aqui de propósito: esse módulo usa child_process/fs, que
// já não resolvem num bundle de browser (quebra no build, não silenciosamente),
// e não carrega nenhum segredo — diferente de lib/supabase/admin.ts. O import
// de "server-only" quebra testes rodados fora do bundler do Next (ele só faz
// sentido dentro do webpack/turbopack do Next, não em Node puro via Vitest).

const execFileAsync = promisify(execFile);

export type ProbeResult = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  bitrate: number | null;
  hasAudio: boolean;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string; // ex: "30/1" ou "30000/1001"
  bit_rate?: string;
};

type FfprobeFormat = {
  duration?: string; // segundos, como string
  bit_rate?: string;
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
};

function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!den) return null;
  const fps = num / den;
  return Number.isFinite(fps) ? Math.round(fps * 100) / 100 : null;
}

/**
 * Roda ffprobe (binário estático via ffprobe-static, sem depender de ffmpeg
 * instalado no host) num arquivo já em disco e extrai a metadata técnica.
 * Nunca confia no filename — só olha o conteúdo real do arquivo.
 */
export async function probeMediaFile(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(ffprobeStatic.path, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
  const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");

  const durationSeconds =
    parsed.format?.duration != null ? Number(parsed.format.duration) : null;

  const bitrate =
    videoStream?.bit_rate != null
      ? Number(videoStream.bit_rate)
      : parsed.format?.bit_rate != null
        ? Number(parsed.format.bit_rate)
        : null;

  return {
    durationMs:
      durationSeconds != null && Number.isFinite(durationSeconds)
        ? Math.round(durationSeconds * 1000)
        : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    fps: parseFrameRate(videoStream?.r_frame_rate),
    codec: videoStream?.codec_name ?? null,
    bitrate: bitrate != null && Number.isFinite(bitrate) ? bitrate : null,
    hasAudio: Boolean(audioStream),
  };
}
