import { useState } from 'react'
import { Plus, Loader2, Minus, AlertTriangle, CheckCircle, Package, ExternalLink } from 'lucide-react'

interface SetupStatus {
  configured: boolean
  missing: string[]
  ecrImageExists: boolean
  imageUri: string | null
}

interface SpinUpFormProps {
  onSpinUp: (count: number) => void
  isLoading: boolean
  setupStatus?: SetupStatus
  onGoToSetup: () => void
}

export default function SpinUpForm({ onSpinUp, isLoading, setupStatus, onGoToSetup }: SpinUpFormProps) {
  const [count, setCount] = useState(1)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (count >= 1 && count <= 100) {
      onSpinUp(count)
    }
  }

  const handleCountChange = (value: string) => {
    const num = parseInt(value, 10)
    if (!isNaN(num)) {
      setCount(Math.max(1, Math.min(100, num)))
    } else if (value === '') {
      setCount(1)
    }
  }

  const increment = () => setCount((c) => Math.min(100, c + 1))
  const decrement = () => setCount((c) => Math.max(1, c - 1))
  const incrementBy10 = () => setCount((c) => Math.min(100, c + 10))
  const decrementBy10 = () => setCount((c) => Math.max(1, c - 10))

  const isSetupComplete = setupStatus?.configured ?? false
  const hasImage = setupStatus?.ecrImageExists ?? false
  const canSpinUp = isSetupComplete && hasImage

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Plus className="w-5 h-5" />
        Spin Up Instances
      </h2>

      {/* Setup Status Warnings */}
      {setupStatus && !canSpinUp && (
        <div className="mb-4 space-y-2">
          {!isSetupComplete && (
            <div className="bg-red-900/50 border border-red-600 rounded-lg p-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-200 font-medium">Setup Incomplete</p>
                <p className="text-red-300 text-sm">
                  Missing: {setupStatus.missing.join(', ')}
                </p>
                <button
                  onClick={onGoToSetup}
                  className="mt-2 text-sm bg-red-600 hover:bg-red-500 px-3 py-1 rounded"
                >
                  Go to Setup
                </button>
              </div>
            </div>
          )}

          {isSetupComplete && !hasImage && (
            <div className="bg-yellow-900/50 border border-yellow-600 rounded-lg p-3 flex items-start gap-3">
              <Package className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-yellow-200 font-medium">Docker Image Not Found</p>
                <p className="text-yellow-300 text-sm">
                  You need to build and push the Docker image to ECR before spinning up instances.
                </p>
                <button
                  onClick={onGoToSetup}
                  className="mt-2 text-sm bg-yellow-600 hover:bg-yellow-500 px-3 py-1 rounded"
                >
                  Go to Setup → Build & Push
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ready Status */}
      {setupStatus && canSpinUp && (
        <div className="mb-4 bg-green-900/30 border border-green-600/50 rounded-lg p-3 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-green-200 font-medium">Ready to Launch</p>
            <div className="text-green-300 text-sm mt-1">
              <span className="text-gray-400">Image:</span>{' '}
              <code className="bg-gray-900/50 px-2 py-0.5 rounded text-xs break-all">
                {setupStatus.imageUri}
              </code>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[280px]">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Number of Instances (1-100)
          </label>
          <div className="flex items-center gap-2">
            {/* -10 button */}
            <button
              type="button"
              onClick={decrementBy10}
              disabled={count <= 1}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg text-sm font-medium"
            >
              -10
            </button>
            {/* -1 button */}
            <button
              type="button"
              onClick={decrement}
              disabled={count <= 1}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed p-2 rounded-lg"
            >
              <Minus className="w-4 h-4" />
            </button>
            {/* Number input */}
            <input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => handleCountChange(e.target.value)}
              className="w-20 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-center text-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {/* +1 button */}
            <button
              type="button"
              onClick={increment}
              disabled={count >= 100}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed p-2 rounded-lg"
            >
              <Plus className="w-4 h-4" />
            </button>
            {/* +10 button */}
            <button
              type="button"
              onClick={incrementBy10}
              disabled={count >= 100}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg text-sm font-medium"
            >
              +10
            </button>
          </div>
          {/* Quick select buttons */}
          <div className="flex gap-2 mt-3">
            {[1, 5, 10, 25, 50, 100].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className={`px-3 py-1 rounded text-sm ${
                  count === n
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || count < 1 || count > 100 || !canSpinUp}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3 rounded-lg flex items-center gap-2 font-medium"
          title={!canSpinUp ? 'Complete setup first' : undefined}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Plus className="w-5 h-5" />
              Spin Up {count} Instance{count > 1 ? 's' : ''}
            </>
          )}
        </button>
      </form>

      <div className="flex items-center justify-between mt-4 text-sm">
        <p className="text-gray-400">
          Each instance includes VS Code IDE (port 8080) and React dev server (port 3000).
        </p>
        <p className="text-gray-500">
          Est. cost: <span className="text-yellow-400 font-medium">~${(count * 0.1).toFixed(2)}/hour</span>
        </p>
      </div>
    </div>
  )
}
