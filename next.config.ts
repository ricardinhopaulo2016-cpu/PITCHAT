import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffprobe-static resolve o binário via __dirname em runtime. Sem isso, o
  // bundler (Turbopack/webpack) empacota o pacote e reescreve __dirname pra
  // um placeholder que não existe em disco (`\ROOT\...`), quebrando o spawn
  // do binário com ENOENT — reproduzido de verdade rodando `next build` +
  // `next start` (não aparece em `next dev`/testes unitários isolados,
  // porque aí o módulo não passa pelo bundler de produção). serverExternalPackages
  // marca o pacote como externo: Next faz `require()` normal em runtime, sem
  // tocar no __dirname dele.
  serverExternalPackages: ["ffprobe-static"],
  // Ainda assim garante que o binário seja copiado pro output rastreado
  // (necessário em deploy serverless tipo Vercel, onde só o que é rastreado
  // vai pro bundle da function).
  outputFileTracingIncludes: {
    "/api/media/finalize": ["./node_modules/ffprobe-static/bin/**/*"],
  },
};

export default nextConfig;
