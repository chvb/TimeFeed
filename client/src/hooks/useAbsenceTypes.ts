import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';

/**
 * Abwesenheitsarten-Katalog (GET /api/absence-types) mit Modul-Cache:
 * Badges/Selects (MyTimes, Zeiten verwalten, Export-Mapping) teilen sich EINEN
 * Request pro Session; `reload()` invalidiert nach CRUD-Änderungen.
 */
export interface AbsenceTypeItem {
  id: number;
  companyId: number | null;
  key: string;
  label: string;
  color: string; // Hex (#rrggbb)
  datevKennzeichen: string;
  isBuiltin: boolean;
  isActive: boolean;
  sortOrder: number;
}

let cache: AbsenceTypeItem[] | null = null;
let palette: string[] = [];
let inflight: Promise<AbsenceTypeItem[]> | null = null;
const listeners = new Set<() => void>();

export function absenceTypePalette(): string[] {
  return palette;
}

export async function fetchAbsenceTypes(force = false): Promise<AbsenceTypeItem[]> {
  if (cache && !force) return cache;
  if (!inflight || force) {
    inflight = api.get('/absence-types')
      .then((r) => {
        cache = (r.data?.absenceTypes || []) as AbsenceTypeItem[];
        palette = r.data?.palette || [];
        listeners.forEach((fn) => fn());
        return cache;
      })
      .catch(() => cache || [])
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function invalidateAbsenceTypes(): void {
  cache = null;
}

export function useAbsenceTypes(): { types: AbsenceTypeItem[]; reload: () => Promise<void> } {
  const [types, setTypes] = useState<AbsenceTypeItem[]>(cache || []);

  useEffect(() => {
    let active = true;
    const update = () => { if (active && cache) setTypes(cache); };
    listeners.add(update);
    fetchAbsenceTypes().then((t) => { if (active) setTypes(t); });
    return () => { active = false; listeners.delete(update); };
  }, []);

  const reload = useCallback(async () => {
    await fetchAbsenceTypes(true);
    if (cache) setTypes(cache);
  }, []);

  return { types, reload };
}
