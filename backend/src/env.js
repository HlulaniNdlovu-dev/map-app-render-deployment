// Loads backend/src/.env before anything else. Must be the FIRST import in
// server.js — ES module imports execute depth-first in declaration order,
// so as long as this is imported before db.js (or anything else that reads
// process.env at module top-level, like the JWT_SECRET constants), every
// other module sees a fully-populated process.env by the time its own
// top-level code runs.
//
// fileURLToPath (not .pathname) so this resolves correctly on Windows too —
// a raw file:// URL's .pathname keeps a leading slash before the drive
// letter (e.g. "/C:/Users/...") which isn't a valid filesystem path there.
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
