import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function auth(requiredRole) {
  return (req, res, next) => {
    const raw = req.headers.authorization || '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      if (requiredRole && payload.role !== requiredRole)
        return res.status(403).json({ error: 'Forbidden' });
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}
