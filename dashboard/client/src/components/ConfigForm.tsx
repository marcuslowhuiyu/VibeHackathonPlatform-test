import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings, Save } from 'lucide-react'
import { api, Config } from '../lib/api'

export default function ConfigForm() {
  const queryClient = useQueryClient()

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  })

  const [formData, setFormData] = useState<Partial<Config>>({
    cluster_name: '',
    task_definition: '',
    vpc_id: '',
    subnet_ids: '',
    security_group_id: '',
  })

  useEffect(() => {
    if (config) {
      setFormData(config)
    }
  }, [config])

  const updateMutation = useMutation({
    mutationFn: api.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateMutation.mutate(formData)
  }

  const handleChange = (field: keyof Config, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5" />
        AWS Configuration
      </h2>

      <p className="text-gray-400 text-sm mb-4">
        Configure your AWS infrastructure settings. Use the{' '}
        <span className="text-blue-400 font-medium">Setup</span>{' '}
        tab to automatically create these resources, or fill them in manually.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              ECS Cluster Name
            </label>
            <input
              type="text"
              value={formData.cluster_name || ''}
              onChange={(e) => handleChange('cluster_name', e.target.value)}
              placeholder="vibe-cluster"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Task Definition
            </label>
            <input
              type="text"
              value={formData.task_definition || ''}
              onChange={(e) => handleChange('task_definition', e.target.value)}
              placeholder="vibe-coding-lab"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              VPC ID
            </label>
            <input
              type="text"
              value={formData.vpc_id || ''}
              onChange={(e) => handleChange('vpc_id', e.target.value)}
              placeholder="vpc-xxxxxxxx"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Security Group ID
            </label>
            <input
              type="text"
              value={formData.security_group_id || ''}
              onChange={(e) => handleChange('security_group_id', e.target.value)}
              placeholder="sg-xxxxxxxx"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Subnet IDs (comma-separated)
            </label>
            <input
              type="text"
              value={formData.subnet_ids || ''}
              onChange={(e) => handleChange('subnet_ids', e.target.value)}
              placeholder="subnet-xxxxxxxx,subnet-yyyyyyyy"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter at least 2 subnet IDs from different availability zones
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-50 px-6 py-2 rounded-lg flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {updateMutation.isPending ? 'Saving...' : 'Save Configuration'}
        </button>

        {updateMutation.isSuccess && (
          <p className="text-green-400 text-sm">Configuration saved successfully!</p>
        )}

        {updateMutation.isError && (
          <p className="text-red-400 text-sm">{(updateMutation.error as Error).message}</p>
        )}
      </form>
    </div>
  )
}
