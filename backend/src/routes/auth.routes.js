// routes/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_routing_key_123';

// Authentication Sign-Up Route -> maps to POST /api/auth/register
router.post('/register', async (req, res) => {
    const { email, password, username, firstName, lastName, userType } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ message: 'Missing essential validation elements.' });
    }

    // A transaction has to run on a single dedicated connection — calling
    // pool.query() for START TRANSACTION/COMMIT pulls a fresh pooled
    // connection each time, so none of those statements actually shared a
    // connection and the "transaction" was a no-op with no atomicity.
    const connection = await pool.getConnection();
    try {
        // 1. Check for existing identifier usage
        const [existingUser] = await connection.query('SELECT user_id FROM user WHERE email = ? OR username = ?', [email, username]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'User with this email or username already exists.' });
        }

        // 2. Compute secure hash
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Begin Transaction isolation block
        await connection.beginTransaction();

        const [userResult] = await connection.query(
            `INSERT INTO user (email, password, username, firstname, lastname)
                 VALUES (?, ?, ?, ?, ?)`,
            [email, hashedPassword, username, firstName, lastName]
        );

        const newUserId = userResult.insertId;

        // 4. Evaluate sub-type allocations from ERD definitions
        if (userType === 'normal') {
            await connection.query(`INSERT INTO driver (user_id) VALUES (?)`, [newUserId]);
        } else {
            await connection.query(`INSERT INTO admin (user_id) VALUES (?)`, [newUserId]);
        }

        await connection.commit();

        // 5. Package session payloads
        const token = jwt.sign({ userId: newUserId, userType }, JWT_SECRET, { expiresIn: '4h' });

        return res.status(201).json({
            userType,
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

// Authentication Login Route -> maps to POST /api/auth/login
router.post('/login', async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ message: 'Identifier and password are required.' });
    }

    try {
        // 1. Fetch user by email OR username
        const [[user]] = await pool.query(
            'SELECT * FROM user WHERE email = ? ',
            [identifier]
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

        // 4. Determine userType by checking the sub-type tables
        let userType = 'normal';
        const [isAdmin] = await pool.query('SELECT admin_id FROM admin WHERE user_id = ?', [user.user_id]);

        if (isAdmin.length > 0) {
            userType = 'admin';
        }

        // 5. Generate session token
        const token = jwt.sign(
            { userId: user.user_id, userType: userType },
            JWT_SECRET,
            { expiresIn: '4h' }
        );

        return res.status(200).json({
            userType: userType,
            token: token
        });

    } catch (error) {
        console.error('Login runtime error:', error);
        return res.status(500).json({ message: 'Internal server operational failure.' });
    }
});

export default router
