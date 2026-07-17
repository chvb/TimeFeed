// Serialisiert Operationen pro Schlüssel (z. B. userId) INNERHALB dieses Prozesses.
// Verhindert TOCTOU-Races beim Stempeln (zwei gleichzeitige Anfragen lesen denselben
// Zustand und legen einen ungültigen Ablauf an, z. B. doppeltes „in"). Für die aktuelle
// Single-Process-Bereitstellung ausreichend; bei Mehr-Prozess-Betrieb bräuchte es ein
// verteiltes Lock (DB/Redis).
const chains = new Map<string, Promise<unknown>>();

export function withUserLock<T>(key: string | number, fn: () => Promise<T>): Promise<T> {
  const k = String(key);
  const prev = chains.get(k) ?? Promise.resolve();
  const result = prev.then(() => fn());
  // Fehler für die Kette schlucken, damit ein Fehlschlag nachfolgende Aufrufe nicht bricht.
  const tail = result.then(() => {}, () => {});
  chains.set(k, tail);
  // Aufräumen, wenn niemand mehr hinter uns wartet (kein Speicherleck).
  tail.finally(() => { if (chains.get(k) === tail) chains.delete(k); });
  return result;
}
