import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'db.json');

// Participant interface for the participant pool
export interface Participant {
  id: string;
  name: string;
  email: string;
  notes?: string;
  instance_id: string | null; // null if unassigned
  password_hash: string;      // bcrypt hash
  password_plain?: string;    // Temporary for export/display, cleared after
  access_token: string;       // 5-character alphanumeric access token for landing page
  created_at: string;
  updated_at: string;
}

// Auth configuration
export interface AuthConfig {
  admin_password_hash: string;  // bcrypt hash for admin
  jwt_secret: string;           // Auto-generated on first run
}

interface Database {
  instances: Instance[];
  config: Record<string, string>;
  participants: Participant[];
  auth: AuthConfig;
}

// Generate default auth config
function generateDefaultAuth(): AuthConfig {
  return {
    admin_password_hash: bcrypt.hashSync('admin', 10), // Default password: admin
    jwt_secret: crypto.randomBytes(32).toString('hex'),
  };
}

function loadDb(): Database {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading database:', err);
  }
  return {
    instances: [],
    config: {
      cluster_name: 'vibe-cluster',
      task_definition: 'vibe-coding-lab',
      vpc_id: '',
      subnet_ids: '',
      security_group_id: '',
      alb_arn: '',
      listener_arn: '',
      ai_extension: 'continue',
      ecr_repository: '',
    },
    participants: [],
    auth: generateDefaultAuth(),
  };
}

