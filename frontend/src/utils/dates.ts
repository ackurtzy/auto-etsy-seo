import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'

export const formatDate = (value?: string | null, pattern = 'MMM d, yyyy') => {
  if (!value) return '—'
  try {
    return format(parseISO(value), pattern)
  } catch (error) {
    return value
  }
}

export const formatRelative = (value?: string | null) => {
  if (!value) return '—'
  try {
    return formatDistanceToNowStrict(parseISO(value), { addSuffix: true })
  } catch (error) {
    return value
  }
}
