import { passwordPolicy, PASSWORD_MIN_LENGTH } from './passwordPolicy';

// passwordPolicy ist ein express-validator CustomValidator: wirft bei Verstoß,
// gibt sonst true zurück.
describe('passwordPolicy', () => {
  const ok = 'GutesPw12!';

  it('akzeptiert ein gültiges Passwort (Buchstabe + Zahl + Sonderzeichen, lang genug)', () => {
    expect(passwordPolicy(ok, {} as any)).toBe(true);
  });

  it('lehnt zu kurze Passwörter ab', () => {
    expect(() => passwordPolicy('Ab1!', {} as any)).toThrow();
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(8);
  });

  it('verlangt mindestens einen Buchstaben', () => {
    expect(() => passwordPolicy('12345678!', {} as any)).toThrow();
  });

  it('verlangt mindestens eine Zahl', () => {
    expect(() => passwordPolicy('OhneZahl!!', {} as any)).toThrow();
  });

  it('verlangt mindestens ein Sonderzeichen', () => {
    expect(() => passwordPolicy('OhneZeichen123', {} as any)).toThrow();
  });
});
