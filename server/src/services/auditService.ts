import { Request } from 'express';
import { AuditLog, AuditAction, AuditCategory } from '../models/AuditLog';

interface AuditLogData {
  userId?: number;
  action: AuditAction;
  category: AuditCategory;
  entity?: string;
  entityId?: number;
  oldValues?: any;
  newValues?: any;
  success?: boolean;
  errorMessage?: string;
  additionalData?: any;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  static async log(data: AuditLogData, req?: Request): Promise<void> {
    try {
      const auditData = {
        ...data,
        ipAddress: req?.ip || req?.connection.remoteAddress,
        userAgent: req?.get('User-Agent'),
        oldValues: data.oldValues ? JSON.stringify(data.oldValues) : undefined,
        newValues: data.newValues ? JSON.stringify(data.newValues) : undefined,
        additionalData: data.additionalData ? JSON.stringify(data.additionalData) : undefined,
        success: data.success !== undefined ? data.success : true,
      };

      await AuditLog.create(auditData);
    } catch (error) {
      console.error('Failed to create audit log:', error);
      // Don't throw error to avoid breaking the main operation
    }
  }

  static async logLogin(userId: number, success: boolean, req?: Request, errorMessage?: string): Promise<void> {
    await this.log({
      userId,
      action: success ? AuditAction.LOGIN : AuditAction.LOGIN_FAILED,
      category: AuditCategory.AUTHENTICATION,
      success,
      errorMessage,
      additionalData: { timestamp: new Date().toISOString() }
    }, req);
  }

  static async logLogout(userId: number, req?: Request): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.LOGOUT,
      category: AuditCategory.AUTHENTICATION,
      additionalData: { timestamp: new Date().toISOString() }
    }, req);
  }

  static async logUserChange(
    action: AuditAction,
    userId: number,
    targetUserId: number,
    oldValues?: any,
    newValues?: any,
    req?: Request
  ): Promise<void> {
    await this.log({
      userId,
      action,
      category: AuditCategory.USER_MANAGEMENT,
      entity: 'User',
      entityId: targetUserId,
      oldValues,
      newValues,
    }, req);
  }

  static async logSettingsChange(
    userId: number,
    oldValues: any,
    newValues: any,
    req?: Request
  ): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.SETTINGS_UPDATE,
      category: AuditCategory.SYSTEM_SETTINGS,
      entity: 'SystemSettings',
      oldValues,
      newValues,
    }, req);
  }

  static async logPasswordChange(userId: number, req?: Request): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.PASSWORD_CHANGE,
      category: AuditCategory.SECURITY,
      additionalData: { timestamp: new Date().toISOString() }
    }, req);
  }

  static async logHolidayRefresh(userId: number, year: number, count: number, req?: Request): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.HOLIDAY_REFRESH,
      category: AuditCategory.DATA_MANAGEMENT,
      entity: 'Holiday',
      additionalData: { year, holidayCount: count }
    }, req);
  }
}