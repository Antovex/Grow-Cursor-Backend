import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Range from '../models/Range.js';

const router = Router();

router.post('/', requireAuth, requireRole('superadmin', 'productadmin'), async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const range = await Range.create({ name });
    res.json(range);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/', requireAuth, async (req, res) => {
  const items = await Range.find().sort({ name: 1 });
  res.json(items);
});

export default router;
