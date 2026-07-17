import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { NFC_STAMP_SCOPE } from '../controllers/nfc.controller';

/**
 * Prüft eine per NFC-Exchange ausgestellte, auf Stempeln begrenzte Sitzung
 * (JWT mit scope nfc:stamp). Setzt req.user wie authenticate, damit die
 * bestehenden Stempel-Handler unverändert wiederverwendet werden können.
 */
export const nfcStampAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error();
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as any;
    if (decoded.scope !== NFC_STAMP_SCOPE) throw new Error();

    const user = await User.findByPk(decoded.id);
    if (!user || !user.isActive) throw new Error();
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) throw new Error();

    req.user = {
      id: user.id, email: user.email, role: user.role,
      companyId: user.companyId ?? null, tenantId: user.tenantId ?? null,
      isSuperAdmin: !!user.isSuperAdmin,
    };
    // Für die Aktionsmeldung ans Hub-Audit (Rückkanal) verfügbar machen.
    (req as any).nfcPublicId = user.hubPersonId || '';
    next();
  } catch {
    res.status(401).json({ error: 'Bitte Chip erneut scannen.', message: 'Bitte Chip erneut scannen.' });
  }
};
