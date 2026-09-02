import { useEffect, useRef } from 'react'

let _show = null
export function toast(msg, isError = false) {
  if (_show) _show(msg, isError)
}

export default function Toast() {
  const ref = useRef()

  useEffect(() => {
    _show = (msg, isError) => {
      const el = ref.current
      if (!el) return
      el.textContent = msg
      el.className = 'toast show' + (isError ? ' error' : '')
      clearTimeout(el._t)
      el._t = setTimeout(() => { el.className = 'toast' }, 2400)
    }
    return () => { _show = null }
  }, [])

  return <div ref={ref} className="toast" />
}
