import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import instancesRouter from './routes/instances.js';
import credentialsRouter from './routes/credentials.js';
import configRouter from './routes/config.js';
import setupRouter from './routes/setup.js';
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

// API Routes
app.use('/api/instances', instancesRouter);
app.use('/api/credentials', credentialsRouter);
app.use('/api/config', configRouter);
app.use('/api/setup', setupRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
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
