import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importSql, SqlImportError } from '../src/services/importers/sqlImporter.js';

const sample = readFileSync(new URL('../../samples/pharmacy.sql', import.meta.url), 'utf8');

describe('importSql (pharmacy sample)', () => {
  const m = importSql(sample, 'postgresql');
  const rel = (from: string, to: string) => m.relationships.filter((r) => r.fromTable === from && r.toTable === to);

  it('finds all tables', () => {
    expect(m.tables.map((t) => t.name).sort()).toEqual(
      ['audit_log', 'medicines', 'order_items', 'orders', 'pharmacies', 'pharmacy_stock', 'users']);
  });

  it('reads column details', () => {
    const email = m.tables.find((t) => t.name === 'users')!.columns.find((c) => c.name === 'email')!;
    expect(email.dataType).toBe('VARCHAR(255)');
    expect(email.nullable).toBe(false);
    expect(email.isUnique).toBe(true);
    const price = m.tables.find((t) => t.name === 'pharmacy_stock')!.columns.find((c) => c.name === 'price')!;
    expect(price.dataType).toBe('NUMERIC(10,2)');
  });

  it('reads primary keys, including composite', () => {
    expect(m.tables.find((t) => t.name === 'users')!.primaryKey).toEqual(['id']);
    expect(m.tables.find((t) => t.name === 'pharmacy_stock')!.primaryKey).toEqual(['pharmacy_id', 'medicine_id']);
  });

  it('extracts explicit FKs: inline, table-level and ALTER TABLE', () => {
    expect(rel('pharmacies', 'users')[0]).toMatchObject({ source: 'explicit', onDelete: 'CASCADE' });
    expect(rel('pharmacy_stock', 'pharmacies')[0].source).toBe('explicit');
    expect(rel('orders', 'users')[0]).toMatchObject({ source: 'explicit', name: 'fk_orders_user' });
    expect(rel('order_items', 'orders')[0].onDelete).toBe('CASCADE');
    expect(rel('order_items', 'medicines')[0].source).toBe('explicit');
  });

  it('flags junction tables', () => {
    expect(m.tables.find((t) => t.name === 'pharmacy_stock')!.isLikelyJunction).toBe(true);
    expect(m.tables.find((t) => t.name === 'users')!.isLikelyJunction).toBe(false);
  });

  it('only infers relationships where no FK exists, and labels them', () => {
    const inferred = m.relationships.filter((r) => r.source === 'inferred');
    expect(inferred.map((r) => `${r.fromTable}.${r.fromColumns[0]}`)).toEqual(['audit_log.user_id']);
  });

  it('reads indexes', () => {
    const o = m.tables.find((t) => t.name === 'orders')!;
    expect(o.indexes.some((i) => i.name === 'idx_orders_user' && !i.unique)).toBe(true);
    const p = m.tables.find((t) => t.name === 'pharmacies')!;
    expect(p.indexes.some((i) => i.name === 'idx_pharmacy_name_city' && i.unique)).toBe(true);
  });
});

describe('importSql errors', () => {
  it('rejects invalid SQL with a friendly error', () => {
    expect(() => importSql('CREATE TABEL nope (')).toThrow(SqlImportError);
  });
  it('rejects SQL with no tables', () => {
    expect(() => importSql('SELECT 1;')).toThrow(/No CREATE TABLE/);
  });
});