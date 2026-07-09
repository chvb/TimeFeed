import { assertPassword, PasswordPolicy, PASSWORD_MIN_LENGTH } from './passwordPolicy';

// assertPassword prüft ein Passwort gegen eine explizite Policy: wirft bei Verstoß,
// gibt sonst true zurück. (Der express-validator-Custom `passwordPolicy` lädt die
// Policy zusätzlich aus den Einstellungen — hier ohne DB die reine Logik getestet.)
describe('assertPassword', () => {
  const strict: PasswordPolicy = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
  };

  it('akzeptiert ein Passwort, das alle Anforderungen erfüllt', () => {
    expect(assertPassword('GutesPw12!', strict)).toBe(true);
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(8);
  });

  it('lehnt zu kurze Passwörter ab', () => {
    expect(() => assertPassword('Ab1!', strict)).toThrow();
  });

  it('verlangt Groß-/Kleinbuchstaben, Zahl und Sonderzeichen, wenn aktiviert', () => {
    expect(() => assertPassword('nurklein12!', strict)).toThrow(); // kein Großbuchstabe
    expect(() => assertPassword('NURGROSS12!', strict)).toThrow(); // kein Kleinbuchstabe
    expect(() => assertPassword('OhneZahl!!Ab', strict)).toThrow(); // keine Zahl
    expect(() => assertPassword('OhneZeichen12', strict)).toThrow(); // kein Sonderzeichen
  });

  it('respektiert deaktivierte Anforderungen', () => {
    const lax: PasswordPolicy = {
      minLength: 6,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: false,
      requireSpecialChars: false,
    };
    // Nur Länge zählt → einfaches Passwort ist gültig.
    expect(assertPassword('abcdef', lax)).toBe(true);
    expect(() => assertPassword('abc', lax)).toThrow();
  });

  it('respektiert eine höhere Mindestlänge', () => {
    const long: PasswordPolicy = { ...strict, minLength: 12 };
    expect(() => assertPassword('GutesPw12!', long)).toThrow(); // 10 < 12
    expect(assertPassword('GutesPw12!xyz', long)).toBe(true);   // 13 >= 12
  });
});
