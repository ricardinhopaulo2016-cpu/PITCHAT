export type FlowBucket = { inbound: number; inbound_clicks: number; outbound_automation: number; outbound_manual: number };
export type HourBucket = FlowBucket & { hour: string };

/** `inbound_clicks` já está dentro de `inbound`, então não entra na soma. */
export function bucketTotal(b: FlowBucket): number {
  return b.inbound + b.outbound_automation + b.outbound_manual;
}

export function sumBuckets(rows: FlowBucket[]): FlowBucket {
  const total: FlowBucket = { inbound: 0, inbound_clicks: 0, outbound_automation: 0, outbound_manual: 0 };
  for (const row of rows) {
    total.inbound += row.inbound;
    total.inbound_clicks += row.inbound_clicks;
    total.outbound_automation += row.outbound_automation;
    total.outbound_manual += row.outbound_manual;
  }
  return total;
}

export function findPeak(byHour: HourBucket[]): { hour: string; total: number } | null {
  let peak: { hour: string; total: number } | null = null;
  for (const bucket of byHour) {
    const total = bucketTotal(bucket);
    if (total === 0) continue;
    if (!peak || total > peak.total || (total === peak.total && bucket.hour < peak.hour)) {
      peak = { hour: bucket.hour, total };
    }
  }
  return peak;
}

/** `2026-11-08T14` vira `08/11 às 14h`. */
export function formatPeakHour(hour: string): string {
  return `${hour.slice(8, 10)}/${hour.slice(5, 7)} às ${hour.slice(11, 13)}h`;
}

/** Horas com mensagem e a média delas. Hora sem mensagem não entra na média. */
export function hourStats(byHour: HourBucket[]): { activeHours: number; averageHourly: number | null } {
  const totals = byHour.map(bucketTotal).filter((total) => total > 0);
  if (totals.length === 0) return { activeHours: 0, averageHourly: null };
  return { activeHours: totals.length, averageHourly: totals.reduce((sum, total) => sum + total, 0) / totals.length };
}

export function hourOfDayProfile(byHour: HourBucket[]): (FlowBucket & { hourOfDay: number })[] {
  const profile = Array.from({ length: 24 }, (_, hourOfDay) => ({
    hourOfDay,
    inbound: 0,
    inbound_clicks: 0,
    outbound_automation: 0,
    outbound_manual: 0,
  }));
  for (const bucket of byHour) {
    const slot = profile[Number(bucket.hour.slice(11, 13))];
    if (!slot) continue;
    slot.inbound += bucket.inbound;
    slot.inbound_clicks += bucket.inbound_clicks;
    slot.outbound_automation += bucket.outbound_automation;
    slot.outbound_manual += bucket.outbound_manual;
  }
  return profile;
}

export type RawQueue = {
  queued_count: number;
  queued_oldest_at: string | null;
  waiting_delay: number;
  waiting_retry: number;
  waiting_oldest_at: string | null;
  waiting_quick_reply: number;
};

export type QueueState = {
  messageQueue: { kind: "not_recorded" } | { kind: "active"; count: number; oldestMinutes: number | null };
  runs: { delay: number; retry: number; oldestMinutes: number | null };
  awaitingPerson: number;
};

function ageInMinutes(iso: string | null, nowIso: string): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60_000));
}

export function buildQueueState(raw: RawQueue, nowIso: string): QueueState {
  return {
    messageQueue:
      raw.queued_count === 0
        ? { kind: "not_recorded" }
        : { kind: "active", count: raw.queued_count, oldestMinutes: ageInMinutes(raw.queued_oldest_at, nowIso) },
    runs: { delay: raw.waiting_delay, retry: raw.waiting_retry, oldestMinutes: ageInMinutes(raw.waiting_oldest_at, nowIso) },
    awaitingPerson: raw.waiting_quick_reply,
  };
}

export type RawFlow = {
  by_day: (FlowBucket & { day: string })[];
  by_hour: HourBucket[];
  by_account: (FlowBucket & { social_account_id: string })[];
  by_automation: { automation_id: string; name: string; status: string; outbound: number }[];
  outbound_automation_unlinked: number;
  queue: RawQueue;
};
