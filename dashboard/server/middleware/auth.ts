import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getAuthConfig } from '../db/database.js';

export interface JWTPayload {
  type: 'admin' | 'participant';
  id?: string;        // participant id (for participants)
  email?: string;     // participant email (for participants)
  name?: string;      // participant name (for participants)
  iat: number;
  exp: number;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

// Middleware to require any valid authentication
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    const auth = getAuthConfig();
    const payload = jwt.verify(token, auth.jwt_secret) as JWTPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      res.status(401).json({ error: 'Authentication failed' });
    }
  }
}

// Middleware to require admin authentication
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const auth = getAuthConfig();
    const payload = jwt.verify(token, auth.jwt_secret) as JWTPayload;

    if (payload.type !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      res.status(401).json({ error: 'Authentication failed' });
    }
  }
}

// Middleware to require participant authentication
export function requireParticipant(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const auth = getAuthConfig();
    const payload = jwt.verify(token, auth.jwt_secret) as JWTPayload;

    if (payload.type !== 'participant') {
      res.status(403).json({ error: 'Participant access required' });
      return;
    }

    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      res.status(401).json({ error: 'Authentication failed' });
    }
  }
}

// Helper to generate tokens
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const auth = getAuthConfig();
  return jwt.sign(payload, auth.jwt_secret, { expiresIn: '24h' });
}
