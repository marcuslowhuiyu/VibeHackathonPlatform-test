import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  AlertTriangle,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Server,
  Shield,
  Database,
  Cloud,
  Terminal,
  Box,
  Download,
  FileCode,
  Save,
  RotateCcw,
  ExternalLink,
  Info,
} from 'lucide-react'
import { api } from '../lib/api'

interface SetupStep {
  step: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  message?: string
  resourceId?: string
}

const STEP_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  get_account_id: { label: 'Get AWS Account ID', icon: <Cloud className="w-4 h-4" /> },
  get_vpc: { label: 'Find Default VPC', icon: <Server className="w-4 h-4" /> },
  get_subnets: { label: 'Find Subnets', icon: <Server className="w-4 h-4" /> },
  create_security_group: { label: 'Create Security Group', icon: <Shield className="w-4 h-4" /> },
  create_execution_role: { label: 'Create ECS Execution Role', icon: <Shield className="w-4 h-4" /> },
  create_task_role: { label: 'Create Task Role (Bedrock)', icon: <Shield className="w-4 h-4" /> },
  create_ecr_repo: { label: 'Create ECR Repository', icon: <Database className="w-4 h-4" /> },
  create_cluster: { label: 'Create ECS Cluster', icon: <Box className="w-4 h-4" /> },
  register_task_definition: { label: 'Register Task Definition', icon: <Box className="w-4 h-4" /> },
  save_config: { label: 'Save Configuration', icon: <CheckCircle className="w-4 h-4" /> },
}

function StatusIcon({ status }: { status: SetupStep['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-5 h-5 text-green-400" />
    case 'skipped':
      return <CheckCircle className="w-5 h-5 text-blue-400" />
    case 'in_progress':
      return <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
    case 'failed':
      return <XCircle className="w-5 h-5 text-red-400" />
    default:
      return <div className="w-5 h-5 rounded-full border-2 border-gray-600" />
  }
}

// Collapsible Section Component
function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
  badge,
  badgeColor = 'gray',
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: string
  badgeColor?: 'green' | 'yellow' | 'red' | 'gray' | 'blue'
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const badgeColors = {
    green: 'bg-green-900/50 text-green-400 border-green-600',
    yellow: 'bg-yellow-900/50 text-yellow-400 border-yellow-600',
    red: 'bg-red-900/50 text-red-400 border-red-600',
    gray: 'bg-gray-700 text-gray-400 border-gray-600',
    blue: 'bg-blue-900/50 text-blue-400 border-blue-600',
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center gap-3 hover:bg-gray-700/50 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        )}
        {icon}
        <span className="text-lg font-semibold flex-1 text-left">{title}</span>
        {badge && (
          <span className={`text-xs px-2 py-1 rounded border ${badgeColors[badgeColor]}`}>
            {badge}
          </span>
        )}
      </button>
      {isOpen && <div className="px-6 pb-6 pt-2">{children}</div>}
    </div>
  )
}

