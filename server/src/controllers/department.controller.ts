import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Department } from '../models/Department';
import { User } from '../models/User';
import { getEffectiveActor, getCompanyScopeWhere, canManageCompanyRecord, canActorAccessUser, resolveWritableCompanyId } from '../services/accessScope';

export const getDepartments = async (req: Request, res: Response) => {
  try {
    const departments = await Department.findAll({
      where: getCompanyScopeWhere(getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId)), // nur Abteilungen der eigenen Firma
      include: [
        {
          model: User,
          as: 'manager',
          attributes: ['id', 'firstName', 'lastName', 'email']
        }
      ],
      order: [['name', 'ASC']]
    });

    res.json(departments);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ message: 'Error fetching departments' });
  }
};

export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name, description, managerId } = req.body;
    const companyId = await resolveWritableCompanyId(req.user!, req.body.companyId);
    if (managerId && !(await canActorAccessUser(req.user!, Number(managerId)))) {
      res.status(403).json({ message: 'Manager außerhalb Ihres Bereichs' });
      return;
    }
    // Name pro Firma eindeutig (composite Unique greift bei company_id=NULL nicht, daher App-Check).
    const dup = await Department.findOne({ where: { name, companyId: companyId ?? null } });
    if (dup) {
      res.status(400).json({ message: 'Department name already exists' });
      return;
    }

    const department = await Department.create({
      name,
      description,
      companyId,
      managerId: managerId || null
    });

    const newDepartment = await Department.findByPk(department.id, {
      include: [
        {
          model: User,
          as: 'manager',
          attributes: ['id', 'firstName', 'lastName', 'email']
        }
      ]
    });

    res.status(201).json(newDepartment);
  } catch (error: any) {
    console.error('Error creating department:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      res.status(400).json({ message: 'Department name already exists' });
    } else {
      res.status(500).json({ message: 'Error creating department' });
    }
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, managerId, isActive } = req.body;

    const department = await Department.findByPk(id);
    if (!department || !(await canManageCompanyRecord(req.user!, (department as any).companyId))) {
      return res.status(404).json({ message: 'Department not found' });
    }
    if (managerId && !(await canActorAccessUser(req.user!, Number(managerId)))) {
      return res.status(403).json({ message: 'Manager außerhalb Ihres Bereichs' });
    }
    // Name pro Firma eindeutig (composite Unique greift bei company_id=NULL nicht).
    if (name && name !== department.name) {
      const dup = await Department.findOne({ where: { name, companyId: (department as any).companyId ?? null, id: { [Op.ne]: department.id } } });
      if (dup) {
        return res.status(400).json({ message: 'Department name already exists' });
      }
    }

    await department.update({
      name,
      description,
      managerId: managerId || null,
      isActive
    });

    const updatedDepartment = await Department.findByPk(id, {
      include: [
        {
          model: User,
          as: 'manager',
          attributes: ['id', 'firstName', 'lastName', 'email']
        }
      ]
    });

    return res.json(updatedDepartment);
  } catch (error: any) {
    console.error('Error updating department:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ message: 'Department name already exists' });
    } else {
      return res.status(500).json({ message: 'Error updating department' });
    }
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const department = await Department.findByPk(id);
    if (!department || !(await canManageCompanyRecord(req.user!, (department as any).companyId))) {
      return res.status(404).json({ message: 'Department not found' });
    }

    // Check if department has users assigned
    const usersCount = await User.count({ where: { department: department.name } });
    if (usersCount > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete department with assigned employees. Please reassign employees first.' 
      });
    }

    await department.destroy();
    return res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    return res.status(500).json({ message: 'Error deleting department' });
  }
};