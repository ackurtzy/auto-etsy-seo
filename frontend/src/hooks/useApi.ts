import { useMemo } from 'react'
import { ApiClient } from '../api/client'
import { useSettingsContext } from '../app/providers/SettingsProvider'

export function useApi() {
  const { baseUrl } = useSettingsContext()
  return useMemo(() => new ApiClient(baseUrl), [baseUrl])
}
