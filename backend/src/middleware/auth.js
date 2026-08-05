// middleware/auth.js
import jwt from 'jsonwebtoken';

// This MUST match the secret or fallback used in server.js
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_routing_key_123';

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

