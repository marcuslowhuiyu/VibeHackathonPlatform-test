import { useState, useRef, useEffect } from 'react'
import { Rocket, Loader2, AlertCircle } from 'lucide-react'

interface LandingPageProps {
  // Reserved for future use
}

interface LoginResponse {
  success: boolean
  token: string
  user: {
    type: string
    id: string
    name: string
    email: string
    instanceId: string
  }
  instance: {
    id: string
    status: string
    vscode_url: string | null
    app_url: string | null
    cloudfront_domain: string | null
  }
}

export default function LandingPage(_props: LandingPageProps = {}) {
  const [code, setCode] = useState<string[]>(['', '', '', '', ''])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const handleInputChange = (index: number, value: string) => {
    // Only accept alphanumeric characters
    const cleanValue = value.toUpperCase().replace(/[^A-Z0-9]/g, '')

    if (cleanValue.length <= 1) {
      const newCode = [...code]
      newCode[index] = cleanValue
      setCode(newCode)
      setError(null)

      // Auto-focus next input
      if (cleanValue && index < 4) {
        inputRefs.current[index + 1]?.focus()
      }

      // Auto-submit when all fields are filled
      if (cleanValue && index === 4) {
        const fullCode = newCode.join('')
        if (fullCode.length === 5) {
          handleSubmit(fullCode)
        }
      }
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'Enter') {
      const fullCode = code.join('')
      if (fullCode.length === 5) {
        handleSubmit(fullCode)
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '')

    if (pastedText.length >= 5) {
      const newCode = pastedText.slice(0, 5).split('')
      setCode(newCode)
      setError(null)
      handleSubmit(pastedText.slice(0, 5))
    }
  }

  const handleSubmit = async (accessToken: string) => {
    if (isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/access-token/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      })

      const data: LoginResponse | { error: string } = await response.json()

      if (!response.ok) {
        throw new Error((data as { error: string }).error || 'Invalid access token')
      }

      const loginData = data as LoginResponse

      // Store the token
      localStorage.setItem('vibe_auth_token', loginData.token)

      // Open VS Code and App in new tabs
      if (loginData.instance.vscode_url) {
        window.open(loginData.instance.vscode_url, '_blank')
      }
      if (loginData.instance.app_url) {
        window.open(loginData.instance.app_url, '_blank')
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setCode(['', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-600 rounded-2xl mb-6 shadow-lg">
            <Rocket className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">Vibe Hackathon</h1>
          <p className="text-gray-400 text-lg">Enter your access code to begin</p>
        </div>

        {/* Code Input */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-gray-700">
          <div className="flex justify-center gap-3 mb-6">
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el }}
                type="text"
                maxLength={1}
                value={digit}
                onChange={(e) => handleInputChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                className={`w-14 h-16 text-center text-2xl font-mono font-bold rounded-xl border-2
                  bg-gray-900/50 text-white uppercase
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                  ${error ? 'border-red-500' : 'border-gray-600'}
                  transition-all duration-200`}
                disabled={isLoading}
              />
            ))}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm mb-4 justify-center">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2 text-blue-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Launching your workspace...</span>
            </div>
          )}

          {/* Help Text */}
          <p className="text-gray-500 text-sm text-center mt-4">
            Your access code was provided by your organizer
          </p>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-gray-500 text-sm">
            Need help? Contact your event organizer.
          </p>
        </div>
      </div>
    </div>
  )
}
