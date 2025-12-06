export type RequestParams = Record<string, string | number | boolean | undefined | null>

type ExtendedRequestInit = Omit<RequestInit, 'body'> & {
  body?: BodyInit | Record<string, unknown> | null
  params?: RequestParams
}

export class ApiClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl?.replace(/\/$/, '') || 'http://localhost:8000'
  }

  private buildUrl(path: string, params?: RequestParams) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const url = new URL(`${this.baseUrl}${normalizedPath}`)
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        url.searchParams.set(key, String(value))
      })
    }
    return url.toString()
  }

  async request<T>(path: string, init?: ExtendedRequestInit) {
    const normalizedInit = (init || {}) as ExtendedRequestInit
    const { params, headers, body, method = 'GET', ...rest } = normalizedInit
    const url = this.buildUrl(path, params)
    const headerMap = new Headers(headers)
    headerMap.set('Accept', 'application/json')

    let finalBody: BodyInit | null | undefined
    if (
      body &&
      typeof body === 'object' &&
      !(body instanceof FormData) &&
      !(body instanceof Blob) &&
      !(body instanceof URLSearchParams)
    ) {
      finalBody = JSON.stringify(body)
      if (!headerMap.has('Content-Type')) {
        headerMap.set('Content-Type', 'application/json')
      }
    } else {
      finalBody = body ?? undefined
    }

    const response = await fetch(url, {
      method,
      headers: headerMap,
      body: finalBody as BodyInit | null | undefined,
      ...rest,
    })

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`
      try {
        const errorBody = await response.json()
        if (errorBody?.error) {
          message = errorBody.error
        }
      } catch (error) {
        const text = await response.text()
        if (text) message = text
      }
      throw new Error(message)
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return (await response.json()) as T
    }
    return (await response.text()) as T
  }

  get<T>(path: string, params?: RequestParams) {
    return this.request<T>(path, { method: 'GET', params })
  }

  post<T>(path: string, body?: ExtendedRequestInit['body']) {
    return this.request<T>(path, { method: 'POST', body })
  }

  put<T>(path: string, body?: ExtendedRequestInit['body']) {
    return this.request<T>(path, { method: 'PUT', body })
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' })
  }
}
