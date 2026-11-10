/**
 * Horários da tela de lote. Os valores são os do input datetime-local
 * ("2026-11-12T08:00"), no fuso do navegador.
 */

export type ScheduleSlot = { accountId: string; when: string };

/** "2026-11-12T08:00" mais N minutos, no mesmo formato. */
export function addMinutesLocal(value: string, minutes: number): string {
  const base = new Date(value);
  if (Number.isNaN(base.getTime())) return value;
  const d = new Date(base.getTime() + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Distribui os horários na ordem da tabela. O intervalo conta por conta: cada
 * conta começa no horário inicial e o vídeo seguinte da mesma conta sai
 * `intervalMinutes` depois. Assim, 3 vídeos em 3 contas saem juntos, e 3 vídeos
 * na mesma conta saem espaçados.
 */
export function distributeSchedule(rows: { accountId: string }[], start: string, intervalMinutes: number): string[] {
  const countByAccount = new Map<string, number>();
  return rows.map((row) => {
    const n = countByAccount.get(row.accountId) ?? 0;
    countByAccount.set(row.accountId, n + 1);
    return addMinutesLocal(start, n * intervalMinutes);
  });
}
