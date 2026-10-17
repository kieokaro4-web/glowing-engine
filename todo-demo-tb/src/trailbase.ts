// TrailBase data layer for the todo demo.
//
// TrailBase exposes each table through a REST "records" API plus a Server-Sent
// Events (SSE) realtime feed. This module is the tb analogue of the Supabase
// demo's `supabase.ts` and the Nhost demo's `nhost.ts`: it wraps fetch for CRUD
// and EventSource for subscriptions, and normalizes TrailBase's storage types
// (integer booleans, unix-second timestamps) into the shape App.tsx expects.
//
// By default the browser uses same-origin `/api/*` paths and Vite proxies them
// to TrailBase on :4000, so no CORS or client key is required.

const base = import.meta.env.VITE_TRAILBASE_URL ?? ''
const recordsUrl = `${base}/api/records/v1/todos`

export type Todo = {
  id: number
  title: string
  completed: boolean
  created_at: string
}

// Raw shapes as returned by the TrailBase records API.
type RawTodo = {
  id: number
  title: string
  completed: number
  created_at: number
}

function toTodo(raw: RawTodo): Todo {
  return {
    id: raw.id,
    title: raw.title,
    completed: raw.completed === 1,
    created_at: new Date(raw.created_at * 1000).toISOString(),
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `TrailBase request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const jsonHeaders = { 'content-type': 'application/json' }

export const trailbase = {
  async list(): Promise<Todo[]> {
    const data = await request<{ records: RawTodo[] }>(
      `${recordsUrl}?order=-created_at`,
      { headers: { accept: 'application/json' } },
    )
    return (data.records ?? []).map(toTodo)
  },

  async create(title: string): Promise<void> {
    await request(`${recordsUrl}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ title }),
    })
  },

  async update(id: number, patch: { title?: string; completed?: boolean }): Promise<void> {
    const body: Record<string, unknown> = {}
    if (patch.title !== undefined) body.title = patch.title
    if (patch.completed !== undefined) body.completed = patch.completed ? 1 : 0
    await request(`${recordsUrl}/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    })
  },

  async remove(id: number): Promise<void> {
    await request(`${recordsUrl}/${id}`, { method: 'DELETE' })
  },

  // Subscribe to all changes on the collection. TrailBase streams SSE frames
  // such as `data: {"Insert":{...},"seq":1}`; we don't need the payload because
  // the caller simply reloads, matching the Supabase/Nhost reload-on-change
  // behavior. Returns a cleanup function.
  subscribe(onChange: () => void): () => void {
    const source = new EventSource(`${recordsUrl}/subscribe/*`)
    source.onmessage = (event) => {
      if (event.data) onChange()
    }
    // EventSource reconnects automatically; no custom handling needed here.
    return () => source.close()
  },
}
