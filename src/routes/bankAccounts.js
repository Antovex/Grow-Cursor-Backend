import express from 'express';
import BankAccount from '../models/BankAccount.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/bank-accounts - List all
router.get('/', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const accounts = await BankAccount.find().sort({ name: 1 });
        res.json(accounts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/bank-accounts - Create
router.post('/', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { name, accountNumber } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }
        const newAccount = new BankAccount({ name, accountNumber });
        await newAccount.save();
        res.status(201).json(newAccount);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Account name must be unique' });
        }
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/bank-accounts/:id - Update
router.put('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, accountNumber } = req.body;
        const account = await BankAccount.findByIdAndUpdate(
            id,
            { name, accountNumber },
            { new: true }
        );
        res.json(account);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/bank-accounts/:id - Delete
router.delete('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        await BankAccount.findByIdAndDelete(id);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
