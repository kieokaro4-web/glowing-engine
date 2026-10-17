import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient as createGraphQLSocket } from 'graphql-ws'
import { nhost, Todo } from './nhost'

type Filter = 'all' | 'open' | 'done'

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'open', label: 'To do' },
  { id: 'done', label: 'Done' },
]

const todosQuery = `query GetTodos {
  todos(order_by: { created_at: desc }) {
    id
    title
    completed
    created_at
  }
}`

const todosSubscription = `subscription WatchTodos {
  todos(order_by: { created_at: desc }) {
    id
    title
    completed
    created_at
  }
}`

async function requestGraphQL<T>(query: string, variables?: Record<string, unknown>) {
  const response = await nhost.graphql.request<T>({ query, variables })
  if (!response.body.data) {
    const message = response.body.errors?.map((error) => error.message).join('; ')
    throw new Error(message || 'Nhost GraphQL returned no data')
  }
  return response.body.data
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadTodos() {
    try {
      const data = await requestGraphQL<{ todos: Todo[] }>(todosQuery)
      setTodos(data.todos)
      setError('')
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : String(queryError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTodos()

    const socket = createGraphQLSocket({
      url: import.meta.env.VITE_NHOST_GRAPHQL_WS_URL,
      connectionParams: { headers: { 'x-hasura-role': 'public' } },
    })
    const unsubscribe = socket.subscribe<{ todos: Todo[] }>({ query: todosSubscription }, {
      next: (result) => {
        if (result.data) {
          setTodos(result.data.todos)
          setLoading(false)
          setError('')
        }
      },
      error: (subscriptionError) => {
        setError(String(subscriptionError))
      },
      complete: () => {},
    })

    return () => {
      unsubscribe()
      void socket.dispose()
    }
  }, [])

  const visibleTodos = useMemo(
    () => todos.filter((todo) => {
      if (filter === 'open') return !todo.completed
      if (filter === 'done') return todo.completed
      return true
    }),
    [filter, todos],
  )
  const remaining = todos.filter((todo) => !todo.completed).length
  const completed = todos.length - remaining

  async function addTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle || saving) return

    setSaving(true)
    try {
      await requestGraphQL<{ insert_todos_one: { id: number } | null }>(
        `mutation AddTodo($title: String!) {
          insert_todos_one(object: { title: $title }) { id }
        }`,
        { title: cleanTitle },
      )
      setTitle('')
      await loadTodos()
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : String(insertError))
    } finally {
      setSaving(false)
    }
  }

  async function toggleTodo(todo: Todo) {
    try {
      await requestGraphQL<{ update_todos_by_pk: { id: number } | null }>(
        `mutation ToggleTodo($id: Int!, $completed: Boolean!) {
          update_todos_by_pk(pk_columns: { id: $id }, _set: { completed: $completed }) { id }
        }`,
        { id: todo.id, completed: !todo.completed },
      )
      await loadTodos()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    }
  }

  async function deleteTodo(id: number) {
    try {
      await requestGraphQL<{ delete_todos_by_pk: { id: number } | null }>(
        `mutation DeleteTodo($id: Int!) {
          delete_todos_by_pk(id: $id) { id }
        }`,
        { id },
      )
      await loadTodos()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Little Things home">
          <span className="wordmark-mark">lt.</span>
          <span>little things</span>
        </a>
        <div className="local-badge"><span className="status-dot" /> Local Nhost</div>
      </header>

      <section className="todo-layout" id="top">
        <aside className="intro">
          <p className="eyebrow">A little room to think</p>
          <h1>Make space<br />for what <em>matters.</em></h1>
          <p className="intro-copy">One thing at a time. Your list is saved right here, in your local workspace.</p>
          <div className="today-note">
            <span className="note-star" aria-hidden="true">✳</span>
            <span>Small steps still move you forward.</span>
          </div>
        </aside>

        <section className="todo-panel" aria-label="Todo list">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Your list</p>
              <h2>Today, gently.</h2>
            </div>
            <div className="task-count" aria-label={`${remaining} tasks remaining`}>
              <strong>{String(remaining).padStart(2, '0')}</strong>
              <span>left</span>
            </div>
          </div>

          <form className="add-form" onSubmit={addTodo}>
            <label className="sr-only" htmlFor="new-todo">Add a task</label>
            <input
              id="new-todo"
              maxLength={180}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What would you like to do?"
              value={title}
            />
            <button className="add-button" disabled={!title.trim() || saving} type="submit">
              <span>{saving ? 'Adding' : 'Add task'}</span>
              <span aria-hidden="true">↗</span>
            </button>
          </form>

          <div className="list-toolbar">
            <div className="filter-tabs" aria-label="Filter tasks" role="tablist">
              {filters.map((item) => (
                <button
                  aria-selected={filter === item.id}
                  className={filter === item.id ? 'filter-tab selected' : 'filter-tab'}
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  role="tab"
                  type="button"
                >
                  {item.label}
                  {item.id === 'done' && completed > 0 && <span className="filter-count">{completed}</span>}
                </button>
              ))}
            </div>
            <span className="total-label">{todos.length} {todos.length === 1 ? 'task' : 'tasks'}</span>
          </div>

          <div className="todo-list" aria-live="polite">
            {loading ? (
              <p className="empty-state">Gathering your list...</p>
            ) : visibleTodos.length === 0 ? (
              <div className="empty-state">
                <span className="empty-mark" aria-hidden="true">○</span>
                <p>{filter === 'done' ? 'Nothing checked off yet.' : filter === 'open' ? 'All caught up. Take a breath.' : 'A fresh page. Add your first little thing.'}</p>
              </div>
            ) : visibleTodos.map((todo, index) => (
              <article className={todo.completed ? 'todo-row is-done' : 'todo-row'} key={todo.id}>
                <button
                  aria-label={todo.completed ? `Mark ${todo.title} as to do` : `Complete ${todo.title}`}
                  aria-pressed={todo.completed}
                  className="check-button"
                  onClick={() => void toggleTodo(todo)}
                  type="button"
                >
                  {todo.completed && <span aria-hidden="true">✓</span>}
                </button>
                <span className="row-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="todo-title">{todo.title}</span>
                <button
                  aria-label={`Delete ${todo.title}`}
                  className="delete-button"
                  onClick={() => void deleteTodo(todo.id)}
                  title="Delete task"
                  type="button"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </article>
            ))}
          </div>

          {error && <p className="error-message" role="alert">{error}</p>}

          <footer className="panel-footer">
            <span><span className="footer-spark" aria-hidden="true">✳</span> Keep it kind. Keep it moving.</span>
            <span>Synced locally</span>
          </footer>
        </section>
      </section>
      <footer className="page-footer"><span>LESS, BUT WITH ATTENTION</span><span>BUILT FOR TODAY</span></footer>
    </main>
  )
}