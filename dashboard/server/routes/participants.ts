import { Router } from 'express';
import {
  createParticipantsWithPasswords,
  regenerateParticipantPassword,
  getAllParticipants,
  getUnassignedParticipants,
  getParticipantById,
  updateParticipant,
  deleteParticipant,
  deleteAllParticipants,
  assignParticipantToInstance,
  unassignParticipant,
  Participant,
} from '../db/database.js';

const router = Router();

// Get all participants
router.get('/', (req, res) => {
  try {
    const participants = getAllParticipants();
    const unassigned = participants.filter((p) => p.instance_id === null);
    const assigned = participants.filter((p) => p.instance_id !== null);

    res.json({
      participants,
      stats: {
        total: participants.length,
        unassigned: unassigned.length,
        assigned: assigned.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get unassigned participants only
router.get('/unassigned', (req, res) => {
  try {
    const participants = getUnassignedParticipants();
    res.json(participants);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import participants (bulk create from CSV/paste) - generates passwords
router.post('/import', (req, res) => {
  try {
    const { participants: data } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'No participants provided' });
    }

    // Validate each participant has at least a name
    const validData = data.filter((p: any) => p.name && p.name.trim());
    if (validData.length === 0) {
      return res.status(400).json({ error: 'No valid participants (name is required)' });
    }

    const { participants, passwords } = createParticipantsWithPasswords(
      validData.map((p: any) => ({
        name: p.name.trim(),
        email: (p.email || '').trim(),
        notes: (p.notes || '').trim(),
      }))
    );

    // Return participants with their plain passwords for admin to distribute
    const participantsWithPasswords = participants.map((p) => ({
      ...p,
      password: passwords.find((pw) => pw.email === p.email)?.password || p.password_plain,
    }));

    res.json({
      success: true,
      imported: participants.length,
      participants: participantsWithPasswords,
      passwords, // Also include as separate list for easy export
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create single participant (with password generation)
router.post('/', (req, res) => {
  try {
    const { name, email, notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const { participants, passwords } = createParticipantsWithPasswords([{
      name: name.trim(),
      email: (email || '').trim(),
      notes: (notes || '').trim(),
    }]);

    const participant = participants[0];
    const password = passwords[0]?.password;

    res.json({
      success: true,
      participant: {
        ...participant,
        password, // Include plain password for admin
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate password for a participant
router.post('/:id/regenerate-password', (req, res) => {
  try {
    const participant = getParticipantById(req.params.id);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const newPassword = regenerateParticipantPassword(req.params.id);
    if (!newPassword) {
      return res.status(500).json({ error: 'Failed to regenerate password' });
    }

    res.json({
      success: true,
      password: newPassword,
      email: participant.email,
      name: participant.name,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update participant
router.patch('/:id', (req, res) => {
  try {
    const participant = getParticipantById(req.params.id);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const { name, email, notes } = req.body;
    updateParticipant(req.params.id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(email !== undefined && { email: email.trim() }),
      ...(notes !== undefined && { notes: notes.trim() }),
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Assign participant to instance
router.post('/:id/assign', (req, res) => {
  try {
    const { instance_id } = req.body;

    if (!instance_id) {
      return res.status(400).json({ error: 'instance_id is required' });
    }

    const participant = getParticipantById(req.params.id);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    assignParticipantToInstance(req.params.id, instance_id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Unassign participant from instance
router.post('/:id/unassign', (req, res) => {
  try {
    const participant = getParticipantById(req.params.id);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    unassignParticipant(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete participant
router.delete('/:id', (req, res) => {
  try {
    const participant = getParticipantById(req.params.id);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    deleteParticipant(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all participants
router.delete('/', (req, res) => {
  try {
    deleteAllParticipants();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Debug: Check participant password status (admin only)
router.get('/debug/check-passwords', (req, res) => {
  try {
    const participants = getAllParticipants();
    const summary = participants.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      has_password_hash: !!p.password_hash,
      password_hash_length: p.password_hash?.length || 0,
      instance_id: p.instance_id,
    }));

    res.json({
      total: participants.length,
      with_password: summary.filter((p) => p.has_password_hash).length,
      without_password: summary.filter((p) => !p.has_password_hash).length,
      participants: summary,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
