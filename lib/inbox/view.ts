/** Regras puras da tela da Caixa de entrada, separadas dos componentes para teste. */

/** Algum campo ainda tem texto digitado que não foi enviado? */
export function hasDraftText(fields: Iterable<{ value: string }>): boolean {
  for (const field of fields) {
    if (field.value.trim() !== "") return true;
  }
  return false;
}

const NEAR_END_PX = 120;

/** A thread está no fim, ou perto o bastante para acompanhar o que chegar? */
export function isNearScrollEnd(position: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return position.scrollHeight - position.scrollTop - position.clientHeight <= NEAR_END_PX;
}
