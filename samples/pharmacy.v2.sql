-- SchemaFlow sample: pharmacy platform, VERSION 2 (PostgreSQL)
-- Same as pharmacy.sql with deliberate changes, to try schema comparison.
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL DEFAULT 'customer',
  phone VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE pharmacies (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  city VARCHAR(80) NOT NULL,
  license_no VARCHAR(40) NOT NULL
);

CREATE TABLE medicines (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  requires_prescription BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE pharmacy_stock (
  pharmacy_id INTEGER NOT NULL,
  medicine_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  price NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (pharmacy_id, medicine_id),
  CONSTRAINT fk_stock_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  CONSTRAINT fk_stock_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  placed_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,
  medicine_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL
);

CREATE TABLE prescriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  issued_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE order_items ADD CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id);
ALTER TABLE order_items ADD CONSTRAINT fk_items_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id);

CREATE INDEX idx_orders_status ON orders (status);
CREATE UNIQUE INDEX idx_pharmacy_name_city ON pharmacies (name, city);