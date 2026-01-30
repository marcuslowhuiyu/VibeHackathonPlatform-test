import { useQuery } from '@tanstack/react-query'
import {
  Users,
  Code,
  Globe,
  Loader2,
  AlertCircle,
  CheckCircle,
  Clock,
  LogOut,
  ExternalLink,
} from 'lucide-react'
import { api } from '../../lib/api'
import { TokenPayload } from '../../lib/auth'

interface ParticipantPortalProps {
  user: TokenPayload
  onLogout: () => void
}

export default function ParticipantPortal({ user, onLogout }: ParticipantPortalProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['my-instance'],
    queryFn: api.getMyInstance,
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading your workspace...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-gray-400 mb-4">{(error as Error).message}</p>
          <button
            onClick={() => refetch()}
            className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  const participant = data?.participant
  const instance = data?.instance

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return <CheckCircle className="w-5 h-5 text-green-400" />
      case 'provisioning':
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-400" />
      default:
        return <AlertCircle className="w-5 h-5 text-gray-400" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return 'bg-green-900/30 border-green-600 text-green-400'
      case 'provisioning':
      case 'pending':
        return 'bg-yellow-900/30 border-yellow-600 text-yellow-400'
      default:
        return 'bg-gray-700/30 border-gray-600 text-gray-400'
    }
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-emerald-500" />
            <div>
              <h1 className="text-xl font-bold text-white">Vibe Coding Lab</h1>
              <p className="text-sm text-gray-400">Participant Portal</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-gray-400 hover:text-white flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-700"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Welcome Card */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">
            Welcome, {participant?.name || user.name}!
          </h2>
          <p className="text-gray-400">{participant?.email || user.email}</p>
        </div>

        {/* Instance Status */}
        {!instance ? (
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <Clock className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">
              Waiting for Assignment
            </h3>
            <p className="text-gray-400 max-w-md mx-auto">
              {data?.message || 'Your workspace is being prepared. This page will automatically update when your instance is ready.'}
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Checking for updates...</span>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Instance Info */}
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Your Workspace</h3>
                <span
                  className={`px-3 py-1 rounded-full text-sm border ${getStatusColor(instance.status)}`}
                >
                  <span className="flex items-center gap-2">
                    {getStatusIcon(instance.status)}
                    {instance.status}
                  </span>
                </span>
              </div>

              <div className="grid gap-4 text-sm">
                <div className="flex items-center justify-between py-2 border-b border-gray-700">
                  <span className="text-gray-400">Instance ID</span>
                  <code className="text-gray-300 bg-gray-900 px-2 py-1 rounded">
                    {instance.id}
                  </code>
                </div>
                {instance.ai_extension && (
                  <div className="flex items-center justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-400">AI Extension</span>
                    <span className="text-emerald-400 capitalize">{instance.ai_extension}</span>
                  </div>
                )}
                {instance.cloudfront_status && (
                  <div className="flex items-center justify-between py-2 border-b border-gray-700">
                    <span className="text-gray-400">HTTPS Status</span>
                    <span className={instance.cloudfront_status === 'Deployed' ? 'text-green-400' : 'text-yellow-400'}>
                      {instance.cloudfront_status}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* VS Code Button */}
              <a
                href={instance.vscode_url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-3 p-6 rounded-lg text-center transition-all ${
                  instance.vscode_url && instance.status.toLowerCase() === 'running'
                    ? 'bg-blue-600 hover:bg-blue-500 cursor-pointer'
                    : 'bg-gray-700 cursor-not-allowed opacity-50'
                }`}
                onClick={(e) => {
                  if (!instance.vscode_url || instance.status.toLowerCase() !== 'running') {
                    e.preventDefault()
                  }
                }}
              >
                <Code className="w-8 h-8" />
                <div className="text-left">
                  <div className="font-semibold text-lg">Open VS Code</div>
                  <div className="text-sm opacity-75">
                    {instance.vscode_url ? 'Start coding in your browser' : 'Waiting for instance...'}
                  </div>
                </div>
                <ExternalLink className="w-5 h-5 ml-auto" />
              </a>

              {/* React App Button */}
              <a
                href={instance.app_url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-3 p-6 rounded-lg text-center transition-all ${
                  instance.app_url && instance.status.toLowerCase() === 'running'
                    ? 'bg-emerald-600 hover:bg-emerald-500 cursor-pointer'
                    : 'bg-gray-700 cursor-not-allowed opacity-50'
                }`}
                onClick={(e) => {
                  if (!instance.app_url || instance.status.toLowerCase() !== 'running') {
                    e.preventDefault()
                  }
                }}
              >
                <Globe className="w-8 h-8" />
                <div className="text-left">
                  <div className="font-semibold text-lg">View React App</div>
                  <div className="text-sm opacity-75">
                    {instance.app_url ? 'See your app preview' : 'Waiting for instance...'}
                  </div>
                </div>
                <ExternalLink className="w-5 h-5 ml-auto" />
              </a>
            </div>

            {/* Tips */}
            {instance.status.toLowerCase() === 'running' && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <h4 className="font-medium text-gray-300 mb-2">Tips:</h4>
                <ul className="text-sm text-gray-400 space-y-1">
                  <li>• VS Code runs in your browser - no installation needed</li>
                  <li>• Your React app auto-refreshes when you save changes</li>
                  <li>• The AI assistant (Continue) is pre-configured and ready to use</li>
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
