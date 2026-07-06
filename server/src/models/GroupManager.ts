import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db/database';

interface GroupManagerAttributes {
  groupId: number;
  userId: number;
  createdAt?: Date;
}

export class GroupManager extends Model<GroupManagerAttributes> implements GroupManagerAttributes {
  public groupId!: number;
  public userId!: number;
  public readonly createdAt!: Date;
}

GroupManager.init(
  {
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      field: 'group_id'
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      field: 'user_id'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at'
    }
  },
  {
    sequelize,
    modelName: 'GroupManager',
    tableName: 'group_managers',
    timestamps: false,
    underscored: true
  }
);