// Progress display component with collapsible completed steps
function ProgressDisplay({
  steps,
  stepLabels,
}: {
  steps: SetupStep[]
  stepLabels: Record<string, { label: string; icon: React.ReactNode }>
}) {
  const [showCompleted, setShowCompleted] = useState(false)

  // Deduplicate steps - keep only the latest status for each step name
  const deduplicatedSteps = steps.reduce((acc, step) => {
    const existingIndex = acc.findIndex((s) => s.step === step.step)
    if (existingIndex >= 0) {
      acc[existingIndex] = step
    } else {
      acc.push(step)
    }
    return acc
  }, [] as SetupStep[])

  const completedSteps = deduplicatedSteps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped'
  )
  const currentStep = deduplicatedSteps.find((s) => s.status === 'in_progress')
  const failedStep = deduplicatedSteps.find((s) => s.status === 'failed')
  const pendingSteps = deduplicatedSteps.filter((s) => s.status === 'pending')

  const completedCount = completedSteps.length
  const totalSteps = deduplicatedSteps.length
  const progressPercent = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0

  return (
    <div className="space-y-3">
      {/* Progress Bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${failedStep ? 'bg-red-500' : 'bg-green-500'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-sm text-gray-400 min-w-[60px] text-right">
          {completedCount}/{totalSteps}
        </span>
      </div>

      {/* Completed Steps (Collapsible) */}
      {completedSteps.length > 0 && (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="w-full px-3 py-2 bg-gray-700/30 hover:bg-gray-700/50 flex items-center gap-2 text-left text-sm"
          >
            {showCompleted ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-green-400">
              {completedSteps.length} step{completedSteps.length > 1 ? 's' : ''} completed
            </span>
          </button>
          {showCompleted && (
            <div className="max-h-40 overflow-y-auto border-t border-gray-700">
              {completedSteps.map((step, index) => {
                const stepInfo = stepLabels[step.step] || { label: step.step, icon: null }
                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 py-1.5 px-3 text-sm text-gray-400 border-b border-gray-700/50 last:border-0"
                  >
                    <StatusIcon status={step.status} />
                    <span className="flex-1">{stepInfo.label}</span>
                    {step.status === 'skipped' && (
                      <span className="text-xs text-blue-400">Exists</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Current Step (Highlighted) */}
      {currentStep && (
        <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 animate-pulse">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {stepLabels[currentStep.step]?.icon}
                <span className="font-medium text-yellow-200">
                  {stepLabels[currentStep.step]?.label || currentStep.step}
                </span>
              </div>
              {currentStep.message && (
                <p className="text-xs text-yellow-300/70 mt-1">{currentStep.message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Failed Step */}
      {failedStep && (
        <div className="bg-red-900/30 border border-red-600 rounded-lg p-3">
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5 text-red-400" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {stepLabels[failedStep.step]?.icon}
                <span className="font-medium text-red-200">
                  {stepLabels[failedStep.step]?.label || failedStep.step}
                </span>
              </div>
              {failedStep.message && (
                <p className="text-xs text-red-300 mt-1">{failedStep.message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pending Steps Summary */}
      {pendingSteps.length > 0 && !failedStep && (
        <div className="text-sm text-gray-500 pl-2">
          {pendingSteps.length} step{pendingSteps.length > 1 ? 's' : ''} remaining...
        </div>
      )}

      {/* All Done */}
      {completedSteps.length === deduplicatedSteps.length && deduplicatedSteps.length > 0 && (
        <div className="bg-green-900/30 border border-green-600 rounded-lg p-3 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <span className="text-green-200 font-medium">All steps completed successfully!</span>
        </div>
      )}
    </div>
  )
}

interface DockerStep {
  success: boolean
  step: string
  message: string
  error?: string
}

const DOCKER_STEP_LABELS: Record<string, string> = {
  check_docker: 'Check Docker',
  get_account: 'Get AWS Account',
  ecr_auth: 'ECR Authentication',
  docker_login: 'Docker Login',
  docker_build: 'Build Image',
  docker_tag: 'Tag Image',
  docker_push: 'Push to ECR',
}

// Docker progress display component
function DockerProgressDisplay({ steps }: { steps: DockerStep[] }) {
  const [showCompleted, setShowCompleted] = useState(false)

  // Deduplicate steps - keep only the latest status for each step name
  const deduplicatedSteps = steps.reduce((acc, step) => {
    const existingIndex = acc.findIndex((s) => s.step === step.step)
    if (existingIndex >= 0) {
      acc[existingIndex] = step
    } else {
      acc.push(step)
    }
    return acc
  }, [] as DockerStep[])

  const completedSteps = deduplicatedSteps.filter((s) => s.success && !s.error)
  const currentStep = deduplicatedSteps.find((s) => !s.success && !s.error)
  const failedStep = deduplicatedSteps.find((s) => s.error)

  const completedCount = completedSteps.length
  const totalSteps = deduplicatedSteps.length
  const progressPercent = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0

  return (
    <div className="space-y-3">
      {/* Progress Bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${failedStep ? 'bg-red-500' : 'bg-green-500'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-sm text-gray-400 min-w-[60px] text-right">
          {completedCount}/{totalSteps}
        </span>
      </div>

      {/* Completed Steps (Collapsible) */}
      {completedSteps.length > 0 && (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="w-full px-3 py-2 bg-gray-700/30 hover:bg-gray-700/50 flex items-center gap-2 text-left text-sm"
          >
            {showCompleted ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-green-400">
              {completedSteps.length} step{completedSteps.length > 1 ? 's' : ''} completed
            </span>
          </button>
          {showCompleted && (
            <div className="max-h-40 overflow-y-auto border-t border-gray-700">
              {completedSteps.map((step, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 py-1.5 px-3 text-sm text-gray-400 border-b border-gray-700/50 last:border-0"
                >
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="flex-1">{DOCKER_STEP_LABELS[step.step] || step.step}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Current Step (Highlighted) */}
      {currentStep && !failedStep && (
        <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 animate-pulse">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
            <div className="flex-1">
              <span className="font-medium text-yellow-200">
                {DOCKER_STEP_LABELS[currentStep.step] || currentStep.step}
              </span>
              <p className="text-xs text-yellow-300/70 mt-1">{currentStep.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Failed Step */}
      {failedStep && (
        <div className="bg-red-900/30 border border-red-600 rounded-lg p-3">
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5 text-red-400" />
            <div className="flex-1">
              <span className="font-medium text-red-200">
                {DOCKER_STEP_LABELS[failedStep.step] || failedStep.step}
              </span>
              <p className="text-xs text-red-300 mt-1">{failedStep.error || failedStep.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* All Done */}
      {completedSteps.length === deduplicatedSteps.length &&
        deduplicatedSteps.length > 0 &&
        !failedStep && (
          <div className="bg-green-900/30 border border-green-600 rounded-lg p-3 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-green-200 font-medium">Image built and pushed successfully!</span>
          </div>
        )}
    </div>
  )
}

// File Editor Component
function FileEditor() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  )

  const { data: filesData } = useQuery({
    queryKey: ['editable-files'],
    queryFn: api.getEditableFiles,
  })

  const { data: fileContent, isLoading: isLoadingFile } = useQuery({
    queryKey: ['file-content', selectedFile],
    queryFn: () => (selectedFile ? api.getFileContent(selectedFile) : null),
    enabled: !!selectedFile,
  })

  // Update content when file is loaded
  useState(() => {
    if (fileContent) {
      setContent(fileContent.content)
      setOriginalContent(fileContent.content)
    }
  })

  const handleFileSelect = async (filename: string) => {
    setSelectedFile(filename)
    setSaveMessage(null)
    try {
      const data = await api.getFileContent(filename)
      setContent(data.content)
      setOriginalContent(data.content)
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message })
    }
  }

  const handleSave = async () => {
    if (!selectedFile) return
    setIsSaving(true)
    setSaveMessage(null)
    try {
      await api.saveFileContent(selectedFile, content)
      setOriginalContent(content)
      setSaveMessage({ type: 'success', text: 'File saved successfully!' })
      setTimeout(() => setSaveMessage(null), 3000)
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message })
    }
    setIsSaving(false)
  }

  const handleReset = () => {
    setContent(originalContent)
    setSaveMessage(null)
  }

  const hasChanges = content !== originalContent

  return (
    <div className="space-y-4">
      <p className="text-gray-400 text-sm">
        Edit container configuration files. Changes will be applied when you rebuild the Docker
        image.
      </p>

      {/* File Tabs */}
      <div className="flex gap-2 flex-wrap">
        {filesData?.files.map((file) => (
          <button
            key={file.name}
            onClick={() => handleFileSelect(file.name)}
            className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
              selectedFile === file.name
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <FileCode className="w-4 h-4" />
            {file.name}
            {!file.exists && (
              <span className="text-xs bg-red-600 px-1 rounded">Missing</span>
            )}
          </button>
        ))}
      </div>

      {/* File Description */}
      {selectedFile && filesData?.files.find((f) => f.name === selectedFile) && (
        <div className="bg-gray-700/30 rounded-lg p-3 flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-400 mt-0.5" />
          <p className="text-sm text-gray-400">
            {filesData.files.find((f) => f.name === selectedFile)?.description}
          </p>
        </div>
      )}

      {/* Editor */}
      {selectedFile && (
        <div className="space-y-3">
          {isLoadingFile ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-96 bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                spellCheck={false}
              />

              {/* Actions */}
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    className="bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save Changes
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={!hasChanges}
                    className="bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset
                  </button>
                </div>

                {hasChanges && (
                  <span className="text-yellow-400 text-sm">Unsaved changes</span>
                )}
              </div>

              {/* Save Message */}
              {saveMessage && (
                <div
                  className={`p-3 rounded-lg ${
                    saveMessage.type === 'success'
                      ? 'bg-green-900/30 border border-green-600 text-green-400'
                      : 'bg-red-900/30 border border-red-600 text-red-400'
                  }`}
                >
                  {saveMessage.text}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!selectedFile && (
        <div className="text-center py-8 text-gray-500">
          Select a file above to edit
        </div>
      )}

      <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5" />
        <p className="text-sm text-yellow-300">
          After editing files, you must rebuild and push the Docker image for changes to take
          effect on new instances.
        </p>
      </div>
    </div>
  )
}

export default function SetupGuide() {
  const queryClient = useQueryClient()
  const [setupSteps, setSetupSteps] = useState<SetupStep[]>([])
  const [dockerSteps, setDockerSteps] = useState<DockerStep[]>([])
  const [showManualDocker, setShowManualDocker] = useState(false)
  const [copiedDocker, setCopiedDocker] = useState(false)
  const [isBuilding, setIsBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['setup-status'],
    queryFn: api.getSetupStatus,
    refetchInterval: 10000,
  })

  const { data: dockerStatus } = useQuery({
    queryKey: ['docker-status'],
    queryFn: api.getDockerStatus,
  })

  const { data: dockerCommands } = useQuery({
    queryKey: ['docker-commands'],
    queryFn: api.getDockerCommands,
  })

  const setupMutation = useMutation({
    mutationFn: api.runSetup,
    onSuccess: (result) => {
      if (result.steps) {
        setSetupSteps(result.steps)
      }
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
  })

  // SSE-based build for real-time progress
  const startBuild = () => {
    setIsBuilding(true)
    setBuildError(null)
    setDockerSteps([])

    const eventSource = new EventSource('/api/setup/build-and-push-stream')

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'progress') {
          setDockerSteps((prev) => {
            const existing = prev.findIndex((s) => s.step === data.step)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = data
              return updated
            }
            return [...prev, data]
          })
        } else if (data.type === 'complete') {
          setIsBuilding(false)
          eventSource.close()
          queryClient.invalidateQueries({ queryKey: ['setup-status'] })
          if (!data.success && data.error) {
            setBuildError(data.error)
          }
        } else if (data.type === 'error') {
          setIsBuilding(false)
          setBuildError(data.error)
          eventSource.close()
        }
      } catch (err) {
        console.error('Failed to parse SSE data:', err)
      }
    }

    eventSource.onerror = () => {
      setIsBuilding(false)
      setBuildError('Connection lost. Please try again.')
      eventSource.close()
    }
  }

  const copyDockerCommands = () => {
    if (dockerCommands?.commands) {
      navigator.clipboard.writeText(dockerCommands.commands)
      setCopiedDocker(true)
      setTimeout(() => setCopiedDocker(false), 2000)
    }
  }

  const allConfigured = status?.configured && status?.ecrImageExists

  // Determine badges
  const getAwsSetupBadge = () => {
    if (status?.configured) return { text: 'Complete', color: 'green' as const }
    if (status?.missing?.length) return { text: 'Incomplete', color: 'yellow' as const }
    return { text: 'Not Started', color: 'gray' as const }
  }

  const getDockerBadge = () => {
    if (status?.ecrImageExists) return { text: 'Image Ready', color: 'green' as const }
    if (status?.configured) return { text: 'Needs Image', color: 'yellow' as const }
    return { text: 'Pending', color: 'gray' as const }
  }

  const awsBadge = getAwsSetupBadge()
  const dockerBadge = getDockerBadge()

  return (
    <div className="space-y-4">
      {/* Status Overview - Always visible */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Setup Status</h2>

        {statusLoading ? (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            Checking setup status...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              className={`p-4 rounded-lg border ${
                status?.configured
                  ? 'bg-green-900/20 border-green-600'
                  : 'bg-yellow-900/20 border-yellow-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {status?.configured ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                )}
                <span className="font-medium">AWS Infrastructure</span>
              </div>
              <p className="text-sm text-gray-400">
                {status?.configured
                  ? 'All resources configured'
                  : `Missing: ${status?.missing?.join(', ') || 'Unknown'}`}
              </p>
            </div>

            <div
              className={`p-4 rounded-lg border ${
                status?.ecrImageExists
                  ? 'bg-green-900/20 border-green-600'
                  : 'bg-yellow-900/20 border-yellow-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {status?.ecrImageExists ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                )}
                <span className="font-medium">Docker Image</span>
              </div>
              <p className="text-sm text-gray-400">
                {status?.ecrImageExists
                  ? 'Image available in ECR'
                  : 'No image found - build and push required'}
              </p>
            </div>
          </div>
        )}

        {allConfigured && (
          <div className="mt-4 bg-green-900/30 border border-green-600 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <div>
              <p className="text-green-400 font-medium">Setup Complete!</p>
              <p className="text-sm text-gray-400">
                You can now spin up instances from the Instances tab.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Prerequisites */}
      <CollapsibleSection
        title="Prerequisites"
        icon={<Download className="w-5 h-5 text-blue-400" />}
        defaultOpen={!status?.configured}
        badge="Required"
        badgeColor="blue"
      >
        <div className="space-y-4">
          <p className="text-gray-400">
            Before setting up, make sure you have the following installed:
          </p>

          <div className="grid gap-3">
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Box className="w-8 h-8 text-blue-400" />
                  <div>
                    <h4 className="font-medium">Docker Desktop</h4>
                    <p className="text-sm text-gray-400">Required to build and run containers</p>
                  </div>
                </div>
                <a
                  href="https://www.docker.com/products/docker-desktop/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm flex items-center gap-2"
                >
                  Download
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              {dockerStatus && (
                <div
                  className={`mt-3 p-2 rounded flex items-center gap-2 text-sm ${
                    dockerStatus.available
                      ? 'bg-green-900/30 text-green-400'
                      : 'bg-red-900/30 text-red-400'
                  }`}
                >
                  {dockerStatus.available ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  {dockerStatus.message}
                </div>
              )}
            </div>

            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Cloud className="w-8 h-8 text-orange-400" />
                <div>
                  <h4 className="font-medium">AWS Account</h4>
                  <p className="text-sm text-gray-400">
                    With access keys configured in Settings tab
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Server className="w-8 h-8 text-green-400" />
                <div>
                  <h4 className="font-medium">Node.js 18+</h4>
                  <p className="text-sm text-gray-400">Already installed if you're running this dashboard</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Step 1: AWS Setup */}
      <CollapsibleSection
        title="Step 1: AWS Infrastructure Setup"
        icon={<Cloud className="w-5 h-5 text-orange-400" />}
        defaultOpen={!status?.configured}
        badge={awsBadge.text}
        badgeColor={awsBadge.color}
      >
        <div className="space-y-4">
          <p className="text-gray-400">
            Click the button below to automatically create all required AWS resources: IAM roles,
            security groups, ECS cluster, ECR repository, and task definition.
          </p>

          <button
            onClick={() => setupMutation.mutate()}
            disabled={setupMutation.isPending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-3 rounded-lg flex items-center gap-2 font-medium"
          >
            {setupMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Running Setup...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Run Automated Setup
              </>
            )}
          </button>

          {setupSteps.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Setup Progress</h3>
              <ProgressDisplay steps={setupSteps} stepLabels={STEP_LABELS} />
            </div>
          )}

          {setupMutation.data?.error && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
              <p className="text-red-400">{setupMutation.data.error}</p>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Step 2: Docker Build */}
      <CollapsibleSection
        title="Step 2: Build & Push Docker Image"
        icon={<Terminal className="w-5 h-5 text-purple-400" />}
        defaultOpen={status?.configured && !status?.ecrImageExists}
        badge={dockerBadge.text}
        badgeColor={dockerBadge.color}
      >
        <div className="space-y-4">
          {/* Docker Status */}
          {dockerStatus && !dockerStatus.available && (
            <div className="p-3 rounded-lg bg-yellow-900/30 border border-yellow-700 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              <span className="text-yellow-300">{dockerStatus.message}</span>
            </div>
          )}

          <p className="text-gray-400">
            Build the Docker image and push it to ECR. This requires Docker to be installed and
            running.
          </p>

          <button
            onClick={startBuild}
            disabled={isBuilding || !dockerStatus?.available}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3 rounded-lg flex items-center gap-2 font-medium"
          >
            {isBuilding ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Building & Pushing...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Build & Push Image
              </>
            )}
          </button>

          {/* Real-time Progress Bar */}
          {(isBuilding || dockerSteps.length > 0) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300 font-medium">Build Progress</span>
                <span className="text-gray-400">
                  {dockerSteps.filter((s) => s.success && s.step !== 'error').length} / 7 steps
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.min(100, (dockerSteps.filter((s) => s.success && s.step !== 'error').length / 7) * 100)}%`,
                  }}
                />
              </div>

              {/* Current Step */}
              {isBuilding && dockerSteps.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-blue-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {dockerSteps[dockerSteps.length - 1]?.message}
                </div>
              )}

              {/* Step Details */}
              <DockerProgressDisplay steps={dockerSteps} />
            </div>
          )}

          {buildError && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
              <p className="text-red-400">{buildError}</p>
            </div>
          )}

          {/* Manual Commands */}
          <div className="border border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowManualDocker(!showManualDocker)}
              className="w-full px-4 py-3 bg-gray-700/50 hover:bg-gray-700 flex items-center gap-2 text-left text-sm"
            >
              {showManualDocker ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <span>Manual Commands (if automated build doesn't work)</span>
            </button>
            {showManualDocker && (
              <div className="p-4 relative">
                <pre className="bg-gray-900 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto">
                  {dockerCommands?.commands || '# Configure AWS credentials first'}
                </pre>
                <button
                  onClick={copyDockerCommands}
                  className="absolute top-6 right-6 bg-gray-700 hover:bg-gray-600 p-2 rounded"
                  title="Copy commands"
                >
                  {copiedDocker ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Step 3: Edit Container Configuration */}
      <CollapsibleSection
        title="Step 3: Customize Container (Optional)"
        icon={<FileCode className="w-5 h-5 text-cyan-400" />}
        badge="Optional"
        badgeColor="gray"
      >
        <FileEditor />
      </CollapsibleSection>

      {/* Manual Setup Instructions */}
      <CollapsibleSection
        title="Manual Setup Instructions"
        icon={<Terminal className="w-5 h-5 text-gray-400" />}
        badge="Advanced"
        badgeColor="gray"
      >
        <div className="space-y-6 text-gray-300">
          <p className="text-gray-400">
            If automated setup doesn't work, follow these manual steps:
          </p>

          <section>
            <h3 className="text-lg font-semibold mb-2">Prerequisites</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>AWS CLI installed and configured</li>
              <li>Docker installed</li>
              <li>AWS account with admin permissions</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Step 1: Create ECR Repository</h3>
            <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
              {`aws ecr create-repository \\
    --repository-name vibe-coding-lab \\
    --region us-east-1`}
            </pre>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Step 2: Create IAM Roles</h3>
            <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
              {`# Create trust policy file
cat > ecs-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

# Create execution role
aws iam create-role \\
    --role-name ecsTaskExecutionRole \\
    --assume-role-policy-document file://ecs-trust-policy.json

aws iam attach-role-policy \\
    --role-name ecsTaskExecutionRole \\
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`}
            </pre>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Step 3: Create ECS Cluster</h3>
            <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
              {`aws ecs create-cluster \\
    --cluster-name vibe-cluster \\
    --capacity-providers FARGATE FARGATE_SPOT`}
            </pre>
          </section>
        </div>
      </CollapsibleSection>
    </div>
  )
}
