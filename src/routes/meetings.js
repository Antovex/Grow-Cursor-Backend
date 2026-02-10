import express from 'express';
import Meeting from '../models/Meeting.js';
import User from '../models/User.js';
import EmployeeProfile from '../models/EmployeeProfile.js';
import { requireAuth as auth } from '../middleware/auth.js';
import mongoose from 'mongoose';

const router = express.Router();

// Helper: Get available slots for a user on a given date
// NOTE: All times are in IST (Asia/Kolkata timezone)
const getUserAvailability = async (userId, dateStr) => {
    // dateStr is expected to be YYYY-MM-DD
    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Get User's Standard Working Hours
    const profile = await EmployeeProfile.findOne({ user: userId });

    // Default 9-18 if not set or invalid
    let startHour = 9;
    let endHour = 18;

    if (profile?.standardWorkingHours?.start && profile?.standardWorkingHours?.end) {
        try {
            const s = parseInt(profile.standardWorkingHours.start.split(':')[0]);
            const e = parseInt(profile.standardWorkingHours.end.split(':')[0]);
            if (!isNaN(s) && s >= 0 && s < 24) startHour = s;
            if (!isNaN(e) && e >= startHour && e <= 24) endHour = e;
        } catch (err) {
            console.warn(`Invalid working hours format for user ${userId}, using defaults (09:00-18:00)`);
        }
    } else {
        console.info(`User ${userId} has no working hours set, using defaults (09:00-18:00)`);
    }

    // 2. Get User's Existing Meetings for this Date
    // Only block slots for meetings where:
    // - User is the creator (auto-accepted), OR
    // - User has accepted the invitation
    // Pending/Rejected meetings should NOT block slots
    const meetings = await Meeting.find({
        date: { $gte: startOfDay, $lte: endOfDay },
        status: { $ne: 'cancelled' },
        $or: [
            { creator: userId }, // User is creator (auto-accepted)
            {
                attendees: {
                    $elemMatch: {
                        user: userId,
                        status: 'accepted' // User has accepted
                    }
                }
            }
        ]
    });

    // 3. Calculate Occupied Slots
    const occupiedSlots = new Set();
    meetings.forEach(m => {
        const mStart = parseInt(m.startTime.split(':')[0]);
        const mEnd = parseInt(m.endTime.split(':')[0]);
        // Mark full hours as occupied. 
        // Example: 09:30 - 10:30. 
        // Simplified logic: If a meeting touches an hour, that hour is busy?
        // User requirement: "each slot is 1 hour long". Let's assume meetings start on the hour for simplicity, 
        // or if they overlap at all, the slot is taken.

        // Better approach: 1-hour slots starting at startHour.
        // Check if slot [H, H+1) overlaps with [mStart, mEnd).
        // Converting everything to minutes might be safer but "1 hour slots" suggests discrete logic.
        // Let's stick to integer hours for the "slots" offered to the UI.

        // If meeting is 09:00-10:00, it occupies 9.
        // If meeting is 09:30-10:30, it occupies 9 and 10.

        // We'll treat the day as a series of 1-hour blocks from startHour to endHour.
        // A block H (H to H+1) is available if no meeting overlaps it.

        // Let's parse exact minutes for meetings to be precise.
        const [mStartH, mStartM] = m.startTime.split(':').map(Number);
        const [mEndH, mEndM] = m.endTime.split(':').map(Number);
        const mStartTotal = mStartH * 60 + mStartM;
        const mEndTotal = mEndH * 60 + mEndM;

        for (let h = startHour; h < endHour; h++) {
            const slotStart = h * 60;
            const slotEnd = (h + 1) * 60;

            // Check overlap
            if (Math.max(slotStart, mStartTotal) < Math.min(slotEnd, mEndTotal)) {
                occupiedSlots.add(h);
            }
        }
    });

    // 4. Return Full Data
    return {
        startHour,
        endHour,
        occupiedSlots
    };
};

