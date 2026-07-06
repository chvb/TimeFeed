import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '../models/User';

interface JwtPayload {
  id: number;
  email: string;
  role: UserRole;
  // Mandanten-Kontext (frisch aus der DB, nicht aus dem Token):
  companyId?: number | null;
  tenantId?: number | null;
  isSuperAdmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      throw new Error();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    const user = await User.findByPk(decoded.id);

    if (!user || !user.isActive) {
      throw new Error();
    }

    // Frische Rolle/Identität aus der DB verwenden (nicht die ggf. veraltete
    // Rolle aus dem Token — z.B. nach Herabstufung).
    req.user = { id: user.id, email: user.email, role: user.role, companyId: user.companyId ?? null, tenantId: user.tenantId ?? null, isSuperAdmin: !!user.isSuperAdmin };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate.', message: 'Please authenticate.' });
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.', message: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.', message: 'Insufficient permissions.' });
    }

    return next();
  };
};

/** Nur für instanzweite Super-Admins (Tenant-/Plattform-Verwaltung). */
export const authorizeSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.', message: 'Authentication required.' });
  }
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ error: 'Super-Admin required.', message: 'Super-Admin required.' });
  }
  return next();
};

/** Super-Admin ODER Mandanten-Admin (admin/buchhaltung mit Tenant, ohne feste Firma) – für Firmen-Verwaltung. */
export const authorizeCompanyManager = (req: Request, res: Response, next: NextFunction) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Authentication required.', message: 'Authentication required.' });
  const isTenantAdmin = (u.role === UserRole.ADMIN || u.role === UserRole.BUCHHALTUNG) && !!u.tenantId && !u.companyId;
  if (!u.isSuperAdmin && !isTenantAdmin) {
    return res.status(403).json({ error: 'Not authorized.', message: 'Not authorized.' });
  }
  return next();
};