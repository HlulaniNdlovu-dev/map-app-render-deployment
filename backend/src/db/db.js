import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MYSQLDATABASE='safe_route'
const MYSQLHOST='localhost'
const MYSQLPASSWORD='12345'
const MYSQLPORT='3306'
const MYSQLUSER='root'

const pool = mysql.createPool({
    host: process.env.MYSQLHOST || MYSQLHOST || 'sakura.proxy.rlwy.net',
    port: process.env.MYSQLPORT || MYSQLPORT || '22943',
    user: process.env.MYSQLUSER || MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || MYSQLPASSWORD || 'NrdknzjgNMxcbhhROHbvSBIscXxcZuXA',
    database: process.env.MYSQLDATABASE || MYSQLDATABASE || 'safe_route',
});

pool.query('SELECT 1')
    .then(() => console.log('Database connected successfully'))
    .catch(err => console.error('Database connection failed:', err.message));

export default pool;
