import { getToken, clearToken } from './auth'

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
  // AI extension used for this instance
  ai_extension?: 'continue' | 'cline' | 'vibe' | 'loclaude-lite' | 'loclaude'
  // CloudFront fields for HTTPS access
  cloudfront_distribution_id?: string
  cloudfront_domain?: string
  cloudfront_status?: string
  public_ip?: string
}

export interface Config {
  cluster_name: string
  task_definition: string
  vpc_id: string
  subnet_ids: string
  security_group_id: string
  alb_arn: string
  listener_arn: string
  ai_extension?: string
}

export interface Participant {
  id: string
  name: string
  email: string
  notes?: string
  instance_id: string | null
  access_token?: string
  created_at: string
  updated_at: string
}

export interface ParticipantsResponse {
  participants: Participant[]
  stats: {
    total: number
    unassigned: number
    assigned: number
  }
}

// Helper to get auth headers
function getAuthHeaders(): Record<string, string> {
  const token = getToken()
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
  })

  if (!response.ok) {
    // Handle 401 - clear token and redirect to login
    if (response.status === 401) {
      clearToken()
      // Redirect to login based on current path
      const isPortal = window.location.hash.includes('portal')
      window.location.hash = isPortal ? '#/portal' : '#/login'
      throw new Error('Session expired. Please login again.')
    }

    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }

  return response.json()
}

// Unauthenticated fetch for login endpoints
async function fetchJsonNoAuth<T>(url: string, options?: RequestInit): Promise<T> {
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

  spinUpInstances: ({ count, extension, autoAssignParticipants = true }: { count: number; extension: string; autoAssignParticipants?: boolean }) =>
    fetchJson<{ success: boolean; instances: Instance[]; participantsAssigned?: number; errors?: string[] }>(
      '/instances/spin-up',
      {
        method: 'POST',
        body: JSON.stringify({ count, extension, autoAssignParticipants }),
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

  // Orphaned instances (running on AWS but not tracked)
  scanOrphanedInstances: () =>
    fetchJson<{
      total_running: number
      tracked: number
      orphaned: number
      orphaned_tasks: {
        task_arn: string
        task_id: string
        status: string
        public_ip: string | null
        private_ip: string | null
        started_at: string | null
        task_definition: string | null
        vscode_url: string | null
        app_url: string | null
      }[]
    }>('/instances/orphaned/scan'),

  importOrphanedTask: (taskArn: string, taskId: string) =>
    fetchJson<{ success: boolean; instance_id: string; message: string }>(
      '/instances/orphaned/import',
      {
        method: 'POST',
        body: JSON.stringify({ task_arn: taskArn, task_id: taskId }),
      }
    ),

  terminateOrphanedTask: (taskArn: string) =>
    fetchJson<{ success: boolean; message: string }>(
      '/instances/orphaned/terminate',
      {
        method: 'POST',
        body: JSON.stringify({ task_arn: taskArn }),
      }
    ),

  terminateAllOrphanedTasks: () =>
    fetchJson<{ success: boolean; total: number; terminated: number; errors: string[] }>(
      '/instances/orphaned/terminate-all',
      { method: 'POST' }
    ),

  updateInstance: (id: string, data: { participant_name?: string; participant_email?: string; notes?: string }) =>
    fetchJson<{ success: boolean }>(`/instances/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
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
    // To add new extensions, update availableImages type: ('continue' | 'cline' | 'roo-code')[]
    fetchJson<{
      configured: boolean;
      missing: string[];
      ecrImageExists: boolean;
      imageUri: string | null;
      availableImages?: ('continue')[];
      sharedAlbConfigured: boolean;
      cloudfrontDomain: string | null;
    }>('/setup/status'),

  runSetup: () =>
    fetchJson<{
      success: boolean;
      steps: { step: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'; message?: string; resourceId?: string }[];
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

  // CodeBuild (for building without Docker)
  getCodeBuildStatus: () =>
    fetchJson<{ exists: boolean; projectName: string }>('/setup/codebuild/status'),

  startCodeBuild: () =>
    fetchJson<{ success: boolean; buildId: string }>('/setup/codebuild/start', { method: 'POST' }),

  getCodeBuildProgress: (buildId: string) =>
    fetchJson<{
      id: string;
      status: string;
      phase: string;
      startTime?: string;
      endTime?: string;
    }>(`/setup/codebuild/build/${encodeURIComponent(buildId)}`),

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

  // Participants
  getParticipants: () => fetchJson<ParticipantsResponse>('/participants'),

  getUnassignedParticipants: () => fetchJson<Participant[]>('/participants/unassigned'),

  importParticipants: (participants: { name: string; email: string; notes?: string }[]) =>
    fetchJson<{ success: boolean; imported: number; participants: Participant[] }>(
      '/participants/import',
      {
        method: 'POST',
        body: JSON.stringify({ participants }),
      }
    ),

  createParticipant: (data: { name: string; email: string; notes?: string }) =>
    fetchJson<{ success: boolean; participant: Participant }>('/participants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateParticipant: (id: string, data: { name?: string; email?: string; notes?: string }) =>
    fetchJson<{ success: boolean }>(`/participants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  assignParticipant: (participantId: string, instanceId: string) =>
    fetchJson<{ success: boolean }>(`/participants/${participantId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ instance_id: instanceId }),
    }),

  unassignParticipant: (participantId: string) =>
    fetchJson<{ success: boolean }>(`/participants/${participantId}/unassign`, {
      method: 'POST',
    }),

  deleteParticipant: (id: string) =>
    fetchJson<{ success: boolean }>(`/participants/${id}`, {
      method: 'DELETE',
    }),

  deleteAllParticipants: () =>
    fetchJson<{ success: boolean }>('/participants', {
      method: 'DELETE',
    }),

  regenerateParticipantPassword: (id: string) =>
    fetchJson<{ success: boolean; password: string; email: string; name: string }>(
      `/participants/${id}/regenerate-password`,
      { method: 'POST' }
    ),

  // Auth endpoints (no auth required)
  adminLogin: (password: string) =>
    fetchJsonNoAuth<{ success: boolean; token: string; user: { type: 'admin' } }>(
      '/auth/admin/login',
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      }
    ),

  participantLogin: (email: string, password: string) =>
    fetchJsonNoAuth<{
      success: boolean
      token: string
      user: {
        type: 'participant'
        id: string
        name: string
        email: string
        instanceId: string | null
      }
    }>('/auth/participant/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  verifyToken: () =>
    fetchJson<{ valid: boolean; user: { type: string } }>('/auth/verify'),

  changeAdminPassword: (currentPassword: string, newPassword: string) =>
    fetchJson<{ success: boolean; message: string }>('/auth/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // Portal endpoints (participant auth required)
  getMyInstance: () =>
    fetchJson<{
      participant: { id: string; name: string; email: string }
      instance: {
        id: string
        status: string
        vscode_url: string | null
        app_url: string | null
        cloudfront_domain: string | null
        cloudfront_status: string | null
        ai_extension: string | null
      } | null
      message?: string
    }>('/portal/my-instance'),

  changeParticipantPassword: (currentPassword: string, newPassword: string) =>
    fetchJson<{ success: boolean; message: string }>('/portal/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // Auto-assign all unassigned participants
  autoAssignParticipants: (extension: string = 'continue') =>
    fetchJson<{
      success: boolean
      message: string
      assigned: number
      instancesCreated: number
      errors?: string[]
    }>('/participants/auto-assign', {
      method: 'POST',
      body: JSON.stringify({ extension }),
    }),

}
