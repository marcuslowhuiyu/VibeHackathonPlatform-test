import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Server, RefreshCw, Wrench } from 'lucide-react'
import CredentialsForm from './components/CredentialsForm'
import ConfigForm from './components/ConfigForm'
import InstanceList from './components/InstanceList'
import SpinUpForm from './components/SpinUpForm'
import SetupGuide from './components/SetupGuide'
import { api } from './lib/api'

type Tab = 'instances' | 'settings' | 'setup'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('instances')
  const queryClient = useQueryClient()

  const { data: credentials } = useQuery({
    queryKey: ['credentials'],
    queryFn: api.getCredentials,
  })

  const { data: instances = [], isLoading: instancesLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: api.getInstances,
    enabled: credentials?.configured,
  })

  const { data: setupStatus } = useQuery({
    queryKey: ['setup-status'],
    queryFn: api.getSetupStatus,
    enabled: credentials?.configured,
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  const spinUpMutation = useMutation({
    mutationFn: ({ count, extension }: { count: number; extension: string }) =>
      api.spinUpInstances({ count, extension }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const isConfigured = credentials?.configured

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Server className="w-8 h-8 text-blue-500" />
              <h1 className="text-2xl font-bold">Vibe Dashboard</h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('instances')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  activeTab === 'instances'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <Server className="w-4 h-4" />
                Instances
              </button>
              <button
                onClick={() => setActiveTab('setup')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  activeTab === 'setup'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <Wrench className="w-4 h-4" />
                Setup
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  activeTab === 'settings'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Keep all tabs mounted to preserve state */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Settings Tab */}
        <div className={activeTab === 'settings' ? '' : 'hidden'}>
          <div className="space-y-8">
            <CredentialsForm />
            <ConfigForm />
          </div>
        </div>

        {/* Setup Tab */}
        <div className={activeTab === 'setup' ? '' : 'hidden'}>
          {!isConfigured ? (
            <div className="bg-yellow-900/50 border border-yellow-600 rounded-lg p-6 text-center">
              <h2 className="text-xl font-semibold text-yellow-200 mb-2">
                AWS Credentials Required
              </h2>
              <p className="text-yellow-300 mb-4">
                Please configure your AWS credentials in Settings first before running setup.
              </p>
              <button
                onClick={() => setActiveTab('settings')}
                className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-lg"
              >
                Go to Settings
              </button>
            </div>
          ) : (
            <SetupGuide />
          )}
        </div>

        {/* Instances Tab */}
        <div className={activeTab === 'instances' ? '' : 'hidden'}>
          <div className="space-y-6">
            {!isConfigured ? (
              <div className="bg-yellow-900/50 border border-yellow-600 rounded-lg p-6 text-center">
                <h2 className="text-xl font-semibold text-yellow-200 mb-2">
                  AWS Credentials Required
                </h2>
                <p className="text-yellow-300 mb-4">
                  Please configure your AWS credentials in Settings to manage instances.
                </p>
                <button
                  onClick={() => setActiveTab('settings')}
                  className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-lg"
                >
                  Go to Settings
                </button>
              </div>
            ) : (
              <>
                {/* Spin Up Form */}
                <SpinUpForm
                  onSpinUp={(count, extension) => spinUpMutation.mutate({ count, extension })}
                  isLoading={spinUpMutation.isPending}
                  setupStatus={setupStatus}
                  onGoToSetup={() => setActiveTab('setup')}
                />

                {/* Instance List */}
                <div className="bg-gray-800 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                      <Server className="w-5 h-5" />
                      Instances ({instances.length})
                    </h2>
                    <button
                      onClick={() => queryClient.invalidateQueries({ queryKey: ['instances'] })}
                      className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-700"
                      title="Refresh"
                    >
                      <RefreshCw className={`w-5 h-5 ${instancesLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {instances.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No instances running</p>
                      <p className="text-sm mt-1">Use the form above to spin up new instances</p>
                    </div>
                  ) : (
                    <InstanceList instances={instances} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
