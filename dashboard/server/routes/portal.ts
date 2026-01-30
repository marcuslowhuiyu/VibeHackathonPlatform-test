import { Router } from 'express';
import { getParticipantById, getInstanceById } from '../db/database.js';
import { requireParticipant } from '../middleware/auth.js';

const router = Router();

// All portal routes require participant authentication
router.use(requireParticipant);

// Get the logged-in participant's instance
router.get('/my-instance', (req, res) => {
  try {
    const participantId = req.user?.id;

    if (!participantId) {
      return res.status(400).json({ error: 'Participant ID not found in token' });
    }

    const participant = getParticipantById(participantId);

    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    if (!participant.instance_id) {
      return res.json({
        participant: {
          id: participant.id,
          name: participant.name,
          email: participant.email,
        },
        instance: null,
        message: 'No instance assigned yet. Please wait for an instance to be assigned.',
      });
    }

    const instance = getInstanceById(participant.instance_id);

    if (!instance) {
      return res.json({
        participant: {
          id: participant.id,
          name: participant.name,
          email: participant.email,
        },
        instance: null,
        message: 'Instance not found. It may have been terminated.',
      });
    }

    res.json({
      participant: {
        id: participant.id,
        name: participant.name,
        email: participant.email,
      },
      instance: {
        id: instance.id,
        status: instance.status,
        vscode_url: instance.vscode_url,
        app_url: instance.app_url,
        cloudfront_domain: instance.cloudfront_domain,
        cloudfront_status: instance.cloudfront_status,
        ai_extension: instance.ai_extension,
      },
    });
  } catch (err) {
    console.error('Get my instance error:', err);
    res.status(500).json({ error: 'Failed to get instance' });
  }
});

export default router;
