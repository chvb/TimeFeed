import { CustomValidator } from 'express-validator';
import { SystemSettings } from '../models/SystemSettings';

// Fallback-Mindestlänge, falls (noch) keine Einstellung existiert.
export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

/**
 * Effektive Passwort-Policy aus den Einstellungen: erst die firmenspezifische Zeile,
 * sonst die globale Vorlage (companyId=null). Nur lesend. Fehlt eine Einstellung,
 * gelten die Model-Defaults (min. 8 Zeichen, alle Klassen erforderlich).
 */
export async function getPasswordPolicy(companyId?: number | null): Promise<PasswordPolicy> {
  let s = companyId
    ? await SystemSettings.findOne({ where: { companyId } })
    : null;
  if (!s) s = await SystemSettings.findOne({ where: { companyId: null } });
  const min = Number(s?.passwordMinLength);
  return {
    minLength: Number.isFinite(min) && min >= 4 ? min : PASSWORD_MIN_LENGTH,
    requireUppercase: s?.passwordRequireUppercase ?? true,
    requireLowercase: s?.passwordRequireLowercase ?? true,
    requireNumbers: s?.passwordRequireNumbers ?? true,
    requireSpecialChars: s?.passwordRequireSpecialChars ?? true,
  };
}

/**
 * Prüft ein Passwort gegen eine Policy; wirft mit klarer Meldung beim ersten Verstoß,
 * gibt sonst true zurück. Sonderzeichen = alles außer Buchstaben/Ziffern (Superset der
 * Frontend-Prüfung, damit nichts serverseitig fälschlich abgelehnt wird).
 */
export function assertPassword(value: unknown, p: PasswordPolicy): true {
  if (typeof value !== 'string' || value.length < p.minLength) {
    throw new Error(`Passwort muss mindestens ${p.minLength} Zeichen lang sein`);
  }
  if (p.requireUppercase && !/[A-Z]/.test(value)) {
    throw new Error('Passwort muss mindestens einen Großbuchstaben enthalten');
  }
  if (p.requireLowercase && !/[a-z]/.test(value)) {
    throw new Error('Passwort muss mindestens einen Kleinbuchstaben enthalten');
  }
  if (p.requireNumbers && !/[0-9]/.test(value)) {
    throw new Error('Passwort muss mindestens eine Zahl enthalten');
  }
  if (p.requireSpecialChars && !/[^A-Za-z0-9]/.test(value)) {
    throw new Error('Passwort muss mindestens ein Sonderzeichen enthalten');
  }
  return true;
}

/**
 * express-validator-Custom: erzwingt die KONFIGURIERTE Passwort-Policy (Einstellungen
 * passwordMinLength / passwordRequire*), aufgelöst über die Firma des anfragenden
 * Nutzers (sonst globale Vorlage). Ohne Auth (Registrierung, Passwort-Reset) gilt die
 * globale Vorlage. Deckt sich mit der Anzeige/Prüfung im Frontend (GET /settings).
 */
export const passwordPolicy: CustomValidator = async (value, { req }) => {
  const companyId = (req as any)?.user?.companyId ?? null;
  const policy = await getPasswordPolicy(companyId);
  return assertPassword(value, policy);
};
