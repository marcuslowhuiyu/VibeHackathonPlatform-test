import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Check, ExternalLink, Info } from 'lucide-react'
import { api } from '../lib/api'

interface Extension {
  id: string
  name: string
  description: string
  features: string[]
  credentialSupport: string
  recommended?: boolean
  docsUrl?: string
}

const EXTENSIONS: Extension[] = [
  {
    id: 'continue',
    name: 'Continue',
    description: 'Open-source AI coding assistant with excellent file-based configuration',
    features: [
      'File-based config (most reliable)',
      'Tab autocomplete',
      'Custom slash commands',
      'Direct AWS credential support'
    ],
    credentialSupport: 'Reads from ~/.continue/config.json - credentials auto-configured',
    recommended: true,
    docsUrl: 'https://continue.dev/docs'
  },
  {
    id: 'vibe',
    name: 'Vibe',
    description: 'AI-powered coding for non-technical users with chat and live preview UI',
    features: [
      'Chat-based AI interface',
      'Live preview UI',
      'Beginner-friendly workflow',
      'AWS Bedrock integration'
    ],
    credentialSupport: 'AWS credentials auto-configured via task role',
  },
  {
    id: 'vibe-pro',
    name: 'Vibe Pro',
    description: 'Enhanced Vibe with codebase-aware AI for complex multi-file applications',
    features: [
      'Codebase-aware AI context',
      'Multi-file project support',
      'Live preview UI',
      'Advanced AWS Bedrock integration'
    ],
    credentialSupport: 'AWS credentials auto-configured via task role',
  },
]

export default function ExtensionSelector() {
  const queryClient = useQueryClient()
  const [selectedExtension, setSelectedExtension] = useState<string>('continue')

  // Fetch current config
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  })

  // Update selection when config loads
  useEffect(() => {
    if (config?.ai_extension) {
      setSelectedExtension(config.ai_extension)
    }
  }, [config])

  // Save config mutation
  const saveMutation = useMutation({
    mutationFn: (extension: string) => api.updateConfig({ ai_extension: extension }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
  })

  const handleSelect = (extensionId: string) => {
    setSelectedExtension(extensionId)
    saveMutation.mutate(extensionId)
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
        <Bot className="w-5 h-5" />
        AI Coding Extension
      </h2>
      <p className="text-gray-400 text-sm mb-4">
        Choose which AI coding assistant extension to use in your instances.
        Credentials will be automatically configured.
      </p>

      <div className="space-y-4">
        {EXTENSIONS.map((ext) => (
          <div
            key={ext.id}
            onClick={() => handleSelect(ext.id)}
            className={`relative border rounded-lg p-4 cursor-pointer transition-all ${
              selectedExtension === ext.id
                ? 'border-blue-500 bg-blue-900/20'
                : 'border-gray-600 hover:border-gray-500 bg-gray-700/30'
            }`}
          >
            {/* Selection indicator */}
            {selectedExtension === ext.id && (
              <div className="absolute top-4 right-4 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}

            {/* Header */}
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-lg">{ext.name}</h3>
                  {ext.recommended && (
                    <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-sm mt-1">{ext.description}</p>
              </div>
            </div>

            {/* Features */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {ext.features.map((feature, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-gray-300">
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                  {feature}
                </div>
              ))}
            </div>

            {/* Credential support info */}
            <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-800/50 rounded p-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{ext.credentialSupport}</span>
            </div>

            {/* Docs link */}
            {ext.docsUrl && (
              <a
                href={ext.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2"
              >
                <ExternalLink className="w-3 h-3" />
                Documentation
              </a>
            )}
          </div>
        ))}
      </div>

      {/* Save status */}
      {saveMutation.isPending && (
        <p className="text-sm text-gray-400 mt-4">Saving...</p>
      )}
      {saveMutation.isSuccess && (
        <p className="text-sm text-green-400 mt-4">
          Extension saved! New instances will use {EXTENSIONS.find(e => e.id === selectedExtension)?.name}.
        </p>
      )}
      {saveMutation.isError && (
        <p className="text-sm text-red-400 mt-4">Failed to save extension preference.</p>
      )}
    </div>
  )
}
