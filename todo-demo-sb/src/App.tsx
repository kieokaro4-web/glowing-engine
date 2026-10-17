import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase, Todo } from './supabase'

type Filter = 'all' | 'open' | 'done'

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'open', label: 'To do' },
  { id: 'done', label: 'Done' },
]

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadTodos() {
    const { data, error: queryError } = await supabase
      .from('todos')
      .select('*')
      .order('created_at', { ascending: false })

    if (queryError) {
      setError(queryError.message)
    } else {
      setTodos(data ?? [])
      setError('')
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadTodos()

    const channel = supabase
      .channel('todo-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => {
        void loadTodos()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
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
    const { error: insertError } = await supabase.from('todos').insert({ title: cleanTitle })
    if (insertError) setError(insertError.message)
    else {
      setTitle('')
      await loadTodos()
    }
    setSaving(false)
  }

  async function toggleTodo(todo: Todo) {
    const { error: updateError } = await supabase
      .from('todos')
      .update({ completed: !todo.completed })
      .eq('id', todo.id)
    if (updateError) setError(updateError.message)
    else await loadTodos()
  }

  async function deleteTodo(id: number) {
    const { error: deleteError } = await supabase.from('todos').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else await loadTodos()
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Little Things home">
          <span className="wordmark-mark">lt.</span>
          <span>little things</span>
        </a>
        <div className="local-badge"><span className="status-dot" /> Local workspace</div>
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