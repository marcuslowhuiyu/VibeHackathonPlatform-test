import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Play,
  Square,
  Trash2,
  ExternalLink,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Download,
  Copy,
  Check,
  StopCircle,
  User,
  Mail,
  FileText,
  Edit3,
  X,
  Save,
  ChevronDown,
  ChevronUp,
  Server,
  Link,
  Calendar,
  Cloud,
} from 'lucide-react'
import { api, Instance } from '../lib/api'

interface InstanceListProps {
  instances: Instance[]
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'running':
      return 'text-green-400'
    case 'provisioning':
    case 'pending':
      return 'text-yellow-400'
    case 'stopping':
    case 'deprovisioning':
      return 'text-orange-400'
    case 'stopped':
      return 'text-gray-400'
    default:
      return 'text-red-400'
  }
}

function getStatusIcon(status: string) {
  switch (status.toLowerCase()) {
    case 'running':
      return <CheckCircle className="w-4 h-4 text-green-400" />
    case 'provisioning':
    case 'pending':
      return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
    case 'stopping':
    case 'deprovisioning':
      return <Clock className="w-4 h-4 text-orange-400" />
    case 'stopped':
      return <Square className="w-4 h-4 text-gray-400" />
    default:
      return <AlertCircle className="w-4 h-4 text-red-400" />
  }
}

// Parse Task ARN and generate AWS Console URL
// ARN format: arn:aws:ecs:region:account-id:task/cluster-name/task-id
function getAwsConsoleUrl(taskArn: string | null): string | null {
  if (!taskArn) return null

  try {
    const parts = taskArn.split(':')
    if (parts.length < 6) return null

    const region = parts[3]
    const taskPart = parts[5] // "task/cluster-name/task-id"
    const taskParts = taskPart.split('/')

    if (taskParts.length < 3) return null

    const clusterName = taskParts[1]
    const taskId = taskParts[2]

    return `https://${region}.console.aws.amazon.com/ecs/v2/clusters/${clusterName}/tasks/${taskId}?region=${region}`
  } catch {
    return null
  }
}

interface EditModalProps {
  instance: Instance
  onClose: () => void
  onSave: (data: { participant_name?: string; participant_email?: string; notes?: string }) => void
  isSaving: boolean
}

