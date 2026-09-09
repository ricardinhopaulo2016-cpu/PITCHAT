/**
 * Versão da Instagram/Graph API usada em toda chamada versionada — nunca
 * hardcode "v25.0"/"v26.0" direto numa URL, sempre passe por aqui. Lida em
 * runtime (não é module-level const resolvido só no import) pra refletir
 * mudança de env sem precisar de novo build. Ver docs/PITCHAT_META_INTEGRATION.md §9.
 */
const DEFAULT_GRAPH_API_VERSION = "v26.0";

export function getGraphApiVersion(): string {
  return process.env.META_API_VERSION || DEFAULT_GRAPH_API_VERSION;
}
