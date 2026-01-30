import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users,
  Upload,
  Trash2,
  UserPlus,
  UserMinus,
  Loader2,
  CheckCircle,
  AlertCircle,
  Link,
  X,
  FileSpreadsheet,
  Copy,
  Key,
  Download,
} from 'lucide-react'
import { api, Participant } from '../lib/api'

interface ImportedCredentials {
  email: string
  password: string
  name?: string
}

export default function ParticipantManager() {
  const queryClient = useQueryClient()
  const [showImportModal, setShowImportModal] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [showAssignModal, setShowAssignModal] = useState<Participant | null>(null)
  const [importedCredentials, setImportedCredentials] = useState<ImportedCredentials[] | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const { data: participantsData, isLoading } = useQuery({
    queryKey: ['participants'],
    queryFn: api.getParticipants,
  })

  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: api.getInstances,
  })

  const importMutation = useMutation({
    mutationFn: api.importParticipants,
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['participants'] })
      setShowImportModal(false)
      setImportText('')
      setImportError('')
      // Store imported credentials to show to admin
      if (data.passwords && data.passwords.length > 0) {
        const creds = data.participants.map((p: any) => ({
          email: p.email,
          password: p.password || data.passwords.find((pw: any) => pw.email === p.email)?.password,
          name: p.name,
        }))
        setImportedCredentials(creds)
      }
    },
    onError: (err: any) => {
      setImportError(err.message)
    },
  })

  const assignMutation = useMutation({
    mutationFn: ({ participantId, instanceId }: { participantId: string; instanceId: string }) =>
      api.assignParticipant(participantId, instanceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['participants'] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      setShowAssignModal(null)
    },
  })

  const unassignMutation = useMutation({
    mutationFn: api.unassignParticipant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['participants'] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteParticipant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['participants'] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const deleteAllMutation = useMutation({
    mutationFn: api.deleteAllParticipants,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['participants'] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const parseImportText = (text: string): { name: string; email: string; notes?: string }[] => {
    const lines = text.trim().split('\n')
    const participants: { name: string; email: string; notes?: string }[] = []

    for (const line of lines) {
      if (!line.trim()) continue

      // Try to parse as tab-separated (Excel paste) or comma-separated
      const parts = line.includes('\t') ? line.split('\t') : line.split(',')

      if (parts.length >= 1) {
        participants.push({
          name: parts[0]?.trim() || '',
          email: parts[1]?.trim() || '',
          notes: parts[2]?.trim() || '',
        })
      }
    }

    return participants.filter((p) => p.name)
  }

  const handleImport = () => {
    const participants = parseImportText(importText)
    if (participants.length === 0) {
      setImportError('No valid participants found. Make sure each line has at least a name.')
      return
    }
    importMutation.mutate(participants)
  }

  const participants = participantsData?.participants || []
  const stats = participantsData?.stats || { total: 0, unassigned: 0, assigned: 0 }

  // Get instances that don't have participants assigned
  const availableInstances = instances.filter(
    (i) => !i.participant_name && ['running', 'provisioning', 'pending'].includes(i.status.toLowerCase())
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header & Stats */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" />
            Participant Pool
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowImportModal(true)}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
            {participants.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('Delete ALL participants? This cannot be undone.')) {
                    deleteAllMutation.mutate()
                  }
                }}
                disabled={deleteAllMutation.isPending}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-700/50 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold">{stats.total}</div>
            <div className="text-sm text-gray-400">Total</div>
          </div>
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-green-400">{stats.assigned}</div>
            <div className="text-sm text-green-400">Assigned</div>
          </div>
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-yellow-400">{stats.unassigned}</div>
            <div className="text-sm text-yellow-400">Unassigned</div>
          </div>
        </div>
      </div>

      {/* Participants List */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">All Participants</h3>

        {participants.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No participants imported yet</p>
            <p className="text-sm mt-1">Click Import to add participants from Excel/CSV</p>
          </div>
        ) : (
          <div className="space-y-2">
            {participants.map((participant) => (
              <div
                key={participant.id}
                className={`flex items-center justify-between p-4 rounded-lg ${
                  participant.instance_id
                    ? 'bg-green-900/20 border border-green-700/50'
                    : 'bg-gray-700/50'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      participant.instance_id ? 'bg-green-400' : 'bg-yellow-400'
                    }`}
                  />
                  <div>
                    <div className="font-medium">{participant.name}</div>
                    <div className="text-sm text-gray-400">
                      {participant.email || 'No email'}
                      {participant.notes && ` - ${participant.notes}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {participant.instance_id ? (
                    <>
                      <span className="text-sm text-green-400 flex items-center gap-1">
                        <Link className="w-3 h-3" />
                        {participant.instance_id}
                      </span>
                      <button
                        onClick={() => unassignMutation.mutate(participant.id)}
                        disabled={unassignMutation.isPending}
                        className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 p-2 rounded-lg"
                        title="Unassign"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setShowAssignModal(participant)}
                      className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg"
                      title="Assign to instance"
                    >
                      <UserPlus className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`Delete participant ${participant.name}?`)) {
                        deleteMutation.mutate(participant.id)
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
            ))}
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Import Participants
              </h3>
              <button
                onClick={() => {
                  setShowImportModal(false)
                  setImportText('')
                  setImportError('')
                }}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Paste from Excel or enter CSV data
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Format: Name, Email, Notes (one participant per line)
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={`John Doe\tjohn@example.com\tVIP guest
Jane Smith\tjane@example.com
Bob Wilson\tbob@example.com\tNeeds extra help`}
                  rows={10}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 font-mono text-sm"
                />
              </div>

              {importError && (
                <div className="bg-red-900/50 border border-red-600 rounded-lg p-3 text-red-200 text-sm">
                  {importError}
                </div>
              )}

              {importText && (
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="text-sm text-gray-400 mb-2">Preview:</div>
                  <div className="text-sm">
                    {parseImportText(importText).length} participants will be imported
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowImportModal(false)
                    setImportText('')
                    setImportError('')
                  }}
                  className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importText.trim() || importMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg flex items-center gap-2"
                >
                  {importMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">
                Assign {showAssignModal.name}
              </h3>
              <button
                onClick={() => setShowAssignModal(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {availableInstances.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No available instances</p>
                <p className="text-sm">All running instances already have participants assigned</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {availableInstances.map((instance) => (
                  <button
                    key={instance.id}
                    onClick={() =>
                      assignMutation.mutate({
                        participantId: showAssignModal.id,
                        instanceId: instance.id,
                      })
                    }
                    disabled={assignMutation.isPending}
                    className="w-full text-left bg-gray-700 hover:bg-gray-600 disabled:opacity-50 p-3 rounded-lg flex items-center justify-between"
                  >
                    <span className="font-mono text-sm">{instance.id}</span>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        instance.status === 'running'
                          ? 'bg-green-900/50 text-green-400'
                          : 'bg-yellow-900/50 text-yellow-400'
                      }`}
                    >
                      {instance.status}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowAssignModal(null)}
                className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credentials Modal - Shows passwords after import */}
      {importedCredentials && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2 text-green-400">
                <Key className="w-5 h-5" />
                Participants Imported Successfully!
              </h3>
              <button
                onClick={() => setImportedCredentials(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 mb-4">
              <p className="text-yellow-200 text-sm">
                Save these credentials now! Passwords are only shown once and cannot be retrieved later.
              </p>
            </div>

            <div className="space-y-2 mb-4">
              {importedCredentials.map((cred, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between bg-gray-700 rounded-lg p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{cred.name}</div>
                    <div className="text-sm text-gray-400 truncate">{cred.email}</div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <code className="bg-gray-900 px-3 py-1 rounded font-mono text-emerald-400">
                      {cred.password}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(cred.password)
                        setCopiedIndex(index)
                        setTimeout(() => setCopiedIndex(null), 2000)
                      }}
                      className={`p-2 rounded-lg ${
                        copiedIndex === index
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-600 hover:bg-gray-500'
                      }`}
                      title="Copy password"
                    >
                      {copiedIndex === index ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  // Export as CSV
                  const csv = importedCredentials
                    .map((c) => `${c.name},${c.email},${c.password}`)
                    .join('\n')
                  const header = 'Name,Email,Password\n'
                  const blob = new Blob([header + csv], { type: 'text/csv' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'participant-credentials.csv'
                  a.click()
                  URL.revokeObjectURL(url)
                }}
                className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              <button
                onClick={() => setImportedCredentials(null)}
                className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
