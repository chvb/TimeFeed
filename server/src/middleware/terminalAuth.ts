import { Request, Response, NextFunction } from 'express';
import { TerminalDevice, hashTerminalToken } from '../models/TerminalDevice';

/**
 * Geräte-Auth für den Kiosk-Modus (KEIN User-JWT):
 * Header `X-Terminal-Token` → SHA-256-Lookup in terminal_devices.
 * Erfolgreiche Requests setzen req.terminal; lastSeenAt wird gedrosselt
 * aktualisiert (max. 1 Schreibzugriff pro Minute, sonst würde jeder
 * Poll des Kiosks einen DB-Write erzeugen).
 */

declare global {
  namespace Express {
    interface Request {
      terminal?: TerminalDevice;
    }
  }
}

const LAST_SEEN_THROTTLE_MS = 60 * 1000;

export const terminalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.header('X-Terminal-Token');
    if (!token || typeof token !== 'string') {
      return res.status(401).json({ error: 'TERMINAL_TOKEN_REQUIRED', code: 'TERMINAL_TOKEN_REQUIRED', message: 'Terminal-Token fehlt.' });
    }

    const terminal = await TerminalDevice.findOne({ where: { tokenHash: hashTerminalToken(token) } });
    if (!terminal || !terminal.isActive) {
      // Bewusst dieselbe Antwort für „unbekannt" und „deaktiviert" (kein Leak).
      return res.status(401).json({ error: 'TERMINAL_TOKEN_INVALID', code: 'TERMINAL_TOKEN_INVALID', message: 'Terminal-Token ungültig.' });
    }

    const lastSeen = terminal.lastSeenAt ? new Date(terminal.lastSeenAt).getTime() : 0;
    if (Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
      try {
        terminal.lastSeenAt = new Date();
        await terminal.save();
      } catch {
        /* lastSeen ist Best-Effort — Request nicht daran scheitern lassen */
      }
    }

    req.terminal = terminal;
    return next();
  } catch (error) {
    return next(error);
  }
};
