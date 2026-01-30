import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Server, RefreshCw, Wrench, Users, LogOut } from 'lucide-react'
import CredentialsForm from './components/CredentialsForm'
import ConfigForm from './components/ConfigForm'
import InstanceList from './components/InstanceList'
import SpinUpForm from './components/SpinUpForm'
import SetupGuide from './components/SetupGuide'
import ParticipantManager from './components/ParticipantManager'
import AdminPasswordForm from './components/AdminPasswordForm'
import OrphanedInstanceScanner from './components/OrphanedInstanceScanner'
import AdminLoginPage from './components/auth/AdminLoginPage'
import ParticipantLoginPage from './components/auth/ParticipantLoginPage'
import ParticipantPortal from './components/portal/ParticipantPortal'
import { api } from './lib/api'
import { useAuth } from './hooks/useAuth'

type Tab = 'instances' | 'participants' | 'settings' | 'setup'
type Route = 'login' | 'portal' | 'portal-dashboard' | 'admin'

// Create a query client outside of the component
const queryClient = new QueryClient()

function getRouteFromHash(): Route {
  const hash = window.location.hash.slice(1) // Remove the '#'
  if (hash === '/portal' || hash === '/portal/') return 'portal'
  if (hash === '/portal/dashboard') return 'portal-dashboard'
  if (hash === '/login' || hash === '/login/') return 'login'
  return 'admin' // Default to admin dashboard
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('instances')
  const queryClientInner = useQueryClient()

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
    refetchInterval: 30000,
  })

  const { data: participantsData } = useQuery({
    queryKey: ['participants'],
    queryFn: api.getParticipants,
  })

  const spinUpMutation = useMutation({
    mutationFn: ({ count, extension, autoAssignParticipants }: { count: number; extension: string; autoAssignParticipants?: boolean }) =>
      api.spinUpInstances({ count, extension, autoAssignParticipants }),
    onSuccess: () => {
      queryClientInner.invalidateQueries({ queryKey: ['instances'] })
      queryClientInner.invalidateQueries({ queryKey: ['participants'] })
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
                onClick={() => setActiveTab('participants')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  activeTab === 'participants'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <Users className="w-4 h-4" />
                Participants
                {participantsData?.stats?.unassigned ? (
                  <span className="bg-yellow-500 text-black text-xs px-1.5 py-0.5 rounded-full">
                    {participantsData.stats.unassigned}
                  </span>
                ) : null}
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
              <button
                onClick={onLogout}
                className="px-4 py-2 rounded-lg flex items-center gap-2 bg-gray-700 text-gray-300 hover:bg-gray-600"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
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
            <AdminPasswordForm />
            <CredentialsForm />
            <ConfigForm />
          </div>
        </div>

        {/* Participants Tab */}
        <div className={activeTab === 'participants' ? '' : 'hidden'}>
          <ParticipantManager />
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
                  onSpinUp={(count, extension, autoAssignParticipants) => spinUpMutation.mutate({ count, extension, autoAssignParticipants })}
                  isLoading={spinUpMutation.isPending}
                  setupStatus={setupStatus}
                  onGoToSetup={() => setActiveTab('setup')}
                  unassignedParticipants={participantsData?.stats?.unassigned || 0}
                />

                {/* Instance List */}
                <div className="bg-gray-800 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                      <Server className="w-5 h-5" />
                      Instances ({instances.length})
                    </h2>
                    <button
                      onClick={() => queryClientInner.invalidateQueries({ queryKey: ['instances'] })}
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

                {/* Orphaned Instance Scanner */}
                <OrphanedInstanceScanner />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function AppContent() {
  const [route, setRoute] = useState<Route>(getRouteFromHash)
  const auth = useAuth()

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getRouteFromHash())
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Handle login
  const handleLogin = (token: string) => {
    auth.login(token)
    // Navigate based on user type
    const user = auth.user
    if (route === 'portal' || route === 'portal-dashboard') {
      window.location.hash = '#/portal/dashboard'
    } else {
      window.location.hash = '#/'
    }
    // Force re-render
    setRoute(getRouteFromHash())
  }

  // Handle logout
  const handleLogout = () => {
    auth.logout()
    // Navigate to appropriate login page
    if (route === 'portal-dashboard') {
      window.location.hash = '#/portal'
    } else {
      window.location.hash = '#/login'
    }
    setRoute(getRouteFromHash())
  }

  // Participant portal routes
  if (route === 'portal') {
    if (auth.isAuthenticated && auth.isParticipant) {
      window.location.hash = '#/portal/dashboard'
      return null
    }
    return <ParticipantLoginPage onLogin={handleLogin} />
  }

  if (route === 'portal-dashboard') {
    if (!auth.isAuthenticated || !auth.isParticipant) {
      window.location.hash = '#/portal'
      return null
    }
    return <ParticipantPortal user={auth.user!} onLogout={handleLogout} />
  }

  // Admin routes
  if (route === 'login') {
    if (auth.isAuthenticated && auth.isAdmin) {
      window.location.hash = '#/'
      return null
    }
    return <AdminLoginPage onLogin={handleLogin} />
  }

  // Admin dashboard (default route)
  if (!auth.isAuthenticated || !auth.isAdmin) {
    window.location.hash = '#/login'
    return null
  }

  return <AdminDashboard onLogout={handleLogout} />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}

export default App
