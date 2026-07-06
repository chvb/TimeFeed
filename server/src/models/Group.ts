import { DataTypes, Model, Optional, BelongsToManySetAssociationsMixin } from 'sequelize';
import { sequelize } from '../db/database';

interface GroupAttributes {
  id: number;
  name: string;
  description?: string;
  companyId?: number | null;
  managerId?: number;
  parentGroupId?: number;
  // Zeitmodell der Gruppe (Sollzeiten); User.timeModelId überschreibt es je Mitarbeiter.
  timeModelId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface GroupCreationAttributes extends Optional<GroupAttributes, 'id' | 'createdAt' | 'updatedAt' | 'companyId' | 'timeModelId'> {}

export class Group extends Model<GroupAttributes, GroupCreationAttributes> implements GroupAttributes {
  public id!: number;
  public name!: string;
  public description?: string;
  public companyId?: number | null;
  public managerId?: number;
  public parentGroupId?: number;
  public timeModelId?: number | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Association methods
  public setManagers!: BelongsToManySetAssociationsMixin<any, number>;
}

Group.init(
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
    parentGroupId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    timeModelId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Group',
    tableName: 'groups',
    underscored: true,
    indexes: [{ unique: true, fields: ['company_id', 'name'] }],
  }
);