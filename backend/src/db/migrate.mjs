// Applies every .sql file under db/migrations (plain CREATE TABLE/ALTER
// TABLE statements, split on ';') and db/procedures (CREATE PROCEDURE
// bodies, which contain their own internal ';' characters so they're split
// on the '@@SPLIT@@' marker line instead).
//
// A schema_migrations table tracks which filenames have already been
// applied so this is safe to re-run after adding new files — already-run
// migrations are skipped rather than re-executed, which matters because
// some of them (e.g. 001_roles_and_reports.sql) contain plain ALTER TABLE
// statements that are NOT safe to run twice.
import '../env.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripComments(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME DEFAULT (NOW() + INTERVAL 2 HOUR)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function alreadyApplied(filename) {
  const [rows] = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = ?', [filename]);
  return rows.length > 0;
}

async function markApplied(filename) {
  await pool.query('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
}

async function runDirectory(dirName, splitter) {
  const dir = path.join(__dirname, dirName);
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const trackingKey = `${dirName}/${file}`;
    if (await alreadyApplied(trackingKey)) {
      console.log(`- ${trackingKey} (already applied, skipped)`);
      continue;
    }
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = stripComments(raw)
      .split(splitter)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await pool.query(statement);
    }
    await markApplied(trackingKey);
    console.log(`✓ ${trackingKey}`);
  }
}

async function main() {
  await ensureTrackingTable();
  await runDirectory('migrations', ';');
  await runDirectory('procedures', '@@SPLIT@@');
  await pool.end();
  console.log('All migrations and procedures applied.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
