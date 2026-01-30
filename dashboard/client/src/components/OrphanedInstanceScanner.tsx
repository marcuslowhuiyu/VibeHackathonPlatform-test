import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  AlertTriangle,
  Loader2,
  Trash2,
  Download,
  ExternalLink,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react'
import { api } from '../lib/api'

interface OrphanedTask {
  task_arn: string
  task_id: string
  status: string
  public_ip: string | null
  private_ip: string | null
  started_at: string | null
  task_definition: string | null
  vscode_url: string | null
  app_url: string | null
}

interface ScanResult {
  total_running: number
  tracked: number
  orphaned: number
  orphaned_tasks: OrphanedTask[]
}

export default function OrphanedInstanceScanner() {
  const queryClient = useQueryClient()
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState('')

  const handleScan = async () => {
    setIsScanning(true)
    setError('')
    try {
      const result = await api.scanOrphanedInstances()
      setScanResult(result)
    } catch (err: any) {
      setError(err.message || 'Failed to scan for orphaned instances')
    } finally {
      setIsScanning(false)
    }
  }

  const importMutation = useMutation({
    mutationFn: ({ taskArn, taskId }: { taskArn: string; taskId: string }) =>
      api.importOrphanedTask(taskArn, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      handleScan() // Refresh the scan
    },
  })

  const terminateMutation = useMutation({
    mutationFn: (taskArn: string) => api.terminateOrphanedTask(taskArn),
    onSuccess: () => {
      handleScan() // Refresh the scan
    },
  })

  const terminateAllMutation = useMutation({
    mutationFn: api.terminateAllOrphanedTasks,
    onSuccess: () => {
      handleScan() // Refresh the scan
    },
  })

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Search className="w-5 h-5" />
          Orphaned Instance Scanner
        </h2>
        <button
          onClick={handleScan}
          disabled={isScanning}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg flex items-center gap-2"
        >
          {isScanning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              Scan AWS
            </>
          )}
        </button>
      </div>

      <p className="text-gray-400 text-sm mb-4">
        Scan for ECS tasks running on AWS that are not tracked in this dashboard.
        These may be leftover from database resets or manual task creation.
      </p>

      {error && (
        <div className="bg-red-900/50 border border-red-600 rounded-lg p-3 mb-4 flex items-center gap-2 text-red-200">
          <XCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {scanResult && (
        <div className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-700/50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{scanResult.total_running}</div>
              <div className="text-sm text-gray-400">Running on AWS</div>
            </div>
            <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{scanResult.tracked}</div>
              <div className="text-sm text-green-400">Tracked</div>
            </div>
            <div className={`rounded-lg p-4 text-center ${
              scanResult.orphaned > 0
                ? 'bg-yellow-900/30 border border-yellow-700'
                : 'bg-gray-700/50'
            }`}>
              <div className={`text-2xl font-bold ${scanResult.orphaned > 0 ? 'text-yellow-400' : ''}`}>
                {scanResult.orphaned}
              </div>
              <div className={`text-sm ${scanResult.orphaned > 0 ? 'text-yellow-400' : 'text-gray-400'}`}>
                Orphaned
              </div>
            </div>
          </div>

          {/* Orphaned Tasks List */}
          {scanResult.orphaned === 0 ? (
            <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-6 text-center">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-green-300 font-medium">No orphaned instances found</p>
              <p className="text-green-400/70 text-sm mt-1">
                All running ECS tasks are being tracked in the dashboard
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium flex items-center gap-2 text-yellow-400">
                  <AlertTriangle className="w-5 h-5" />
                  Orphaned Tasks ({scanResult.orphaned})
                </h3>
                <button
                  onClick={() => {
                    if (confirm(`Terminate ALL ${scanResult.orphaned} orphaned tasks? This cannot be undone.`)) {
                      terminateAllMutation.mutate()
                    }
                  }}
                  disabled={terminateAllMutation.isPending}
                  className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm"
                >
                  {terminateAllMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Terminate All
                </button>
              </div>

              <div className="space-y-3">
                {scanResult.orphaned_tasks.map((task) => (
                  <div
                    key={task.task_arn}
                    className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <code className="text-sm bg-gray-900 px-2 py-1 rounded truncate">
                            {task.task_id}
                          </code>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            task.status === 'RUNNING'
                              ? 'bg-green-900/50 text-green-400'
                              : 'bg-yellow-900/50 text-yellow-400'
                          }`}>
                            {task.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-gray-500">Public IP:</span>{' '}
                            <span className="text-gray-300">{task.public_ip || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Task Def:</span>{' '}
                            <span className="text-gray-300">{task.task_definition || 'N/A'}</span>
                          </div>
                          {task.started_at && (
                            <div className="col-span-2">
                              <span className="text-gray-500">Started:</span>{' '}
                              <span className="text-gray-300">
                                {new Date(task.started_at).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                        {task.vscode_url && (
                          <div className="flex gap-2 mt-2">
                            <a
                              href={task.vscode_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              VS Code
                            </a>
                            {task.app_url && (
                              <a
                                href={task.app_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                React App
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => importMutation.mutate({ taskArn: task.task_arn, taskId: task.task_id })}
                          disabled={importMutation.isPending}
                          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-1 text-sm"
                          title="Import into dashboard"
                        >
                          {importMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                          Import
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Terminate this task? This cannot be undone.')) {
                              terminateMutation.mutate(task.task_arn)
                            }
                          }}
                          disabled={terminateMutation.isPending}
                          className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-3 py-1.5 rounded-lg flex items-center gap-1 text-sm"
                          title="Terminate task"
                        >
                          {terminateMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                          Terminate
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!scanResult && !isScanning && (
        <div className="text-center py-8 text-gray-400">
          <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Click "Scan AWS" to check for orphaned instances</p>
        </div>
      )}
    </div>
  )
}
