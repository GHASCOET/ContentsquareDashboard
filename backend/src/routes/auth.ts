import { Router, Request, Response } from 'express';
import { generateToken } from '../middleware/auth.js';

const router = Router();

// Simple login - in production, use a real auth system
router.post('/login', (req: Request, res: Response): void => {
  const { username, password } = req.body;

  // Demo credentials
  if (username === 'admin' && password === 'admin') {
    const token = generateToken(1, username);
    res.json({ token, user: { id: 1, username } });
    return;
  }

  res.status(401).json({ error: 'Invalid credentials' });
});

export default router;
