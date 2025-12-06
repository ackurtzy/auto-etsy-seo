import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type ExperimentDefaults = {
  runDurationDays?: number
  generationModel?: string
  tolerance?: number
  includePriorExperiments?: boolean
}

type SettingsContextValue = {
  baseUrl: string
  setBaseUrl: (value: string) => void
  experimentDefaults: ExperimentDefaults
  updateExperimentDefaults: (updates: Partial<ExperimentDefaults>) => void
}

const DEFAULT_BASE_URL = 'http://localhost:8000'
const BASE_STORAGE_KEY = 'auto-etsy-api-base-url'
const EXPERIMENT_STORAGE_KEY = 'auto-etsy-experiment-defaults'

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined)

const DEFAULT_EXPERIMENT_DEFAULTS: ExperimentDefaults = {
  runDurationDays: 14,
  tolerance: 0.05,
  includePriorExperiments: true,
}

const readBaseUrl = () => {
  if (typeof window === 'undefined') return DEFAULT_BASE_URL
  return localStorage.getItem(BASE_STORAGE_KEY) || DEFAULT_BASE_URL
}

const readDefaults = (): ExperimentDefaults => {
  if (typeof window === 'undefined') return DEFAULT_EXPERIMENT_DEFAULTS
  const raw = localStorage.getItem(EXPERIMENT_STORAGE_KEY)
  if (!raw) return DEFAULT_EXPERIMENT_DEFAULTS
  try {
    return { ...DEFAULT_EXPERIMENT_DEFAULTS, ...JSON.parse(raw) }
  } catch (error) {
    console.warn('Failed to parse experiment defaults from storage', error)
    return DEFAULT_EXPERIMENT_DEFAULTS
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [baseUrl, setBaseUrlState] = useState<string>(readBaseUrl)
  const [experimentDefaults, setExperimentDefaults] = useState<ExperimentDefaults>(readDefaults)

  const setBaseUrl = useCallback((value: string) => {
    setBaseUrlState(value)
    if (typeof window !== 'undefined') {
      localStorage.setItem(BASE_STORAGE_KEY, value)
    }
  }, [])

  const updateExperimentDefaults = useCallback((updates: Partial<ExperimentDefaults>) => {
    setExperimentDefaults((prev) => {
      const next = { ...prev, ...updates }
      if (typeof window !== 'undefined') {
        localStorage.setItem(EXPERIMENT_STORAGE_KEY, JSON.stringify(next))
      }
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ baseUrl, setBaseUrl, experimentDefaults, updateExperimentDefaults }),
    [baseUrl, experimentDefaults, setBaseUrl, updateExperimentDefaults],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettingsContext(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettingsContext must be used within the SettingsProvider')
  }
  return context
}
