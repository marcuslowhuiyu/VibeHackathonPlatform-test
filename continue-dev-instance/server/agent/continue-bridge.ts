import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

const PROJECT_ROOT = '/home/workspace/project';
const CONFIG_PATH = '/app/continue-config.yaml';

/**
 * Bridge between the WebSocket server and the Continue CLI.
 * Spawns `cn -p "message" --format json` for each user message.
 */
export class ContinueBridge extends EventEmitter {
  private sessionId: string | null = null;
  private currentProcess: ChildProcess | null = null;

  /** Abort the currently running CLI process. */
  cancel(): void {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  /** Clear session state to start a fresh conversation. */
  clearHistory(): void {
    this.sessionId = null;
  }

  async processMessage(userMessage: string): Promise<void> {
    this.emit('agent:thinking', { text: 'Processing with Continue...' });

    const beforeSnapshot = await this.snapshotFiles();

    try {
      const response = await this.runCli(userMessage);

      if (response) {
        this.emit('agent:text', { text: response });
      }

      const afterSnapshot = await this.snapshotFiles();
      const changes = await this.detectChanges(beforeSnapshot, afterSnapshot);

      for (const change of changes) {
        this.emit('agent:file_changed', {
          path: change.path,
          content: change.content,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('agent:error', { error: message });
    }
  }

  private runCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--config', CONFIG_PATH];

      if (this.sessionId) {
        args.push('--resume', this.sessionId);
      }

      const proc = spawn('cn', args, {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          CI: 'true',
          NO_COLOR: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.currentProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code, signal) => {
        this.currentProcess = null;

        // If killed by cancel(), resolve with empty string
        if (signal === 'SIGTERM') {
          resolve(stdout.trim() || '');
          return;
        }

        if (code !== 0 && !stdout) {
          reject(new Error(`Continue CLI exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          if (parsed.sessionId) {
            this.sessionId = parsed.sessionId;
          }
          resolve(parsed.content || parsed.message || parsed.text || stdout);
        } catch {
          resolve(stdout.trim());
        }
      });

      proc.on('error', (err) => {
        this.currentProcess = null;
        reject(new Error(`Failed to spawn Continue CLI: ${err.message}`));
      });

      proc.stdin.end();
    });
  }

  private async snapshotFiles(): Promise<Map<string, number>> {
    const snapshot = new Map<string, number>();
    await this.walkForSnapshot(PROJECT_ROOT, PROJECT_ROOT, snapshot, 0, 4);
    return snapshot;
  }

  private async walkForSnapshot(
    dir: string,
    root: string,
    snapshot: Map<string, number>,
    depth: number,
    maxDepth: number,
  ): Promise<void> {
    if (depth > maxDepth) return;

    const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.cache']);

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        await this.walkForSnapshot(fullPath, root, snapshot, depth + 1, maxDepth);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          snapshot.set(relativePath, stat.mtimeMs);
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  private async detectChanges(
    before: Map<string, number>,
    after: Map<string, number>,
  ): Promise<Array<{ path: string; content: string }>> {
    const changes: Array<{ path: string; content: string }> = [];

    for (const [filePath, mtime] of after) {
      const prevMtime = before.get(filePath);
      if (prevMtime === undefined || mtime > prevMtime) {
        try {
          const fullPath = path.join(PROJECT_ROOT, filePath);
          const content = readFileSync(fullPath, 'utf-8');
          changes.push({ path: filePath, content });
        } catch {
          changes.push({ path: filePath, content: '' });
        }
      }
    }

    return changes;
  }
}
