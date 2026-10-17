import { createDirectus, realtime, rest } from '@directus/sdk'

const directusUrl = import.meta.env.VITE_DIRECTUS_URL

if (!directusUrl) {
  throw new Error('Directus is not configured. Start the local stack and set VITE_DIRECTUS_URL in .env.local.')
}

// authMode "public" matches the server's WEBSOCKETS_REST_AUTH=public setting:
// realtime subscriptions stay on the public policy, so no browser token exists.
export const directus = createDirectus(directusUrl).with(rest()).with(realtime({ authMode: 'public' }))

export type Todo = {
  id: number
  title: string
  completed: boolean
  created_at: string
}

// SQLite-backed Directus can return booleans as 0/1, and the SDK hands back
// loose records, so normalize every row here.
export function toTodo(row: Record<string, unknown>): Todo {
  return {
    id: Number(row.id),
    title: String(row.title),
    completed: Boolean(row.completed),
    created_at: (row.created_at as string | null | undefined) ?? new Date(0).toISOString(),
  }
}
