import mysql from 'mysql2/promise';

// No hardcoded fallback credentials — this used to default to the real,
// live DB password when the env vars were missing, which meant the actual
// production password was checked into source. Fail loudly and immediately
// instead: a missing env var should never silently degrade into "works
// anyway using a secret nobody meant to commit."
const REQUIRED_VARS = ['MYSQLHOST', 'MYSQLPORT', 'MYSQLUSER', 'MYSQLPASSWORD', 'MYSQLDATABASE'];
const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
    throw new Error(
        `Missing required database environment variable(s): ${missing.join(', ')}. ` +
        `Copy backend/.env.example to backend/src/.env and fill them in.`
    );
}

const pool = mysql.createPool({
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
});

pool.query('SELECT 1')
    .then(() => console.log('Database connected successfully'))
    .catch(err => console.error('Database connection failed:', err.message));

export default pool;
