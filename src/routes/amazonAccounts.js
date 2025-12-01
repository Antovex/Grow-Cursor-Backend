// routes/amazonAccounts.js
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import AmazonAccount from '../models/AmazonAccount.js';

const router = Router();

// GET: Fetch all Amazon Accounts (Accessible by authenticated users so Dashboard can read it)
router.get('/', requireAuth, async (req, res) => {
  try {
    const accounts = await AmazonAccount.find().sort({ name: 1 });
    res.json(accounts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: Add new Amazon Account (Restricted to specific roles)
router.post('/', requireAuth, requireRole('superadmin', 'hoc', 'compliancemanager'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Account name is required' });
  
  try {
    const account = await AmazonAccount.create({ name });
    res.json(account);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(400).json({ error: 'Account name already exists' });
    }
    res.status(400).json({ error: e.message });
  }
});

// DELETE: Remove an account (Optional, but good to have)
router.delete('/:id', requireAuth, requireRole('superadmin', 'hoc', 'compliancemanager'), async (req, res) => {
    try {
      await AmazonAccount.findByIdAndDelete(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

export default router;