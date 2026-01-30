import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  verifyAdminPassword,
  verifyParticipantPassword,
  getAuthConfig,
  updateAdminPassword,
} from '../db/database.js';
import { generateToken, requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Admin login
router.post('/admin/login', (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const isValid = verifyAdminPassword(password);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = generateToken({ type: 'admin' });

    res.json({
      success: true,
      token,
      user: { type: 'admin' },
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Participant login
router.post('/participant/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const participant = verifyParticipantPassword(email, password);

    if (!participant) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken({
      type: 'participant',
      id: participant.id,
      email: participant.email,
      name: participant.name,
    });

    res.json({
      success: true,
      token,
      user: {
        type: 'participant',
        id: participant.id,
        name: participant.name,
        email: participant.email,
        instanceId: participant.instance_id,
      },
    });
  } catch (err) {
    console.error('Participant login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify token validity
router.get('/verify', requireAuth, (req, res) => {
  res.json({
    valid: true,
    user: req.user,
  });
});

// Change admin password (requires admin auth)
router.post('/admin/change-password', requireAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters' });
    }

    // Verify current password
    if (!verifyAdminPassword(currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash and save new password
    const newHash = bcrypt.hashSync(newPassword, 10);
    updateAdminPassword(newHash);

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;
