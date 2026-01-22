import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'db.json');

interface Database {
  instances: Instance[];
  credentials: Credentials | null;
  config: Record<string, string>;
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
    credentials: null,
    config: {
      cluster_name: 'vibe-cluster',
      task_definition: 'vibe-coding-lab',
      vpc_id: '',
      subnet_ids: '',
      security_group_id: '',
      alb_arn: '',
      listener_arn: '',
    },
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
      credentials: null,
      config: {
        cluster_name: 'vibe-cluster',
        task_definition: 'vibe-coding-lab',
        vpc_id: '',
        subnet_ids: '',
        security_group_id: '',
        alb_arn: '',
        listener_arn: '',
      },
    };
    saveDb(initialDb);
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
  // CloudFront fields for HTTPS access
  cloudfront_distribution_id?: string;
  cloudfront_domain?: string;
  cloudfront_status?: string;
  public_ip?: string;
}

export function createInstance(id: string): Instance {
  const db = loadDb();
  const instance: Instance = {
    id,
    task_arn: null,
    status: 'provisioning',
    vscode_url: null,
    app_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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

// Credentials operations
export interface Credentials {
  access_key_id: string;
  secret_access_key: string;
  region: string;
}

export function getCredentials(): Credentials | undefined {
  const db = loadDb();
  return db.credentials || undefined;
}

export function saveCredentials(creds: Credentials): void {
  const db = loadDb();
  db.credentials = creds;
  saveDb(db);
}

export function deleteCredentials(): void {
  const db = loadDb();
  db.credentials = null;
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
