import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { Group } from '../models/Group';
import { User, UserRole } from '../models/User';
import { GroupManager } from '../models/GroupManager';
import { Op } from 'sequelize';
import { AppError } from '../middleware/errorHandler';
import { moveToTrash } from '../services/trashService';
import { getEffectiveActor, getCompanyScopeWhere, canReadCompanyRecord, canManageCompanyRecord, canActorAccessUser, resolveWritableCompanyId } from '../services/accessScope';
import { validateTimeModelAssignment } from './timeModel.controller';
import { validateSurchargeProfileAssignment } from './surchargeProfile.controller';

export class GroupController {
  async getAllGroups(req: Request, res: Response, next: NextFunction) {
    try {
      const groups = await Group.findAll({
        where: getCompanyScopeWhere(getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId)), // nur Gruppen der eigenen Firma (Super-Admin: alle)
        include: [
          { model: User, as: 'manager', attributes: ['id', 'firstName', 'lastName'], required: false },
          { model: User, as: 'managers', attributes: ['id', 'firstName', 'lastName'], required: false },
          { model: User, as: 'members', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
          { model: Group, as: 'parentGroup', attributes: ['id', 'name'], required: false },
          { model: Group, as: 'subGroups', attributes: ['id', 'name'], required: false },
        ],
        order: [['name', 'ASC']],
      });

      res.json({ groups });
    } catch (error) {
      next(error);
    }
  }

  async getGroupById(req: Request, res: Response, next: NextFunction) {
    try {
      const group = await Group.findByPk(req.params.id, {
        include: [
          { model: User, as: 'manager', attributes: ['id', 'firstName', 'lastName', 'email'] },
          { model: User, as: 'managers', attributes: ['id', 'firstName', 'lastName', 'email'] },
          { model: User, as: 'members', attributes: ['id', 'firstName', 'lastName', 'email', 'role'] },
          { model: Group, as: 'parentGroup' },
          { model: Group, as: 'subGroups' },
        ],
      });

      if (!group || !(await canReadCompanyRecord(req.user!, (group as any).companyId))) {
        return next(new AppError(404, 'Group not found'));
      }

      res.json({ group });
    } catch (error) {
      next(error);
    }
  }

