// Conversão de data/hora "de parede" em um fuso IANA (ex.: America/Sao_Paulo) para UTC,
// sem depender do fuso do servidor.
export const TZ = 'America/Sao_Paulo';

function offsetMinutes(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}

/** "2026-11-20T09:00" (horário de Brasília) -> Date em UTC. */
export function zonedToUtc(local, tz = TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let d = new Date(guess - offsetMinutes(new Date(guess), tz) * 60000);
  d = new Date(guess - offsetMinutes(d, tz) * 60000); // 2ª passada cobre mudanças de horário de verão
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatLocal(date, tz = TZ) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date(date));
}
