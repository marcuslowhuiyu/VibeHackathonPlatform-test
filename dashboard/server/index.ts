import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import instancesRouter from './routes/instances.js';
import configRouter from './routes/config.js';
import setupRouter from './routes/setup.js';
import participantsRouter from './routes/participants.js';
import authRouter from './routes/auth.js';
import portalRouter from './routes/portal.js';
import { requireAdmin } from './middleware/auth.js';
import { initDatabase } from './db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initDatabase();

// Public API Routes (no auth required)
app.use('/api/auth', authRouter);

// Protected Admin API Routes
app.use('/api/instances', requireAdmin, instancesRouter);
app.use('/api/config', requireAdmin, configRouter);
app.use('/api/setup', requireAdmin, setupRouter);
app.use('/api/participants', requireAdmin, participantsRouter);

// Participant Portal Routes
app.use('/api/portal', portalRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version/build info - helps verify which code is deployed
app.get('/api/version', (req, res) => {
  res.json({
    version: '2.2.0',
    build: process.env.BUILD_SHA || 'local',
    buildDate: '2026-02-05',
    features: ['continue', 'cline', 'codebuild-setup', 'task-role-auth'],
  });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));

  // Clean URL redirects - redirect to hash routes
  app.get('/portal', (req, res) => {
    res.redirect('/#/portal');
  });

  app.get('/portal/*', (req, res) => {
    res.redirect('/#/portal');
  });

  app.get('/admin', (req, res) => {
    res.redirect('/#/login');
  });

  app.get('/login', (req, res) => {
    res.redirect('/#/login');
  });

  // SPA fallback - serve index.html for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`
====================================
  Vibe Dashboard Server
====================================
  Running on: http://localhost:${PORT}
  API: http://localhost:${PORT}/api
====================================
  `);
});
