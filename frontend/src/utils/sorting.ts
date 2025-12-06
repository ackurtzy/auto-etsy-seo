export function sortByDate<T>(
  items: T[],
  selector: (item: T) => string | null | undefined,
  direction: 'asc' | 'desc' = 'asc',
) {
  const sorted = [...items]
  sorted.sort((a, b) => {
    const aValue = selector(a)
    const bValue = selector(b)
    const aTime = aValue ? Date.parse(aValue) : 0
    const bTime = bValue ? Date.parse(bValue) : 0
    return direction === 'asc' ? aTime - bTime : bTime - aTime
  })
  return sorted
}

export function sortByText<T>(items: T[], selector: (item: T) => string) {
  const sorted = [...items]
  sorted.sort((a, b) => selector(a).localeCompare(selector(b)))
  return sorted
}
