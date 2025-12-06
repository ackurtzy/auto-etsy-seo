import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'

const createClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  })

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
