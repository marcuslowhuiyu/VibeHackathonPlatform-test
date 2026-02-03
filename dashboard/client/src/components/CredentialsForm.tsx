import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Key, Check, AlertCircle, Trash2, ChevronDown, ChevronRight, ExternalLink, Shield, X } from 'lucide-react'
import { api, type PermissionCheck } from '../lib/api'

export default function CredentialsForm() {
  const queryClient = useQueryClient()
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [region, setRegion] = useState('ap-southeast-1')
  const [showInstructions, setShowInstructions] = useState(false)

  const { data: credentials } = useQuery({
    queryKey: ['credentials'],
    queryFn: api.getCredentials,
  })

  const saveMutation = useMutation({
    mutationFn: api.saveCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
      setAccessKeyId('')
      setSecretAccessKey('')
      // Auto-validate after saving
      validateMutation.mutate()
    },
  })

  const validateMutation = useMutation({
    mutationFn: api.validateCredentials,
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate({ accessKeyId, secretAccessKey, region })
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Key className="w-5 h-5" />
        AWS Credentials
      </h2>

      {credentials?.configured ? (
        <div className="space-y-4">
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 flex items-center gap-3">
            <Check className="w-5 h-5 text-green-500" />
            <div>
              <p className="font-medium text-green-200">Credentials Configured</p>
              <p className="text-sm text-green-300">
                Access Key: {credentials.accessKeyId} | Region: {credentials.region}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => validateMutation.mutate()}
              disabled={validateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg"
            >
              {validateMutation.isPending ? 'Validating...' : 'Validate'}
            </button>
            <button
              onClick={() => {
                if (confirm('Are you sure you want to delete your credentials?')) {
                  deleteMutation.mutate()
                }
              }}
              className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded-lg flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>

          {validateMutation.data && (
            <div className="space-y-3">
              <div
                className={`p-4 rounded-lg ${
                  validateMutation.data.valid
                    ? 'bg-green-900/30 border border-green-700'
                    : 'bg-red-900/30 border border-red-700'
                }`}
              >
                {validateMutation.data.valid ? (
                  <Check className="w-5 h-5 text-green-500 inline mr-2" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-500 inline mr-2" />
                )}
                {validateMutation.data.message}
              </div>

              {/* Detailed permission checks */}
              {validateMutation.data.permissions && validateMutation.data.permissions.length > 0 && (
                <div className="bg-gray-700/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Permission Check Details
                  </h4>
                  <div className="space-y-2">
                    {validateMutation.data.permissions.map((perm: PermissionCheck, idx: number) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-3 p-2 rounded ${
                          perm.status === 'granted'
                            ? 'bg-green-900/20'
                            : perm.status === 'denied'
                            ? 'bg-red-900/20'
                            : 'bg-yellow-900/20'
                        }`}
                      >
                        {perm.status === 'granted' ? (
                          <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        ) : perm.status === 'denied' ? (
                          <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white text-sm">{perm.service}</span>
                            <code className="text-xs bg-gray-800 px-1.5 py-0.5 rounded text-gray-400">
                              {perm.permission}
                            </code>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{perm.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <hr className="border-gray-700" />
          <p className="text-sm text-gray-400">Update credentials:</p>
        </div>
      ) : (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 mb-4">
          <AlertCircle className="w-5 h-5 text-yellow-500 inline mr-2" />
          No credentials configured. Enter your AWS credentials below.
        </div>
      )}

      {/* How to get AWS credentials */}
      <div className="mb-4 border border-gray-700 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowInstructions(!showInstructions)}
          className="w-full px-4 py-3 bg-gray-700/50 hover:bg-gray-700 flex items-center gap-2 text-left"
        >
          {showInstructions ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          <span className="font-medium">How to get AWS Access Keys</span>
        </button>

        {showInstructions && (
          <div className="p-4 bg-gray-800/50 space-y-4 text-sm">
            <div className="space-y-3">
              <h4 className="font-semibold text-white">Option 1: Create a new IAM User (Recommended)</h4>
              <ol className="list-decimal list-inside space-y-2 text-gray-300">
                <li>
                  Go to the{' '}
                  <a
                    href="https://console.aws.amazon.com/iam/home#/users"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    AWS IAM Console
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>Click <span className="text-white font-medium">"Create user"</span></li>
                <li>Enter a username (e.g., <code className="bg-gray-700 px-1 rounded">vibe-hackathon-admin</code>)</li>
                <li>Click <span className="text-white font-medium">"Next"</span></li>
                <li>Select <span className="text-white font-medium">"Attach policies directly"</span></li>
                <li>
                  Search and select these policies:
                  <p className="mt-1 mb-1 text-gray-500 text-xs font-medium">Required permissions:</p>
                  <ul className="list-disc list-inside ml-4 text-gray-400">
                    <li><code className="bg-gray-700 px-1 rounded">AmazonECS_FullAccess</code> - Run ECS tasks</li>
                    <li><code className="bg-gray-700 px-1 rounded">AmazonEC2ContainerRegistryFullAccess</code> - Push Docker images</li>
                    <li><code className="bg-gray-700 px-1 rounded">AmazonEC2ReadOnlyAccess</code> - Get VPC/subnet info</li>
                    <li><code className="bg-gray-700 px-1 rounded">ElasticLoadBalancingFullAccess</code> - ALB for dashboard</li>
                    <li><code className="bg-gray-700 px-1 rounded">CloudWatchLogsFullAccess</code> - View container logs</li>
                    <li><code className="bg-gray-700 px-1 rounded">CloudFrontFullAccess</code> - HTTPS for dashboard & instances</li>
                    <li><code className="bg-gray-700 px-1 rounded">AmazonElasticFileSystemFullAccess</code> - Persistent storage</li>
                    <li><code className="bg-gray-700 px-1 rounded">AWSCodeBuildAdminAccess</code> - Create and run CodeBuild projects</li>
                  </ul>
                  <p className="mt-2 text-gray-500 text-xs font-medium">
                    Required for automated setup:
                  </p>
                  <ul className="list-disc list-inside ml-4 text-gray-400">
                    <li><code className="bg-gray-700 px-1 rounded">IAMFullAccess</code> - Creates ECS/CodeBuild service roles</li>
                  </ul>
                  <p className="mt-2 text-gray-500 text-xs font-medium">
                    Optional (for AI in containers):
                  </p>
                  <ul className="list-disc list-inside ml-4 text-gray-400">
                    <li><code className="bg-gray-700 px-1 rounded">AmazonBedrockFullAccess</code> - AI access in containers</li>
                  </ul>
                </li>
                <li>Click <span className="text-white font-medium">"Create user"</span></li>
                <li>Click on the new user, go to <span className="text-white font-medium">"Security credentials"</span> tab</li>
                <li>Click <span className="text-white font-medium">"Create access key"</span></li>
                <li>Select <span className="text-white font-medium">"Application running outside AWS"</span></li>
                <li>Copy the <span className="text-white font-medium">Access Key ID</span> and <span className="text-white font-medium">Secret Access Key</span></li>
              </ol>
            </div>

            <hr className="border-gray-700" />

            <div className="space-y-3">
              <h4 className="font-semibold text-white">Option 2: Use existing credentials</h4>
              <p className="text-gray-300">
                If you already have AWS CLI configured, you can find your credentials at:
              </p>
              <ul className="list-disc list-inside text-gray-400">
                <li>
                  <span className="text-white">Windows:</span>{' '}
                  <code className="bg-gray-700 px-1 rounded">C:\Users\YOUR_USER\.aws\credentials</code>
                </li>
                <li>
                  <span className="text-white">Mac/Linux:</span>{' '}
                  <code className="bg-gray-700 px-1 rounded">~/.aws/credentials</code>
                </li>
              </ul>
            </div>

            <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3 mt-4">
              <p className="text-blue-200 text-xs mb-2">
                <strong>For Production / Enhanced Security:</strong> AWS recommends using{' '}
                <a
                  href="https://docs.aws.amazon.com/rolesanywhere/latest/userguide/introduction.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  IAM Roles Anywhere
                </a>{' '}
                for temporary credentials instead of static access keys. This requires setting up a certificate authority and trust anchor.
              </p>
              <p className="text-blue-300 text-xs">
                For hackathons and quick setups, access keys work fine. Just delete the IAM user after the event.
              </p>
            </div>

            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mt-2">
              <p className="text-yellow-200 text-xs">
                <strong>Security Note:</strong> Credentials are stored locally in the dashboard's data folder.
                Never share your Secret Access Key or commit it to git.
              </p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            AWS Access Key ID
          </label>
          <input
            type="text"
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            placeholder="AKIA..."
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            AWS Secret Access Key
          </label>
          <input
            type="password"
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            placeholder="Your secret key"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            AWS Region
          </label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="us-east-1">US East (N. Virginia)</option>
            <option value="us-west-2">US West (Oregon)</option>
            <option value="eu-west-1">EU (Ireland)</option>
            <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-2 rounded-lg"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save Credentials'}
        </button>

        {saveMutation.isError && (
          <p className="text-red-400 text-sm">{(saveMutation.error as Error).message}</p>
        )}
      </form>
    </div>
  )
}
