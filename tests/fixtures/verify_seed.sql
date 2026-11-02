-- Seed verification fixture.
--
-- Loaded into the app's real database with sqlite3 after the app has run its
-- migration at least once, so the chart, the KPI tiles and the table all have
-- something to render without clicking through the UI.
--
-- Mirrors src/dev/sampleData.ts: 2 institutions, 2 categories, 3 assets,
-- 12 monthly snapshots each. Amounts are minor units (cents).

INSERT INTO institutions (name) VALUES ('UBS'), ('Swissquote');
INSERT INTO categories (name, color, system_role) VALUES
  ('Savings', '#0d9488', 'cash'),
  ('Investments', '#2563eb', 'stocks');

INSERT INTO assets (institution_id, category_id, currency, product_name, name, notes)
VALUES
  ((SELECT id FROM institutions WHERE name = 'UBS'),
   (SELECT id FROM categories  WHERE name = 'Savings'),
   'CHF', 'Savings Account', NULL, 'Verification fixture'),
  ((SELECT id FROM institutions WHERE name = 'UBS'),
   (SELECT id FROM categories  WHERE name = 'Investments'),
   'CHF', 'Global Equity Fund', 'Pension portfolio', 'Verification fixture'),
  ((SELECT id FROM institutions WHERE name = 'Swissquote'),
   (SELECT id FROM categories  WHERE name = 'Investments'),
   'EUR', 'ETF World', NULL, 'Verification fixture');

-- 12 monthly snapshots, each asset growing steadily.
WITH RECURSIVE months(n) AS (
  SELECT 0 UNION ALL SELECT n + 1 FROM months WHERE n < 11
)
INSERT INTO snapshots (asset_id, date, amount_minor)
SELECT
  a.id,
  date('now', 'start of month', printf('-%d months', 11 - months.n)),
  CASE a.product_name
    WHEN 'Savings Account'   THEN 2450000 + months.n * 62000
    WHEN 'Global Equity Fund' THEN 4800000 + months.n * 91000
    WHEN 'ETF World'         THEN 3100000 + months.n * 43000
  END
FROM assets a, months;