// GET /availability
// Query: date (YYYY-MM-DD), users (comma separated IDs)
router.get('/availability', auth, async (req, res) => {
    try {
        const { date, users } = req.query;
        if (!date || !users) {
            return res.status(400).json({ error: 'Missing date or users' });
        }

        // Split and filter out empty strings
        const userIds = users.split(',').filter(id => id && id.trim() !== '');

        // Include the requester in the check if not already present
        const currentUserId = req.user.userId || req.user._id || req.user.id;
        if (currentUserId && !userIds.includes(currentUserId.toString())) {
            userIds.push(currentUserId.toString());
        }

        // Validate we have at least one user
        if (userIds.length === 0) {
            return res.status(400).json({ error: 'No valid user IDs provided' });
        }

        // Get availability for all users
        const availabilityMap = {}; // userId -> [slots]
        for (const uid of userIds) {
            // Validate ObjectId format
            if (!uid || uid.length !== 24) {
                console.warn(`Invalid user ID format: ${uid}`);
                continue;
            }

            try {
                availabilityMap[uid] = await getUserAvailability(uid, date);
            } catch (error) {
                console.error(`Failed to get availability for user ${uid}:`, error.message);
                // Default to empty availability if user lookup fails
                availabilityMap[uid] = [];
            }
        }

        // Ensure we have at least one user with valid availability
        if (Object.keys(availabilityMap).length === 0) {
            return res.status(400).json({ error: 'No valid users to check availability for' });
        }

        // Calculate availability with conflict reasons
        // We'll use a standard day range (e.g., 9 to 18) for the UI, 
        // or the union of all users' working hours. Let's use 9-18 as base but expand if needed.
        let minStart = 9;
        let maxEnd = 18;

        // Optional: Expand range based on users' actual working hours
        for (const uid in availabilityMap) {
            const data = availabilityMap[uid];
            if (data.startHour < minStart) minStart = data.startHour;
            if (data.endHour > maxEnd) maxEnd = data.endHour;
        }

        const slots = [];
        for (let h = minStart; h < maxEnd; h++) {
            let isBusy = false;
            let busyUsers = [];
            let notWorkingUsers = [];

            for (const uid of userIds) {
                const userData = availabilityMap[uid];

                // Check if hour is within user's working hours
                if (h < userData.startHour || h >= userData.endHour) {
                    isBusy = true;
                    notWorkingUsers.push(uid);
                }
                // Check if user has a meeting
                else if (userData.occupiedSlots.has(h)) {
                    isBusy = true;
                    busyUsers.push(uid);
                }
            }

            if (isBusy) {
                // Construct reason
                let reasons = [];
                if (busyUsers.length > 0) {
                    reasons.push(`Busy: ${busyUsers.map(u => `User ${u}`).join(', ')}`);
                }
                if (notWorkingUsers.length > 0) {
                    reasons.push(`Not working: ${notWorkingUsers.map(u => `User ${u}`).join(', ')}`);
                }
                slots.push({ hour: h, status: 'busy', reason: reasons.join('\n') });
            } else {
                slots.push({ hour: h, status: 'available' });
            }
        }

        // Enhance reasons with usernames
        // We need to fetch usernames for the IDs involved in conflicts
        // Optimization: Fetch all users in selected list once
        const usersObjects = await User.find({ _id: { $in: userIds } }, 'username');
        const userMap = {};
        usersObjects.forEach(u => userMap[u._id.toString()] = u.username);

        // Update reasons with actual usernames
        const enhancedSlots = slots.map(slot => {
            if (slot.status === 'busy') {
                let reason = slot.reason;
                for (const [id, name] of Object.entries(userMap)) {
                    // Global replace for this ID
                    // Use regex with 'g' flag to replace all occurrences if user appears multiple times (unlikely here but safe)
                    // Escape ID for regex just in case
                    const regex = new RegExp(`User ${id}`, 'g');
                    reason = reason.replace(regex, name);
                }
                return { ...slot, reason };
            }
            return slot;
        });

        res.json({ slots: enhancedSlots });

    } catch (error) {
        console.error('Availability Check Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /create
router.post('/create', auth, async (req, res) => {
    try {
        const { title, description, date, startTime, attendees, meetingLink } = req.body;
        // attendees expected to be array of userIds

        // Validate
        if (!title || !date || !startTime || !attendees || attendees.length === 0) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Calculate End Time (Assuming 1 hour duration per req)
        const [sh, sm] = startTime.split(':').map(Number);
        const endH = sh + 1;
        const endTime = `${endH.toString().padStart(2, '0')}:${sm.toString().padStart(2, '0')}`;

        // Get creator ID from auth payload
        const creatorId = req.user.userId || req.user._id || req.user.id;

        const newMeeting = new Meeting({
            title,
            description,
            meetingLink,
            date: new Date(date),
            startTime,
            endTime,
            creator: creatorId,
            attendees: attendees.map(uid => ({
                user: uid,
                status: 'pending'
            }))
        });

        // Add creator to attendees list implicitly as 'accepted'? 
        // Or separates? The model has `creator` field.
        // The UI should probably show Creator in the list or separate.
        // Let's ensure creator is tracked if they want to block their own slot?
        // Usually creator is "accepted" by default.
        // Let's add creator to attendees list if not there
        if (creatorId && !attendees.includes(creatorId.toString())) {
            newMeeting.attendees.push({
                user: creatorId,
                status: 'accepted'
            });
        }

        await newMeeting.save();
        res.status(201).json(newMeeting);
    } catch (error) {
        console.error('Create Meeting Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /:id/edit - Edit meeting core details (Creator only)
router.put('/:id/edit', auth, async (req, res) => {
    try {
        const { title, description, date, startTime, meetingLink } = req.body;
        const meeting = await Meeting.findById(req.params.id);

        if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

        // Use robust ID check
        const userId = req.user.userId || req.user._id || req.user.id;
        if (meeting.creator.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Only creator can edit meeting' });
        }

        meeting.title = title || meeting.title;
        meeting.description = description || meeting.description;
        meeting.meetingLink = meetingLink || meeting.meetingLink; // Allow empty string to clear? Or just update if provided.
        if (date) meeting.date = new Date(date);

        if (startTime) {
            meeting.startTime = startTime;
            // Recalculate endTime
            const [sh, sm] = startTime.split(':').map(Number);
            const endH = sh + 1;
            meeting.endTime = `${endH.toString().padStart(2, '0')}:${sm.toString().padStart(2, '0')}`;
        }

        await meeting.save();

        // Return populated meeting
        const populated = await Meeting.findById(meeting._id)
            .populate('creator', 'username email')
            .populate('attendees.user', 'username email');

        res.json(populated);
    } catch (error) {
        console.error('Edit Meeting Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// GET /my-meetings
router.get('/my-meetings', auth, async (req, res) => {
    try {
        const userId = req.user.userId || req.user._id || req.user.id;
        const meetings = await Meeting.find({
            $or: [
                { creator: userId },
                { "attendees.user": userId }
            ]
        })
            .populate('creator', 'username email')
            .populate('attendees.user', 'username email') // Basic info
            .sort({ date: 1, startTime: 1 });

        res.json(meetings);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /:id - Cancel meeting (Creator only)
router.delete('/:id', auth, async (req, res) => {
    try {
        const meeting = await Meeting.findById(req.params.id);

        if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

        // Only creator can cancel
        const userId = req.user.userId || req.user._id || req.user.id;
        if (meeting.creator.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Only creator can cancel meeting' });
        }

        // Soft delete - set status to cancelled
        meeting.status = 'cancelled';
        await meeting.save();

        res.json({ message: 'Meeting cancelled successfully' });
    } catch (error) {
        console.error('Cancel Meeting Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// PUT /:id/respond
router.put('/:id/respond', auth, async (req, res) => {
    try {
        const { status, rejectionReason } = req.body; // 'accepted' or 'rejected'
        const meeting = await Meeting.findById(req.params.id);

        if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

        const userId = req.user.userId || req.user._id || req.user.id;
        const attendeeIndex = meeting.attendees.findIndex(a => a.user.toString() === userId.toString());
        if (attendeeIndex === -1) {
            return res.status(403).json({ error: 'You are not invited to this meeting' });
        }

        meeting.attendees[attendeeIndex].status = status;
        if (status === 'rejected' && rejectionReason) {
            meeting.attendees[attendeeIndex].rejectionReason = rejectionReason;
        }

        // Update overall status
        // If rejected, set overall to unconfirmed? Or let it stay unconfirmed.
        // If ALL accepted, set confirmed.
        const allAccepted = meeting.attendees.every(a => a.status === 'accepted');
        if (allAccepted) {
            meeting.status = 'confirmed';
        } else {
            // If anyone rejects, we leave it unconfirmed or specific state?
            // Req: "until eveybody accepts... state... will be upcoming unconfirmed"
            meeting.status = 'unconfirmed';
        }

        await meeting.save();
        res.json(meeting);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /:id (Edit / Reschedule)
router.put('/:id', auth, async (req, res) => {
    try {
        const meeting = await Meeting.findById(req.params.id);
        if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

        if (meeting.creator.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Only creator can edit' });
        }

        const { date, startTime, title, description, agenda, details, conclusion } = req.body;

        let rescheduling = false;

        // Check if rescheduling
        if ((date && new Date(date).getTime() !== new Date(meeting.date).getTime()) ||
            (startTime && startTime !== meeting.startTime)) {
            rescheduling = true;
        }

        if (title) meeting.title = title;
        if (description) meeting.description = description;
        if (agenda) meeting.agenda = agenda;
        if (details) meeting.details = details;
        if (conclusion) meeting.conclusion = conclusion;

        if (rescheduling) {
            meeting.date = new Date(date);
            meeting.startTime = startTime;
            // Recalc End Time (1 hr)
            const [sh, sm] = startTime.split(':').map(Number);
            const endH = sh + 1;
            meeting.endTime = `${endH.toString().padStart(2, '0')}:${sm.toString().padStart(2, '0')}`;

            // RESET statuses to pending (except creator)
            meeting.attendees.forEach(a => {
                if (a.user.toString() !== meeting.creator.toString()) {
                    a.status = 'pending';
                    a.rejectionReason = undefined; // Clear previous rejection reasons
                }
            });
            meeting.status = 'unconfirmed';
        }

        await meeting.save();
        res.json(meeting);

    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /:id/attendance (Mark Attendance)
router.put('/:id/attendance', auth, async (req, res) => {
    try {
        const { attendance } = req.body; // Array of { user: id, present: bool }
        const meeting = await Meeting.findById(req.params.id);

        if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

        const userId = req.user.userId || req.user._id || req.user.id;
        if (meeting.creator.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Only creator can mark attendance' });
        }

        meeting.attendance = attendance;

        // Mark as completed if date is in past or today
        const now = new Date();
        const meetingDate = new Date(meeting.date);
        if (meetingDate <= now) {
            meeting.status = 'completed';
        }

        await meeting.save();
        res.json(meeting);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;
