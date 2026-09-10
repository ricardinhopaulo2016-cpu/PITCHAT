/**
 * Bloco de carregamento ESTÁTICO — sem shimmer/gradiente animado (é o
 * clichê de loading mais comum de SaaS-de-IA, ver docs/PITCHAT_DESIGN_SYSTEM.md
 * §3). Só ocupa o espaço da forma final, sem chamar atenção pra si mesmo.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={`rounded-[var(--radius-panel-sm)] bg-surface-2 ${className ?? ""}`} />;
}
