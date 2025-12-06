import { useCallback, useMemo, useState } from 'react'

export function useCheckboxSelection(initial: number[] = []) {
  const [selected, setSelected] = useState<Set<number>>(new Set(initial))

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  const isSelected = useCallback((id: number) => selected.has(id), [selected])

  const selectedIds = useMemo(() => Array.from(selected), [selected])

  return { selectedIds, toggle, clear, isSelected, count: selectedIds.length }
}
