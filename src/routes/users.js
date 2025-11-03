import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireRole } from '../middleware/auth.js';
import User from '../models/User.js';

const router = Router();

// Superadmin creates admins and listers; Admin creates listers
router.post('/', requireAuth, async (req, res) => {
  const { role } = req.user;
  const { email, username, password, newUserRole } = req.body || {};
  if (!email || !username || !password || !newUserRole) {
    return res.status(400).json({ error: 'email, username, password, newUserRole required' });
  }
  if (!['admin', 'lister'].includes(newUserRole)) return res.status(400).json({ error: 'Invalid newUserRole' });
  if (role === 'lister') return res.status(403).json({ error: 'Forbidden' });
  if (role === 'admin' && newUserRole !== 'lister') return res.status(403).json({ error: 'Admins can only create listers' });
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: 'Email already in use' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, username, passwordHash, role: newUserRole });
  res.json({ id: user._id, email: user.email, username: user.username, role: user.role });
});

router.get('/listers', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const listers = await User.find({ role: 'lister', active: true }).select('email username role');
  res.json(listers);
});

router.get('/admins', requireAuth, requireRole('superadmin'), async (req, res) => {
  const admins = await User.find({ role: 'admin', active: true }).select('email username role');
  res.json(admins);
});

export default router;


