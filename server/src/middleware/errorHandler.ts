import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // body-parser: Payload über dem Limit → 413 statt generischem 500.
  if ((err as any)?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Die Datei ist zu groß (max. ca. 2 MB für Logos).' });
  }
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      error: err.message, // Alias: einige Clients lesen `error`, andere `message`
    });
  }

  // Sequelize-Fehler auf passende 4xx-Codes abbilden statt generisch 500.
  const anyErr = err as any;
  if (anyErr.name === 'SequelizeUniqueConstraintError') {
    const field = anyErr.errors?.[0]?.path;
    const msg = field ? `Wert bereits vergeben (${field})` : 'Eintrag existiert bereits';
    return res.status(409).json({ status: 'error', message: msg, error: msg });
  }
  if (anyErr.name === 'SequelizeValidationError') {
    const msg = anyErr.errors?.[0]?.message || 'Validierungsfehler';
    return res.status(400).json({ status: 'error', message: msg, error: msg });
  }

  console.error('Error:', err);

  return res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    error: 'Internal server error',
  });
};