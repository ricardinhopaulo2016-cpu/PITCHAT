/** Teto "redondo" do eixo: 1, 2, 5 e 10 vezes a potência de dez. */
export function niceCeil(max: number): number {
  if (max <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 5, 10].find((step) => step * magnitude >= max) ?? 10) * magnitude;
}

/** Contagens não têm meio-ponto: a marca do meio só entra se for inteira. */
export function axisTicks(ceiling: number): number[] {
  const middle = ceiling / 2;
  return Number.isInteger(middle) ? [ceiling, middle, 0] : [ceiling, 0];
}

/** Índices com rótulo no eixo X. O último dia sempre aparece. */
export function xTickIndexes(count: number, maxTicks = 7): number[] {
  const step = Math.max(1, Math.ceil(count / maxTicks));
  return Array.from({ length: count }, (_, index) => index).filter((index) => (count - 1 - index) % step === 0);
}

/** Centro da coluna do índice, em porcentagem da largura do gráfico. */
export function chartX(index: number, count: number): number {
  return ((index + 0.5) / count) * 100;
}

export type TooltipSide = "right" | "center" | "left";

/**
 * Para onde a dica abre sem sair do painel no celular. Os limites não são
 * simétricos porque à esquerda do gráfico ainda há a coluna do eixo Y.
 */
export function tooltipSide(index: number, count: number): TooltipSide {
  const x = chartX(index, count);
  if (x < 25) return "right";
  return x < 70 ? "center" : "left";
}

export function chartY(value: number, ceiling: number): number {
  return 100 - (value / ceiling) * 100;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Caminho SVG em viewBox 100x100. Dia sem dado interrompe a linha: nunca vira zero. */
export function linePath(values: (number | null)[], ceiling: number): string {
  const parts: string[] = [];
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    parts.push(`${drawing ? "L" : "M"}${round(chartX(index, values.length))} ${round(chartY(value, ceiling))}`);
    drawing = true;
  });
  return parts.join(" ");
}

/** Pontos sem vizinho com dado: sem marcador, nem apareceriam como linha. */
export function isolatedIndexes(values: (number | null)[]): number[] {
  return values.flatMap((value, index) => (value !== null && (values[index - 1] ?? null) === null && (values[index + 1] ?? null) === null ? [index] : []));
}
