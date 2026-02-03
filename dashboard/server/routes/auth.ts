import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  verifyAdminPassword,
  verifyParticipantPassword,
  getAuthConfig,
  updateAdminPassword,
  getParticipantByAccessToken,
  getInstanceById,
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
    let { email, password } = req.body;

    // Clean inputs - trim whitespace, normalize email
    email = (email || '').toString().trim().toLowerCase();
    password = (password || '').toString().trim();

    console.log(`[Auth] Participant login attempt for email: "${email}"`);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const participant = verifyParticipantPassword(email, password);

    if (!participant) {
      // Debug: check if participant exists at all
      const { getParticipantByEmail, getAllParticipants } = require('../db/database.js');
      const existingParticipant = getParticipantByEmail(email);
      const totalParticipants = getAllParticipants().length;
      console.log(`[Auth] Login failed. Participant exists: ${!!existingParticipant}, Total participants in DB: ${totalParticipants}`);
      if (existingParticipant) {
        console.log(`[Auth] Participant found but password mismatch. Has password_hash: ${!!existingParticipant.password_hash}`);
      }
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

// Access token login (5-character code from landing page)
router.post('/access-token/login', (req, res) => {
  try {
    let { accessToken } = req.body;

    // Clean input - trim whitespace, uppercase
    accessToken = (accessToken || '').toString().trim().toUpperCase();

    console.log(`[Auth] Access token login attempt: "${accessToken}"`);

    if (!accessToken || accessToken.length !== 5) {
      return res.status(400).json({ error: 'Invalid access token format' });
    }

    const participant = getParticipantByAccessToken(accessToken);

    if (!participant) {
      console.log(`[Auth] Access token not found: ${accessToken}`);
      return res.status(401).json({ error: 'Invalid access token' });
    }

    // Check if participant has an assigned instance
    if (!participant.instance_id) {
      return res.status(400).json({
        error: 'No instance assigned yet. Please wait for your workspace to be provisioned.'
      });
    }

    // Get instance details
    const instance = getInstanceById(participant.instance_id);
    if (!instance) {
      return res.status(400).json({
        error: 'Instance not found. Please contact support.'
      });
    }

    // Check if instance is ready
    if (instance.status !== 'running') {
      return res.status(400).json({
        error: `Instance is ${instance.status}. Please wait for it to be ready.`
      });
    }

    // Generate JWT token
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
      instance: {
        id: instance.id,
        status: instance.status,
        vscode_url: instance.vscode_url,
        app_url: instance.app_url,
        cloudfront_domain: instance.cloudfront_domain,
      },
    });
  } catch (err) {
    console.error('Access token login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
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
