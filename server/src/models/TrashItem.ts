import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/database';

interface TrashItemAttributes {
  id: number;
  entityType: string;   // 'User' | 'Group' | 'Holiday' | 'GroupManager'
  entityId: number;     // ursprüngliche PK
  label: string;        // menschenlesbare Bezeichnung
  data: any;            // vollständiger Snapshot zum Wiederherstellen
  companyId?: number | null; // Firma des Datensatzes (für Mandanten-/Firmen-Scope; null = global)
  deletedById?: number | null;
  createdAt?: Date;     // = Löschzeitpunkt
  updatedAt?: Date;
}

interface TrashItemCreationAttributes
  extends Optional<TrashItemAttributes, 'id' | 'createdAt' | 'updatedAt' | 'deletedById' | 'companyId'> {}

export class TrashItem extends Model<TrashItemAttributes, TrashItemCreationAttributes> implements TrashItemAttributes {
  public id!: number;
  public entityType!: string;
  public entityId!: number;
  public label!: string;
  public data!: any;
  public companyId?: number | null;
  public deletedById?: number | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TrashItem.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    entityType: { type: DataTypes.STRING, allowNull: false },
    entityId: { type: DataTypes.INTEGER, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    data: { type: DataTypes.JSON, allowNull: false },
    companyId: { type: DataTypes.INTEGER, allowNull: true },
    deletedById: { type: DataTypes.INTEGER, allowNull: true },
  },
  { sequelize, modelName: 'TrashItem', tableName: 'trash_items', underscored: true }
);
