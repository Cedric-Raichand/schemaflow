export type Dialect = 'postgresql' | 'mysql';

export interface Column {
  name: string;
  dataType: string; // e.g. VARCHAR(255)
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface Table {
  id: string; // schema.name or name
  schema: string | null;
  name: string;
  columns: Column[];
  primaryKey: string[];
  indexes: IndexInfo[];
  isLikelyJunction: boolean;
}

export type RelationshipSource = 'explicit' | 'inferred';
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-many';

export interface Relationship {
  id: string;
  name: string | null;
  source: RelationshipSource; // explicit = defined by a FK constraint; inferred = guessed from naming, needs confirmation
  fromTable: string; // table id holding the foreign key
  fromColumns: string[];
  toTable: string; // referenced table id
  toColumns: string[];
  cardinality: Cardinality;
  onDelete: string | null;
  onUpdate: string | null;
}

export interface SchemaModel {
  dialect: Dialect;
  importedAt: string;
  tables: Table[];
  relationships: Relationship[];
  warnings: string[];
}