function saveDb(db: Database): void {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

export function initDatabase(): void {
  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Initialize database file if it doesn't exist
  if (!fs.existsSync(dbPath)) {
    const initialDb: Database = {
      instances: [],
      config: {
        cluster_name: 'vibe-cluster',
        task_definition: 'vibe-coding-lab',
        vpc_id: '',
        subnet_ids: '',
        security_group_id: '',
        alb_arn: '',
        listener_arn: '',
        ai_extension: 'continue',
        ecr_repository: '',
      },
      participants: [],
      auth: generateDefaultAuth(),
    };
    saveDb(initialDb);
  }

  // Migrate existing database
  const db = loadDb();
  let needsSave = false;

  // Add participants array if missing
  if (!db.participants) {
    db.participants = [];
    needsSave = true;
  }

  // Add auth config if missing
  if (!db.auth) {
    db.auth = generateDefaultAuth();
    needsSave = true;
    console.log('Auth config initialized. Default admin password: admin');
  }

  if (needsSave) {
    saveDb(db);
  }

  console.log('Database initialized at:', dbPath);
}

// Instance operations
export interface Instance {
  id: string;
  task_arn: string | null;
  status: string;
  vscode_url: string | null;
  app_url: string | null;
  created_at: string;
  updated_at: string;
  participant_name?: string;
  participant_email?: string;
  notes?: string;
  // AI extension used for this instance
  // To add new extensions, update the type and validExtensions in instances.ts
  ai_extension?: 'continue' | 'cline' | 'vibe' | 'vibe-pro';
  // CloudFront fields for HTTPS access (legacy - per-instance CloudFront)
  cloudfront_distribution_id?: string;
  cloudfront_domain?: string;
  cloudfront_status?: string;
  public_ip?: string;
  // Shared ALB fields (new - single CloudFront for all instances)
  alb_target_group_arn?: string;
  alb_rule_arn?: string;
  alb_access_path?: string;
}

export function createInstance(id: string, aiExtension?: 'continue' | 'cline' | 'vibe' | 'vibe-pro'): Instance {
  const db = loadDb();
  const instance: Instance = {
    id,
    task_arn: null,
    status: 'provisioning',
    vscode_url: null,
    app_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ai_extension: aiExtension,
  };
  db.instances.push(instance);
  saveDb(db);
  return instance;
}

export function getInstanceById(id: string): Instance | undefined {
  const db = loadDb();
  return db.instances.find((i) => i.id === id);
}

export function getAllInstances(): Instance[] {
  const db = loadDb();
  return db.instances.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function updateInstance(id: string, updates: Partial<Instance>): void {
  const db = loadDb();
  const index = db.instances.findIndex((i) => i.id === id);
  if (index !== -1) {
    db.instances[index] = {
      ...db.instances[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    saveDb(db);
  }
}

export function deleteInstance(id: string): void {
  const db = loadDb();
  db.instances = db.instances.filter((i) => i.id !== id);
  saveDb(db);
}

// Config operations
export function getConfig(key: string): string | undefined {
  const db = loadDb();
  return db.config[key];
}

export function setConfig(key: string, value: string): void {
  const db = loadDb();
  db.config[key] = value;
  saveDb(db);
}

export function getAllConfig(): Record<string, string> {
  const db = loadDb();
  return db.config;
}

// Participant operations
export function createParticipant(data: { name: string; email: string; notes?: string }): Participant {
  const db = loadDb();
  const accessToken = generateAccessToken();
  const participant: Participant = {
    id: `p-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    name: data.name,
    email: data.email,
    notes: data.notes,
    instance_id: null,
    password_hash: '',
    access_token: accessToken,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.participants.push(participant);
  saveDb(db);
  return participant;
}

export function createParticipants(dataArray: { name: string; email: string; notes?: string }[]): Participant[] {
  const db = loadDb();
  const usedTokens = new Set(db.participants.map(p => p.access_token).filter(Boolean));
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const participants: Participant[] = dataArray.map((data, index) => {
    // Generate unique access token
    let accessToken = '';
    do {
      accessToken = '';
      for (let i = 0; i < 5; i++) {
        accessToken += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (usedTokens.has(accessToken));
    usedTokens.add(accessToken);

    return {
      id: `p-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
      name: data.name,
      email: data.email,
      notes: data.notes,
      instance_id: null,
      password_hash: '',
      access_token: accessToken,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
  db.participants.push(...participants);
  saveDb(db);
  return participants;
}

export function getParticipantById(id: string): Participant | undefined {
  const db = loadDb();
  return db.participants.find((p) => p.id === id);
}

export function getAllParticipants(): Participant[] {
  const db = loadDb();
  return db.participants || [];
}

export function getUnassignedParticipants(): Participant[] {
  const db = loadDb();
  return (db.participants || []).filter((p) => p.instance_id === null);
}

export function getAssignedParticipants(): Participant[] {
  const db = loadDb();
  return (db.participants || []).filter((p) => p.instance_id !== null);
}

export function updateParticipant(id: string, updates: Partial<Participant>): void {
  const db = loadDb();
  const index = db.participants.findIndex((p) => p.id === id);
  if (index !== -1) {
    db.participants[index] = {
      ...db.participants[index],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    saveDb(db);
  }
}

export function assignParticipantToInstance(participantId: string, instanceId: string): void {
  const db = loadDb();
  const pIndex = db.participants.findIndex((p) => p.id === participantId);
  const iIndex = db.instances.findIndex((i) => i.id === instanceId);

  if (pIndex !== -1 && iIndex !== -1) {
    const participant = db.participants[pIndex];

    // Update participant
    db.participants[pIndex].instance_id = instanceId;
    db.participants[pIndex].updated_at = new Date().toISOString();

    // Update instance with participant info
    db.instances[iIndex].participant_name = participant.name;
    db.instances[iIndex].participant_email = participant.email;
    db.instances[iIndex].notes = participant.notes;
    db.instances[iIndex].updated_at = new Date().toISOString();

    saveDb(db);
  }
}

export function unassignParticipant(participantId: string): void {
  const db = loadDb();
  const pIndex = db.participants.findIndex((p) => p.id === participantId);

  if (pIndex !== -1) {
    const instanceId = db.participants[pIndex].instance_id;

    // Clear participant's instance assignment
    db.participants[pIndex].instance_id = null;
    db.participants[pIndex].updated_at = new Date().toISOString();

    // Clear instance's participant info if there was an instance
    if (instanceId) {
      const iIndex = db.instances.findIndex((i) => i.id === instanceId);
      if (iIndex !== -1) {
        db.instances[iIndex].participant_name = undefined;
        db.instances[iIndex].participant_email = undefined;
        db.instances[iIndex].notes = undefined;
        db.instances[iIndex].updated_at = new Date().toISOString();
      }
    }

    saveDb(db);
  }
}

export function deleteParticipant(id: string): void {
  const db = loadDb();
  const participant = db.participants.find((p) => p.id === id);

  // If assigned, clear the instance's participant info
  if (participant?.instance_id) {
    const iIndex = db.instances.findIndex((i) => i.id === participant.instance_id);
    if (iIndex !== -1) {
      db.instances[iIndex].participant_name = undefined;
      db.instances[iIndex].participant_email = undefined;
      db.instances[iIndex].notes = undefined;
      db.instances[iIndex].updated_at = new Date().toISOString();
    }
  }

  db.participants = db.participants.filter((p) => p.id !== id);
  saveDb(db);
}

export function deleteAllParticipants(): void {
  const db = loadDb();

  // Clear all instance participant info
  db.instances.forEach((instance, index) => {
    db.instances[index].participant_name = undefined;
    db.instances[index].participant_email = undefined;
    db.instances[index].notes = undefined;
    db.instances[index].updated_at = new Date().toISOString();
  });

  db.participants = [];
  saveDb(db);
}

// Auth operations
export function getAuthConfig(): AuthConfig {
  const db = loadDb();
  return db.auth;
}

export function updateAdminPassword(newPasswordHash: string): void {
  const db = loadDb();
  db.auth.admin_password_hash = newPasswordHash;
  saveDb(db);
}

export function getParticipantByEmail(email: string): Participant | undefined {
  const db = loadDb();
  const cleanEmail = (email || '').trim().toLowerCase();
  return db.participants.find((p) => (p.email || '').trim().toLowerCase() === cleanEmail);
}

// Generate a random password (8 chars, alphanumeric)
export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // Removed confusing chars like 0, O, 1, l
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Generate a unique 5-character access token
export function generateAccessToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Uppercase + numbers, no confusing chars
  const db = loadDb();
  const existingTokens = new Set(db.participants.map(p => p.access_token).filter(Boolean));

  let token = '';
  do {
    token = '';
    for (let i = 0; i < 5; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (existingTokens.has(token)); // Ensure uniqueness

  return token;
}

// Get participant by access token
export function getParticipantByAccessToken(accessToken: string): Participant | undefined {
  const db = loadDb();
  const cleanToken = (accessToken || '').trim().toUpperCase();
  return db.participants.find((p) => p.access_token === cleanToken);
}

// Create participants with auto-generated passwords and access tokens
export function createParticipantsWithPasswords(
  dataArray: { name: string; email: string; notes?: string }[]
): { participants: Participant[]; passwords: { email: string; password: string }[] } {
  const db = loadDb();
  const passwords: { email: string; password: string }[] = [];
  const usedTokens = new Set(db.participants.map(p => p.access_token).filter(Boolean));

  const participants: Participant[] = dataArray.map((data, index) => {
    const plainPassword = generatePassword();
    const passwordHash = bcrypt.hashSync(plainPassword, 10);

    // Generate unique access token
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let accessToken = '';
    do {
      accessToken = '';
      for (let i = 0; i < 5; i++) {
        accessToken += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (usedTokens.has(accessToken));
    usedTokens.add(accessToken);

    // Clean and normalize email
    const cleanEmail = (data.email || '').trim().toLowerCase();
    const cleanName = (data.name || '').trim();
    const cleanNotes = (data.notes || '').trim();

    passwords.push({ email: cleanEmail, password: plainPassword });

    return {
      id: `p-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
      name: cleanName,
      email: cleanEmail,
      notes: cleanNotes || undefined,
      instance_id: null,
      password_hash: passwordHash,
      password_plain: plainPassword, // Include for immediate display
      access_token: accessToken,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  db.participants.push(...participants);
  saveDb(db);

  return { participants, passwords };
}

// Regenerate password for a participant
export function regenerateParticipantPassword(participantId: string): string | null {
  const db = loadDb();
  const index = db.participants.findIndex((p) => p.id === participantId);

  if (index === -1) return null;

  const newPassword = generatePassword();
  db.participants[index].password_hash = bcrypt.hashSync(newPassword, 10);
  db.participants[index].password_plain = newPassword;
  db.participants[index].updated_at = new Date().toISOString();
  saveDb(db);

  return newPassword;
}

// Verify participant password
export function verifyParticipantPassword(email: string, password: string): Participant | null {
  const participant = getParticipantByEmail(email);
  if (!participant || !participant.password_hash) return null;

  const isValid = bcrypt.compareSync(password, participant.password_hash);
  return isValid ? participant : null;
}

// Verify admin password
export function verifyAdminPassword(password: string): boolean {
  const auth = getAuthConfig();
  return bcrypt.compareSync(password, auth.admin_password_hash);
}
