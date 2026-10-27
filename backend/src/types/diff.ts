export type Risk = 'breaking' | 'caution' | 'safe';

export type ChangeKind =
  | 'table_added' | 'table_removed'
  | 'column_added' | 'column_removed'
  | 'column_type_changed' | 'column_nullability_changed' | 'column_default_changed'
  | 'primary_key_changed'
  | 'foreign_key_added' | 'foreign_key_removed' | 'foreign_key_changed'
  | 'index_added' | 'index_removed';

export interface Change {
  kind: ChangeKind;
  /** How worried to be. These are POTENTIAL impacts: SchemaFlow cannot see your application code. */
  risk: Risk;
  table: string;
  column?: string;
  summary: string;
  before?: string;
  after?: string;
  impact: string;
}

export interface SchemaDiff {
  identical: boolean;
  counts: { total: number; breaking: number; caution: number; safe: number };
  baseTables: number;
  nextTables: number;
  changes: Change[];
  notes: string[];
}