import { CustomValidator } from 'express-validator';

// Mindestlänge für Passwörter. Bewusst moderat, kombiniert mit Komplexität.
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Erzwingt: Mindestlänge + mindestens ein Buchstabe, eine Zahl und ein
 * Sonderzeichen. Als express-validator-Custom in den Routen verwendbar.
 */
export const passwordPolicy: CustomValidator = (value) => {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen lang sein`);
  }
  if (!/[A-Za-z]/.test(value)) {
    throw new Error('Passwort muss mindestens einen Buchstaben enthalten');
  }
  if (!/[0-9]/.test(value)) {
    throw new Error('Passwort muss mindestens eine Zahl enthalten');
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    throw new Error('Passwort muss mindestens ein Sonderzeichen enthalten');
  }
  return true;
};
