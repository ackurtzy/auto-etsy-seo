export const formatNumber = (value?: number | null, fallback = '—') => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return fallback
  }
  return new Intl.NumberFormat('en-US').format(value)
}

export const formatPercent = (value?: number | null, digits = 1) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '—'
  }
  return `${value.toFixed(digits)}%`
}

export const formatPercentFromDecimal = (value?: number | null, digits = 1) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '—'
  }
  return `${(value * 100).toFixed(digits)}%`
}

export const formatDelta = (value?: number | null, digits = 1) => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '—'
  }
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(digits)}`
}

export const truncate = (value: string | undefined, length = 60) => {
  if (!value) return ''
  return value.length > length ? `${value.slice(0, length)}…` : value
}
