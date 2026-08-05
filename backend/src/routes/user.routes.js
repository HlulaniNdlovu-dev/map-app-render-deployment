// routes/user.routes.js
import express from 'express';
import pool from '../db/db.js';
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';
import bcrypt from 'bcryptjs'; // Ensure bcrypt is imported if hashing passwords here
import { sendExport } from '../services/export.js';
const router = express.Router();



// 1. GET PROFILE FIELDS
router.get('/', authenticateToken, async (req, res) => {
    // Standardize targeting the authenticated user ID from the middleware
    const targetUserId = req.user?.id || req.id;

    try {
        const [users] = await pool.query(
            'SELECT user_id, email, username, firstname, lastname, date_created, last_login FROM user WHERE user_id = ?',
            [targetUserId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'Target profile user not found.' });
        }

        return res.status(200).json({ user: users[0] });
    } catch (error) {
        console.error('Error fetching user:', error);
        return res.status(500).json({ message: 'Internal server operational failure.' });
    }
});

/**
 * MODIFIED: added a computed `role` column (admin/driver, via LEFT JOINs on
 * the subtype tables) so the admin User Management page can show and
 * export who's who. Also supports ?format=csv|pdf, same convention as the
 * other admin list/report endpoints.
 */
router.get('/all', authenticateToken, adminWare, async (req, res) => {
    try {
        const [users] = await pool.query(
            `SELECT u.user_id, u.email, u.username, u.firstname, u.lastname, u.date_created, u.last_login,
                    CASE WHEN a.admin_id IS NOT NULL THEN 'admin' ELSE 'driver' END AS role
             FROM user u
             LEFT JOIN admin a ON a.user_id = u.user_id
             ORDER BY u.user_id`
        );

        const exported = sendExport(req, res, {
            title: 'User Management',
            description: 'Every account registered in the system, with their assigned role and account activity.',
            sections: [{
                columns: [
                    { key: 'user_id', label: 'ID', width: 0.5 },
                    { key: 'username', label: 'Username', width: 1 },
                    { key: 'firstname', label: 'First Name', width: 1 },
                    { key: 'lastname', label: 'Last Name', width: 1 },
                    { key: 'email', label: 'Email', width: 1.4 },
                    { key: 'role', label: 'Role', width: 0.8 },
                    { key: 'date_created', label: 'Created', width: 1.2 },
                    { key: 'last_login', label: 'Last Login', width: 1.2 },
                ],
                rows: users,
            }],
        });
        if (exported) return;

        // Explicit return ensures execution control context halts immediately
        return res.status(200).json({ users });
    } catch (error) {
        console.error('Error fetching system users:', error);

        // Prevent crashing if a response headers phase was partially altered upstream
        if (res.headersSent) {
            return;
        }

        return res.status(500).json({ message: 'Internal server operational failure.' });
    }
});

/**
 * NEW: ADMIN CREATE USER
 * Endpoint: POST /api/users
 * Lets an admin create a driver or admin account directly from the User
 * Management page, without going through the public signup form.
 */
router.post('/', authenticateToken, adminWare, async (req, res) => {
    const { email, password, username, firstName, lastName, role } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ success: false, message: 'Email, username, and password are required.' });
    }

    try {
        const [existingUser] = await pool.query('SELECT user_id FROM user WHERE email = ? OR username = ?', [email, username]);
        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: 'A user with this email or username already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [userResult] = await pool.query(
            `INSERT INTO user (email, password, username, firstname, lastname) VALUES (?, ?, ?, ?, ?)`,
            [email, hashedPassword, username, firstName || null, lastName || null]
        );
        const newUserId = userResult.insertId;

        if (role === 'admin') {
            await pool.query(`INSERT INTO admin (user_id) VALUES (?)`, [newUserId]);
        } else {
            await pool.query(`INSERT INTO driver (user_id) VALUES (?)`, [newUserId]);
        }

        return res.status(201).json({ success: true, message: 'User created successfully.', userId: newUserId });
    } catch (error) {
        console.error('Error creating user:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'A user with this email or username already exists.' });
        }
        return res.status(500).json({ success: false, message: 'Internal server operational failure.' });
    }
});

/**
 * NEW: GET ALL DRIVERS (Admin Driver Management page)
 * Endpoint: GET /api/users/drivers
 * Joins driver -> user so only the driver subtype comes back.
 * Admins never appear in this list, by construction of the join.
 */
router.get('/drivers', authenticateToken, adminWare, async (req, res) => {
    try {
        const [drivers] = await pool.query(
            `SELECT
                d.driver_id,
                u.user_id,
                u.firstname,
                u.lastname,
                u.username,
                u.email,
                u.date_created,
                u.last_login
             FROM driver d
             INNER JOIN user u ON d.user_id = u.user_id
             ORDER BY u.user_id`
        );

        return res.status(200).json({ success: true, drivers });
    } catch (error) {
        console.error('Error fetching drivers:', error);
        return res.status(500).json({ success: false, message: 'Internal server operational failure.' });
    }
});

