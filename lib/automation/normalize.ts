/**
 * Normalização de texto para keyword matching (comentários/mensagens).
 * Objetivo: minimizar falsos positivos, não maximizar recall — por isso não
 * fazemos fuzzy matching agressivo aqui (ver docs/PITCHAT_ARCHITECTURE.md §9
 * e a seção 10 do briefing original).
 *
 * Pipeline: lowercase -> trim -> remover acentos (opcional) -> colapsar
 * espaços -> remover pontuação nas bordas de cada palavra.
 */
export type NormalizeOptions = {
  /** Remove acentos (á -> a). Default: true. */
  stripAccents?: boolean;
};

export function normalizeText(input: string, options: NormalizeOptions = {}): string {
  const { stripAccents = true } = options;

  let text = input.toLowerCase().trim();

  if (stripAccents) {
    // NFD splits "á" into "a" + U+0301 (combining acute accent); strip the
    // whole combining-diacritical-marks block (U+0300–U+036F) that follows.
    text = text.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
  }

  // Colapsa qualquer whitespace (espaço, tab, quebra de linha) em um espaço só.
  text = text.replace(/\s+/g, " ");

  // Remove pontuação comum que não muda o sentido da keyword (!!!, ??, ..., etc),
  // mas preserva letras/números/espaço — não mexe em unicode fora do alfabeto latino.
  text = text.replace(/[!?.,;:"'()[\]{}]+/g, "");

  return text.trim();
}

export type KeywordMatchType = "EXACT" | "CONTAINS";

export type Keyword = {
  value: string;
  matchType: KeywordMatchType;
};

/**
 * Retorna a primeira keyword que casou com o texto (já normalizando ambos os
 * lados), ou null. A ordem da lista importa — keywords mais específicas devem
 * vir primeiro se puderem colidir.
 */
export function matchKeyword(text: string, keywords: Keyword[]): Keyword | null {
  const normalizedText = normalizeText(text);

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword.value);
    if (!normalizedKeyword) continue;

    if (keyword.matchType === "EXACT" && normalizedText === normalizedKeyword) {
      return keyword;
    }

    if (keyword.matchType === "CONTAINS" && normalizedText.includes(normalizedKeyword)) {
      return keyword;
    }
  }

  return null;
}
