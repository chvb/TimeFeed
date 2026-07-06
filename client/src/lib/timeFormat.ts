// Format-Helfer für die Zeiterfassung: Minuten <-> "H:MM"-Darstellung.

/** Minuten (>= 0) als "H:MM" (z. B. 450 → "7:30"). */
export function minutesToHM(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Dauer in Minuten als "7:30 h". */
export function formatMinutes(min: number): string {
  return `${minutesToHM(min)} h`;
}

/** Saldo in Minuten mit Vorzeichen als "+12:45 h" / "-3:20 h". */
export function formatSignedMinutes(min: number): string {
  const sign = Math.round(min) < 0 ? '-' : '+';
  return `${sign}${minutesToHM(Math.abs(min))} h`;
}

/** Minuten als "HH:MM"-Eingabewert (z. B. 480 → "08:00"). */
export function minutesToHHMMInput(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "HH:MM" (oder "H:MM") in Minuten; null bei ungültiger Eingabe. Leer = 0. */
export function hhmmToMinutes(value: string): number | null {
  const v = value.trim();
  if (v === '') return 0;
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(v);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Uhrzeit (Datum/ISO-String) als "HH:MM"; '–' wenn leer. */
export function timeHHMM(d: string | Date | null | undefined, locale = 'de-DE'): string {
  if (!d) return '–';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '–';
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
