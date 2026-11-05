import { useCallback, useEffect, useRef, useState } from 'react'
import { notificationsApi, type InboxNotification, type NotificationPage, type NotificationQuery } from '../../api/notifications'

export type UnreadCount = { count?: number; error?: unknown; loading: boolean; refresh: () => void }
// Fetched on sign-in, navigation, deliberate refresh and after read-state changes; never polled.
export function useUnreadCount(): UnreadCount {
  const [state, setState] = useState<{ count?: number; error?: unknown; loading: boolean }>({ loading: true })
  const controller = useRef<AbortController>(null)
  const load = useCallback(() => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    notificationsApi.unreadCount(current.signal).then(({ count }) => {
      if (!current.signal.aborted) setState({ count, loading: false })
    }).catch((error: unknown) => { if (!current.signal.aborted) setState({ error, loading: false }) })
  }, [])
  const refresh = useCallback(() => { setState((previous) => ({ ...previous, loading: true })); load() }, [load])
  useEffect(() => {
    load()
    return () => controller.current?.abort()
  }, [load])
  return { ...state, refresh }
}

export function useNotificationList(query: NotificationQuery, revision: number) {
  const serialized = JSON.stringify(query)
  const key = JSON.stringify([serialized, revision])
  const [result, setResult] = useState<{ key: string; data?: NotificationPage; error?: unknown }>()
  useEffect(() => {
    const controller = new AbortController()
    notificationsApi.list(JSON.parse(serialized) as NotificationQuery, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ key, data })
    }).catch((error: unknown) => { if (!controller.signal.aborted) setResult({ key, error }) })
    return () => controller.abort()
  }, [serialized, key])
  const replace = useCallback((notification: InboxNotification) => setResult((current) => current?.data ? {
    ...current, data: { ...current.data, items: current.data.items.map((item) => item.id === notification.id ? notification : item) },
  } : current), [])
  const current = result?.key === key ? result : undefined
  return { loading: !current, data: current?.data, error: current?.error, replace }
}
