import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tools module
vi.mock('./tools.js', () => ({
  TOOL_DEFINITIONS: [
    {
      name: 'write_file',
      description: 'Write a file',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
    {
      name: 'edit_file',
      description: 'Edit a file',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] },
    },
    {
      name: 'read_file',
      description: 'Read a file',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  ],
  executeTool: vi.fn().mockResolvedValue('{"status":"ok"}'),
}));

// Mock the Bedrock SDK with proper class
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class MockBedrockClient {
    send = vi.fn();
  }
  return {
    BedrockRuntimeClient: MockBedrockClient,
    ConverseStreamCommand: class { constructor(public input: any) {} },
  };
});

// Mock fs/promises for edit_file content reading
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue('World content after edit'),
  },
}));

import { AgentLoop } from './agent-loop.js';
import { executeTool } from './tools.js';

// Helper: create an async iterable from yielded events
function makeStream(events: any[]) {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

describe('AgentLoop file_changed event', () => {
  let agent: AgentLoop;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new AgentLoop('vibe');
  });

  it('emits agent:file_changed with both path AND content for write_file', async () => {
    const fileChangedEvents: any[] = [];
    agent.on('agent:file_changed', (data) => fileChangedEvents.push(data));

    const mockBedrockSend = vi.fn();

    // First call: model returns a write_file tool use
    mockBedrockSend.mockResolvedValueOnce({
      stream: makeStream([
        { contentBlockStart: { start: { toolUse: { toolUseId: 'tool-1', name: 'write_file' } } } },
        { contentBlockDelta: { delta: { toolUse: { input: JSON.stringify({ path: 'test.txt', content: 'hello world' }) } } } },
        { contentBlockStop: {} },
        { messageStop: { stopReason: 'tool_use' } },
      ]),
    });

    // Second call: model finishes with end_turn
    mockBedrockSend.mockResolvedValueOnce({
      stream: makeStream([
        { contentBlockDelta: { delta: { text: 'Done!' } } },
        { contentBlockStop: {} },
        { messageStop: { stopReason: 'end_turn' } },
      ]),
    });

    (agent as any).client = { send: mockBedrockSend };

    vi.mocked(executeTool).mockResolvedValueOnce('{"status":"ok","path":"/home/workspace/project/test.txt","bytes":11}');

    await agent.processMessage('Create a test file');

    expect(fileChangedEvents.length).toBeGreaterThanOrEqual(1);
    const event = fileChangedEvents[0];
    expect(event.path).toBe('test.txt');
    // KEY ASSERTION: content must be defined, not undefined
    expect(event.content).toBeDefined();
    expect(event.content).toBe('hello world');
  });

  it('emits agent:file_changed with content for edit_file', async () => {
    const fileChangedEvents: any[] = [];
    agent.on('agent:file_changed', (data) => fileChangedEvents.push(data));

    const mockBedrockSend = vi.fn();

    mockBedrockSend.mockResolvedValueOnce({
      stream: makeStream([
        { contentBlockStart: { start: { toolUse: { toolUseId: 'tool-2', name: 'edit_file' } } } },
        { contentBlockDelta: { delta: { toolUse: { input: JSON.stringify({ path: 'app.tsx', old_string: 'Hello', new_string: 'World' }) } } } },
        { contentBlockStop: {} },
        { messageStop: { stopReason: 'tool_use' } },
      ]),
    });

    mockBedrockSend.mockResolvedValueOnce({
      stream: makeStream([
        { contentBlockDelta: { delta: { text: 'Edited!' } } },
        { contentBlockStop: {} },
        { messageStop: { stopReason: 'end_turn' } },
      ]),
    });

    (agent as any).client = { send: mockBedrockSend };

    vi.mocked(executeTool).mockResolvedValueOnce('{"status":"ok","path":"/home/workspace/project/app.tsx","replacements":1}');

    await agent.processMessage('Edit the file');

    expect(fileChangedEvents.length).toBeGreaterThanOrEqual(1);
    const event = fileChangedEvents[0];
    expect(event.path).toBe('app.tsx');
    expect(event.content).toBeDefined();
    expect(typeof event.content).toBe('string');
  });

  it('does NOT emit agent:file_changed for non-mutating tools like read_file', async () => {
    const fileChangedEvents: any[] = [];
    agent.on('agent:file_changed', (data) => fileChangedEvents.push(data));

    const mockBedrockSend = vi.fn();

    mockBedrockSend.mockResolvedValueOnce({
      stream: makeStream([
        { contentBlockStart: { start: { toolUse: { toolUseId: 'tool-3', name: 'read_file' } } } },
        { contentBlockDelta: { delta: { toolUse: { input: JSON.stringify({ path: 'readme.md' }) } } } },
        { contentBlockStop: {} },
        { messageStop: { stopReason: 'tool_use' } },
      ]),
    });

    mockBedrockSend.mockResolvedValueOnce({
      stream: makeStream([
        { contentBlockDelta: { delta: { text: 'Here is the file.' } } },
        { contentBlockStop: {} },
        { messageStop: { stopReason: 'end_turn' } },
      ]),
    });

    (agent as any).client = { send: mockBedrockSend };

    vi.mocked(executeTool).mockResolvedValueOnce('1\tHello World');

    await agent.processMessage('Read the file');

    expect(fileChangedEvents.length).toBe(0);
  });
});
