const BASE_URL = '/api'

export interface Instance {
  id: string
  task_arn: string | null
  status: string
  vscode_url: string | null
  app_url: string | null
  created_at: string
  updated_at: string
  participant_name?: string
  participant_email?: string
  notes?: string
}

export interface Credentials {
  configured: boolean
  accessKeyId?: string
  region?: string
}

export interface PermissionCheck {
  service: string
  permission: string
  status: 'granted' | 'denied' | 'error'
  message: string
}

export interface ValidateCredentialsResult {
  valid: boolean
  message: string
  permissions?: PermissionCheck[]
}

export interface Config {
  cluster_name: string
  task_definition: string
  vpc_id: string
  subnet_ids: string
  security_group_id: string
  alb_arn: string
  listener_arn: string
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }

  return response.json()
}

export const api = {
  // Instances
  getInstances: () => fetchJson<Instance[]>('/instances'),

  spinUpInstances: (count: number) =>
    fetchJson<{ success: boolean; instances: Instance[]; errors?: string[] }>(
      '/instances/spin-up',
      {
        method: 'POST',
        body: JSON.stringify({ count }),
      }
    ),

  stopInstance: (id: string) =>
    fetchJson<{ success: boolean }>(`/instances/${id}/stop`, {
      method: 'POST',
    }),

  startInstance: (id: string) =>
    fetchJson<{ success: boolean }>(`/instances/${id}/start`, {
      method: 'POST',
    }),

  deleteInstance: (id: string) =>
    fetchJson<{ success: boolean }>(`/instances/${id}`, {
      method: 'DELETE',
    }),

  stopAllInstances: () =>
    fetchJson<{ success: boolean; stopped: number; total: number; errors?: string[] }>(
      '/instances/stop-all',
      { method: 'POST' }
    ),

  deleteAllInstances: () =>
    fetchJson<{ success: boolean; deleted: number; errors?: string[] }>(
      '/instances/all',
      { method: 'DELETE' }
    ),

  updateInstance: (id: string, data: { participant_name?: string; participant_email?: string; notes?: string }) =>
    fetchJson<{ success: boolean }>(`/instances/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Credentials
  getCredentials: () => fetchJson<Credentials>('/credentials'),

  saveCredentials: (creds: {
    accessKeyId: string
    secretAccessKey: string
    region: string
  }) =>
    fetchJson<{ success: boolean }>('/credentials', {
      method: 'POST',
      body: JSON.stringify(creds),
    }),

  validateCredentials: () =>
    fetchJson<ValidateCredentialsResult>('/credentials/validate'),

  deleteCredentials: () =>
    fetchJson<{ success: boolean }>('/credentials', {
      method: 'DELETE',
    }),

  // Config
  getConfig: () => fetchJson<Config>('/config'),

  updateConfig: (config: Partial<Config>) =>
    fetchJson<{ success: boolean; updated: Partial<Config> }>('/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  // Setup
  getSetupStatus: () =>
    fetchJson<{ configured: boolean; missing: string[]; ecrImageExists: boolean; imageUri: string | null }>('/setup/status'),

  runSetup: () =>
    fetchJson<{
      success: boolean;
      steps: { step: string; status: string; message?: string; resourceId?: string }[];
      config?: Config;
      error?: string;
    }>('/setup/run', { method: 'POST' }),

  getDockerCommands: () =>
    fetchJson<{ commands: string }>('/setup/docker-commands'),

  getDockerStatus: () =>
    fetchJson<{ available: boolean; message: string }>('/setup/docker-status'),

  buildAndPushImage: () =>
    fetchJson<{
      success: boolean;
      steps: { success: boolean; step: string; message: string; error?: string }[];
      error?: string;
    }>('/setup/build-and-push', { method: 'POST' }),

  // File editing
  getEditableFiles: () =>
    fetchJson<{
      files: { name: string; description: string; language: string; exists: boolean }[];
    }>('/setup/files'),

  getFileContent: (filename: string) =>
    fetchJson<{
      name: string;
      content: string;
      description: string;
      language: string;
    }>(`/setup/files/${encodeURIComponent(filename)}`),

  saveFileContent: (filename: string, content: string) =>
    fetchJson<{ success: boolean; message: string }>(`/setup/files/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
}
