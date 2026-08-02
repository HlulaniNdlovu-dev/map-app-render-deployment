// routes/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/db.js';
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';

const router = express.Router();
// No fallback — see middleware/auth.js for why. Both must read the same
// env var since one signs tokens and the other verifies them.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set.');
}

// Every role beyond plain driver maps to its own subtype table, mirroring
// the existing driver/admin pattern.
const ROLE_TABLES = {
    driver: 'driver',
    admin: 'admin',
    traffic_authority: 'traffic_authority',
    security_agency: 'security_agency',
    data_analyst: 'data_analyst',
};
const STAFF_ROLES = ['admin', 'traffic_authority', 'security_agency', 'data_analyst'];

async function insertUserRow(connection, { email, password, username, firstName, lastName }) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [userResult] = await connection.query(
        `INSERT INTO user (email, password, username, firstname, lastname)
             VALUES (?, ?, ?, ?, ?)`,
        [email, hashedPassword, username, firstName, lastName]
    );
    return userResult.insertId;
}

/**
 * Public sign-up -> POST /api/auth/register
 * This is the only self-service path into the system, so it is hard-wired
 * to always create a driver account — any `userType` in the request body
 * is ignored. Staff roles (admin, traffic authority, security agency,
 * data analyst) can only be created by an existing admin, via
 * POST /api/auth/register-staff below. (Previously this endpoint trusted
 * the client-supplied userType and made ANYONE who passed a non-"driver"
 * value an admin — a real privilege-escalation hole.)
 */
router.post('/register', async (req, res) => {
    const { email, password, username, firstName, lastName } = req.body || {};

    if (!email || !password || !username) {
        return res.status(400).json({ message: 'Missing essential validation elements.' });
    }

    const connection = await pool.getConnection();
    try {
        const [existingUser] = await connection.query('SELECT user_id FROM user WHERE email = ? OR username = ?', [email, username]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'User with this email or username already exists.' });
        }

        await connection.beginTransaction();

        const newUserId = await insertUserRow(connection, { email, password, username, firstName, lastName });
        await connection.query(`INSERT INTO driver (user_id) VALUES (?)`, [newUserId]);

        await connection.commit();

        const token = jwt.sign({ userId: newUserId, userType: 'driver' }, JWT_SECRET, { expiresIn: '4h' });

        return res.status(201).json({
            userType: 'driver',
            token
        });

    } catch (error) {
        await connection.rollback().catch(() => { });
        console.error('Registration runtime error:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                message: 'User with this email or username already exists.'
            });
        }
        return res.status(500).json({ message: 'Internal server operational failure.' });
    } finally {
        connection.release();
    }
});

/**
 * Admin-only staff provisioning -> POST /api/auth/register-staff
 * Creates an account for one of the roles an admin manages: System
 * Administrator, Traffic Authority, Security Agency, or Data Analyst.
 * Body: { email, password, username, firstName, lastName, role }
 */
router.post('/register-staff', authenticateToken, adminWare, async (req, res) => {
    const { email, password, username, firstName, lastName, role } = req.body || {};

    if (!email || !password || !username || !role) {
        return res.status(400).json({ message: 'email, password, username and role are required.' });
    }
    if (!STAFF_ROLES.includes(role)) {
        return res.status(400).json({ message: `role must be one of: ${STAFF_ROLES.join(', ')}` });
    }

    const connection = await pool.getConnection();
    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        // sp_create_staff_account does the duplicate check + user insert +
        // role-subtype insert atomically in one transaction server-side.
        await connection.query(
            'CALL sp_create_staff_account(?, ?, ?, ?, ?, ?, @p_user_id, @p_status)',
            [email, hashedPassword, username, firstName, lastName, role]
        );
        const [[out]] = await connection.query('SELECT @p_user_id AS userId, @p_status AS status');

        if (out.status === 'DUPLICATE') {
            return res.status(400).json({ message: 'User with this email or username already exists.' });
        }
        if (out.status !== 'OK') {
            return res.status(500).json({ message: 'Internal server operational failure.' });
        }

        return res.status(201).json({
            success: true,
            message: `${role} account created.`,
            userId: out.userId,
            userType: role,
        });

    } catch (error) {
        console.error('Staff registration runtime error:', error);
        return res.status(500).json({ message: 'Internal server operational failure.' });
    } finally {
        connection.release();
    }
});

/**
 * Determines a user's role by checking each subtype table. A user should
 * only ever appear in one of these; driver is the implicit default since
 * every self-registered account lands there.
 */
async function resolveUserType(userId) {
    for (const role of ['admin', 'traffic_authority', 'security_agency', 'data_analyst']) {
        const [rows] = await pool.query(`SELECT 1 FROM ${ROLE_TABLES[role]} WHERE user_id = ?`, [userId]);
        if (rows.length > 0) return role;
    }
    return 'driver';
}

// Authentication Login Route -> maps to POST /api/auth/login
router.post('/login', async (req, res) => {
    const { identifier, password } = req.body || {};

    if (!identifier || !password) {
        return res.status(400).json({ message: 'Identifier and password are required.' });
    }

    try {
        // 1. Fetch user by email OR username
        const [[user]] = await pool.query(
            'SELECT * FROM user WHERE email = ? OR username = ?',
            [identifier, identifier]
        );

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // 2. Compare passwords
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        await pool.query(
            'UPDATE user SET last_login = NOW() WHERE user_id = ?',
            [user.user_id]
        );

        // 3. Determine role by checking every subtype table
        const userType = await resolveUserType(user.user_id);

        // 4. Generate session token
        const token = jwt.sign(
            { userId: user.user_id, userType },
            JWT_SECRET,
            { expiresIn: '4h' }
        );

        return res.status(200).json({
            userType,
            token
        });

    } catch (error) {
        console.error('Login runtime error:', error);
        return res.status(500).json({ message: 'Internal server operational failure.' });
    }
});

export default router
