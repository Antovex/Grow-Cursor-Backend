import express from 'express';
import PayoneerRecord from '../models/PayoneerRecord.js';
import Transaction from '../models/Transaction.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Helper to calculate fields
const calculateFields = (amount, exchangeRate) => {
    const amountNum = parseFloat(amount);
    const rateNum = parseFloat(exchangeRate);

    // Actual Exchange Rate = Rate + (Rate * 0.02)
    const actualExchangeRate = rateNum + (rateNum * 0.02);

    // Bank Deposit = Amount * Exchange Rate (NOT Actual Rate)
    const bankDeposit = amountNum * rateNum;

    return {
        amount: amountNum,
        exchangeRate: rateNum,
        actualExchangeRate: parseFloat(actualExchangeRate.toFixed(4)), // Keep decent precision
        bankDeposit: parseFloat(bankDeposit.toFixed(2)) // Currency usually 2 decimals
    };
};

// GET /api/payoneer - List all records
router.get('/', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const records = await PayoneerRecord.find()
            .populate({
                path: 'store',
                select: 'user',
                populate: {
                    path: 'user',
                    select: 'username'
                }
            })
            .populate({
                path: 'paymentAccount',
                select: 'name',
                populate: {
                    path: 'bankAccount',
                    select: 'name'
                }
            })
            .sort({ paymentDate: -1 });
        res.json(records);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/payoneer - Create new record
router.post('/', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { paymentAccount, paymentDate, amount, exchangeRate, store } = req.body;

        if (!paymentAccount || !paymentDate || !amount || !exchangeRate || !store) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const calcs = calculateFields(amount, exchangeRate);

        const newRecord = new PayoneerRecord({
            paymentAccount,
            // bankName removed, accessed via relation
            paymentDate,
            store,
            ...calcs
        });

        await newRecord.save();

        // Populate return data
        await newRecord.populate([
            {
                path: 'store',
                select: 'user',
                populate: {
                    path: 'user',
                    select: 'username'
                }
            },
            {
                path: 'paymentAccount',
                select: 'name',
                populate: { path: 'bankAccount', select: 'name' }
            }
        ]);

        // --- SYNC WITH TRANSACTION ---
        try {
            // Find the Bank Account ID from the Payment Account
            const paymentAcc = await newRecord.paymentAccount; // Already populated
            if (paymentAcc && paymentAcc.bankAccount) {
                await Transaction.create({
                    date: newRecord.paymentDate,
                    bankAccount: paymentAcc.bankAccount._id,
                    transactionType: 'Credit',
                    amount: newRecord.bankDeposit,
                    remark: 'Payoneer',
                    source: 'PAYONEER',
                    sourceId: newRecord._id
                });
            }
        } catch (syncErr) {
            console.error('Failed to sync Payoneer to Transaction:', syncErr);
            // Optional: Choose to revert PayoneerRecord creation or just log error
        }

        res.status(201).json(newRecord);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/payoneer/:id - Update record
router.put('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentAccount, paymentDate, amount, exchangeRate, store } = req.body;

        const record = await PayoneerRecord.findById(id);
        if (!record) return res.status(404).json({ error: 'Record not found' });

        // Update basic fields if provided
        if (paymentAccount) record.paymentAccount = paymentAccount;
        if (paymentDate) record.paymentDate = paymentDate;
        if (store) record.store = store;

        // Recalculate if amount or rate changes
        // We use the new value if provided, otherwise fallback to existing
        const newAmount = amount !== undefined ? amount : record.amount;
        const newRate = exchangeRate !== undefined ? exchangeRate : record.exchangeRate;

        const calcs = calculateFields(newAmount, newRate);

        record.amount = calcs.amount;
        record.exchangeRate = calcs.exchangeRate;
        record.actualExchangeRate = calcs.actualExchangeRate;
        record.bankDeposit = calcs.bankDeposit;

        await record.save();

        await record.populate([
            {
                path: 'store',
                select: 'user',
                populate: {
                    path: 'user',
                    select: 'username'
                }
            },
            {
                path: 'paymentAccount',
                select: 'name',
                populate: { path: 'bankAccount', select: 'name' }
            }
        ]);

        // --- SYNC UPDATE TRANSACTION ---
        try {
            // Re-fetch bank account ID just in case payment account changed
            const paymentAcc = await record.paymentAccount;

            if (paymentAcc && paymentAcc.bankAccount) {
                await Transaction.findOneAndUpdate(
                    { source: 'PAYONEER', sourceId: record._id },
                    {
                        date: record.paymentDate,
                        bankAccount: paymentAcc.bankAccount._id,
                        amount: record.bankDeposit
                    },
                    { upsert: true } // Create if missing for some reason
                );
            }
        } catch (syncErr) {
            console.error('Failed to sync update to Transaction:', syncErr);
        }

        res.json(record);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/payoneer/:id - Delete record
router.delete('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        await PayoneerRecord.findByIdAndDelete(id);

        // --- SYNC DELETE TRANSACTION ---
        await Transaction.findOneAndDelete({ source: 'PAYONEER', sourceId: id });

        res.json({ message: 'Record deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
