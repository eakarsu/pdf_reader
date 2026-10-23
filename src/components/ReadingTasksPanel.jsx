import { useCallback, useEffect, useState } from 'react';
import AiSections from './AiSections';

// Authenticated reading tasks + AI over those tasks (wave 15A). Uses the
// app's existing runtime account; the PDF itself is still never uploaded.
const TOKEN_KEY = 'pdf-reader-runtime-token';

async function request(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.error?.message || value?.error || `Request failed (${response.status})`);
  return value;
}

export default function ReadingTasksPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tasks, setTasks] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [title, setTitle] = useState('');
  const [aiResult, setAiResult] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    const value = await request(`/api/tasks?${params}`, token);
    setTasks(value.data || []);
  }, [token, search, status]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const login = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const value = await request('/api/auth/login', '', { method: 'POST', body: JSON.stringify({ email, password }) });
      sessionStorage.setItem(TOKEN_KEY, value.token);
      setToken(value.token);
      setPassword('');
    } catch (e) { setError(e.message); }
  };

  const fillDemo = async () => {
    try {
      const value = await request('/api/auth/demo-credentials', '');
      setEmail(value.email || '');
      setPassword(value.password || '');
    } catch (e) { setError(e.message); }
  };

  const createTask = async () => {
    if (!title.trim()) return;
    await request('/api/tasks', token, { method: 'POST', body: JSON.stringify({ title: title.trim() }) });
    setTitle('');
    await load();
  };

  const advance = async (task) => {
    const next = task.status === 'open' ? 'in_progress' : 'done';
    await request(`/api/tasks/${encodeURIComponent(task.id)}`, token, { method: 'PATCH', body: JSON.stringify({ status: next }) });
    await load();
  };

  const exportRecords = async (format) => {
    const response = await fetch(`/api/tasks/export?format=${format}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { setError(`Export failed (${response.status})`); return; }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tasks.${format === 'csv' ? 'csv' : 'json'}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runAi = async (feature) => {
    setError('');
    try { setAiResult(await request(`/api/runtime-ai/${feature}`, token, { method: 'POST', body: JSON.stringify({}) })); }
    catch (e) { setError(e.message); }
  };

  if (!token) {
    return (
      <section className="panel" id="reading-tasks" aria-labelledby="reading-tasks-heading">
        <h2 id="reading-tasks-heading">Reading tasks</h2>
        <p className="muted">Sign in with your runtime account to manage reading tasks and run AI over them. Your PDF stays in this browser.</p>
        <form onSubmit={login}>
          <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <div className="actions">
            <button type="button" onClick={() => void fillDemo()}>Fill demo credentials</button>
            <button type="submit">Sign in</button>
          </div>
        </form>
        {error ? <p role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="panel" id="reading-tasks" aria-labelledby="reading-tasks-heading">
      <h2 id="reading-tasks-heading">Reading tasks</h2>
      <div className="actions">
        <input type="search" aria-label="Search tasks" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
        <button type="button" onClick={() => void exportRecords('csv')}>Export CSV</button>
        <button type="button" onClick={() => void exportRecords('json')}>Export JSON</button>
      </div>
      <div className="actions">
        <input aria-label="New task title" placeholder="New task title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="button" onClick={() => void createTask()}>Add task</button>
      </div>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <span>{task.title} — {task.status}{task.document_name ? ` (${task.document_name})` : ''}</span>
            {task.status !== 'done' ? <button type="button" onClick={() => void advance(task)}>Advance</button> : null}
          </li>
        ))}
      </ul>
      {tasks.length === 0 ? <p>No tasks match. Add one above.</p> : null}
      <h3>AI over your reading tasks</h3>
      <p className="muted">Deterministic fallback is labelled aiGenerated: false when no provider is configured.</p>
      <div className="actions">
        <button type="button" onClick={() => void runAi('task-triage')}>Task triage</button>
        <button type="button" onClick={() => void runAi('document-checklist')}>Document checklist</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {aiResult ? <AiSections value={aiResult} /> : null}
    </section>
  );
}
