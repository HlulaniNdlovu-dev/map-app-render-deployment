import mysql from 'mysql2/promise';

const pool = mysql.createPool({
    host: process.env.MYSQLHOST || 'reseau.proxy.rlwy.net',
    port: process.env.MYSQLPORT || '23027',
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || 'KKoPJqguYVkgPnWXjibpGyWHDeKicJDe',
    database: process.env.MYSQLDATABASE || 'safe_route',
});

pool.query('SELECT 1')
    .then(() => console.log('Database connected successfully'))
    .catch(err => console.error('Database connection failed:', err.message));

export default pool;
