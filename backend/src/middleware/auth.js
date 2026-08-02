// middleware/auth.js
import jwt from 'jsonwebtoken';

// No fallback — a missing JWT_SECRET should fail startup (via env.js's
// dotenv load + this throwing on first use), not silently sign/verify
// tokens with a secret that used to be checked into source.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set.');
}

export function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <token>"

    if (!token) {
        return res.status(401).json({ message: 'Access token missing or unprovided.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired authentication token.' });
        }
        
        // Attach the decrypted payload ({ userId, username }) to the request object
        req.id = decodedUser.userId;
        req.type = decodedUser.userType
        next();
    });
}