/**
 * NEW: ADMIN PASSWORD RESET FOR A SPECIFIC USER
 * Endpoint: PUT /api/users/:id/password
 * This is distinct from the self-service PUT / below — that route can
 * only ever touch the caller's own row. This one lets an admin reset
 * someone else's password, and touches ONLY the password column.
 */
router.put('/:id/password', authenticateToken, adminWare, async (req, res) => {
    const targetUserId = req.params.id;
    const { password } = req.body;

    if (!password || password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    try {
        const [userCheck] = await pool.query('SELECT user_id FROM user WHERE user_id = ?', [targetUserId]);
        if (userCheck.length === 0) {
            return res.status(404).json({ success: false, message: 'Target user not found.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('UPDATE user SET password = ? WHERE user_id = ?', [hashedPassword, targetUserId]);

        return res.status(200).json({ success: true, message: 'Password updated successfully.' });
    } catch (error) {
        console.error('Error updating password:', error);
        return res.status(500).json({ success: false, message: 'Internal server operational failure.' });
    }
});
/**
 * MODIFIED: this previously had NO role check — any authenticated user
 * (including a driver) could delete any account by guessing a user_id.
 * adminWare has been added to close that gap. A `success` flag was also
 * added to the response so the admin frontend can branch on it cleanly.
 */
router.delete('/:id', authenticateToken, adminWare, async (req, res) => {
    const targetUserId = req.params.id;

    try {
        // 1. Verify existence of the targeted resource entry before destructive execution
        const [userCheck] = await pool.query(
            'SELECT user_id FROM user WHERE user_id = ?',
            [targetUserId]
        );

        if (userCheck.length === 0) {
            return res.status(404).json({ success: false, message: 'Target profile user not found for deletion.' });
        }

        // 2. Clear subtype rows first — `driver`/`admin` reference `user`
        // without ON DELETE CASCADE (unlike admin_driver/destination/
        // hazard_report, which do), so deleting `user` directly would fail
        // with a foreign key constraint error for any user who has a
        // driver or admin row (i.e. almost everyone).
        const [driverRows] = await pool.query('SELECT driver_id FROM driver WHERE user_id = ?', [targetUserId]);
        if (driverRows.length > 0) {
            await pool.query('DELETE FROM admin_driver WHERE driver_id = ?', [driverRows[0].driver_id]);
        }
        await pool.query('DELETE FROM driver WHERE user_id = ?', [targetUserId]);

        const [adminRows] = await pool.query('SELECT admin_id FROM admin WHERE user_id = ?', [targetUserId]);
        if (adminRows.length > 0) {
            await pool.query('DELETE FROM admin_driver WHERE admin_id = ?', [adminRows[0].admin_id]);
        }
        await pool.query('DELETE FROM admin WHERE user_id = ?', [targetUserId]);

        // 3. Execute database destruction command sequence
        await pool.query(
            'DELETE FROM user WHERE user_id = ?',
            [targetUserId]
        );

        // 3. Return explicit success status indication
        return res.status(200).json({
            success: true,
            message: 'User profile successfully unlinked and purged from system records.',
            purgedId: targetUserId
        });
    } catch (error) {
        console.error('Error executing system user purge:', error);
        return res.status(500).json({ success: false, message: 'Internal server operational failure.' });
    }
});



// 2. UPDATE PROFILE FIELDS (self-service only — unchanged)
router.put('/', authenticateToken, async (req, res) => {
    // Ensure both variables extract from the identical authenticated source
    const targetUserId = req.user?.id || req.id;
    const { username, firstName, lastName, email, password } = req.body;

    try {
        // Fetch current records to fall back on if fields are omitted in req.body
        const [[currentUser]] = await pool.query('SELECT * FROM user WHERE user_id = ?', [targetUserId]);

        if (!currentUser) {
            return res.status(404).json({ message: 'Target user does not exist.' });
        }

        const updatedUsername = username || currentUser.username;
        const updatedEmail = email || currentUser.email;
        const updatedFirstName = firstName || currentUser.firstname;
        const updatedLastName = lastName || currentUser.lastname;
        const updatedPassword = currentUser.password;

        await pool.query(
            `UPDATE user 
             SET username = ?, email = ?, firstname = ?, lastname = ?, password = ?
             WHERE user_id = ?`,
            [updatedUsername, updatedEmail, updatedFirstName, updatedLastName, updatedPassword, targetUserId]
        );

        return res.status(200).json({
            message: 'Profile updated successfully!',
            user: {
                email: updatedEmail,
                username: updatedUsername,
                firstName: updatedFirstName,
                lastName: updatedLastName
            }
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                message: 'Username or email already taken.'
            });
        }
        console.error('Error updating user:', error);
        return res.status(500).json({ message: 'Internal server operational failure.' });
    }
});

/**
 * 3. DELETE OWN ACCOUNT (self-service — unchanged)
 * Endpoint: DELETE /api/users
 */
router.delete('/', authenticateToken, async (req, res) => {
    const targetUserId = req.id

    try {
        const [result] = await pool.query('DELETE FROM user WHERE user_id = ?', [targetUserId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Target user record not found.' });
        }

        return res.status(200).json({ message: 'Account deleted successfully.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        return res.status(500).json({ message: 'Internal server operational failure.' });
    }
});

export default router;
