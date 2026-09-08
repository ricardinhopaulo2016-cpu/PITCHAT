import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffprobe-static resolve o binário via __dirname em runtime (nunca via
  // require/import direto), então o tracer de arquivos serverless da Vercel
  // pode não incluir o binário automaticamente — força a inclusão pra rota
  // que roda ffprobe. Ver docs/PITCHAT_ARCHITECTURE.md (Media Library, Fase 2).
  outputFileTracingIncludes: {
    "/api/media/finalize": ["./node_modules/ffprobe-static/bin/**/*"],
  },
};

export default nextConfig;
