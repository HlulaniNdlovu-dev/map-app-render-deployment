/**
 * Generic role gate, for the roles beyond plain admin/driver
 * (traffic_authority, security_agency, data_analyst). Must run after
 * authenticateToken, which sets req.type from the JWT payload.
 */
export default function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.type)) {
      return res.status(403).json({ message: `Access denied: requires one of [${allowedRoles.join(', ')}].` });
    }
    next();
  };
}
