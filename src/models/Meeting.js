import mongoose from 'mongoose';

const MeetingSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        meetingLink: { type: String, trim: true },

        // Time & Date
        date: { type: Date, required: true }, // Store midnight of the meeting day (UTC/Local)
        startTime: { type: String, required: true }, // Format "HH:mm" (e.g., "09:30")
        endTime: { type: String, required: true },   // Format "HH:mm" (e.g., "10:30")
        durationMinutes: { type: Number, required: true, default: 60 },

        creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

        // Attendees List & Status
        attendees: [
            {
                user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                status: {
                    type: String,
                    enum: ['pending', 'accepted', 'rejected'],
                    default: 'pending'
                },
                rejectionReason: { type: String, trim: true }
            }
        ],

        // Meeting Status
        // 'unconfirmed': At least one person hasn't accepted (or rejected without reschedule)
        // 'confirmed': Everyone accepted
        // 'cancelled': Creator cancelled
        // 'completed': Meeting happened
        status: {
            type: String,
            enum: ['unconfirmed', 'confirmed', 'cancelled', 'completed'],
            default: 'unconfirmed'
        },

        // Post-Meeting Details
        agenda: { type: String, trim: true }, // Can be pre-filled
        details: { type: String, trim: true }, // Meeting minutes/notes
        conclusion: { type: String, trim: true }, // Action items/outcome

        // Attendance (Marked by Creator after meeting)
        attendance: [
            {
                user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                present: { type: Boolean, default: false }
            }
        ]
    },
    { timestamps: true }
);

// Indexes for faster querying
MeetingSchema.index({ date: 1 });
MeetingSchema.index({ "attendees.user": 1 });
MeetingSchema.index({ creator: 1 });

export default mongoose.model('Meeting', MeetingSchema);