function EditModal({ instance, onClose, onSave, isSaving }: EditModalProps) {
  const [name, setName] = useState(instance.participant_name || '')
  const [email, setEmail] = useState(instance.participant_email || '')
  const [notes, setNotes] = useState(instance.notes || '')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Edit Instance: {instance.id}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              <User className="w-4 h-4 inline mr-1" />
              Participant Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              <Mail className="w-4 h-4 inline mr-1" />
              Participant Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              <FileText className="w-4 h-4 inline mr-1" />
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this participant or instance..."
              rows={3}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ participant_name: name, participant_email: email, notes })}
            disabled={isSaving}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default function InstanceList({ instances }: InstanceListProps) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null)
  const [expandedInstances, setExpandedInstances] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) => {
    setExpandedInstances((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  const stopMutation = useMutation({
    mutationFn: api.stopInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const startMutation = useMutation({
    mutationFn: api.startInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const stopAllMutation = useMutation({
    mutationFn: api.stopAllInstances,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const deleteAllMutation = useMutation({
    mutationFn: api.deleteAllInstances,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { participant_name?: string; participant_email?: string; notes?: string } }) =>
      api.updateInstance(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      setEditingInstance(null)
    },
  })

  const runningInstances = instances.filter(
    (i) => ['running', 'provisioning', 'pending'].includes(i.status.toLowerCase())
  )
  const activeWithUrls = instances.filter(
    (i) => i.vscode_url && i.status.toLowerCase() === 'running'
  )

  const copyLinksToClipboard = () => {
    const links = activeWithUrls
      .map(
        (i) =>
          `${i.participant_name || i.id}${i.participant_email ? ` (${i.participant_email})` : ''}\nVS Code: ${i.vscode_url}\nReact App: ${i.app_url || 'N/A'}\n`
      )
      .join('\n')

    navigator.clipboard.writeText(links).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const exportToCSV = () => {
    const headers = ['Instance ID', 'Participant Name', 'Participant Email', 'Status', 'VS Code URL', 'React App URL', 'Notes', 'Created At']
    const rows = instances.map((i) => [
      i.id,
      i.participant_name || '',
      i.participant_email || '',
      i.status,
      i.vscode_url || '',
      i.app_url || '',
      i.notes || '',
      new Date(i.created_at).toLocaleString(),
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `vibe-instances-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
  }

  return (
    <div className="space-y-4">
      {/* Status Summary */}
      {instances.length > 0 && (
        <div className="bg-gray-800/50 rounded-lg p-4 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-gray-400">Total:</span>{' '}
              <span className="font-semibold">{instances.length}</span>
            </div>
            <div>
              <span className="text-green-400">Running:</span>{' '}
              <span className="font-semibold">{instances.filter(i => i.status.toLowerCase() === 'running').length}</span>
            </div>
            <div>
              <span className="text-yellow-400">Starting:</span>{' '}
              <span className="font-semibold">{instances.filter(i => ['provisioning', 'pending'].includes(i.status.toLowerCase())).length}</span>
            </div>
            <div>
              <span className="text-gray-400">Stopped:</span>{' '}
              <span className="font-semibold">{instances.filter(i => i.status.toLowerCase() === 'stopped').length}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {instances.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (confirm(`Stop all ${runningInstances.length} running instances?`)) {
                  stopAllMutation.mutate()
                }
              }}
              disabled={stopAllMutation.isPending || runningInstances.length === 0}
              className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              {stopAllMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <StopCircle className="w-4 h-4" />
              )}
              Stop All ({runningInstances.length})
            </button>
            <button
              onClick={() => {
                if (confirm(`DELETE ALL ${instances.length} instances? This cannot be undone!`)) {
                  deleteAllMutation.mutate()
                }
              }}
              disabled={deleteAllMutation.isPending || instances.length === 0}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              {deleteAllMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Delete All
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={copyLinksToClipboard}
              disabled={activeWithUrls.length === 0}
              className="bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
              title="Copy all running instance links to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy Links ({activeWithUrls.length})
                </>
              )}
            </button>
            <button
              onClick={exportToCSV}
              className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
              title="Export all instances to CSV"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>
      )}

      {/* Instance List */}
      {instances.map((instance) => {
        const isExpanded = expandedInstances.has(instance.id)
        return (
          <div
            key={instance.id}
            className="bg-gray-700/50 rounded-lg overflow-hidden"
          >
            {/* Main Row - Clickable to expand */}
            <div
              className="p-4 cursor-pointer hover:bg-gray-700/70 transition-colors"
              onClick={() => toggleExpanded(instance.id)}
            >
              <div className="flex flex-wrap items-center gap-4">
                {/* Expand Icon */}
                <div className="text-gray-400">
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5" />
                  ) : (
                    <ChevronDown className="w-5 h-5" />
                  )}
                </div>

                {/* Status & ID */}
                <div className="flex items-center gap-3 min-w-[200px]">
                  {getStatusIcon(instance.status)}
                  <div>
                    <p className="font-mono text-sm">{instance.id}</p>
                    <p className={`text-xs ${getStatusColor(instance.status)}`}>
                      {instance.status.toUpperCase()}
                    </p>
                  </div>
                </div>

                {/* Participant Info */}
                <div className="flex-1 min-w-[150px]">
                  {instance.participant_name ? (
                    <div className="text-sm">
                      <div className="flex items-center gap-1 text-white">
                        <User className="w-3 h-3 text-gray-400" />
                        {instance.participant_name}
                      </div>
                      {instance.participant_email && (
                        <div className="flex items-center gap-1 text-gray-400 text-xs">
                          <Mail className="w-3 h-3" />
                          {instance.participant_email}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-500 text-sm italic">No participant assigned</span>
                  )}
                </div>

                {/* URLs */}
                <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  {instance.vscode_url ? (
                    <>
                      <a
                        href={instance.vscode_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm flex items-center gap-1"
                      >
                        VS Code
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href={instance.app_url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 rounded text-sm flex items-center gap-1"
                      >
                        React App
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </>
                  ) : (
                    <span className="text-gray-400 text-sm">
                      {['provisioning', 'pending'].includes(instance.status.toLowerCase())
                        ? 'Starting up...'
                        : 'No URLs available'}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setEditingInstance(instance)}
                    className="bg-gray-600 hover:bg-gray-500 p-2 rounded-lg"
                    title="Edit participant info"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  {instance.task_arn && getAwsConsoleUrl(instance.task_arn) && (
                    <a
                      href={getAwsConsoleUrl(instance.task_arn)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-amber-600 hover:bg-amber-500 p-2 rounded-lg"
                      title="View on AWS Console"
                    >
                      <Cloud className="w-4 h-4" />
                    </a>
                  )}

                  {['running', 'provisioning', 'pending'].includes(
                    instance.status.toLowerCase()
                  ) ? (
                    <button
                      onClick={() => stopMutation.mutate(instance.id)}
                      disabled={stopMutation.isPending}
                      className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 p-2 rounded-lg"
                      title="Stop"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => startMutation.mutate(instance.id)}
                      disabled={startMutation.isPending}
                      className="bg-green-600 hover:bg-green-500 disabled:opacity-50 p-2 rounded-lg"
                      title="Start"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => {
                      if (confirm(`Delete instance ${instance.id}?`)) {
                        deleteMutation.mutate(instance.id)
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="bg-red-600 hover:bg-red-500 disabled:opacity-50 p-2 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
              <div className="px-4 pb-4 pt-0 border-t border-gray-600/50 bg-gray-800/30">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                  {/* Left Column - Technical Details */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                      <Server className="w-4 h-4" />
                      Technical Details
                    </h4>

                    <div className="space-y-2 text-sm">
                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">Task ARN</span>
                        <span className="font-mono text-xs text-gray-300 break-all">
                          {instance.task_arn || 'Not assigned'}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">Status</span>
                        <span className={`font-semibold ${getStatusColor(instance.status)}`}>
                          {instance.status.toUpperCase()}
                        </span>
                      </div>

                      {/* View on AWS Button */}
                      {instance.task_arn && getAwsConsoleUrl(instance.task_arn) && (
                        <div className="pt-2">
                          <a
                            href={getAwsConsoleUrl(instance.task_arn)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded text-sm"
                          >
                            <Cloud className="w-4 h-4" />
                            View on AWS
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column - URLs & Timestamps */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                      <Link className="w-4 h-4" />
                      URLs & Access
                    </h4>

                    <div className="space-y-2 text-sm">
                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">VS Code URL</span>
                        {instance.vscode_url ? (
                          <a
                            href={instance.vscode_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 text-xs break-all"
                          >
                            {instance.vscode_url}
                          </a>
                        ) : (
                          <span className="text-gray-500 text-xs">Not available</span>
                        )}
                      </div>

                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">React App URL</span>
                        {instance.app_url ? (
                          <a
                            href={instance.app_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 text-xs break-all"
                          >
                            {instance.app_url}
                          </a>
                        ) : (
                          <span className="text-gray-500 text-xs">Not available</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Participant Info - Full Width */}
                  <div className="space-y-3 md:col-span-2">
                    <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Participant Information
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">Name</span>
                        <span className="text-gray-300">
                          {instance.participant_name || 'Not assigned'}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">Email</span>
                        <span className="text-gray-300">
                          {instance.participant_email || 'Not provided'}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">Notes</span>
                        <span className="text-gray-300">
                          {instance.notes || 'No notes'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Timestamps - Full Width */}
                  <div className="space-y-3 md:col-span-2">
                    <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Timestamps
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">Created</span>
                        <span className="text-gray-300">
                          {new Date(instance.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs">Last Updated</span>
                        <span className="text-gray-300">
                          {new Date(instance.updated_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Edit Modal */}
      {editingInstance && (
        <EditModal
          instance={editingInstance}
          onClose={() => setEditingInstance(null)}
          onSave={(data) => updateMutation.mutate({ id: editingInstance.id, data })}
          isSaving={updateMutation.isPending}
        />
      )}
    </div>
  )
}
