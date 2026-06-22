

export default async (req, res,next) => {
if (req.type !== 'admin') {
        // CRITICAL: Must use the 'return' keyword here
        return res.status(403).json({ message: 'Access denied: Administrative privileges required.' });
    }
    next();
}