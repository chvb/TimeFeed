import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

interface DepartmentAttributes {
  id: number;
  name: string;
  description?: string;
  companyId?: number | null;
  managerId?: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DepartmentCreationAttributes extends Optional<DepartmentAttributes, 'id' | 'createdAt' | 'updatedAt' | 'isActive' | 'companyId'> {}

export class Department extends Model<DepartmentAttributes, DepartmentCreationAttributes> implements DepartmentAttributes {
  public id!: number;
  public name!: string;
  public description?: string;
  public companyId?: number | null;
  public managerId?: number;
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Department.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      // Eindeutigkeit gilt pro Firma (zusammengesetzter Index unten), nicht global.
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    companyId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    managerId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: 'Department',
    tableName: 'departments',
    underscored: true,
    indexes: [{ unique: true, fields: ['company_id', 'name'] }],
  }
);