// Applies db/seed.sql (demo data — at least 10 rows per real table, see
// that file's header comment). Unlike migrate.mjs, this is NOT tracked in
// schema_migrations — seeding is a deliberate, explicit action you run
// when you want demo data, not an automatic one-time-only step.
import '../env.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
  const statements = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
  await pool.end();
  console.log(`Seed data applied (${statements.length} statements).`);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
