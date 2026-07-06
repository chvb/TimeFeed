import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

/**
 * Bricht die Anfrage mit 400 ab, wenn express-validator-Regeln verletzt sind.
 * Hinter die `body()/query()`-Validatoren einer Route hängen.
 */
export const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validierungsfehler', errors: errors.array() });
  }
  return next();
};