  async createGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, managerId, managerIds, parentGroupId } = req.body;

      // Firma der neuen Gruppe: Super-Admin darf wählen, sonst eigene Firma.
      const companyId = await resolveWritableCompanyId(req.user!, req.body.companyId);

      // Gruppenname nur innerhalb der Firma eindeutig (auch bei companyId=NULL korrekt geprüft).
      const existingGroup = await Group.findOne({ where: { name, companyId: companyId ?? null } });
      if (existingGroup) {
        return next(new AppError(400, 'Group name already exists'));
      }

      // Validate manager IDs if provided
      const managersToSet = managerIds && managerIds.length > 0 ? managerIds : (managerId ? [managerId] : []);
      if (managersToSet.length > 0) {
        const found = await User.count({ where: { id: { [Op.in]: managersToSet } } });
        if (found !== new Set(managersToSet).size) {
          return next(new AppError(404, 'Mindestens eine Manager-ID wurde nicht gefunden'));
        }
        // Manager nur aus dem eigenen Scope (keine firmenfremden Manager zuweisen).
        for (const mid of managersToSet) {
          if (!(await canActorAccessUser(req.user!, Number(mid)))) return next(new AppError(403, 'Manager außerhalb Ihres Bereichs'));
        }
      }

      if (parentGroupId) {
        const parentGroup = await Group.findByPk(parentGroupId);
        if (!parentGroup || !(await canReadCompanyRecord(req.user!, (parentGroup as any).companyId))) {
          return next(new AppError(404, 'Parent group not found'));
        }
      }

      // Zeitmodell (optional): muss existieren und zur Firma der Gruppe gehören.
      let timeModelId: number | null = null;
      if (req.body.timeModelId !== undefined) {
        timeModelId = await validateTimeModelAssignment(req.body.timeModelId, companyId ?? null);
      }
      // Zuschlagsprofil (optional): gleiches Muster wie das Zeitmodell.
      let surchargeProfileId: number | null = null;
      if (req.body.surchargeProfileId !== undefined) {
        surchargeProfileId = await validateSurchargeProfileAssignment(req.body.surchargeProfileId, companyId ?? null);
      }

      const group = await Group.create({
        name,
        description,
        companyId,
        timeModelId,
        surchargeProfileId,
        managerId: managersToSet.length > 0 ? managersToSet[0] : undefined, // Keep first manager for backward compatibility
        parentGroupId,
      });

      // Set multiple managers using the many-to-many relationship
      if (managersToSet.length > 0) {
        await group.setManagers(managersToSet);
      }

      res.status(201).json({ 
        message: 'Group created successfully',
        group 
      });
    } catch (error) {
      next(error);
    }
  }

  async updateGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const group = await Group.findByPk(req.params.id);
      if (!group || !(await canManageCompanyRecord(req.user!, (group as any).companyId))) {
        return next(new AppError(404, 'Group not found'));
      }

      if (req.user!.role === UserRole.VERWALTUNG) {
        // Auch m:n-zugeordnete Manager (GroupManager) dürfen, nicht nur der legacy managerId.
        const isManagerOfGroup =
          group.managerId === req.user!.id ||
          !!(await GroupManager.findOne({ where: { groupId: group.id, userId: req.user!.id } }));
        if (!isManagerOfGroup) {
          return next(new AppError(403, 'Not authorized to update this group'));
        }
      }

      const { name, description, managerId, managerIds, parentGroupId } = req.body;

      // Ziel-Firma bestimmen (Super-Admin kann sie mit-ändern). Der Dup-Check muss gegen
      // die ZIEL-Firma laufen, sonst lässt sich ein Name in eine fremde Firma (oder nach null)
      // verschieben, in der er bereits existiert. company_id=NULL hat keinen DB-Unique-Schutz.
      const currentCompanyId = (group as any).companyId ?? null;
      const targetCompanyId = (req.user!.isSuperAdmin && req.body.companyId !== undefined)
        ? (req.body.companyId ?? null)
        : currentCompanyId;
      const nameChanged = !!name && name !== group.name;
      const companyChanged = targetCompanyId !== currentCompanyId;
      if (nameChanged || companyChanged) {
        const existingGroup = await Group.findOne({ where: { name: name || group.name, companyId: targetCompanyId, id: { [Op.ne]: group.id } } });
        if (existingGroup) {
          return next(new AppError(400, 'Group name already exists'));
        }
      }
      if (nameChanged) group.name = name;

      if (description !== undefined) group.description = description;
      // Firmen-Zuordnung nur durch Super-Admin änderbar.
      if (req.user!.isSuperAdmin && req.body.companyId !== undefined) {
        group.companyId = req.body.companyId ?? null;
      }

      // Handle manager updates
      if (managerId !== undefined || managerIds !== undefined) {
        const managersToSet = managerIds && managerIds.length > 0 ? managerIds : (managerId ? [managerId] : []);
        
        // Validate manager IDs if provided
        if (managersToSet.length > 0) {
          const found = await User.count({ where: { id: { [Op.in]: managersToSet } } });
          if (found !== new Set(managersToSet).size) {
            return next(new AppError(404, 'Mindestens eine Manager-ID wurde nicht gefunden'));
          }
          for (const mid of managersToSet) {
            if (!(await canActorAccessUser(req.user!, Number(mid)))) return next(new AppError(403, 'Manager außerhalb Ihres Bereichs'));
          }
        }

        // Update single manager field for backward compatibility
        group.managerId = managersToSet.length > 0 ? managersToSet[0] : undefined;
        
        // Update multiple managers using the many-to-many relationship
        await group.setManagers(managersToSet);
      }

      if (parentGroupId !== undefined) {
        if (parentGroupId === group.id) {
          return next(new AppError(400, 'Group cannot be its own parent'));
        }
        if (parentGroupId) {
          const parentGroup = await Group.findByPk(parentGroupId);
          if (!parentGroup || !(await canReadCompanyRecord(req.user!, (parentGroup as any).companyId))) {
            return next(new AppError(404, 'Parent group not found'));
          }
          // Zirkelbezug verhindern: Ahnenkette des neuen Parents hochlaufen.
          let ancestorId: number | null | undefined = parentGroupId;
          const visited = new Set<number>();
          while (ancestorId) {
            if (ancestorId === group.id) {
              return next(new AppError(400, 'Zirkelbezug in der Gruppenhierarchie ist nicht erlaubt'));
            }
            if (visited.has(ancestorId)) break;
            visited.add(ancestorId);
            const anc: any = await Group.findByPk(ancestorId, { attributes: ['parentGroupId'] });
            ancestorId = anc?.parentGroupId ?? null;
          }
        }
        group.parentGroupId = parentGroupId;
      }

      // Zeitmodell-Zuordnung (null = entfernen); Modell muss zur (Ziel-)Firma passen.
      if (req.body.timeModelId !== undefined) {
        group.timeModelId = await validateTimeModelAssignment(req.body.timeModelId, targetCompanyId ?? null);
      }
      // Zuschlagsprofil-Zuordnung (null = entfernen); Profil muss zur (Ziel-)Firma passen.
      if (req.body.surchargeProfileId !== undefined) {
        group.surchargeProfileId = await validateSurchargeProfileAssignment(req.body.surchargeProfileId, targetCompanyId ?? null);
      }

      await group.save();

      res.json({ 
        message: 'Group updated successfully',
        group 
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const group = await Group.findByPk(req.params.id);
      if (!group || !(await canManageCompanyRecord(req.user!, (group as any).companyId))) {
        return next(new AppError(404, 'Group not found'));
      }

      const members = await User.count({ where: { groupId: group.id } });
      if (members > 0) {
        return next(new AppError(400, 'Cannot delete group with members'));
      }
      const subGroups = await Group.count({ where: { parentGroupId: group.id } });
      if (subGroups > 0) {
        return next(new AppError(400, 'Untergruppen müssen zuerst entfernt/umgehängt werden'));
      }

      // m:n-Manager-Zuordnungen mitlöschen (sonst verwaiste GroupManager-Einträge).
      await GroupManager.destroy({ where: { groupId: group.id } });
      await moveToTrash('Group', group, group.name, req.user!.id);
      await group.destroy();

      res.json({ message: 'Group deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  async getGroupMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const group = await Group.findByPk(req.params.id);
      if (!group || !(await canReadCompanyRecord(req.user!, (group as any).companyId))) {
        return next(new AppError(404, 'Group not found'));
      }

      const members = await User.findAll({
        where: { groupId: group.id },
        attributes: { exclude: ['password'] },
        order: [['lastName', 'ASC'], ['firstName', 'ASC']],
      });

      res.json({ members });
    } catch (error) {
      next(error);
    }
  }

  async addGroupMember(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const group = await Group.findByPk(req.params.id);
      if (!group || !(await canManageCompanyRecord(req.user!, (group as any).companyId))) {
        return next(new AppError(404, 'Group not found'));
      }

      const { userId } = req.body;
      const user = await User.findByPk(userId);
      if (!user) {
        return next(new AppError(404, 'User not found'));
      }
      // Ziel-Nutzer muss im Scope liegen (kein firmenübergreifendes Zuordnen).
      if (!(await canActorAccessUser(req.user!, user.id))) {
        return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      }

      if (user.groupId === group.id) {
        return next(new AppError(400, 'User is already a member of this group'));
      }

      user.groupId = group.id;
      await user.save();

      res.json({ 
        message: 'User added to group successfully',
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async removeGroupMember(req: Request, res: Response, next: NextFunction) {
    try {
      const group = await Group.findByPk(req.params.id);
      if (!group || !(await canManageCompanyRecord(req.user!, (group as any).companyId))) {
        return next(new AppError(404, 'Group not found'));
      }

      const userId = parseInt(req.params.userId);
      const user = await User.findByPk(userId);
      if (!user) {
        return next(new AppError(404, 'User not found'));
      }

      if (user.groupId !== group.id) {
        return next(new AppError(400, 'User is not a member of this group'));
      }

      // null statt undefined: Sequelize ignoriert undefined bei save(),
      // dadurch würde die Gruppenzuordnung sonst nie geleert.
      (user as any).setDataValue('groupId', null);
      user.changed('groupId', true);
      await user.save();

      res.json({ message: 'User removed from group successfully' });
    } catch (error) {
      next(error);
    }
  }
}