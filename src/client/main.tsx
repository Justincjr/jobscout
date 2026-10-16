import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bootstrap, request } from './api';
import { Icon } from './ui';
import { Feed } from './screens/Feed';
import { Profile } from './screens/Profile';
import { Companies } from './screens/Companies';
import { PreferencesScreen, SettingsScreen } from './screens/Settings';
import { State } from '../shared/schema';
import './styles.css';

export type ScreenProps = { data: Bootstrap; mutate: <T = unknown>(url: string, body?: unknown, method?: string) => Promise<T>; notify: (message: string) => void; navigate: (page: string) => void };
const navigation = [
  { id: 'discover', label: 'Discover', icon: 'compass' }, { id: 'applications', label: 'My applications', icon: 'bookmark' },
  { id: 'profile', label: 'Career profile', icon: 'user' }, { id: 'companies', label: 'Companies', icon: 'building' },
  { id: 'preferences', label: 'Preferences', icon: 'sliders' }, { id: 'settings', label: 'Settings', icon: 'settings' },
];

function App() {
  const [data, setData] = useState<Bootstrap>();
  const dataRef = useRef<Bootstrap | undefined>(undefined);
  const [page, setPage] = useState(location.hash.slice(1) || 'discover');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seenTasks = useRef<Map<string, string> | undefined>(undefined);
  const reload = useCallback(async (force = false) => {
    const result = await request<Bootstrap | { unchanged: true }>(`/api/state${!force && dataRef.current ? `?since=${dataRef.current.state.revision}` : ''}`);
    if ('unchanged' in result) return;
    if (!dataRef.current || result.state.revision >= dataRef.current.state.revision) { dataRef.current = result; setData(result); }
  }, []);
  useEffect(() => {
    void reload(true).catch(e => setError(e.message));
    const interval = setInterval(() => { void reload().catch(e => setError(e.message)); }, 2500);
    const hash = () => setPage(location.hash.slice(1) || 'discover');
    window.addEventListener('hashchange', hash);
    return () => { clearInterval(interval); window.removeEventListener('hashchange', hash); };
  }, [reload]);
  const notify = useCallback((message: string) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  useEffect(() => {
    if (!data) return;
    if (seenTasks.current) for (const task of data.state.tasks) {
      if (task.status === 'failed' && seenTasks.current.get(task.id) !== 'failed') notify(task.error ?? 'Task failed. See Settings for details and retry.');
    }
    seenTasks.current = new Map(data.state.tasks.map(t => [t.id, t.status]));
  }, [data, notify]);
  const mutate = async <T,>(url: string, body?: unknown, method = 'POST'): Promise<T> => {
    const current = dataRef.current!;
    setBusy(v => v + 1);
    try {
      const result = await request<T>(url, { method, headers: { 'Content-Type': 'application/json', 'X-Scout-Token': current.token, 'X-Revision': String(current.state.revision) }, body: body === undefined ? undefined : JSON.stringify(body) });
      await reload(true); return result;
    } catch (e) { const message = (e as Error).message; notify(message); await reload(true).catch(() => undefined); throw e; }
    finally { setBusy(v => v - 1); }
  };
  const navigate = (page: string) => { location.hash = page; setPage(page); };
  if (!data) return <div className="boot"><div className="brand-mark"><Icon name="compass" size={34}/></div><h1>Job Scout</h1><p>{error || 'Opening your workspace…'}</p>{error && <button onClick={() => location.reload()}>Try again</button>}</div>;
  const activeNav = navigation.find(item => item.id === page) ?? navigation[0];
  const props = { data, mutate, notify, navigate };
  const confirmed = data.state.facts.filter(f => f.verified).length;
  const tasks = data.state.tasks.filter(t => t.status === 'queued' || t.status === 'running');
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" aria-label="Job Scout home" href="#discover"><span className="brand-mark"><Icon name="compass" size={27}/></span><span>job scout<span className="brand-dot">.</span></span></a><div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} aria-label={item.label} title={item.label} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === 'applications' && data.stats.saved > 0 && <span className="nav-count">{data.stats.saved}</span>}</button>)}</nav>
      <div className="sidebar-note"><span className="note-symbol">↗</span><h3>A more intentional search.</h3><p>Find the right roles.<br/>Tell your story well.</p><button onClick={() => navigate('profile')}>Build your profile <Icon name="arrow" size={16}/></button></div>
      <div className="local-status"><span className="status-dot"/><span>Local workspace<small>Saved on this computer</small></span><Icon name="lock" size={15}/></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div><span className="muted">Workspace</span><span className="breadcrumb">/</span>{activeNav.label}</div><div className="topbar-right">{busy > 0 ? <span className="saving">Saving…</span> : <span className="saved-indicator"><Icon name="check" size={14}/> All changes saved</span>}<button className="profile-chip" onClick={() => navigate('profile')}><span>Y</span>Your profile<Icon name="user" size={15}/></button></div></header>
      <main>{page === 'profile' ? <Profile {...props}/> : page === 'companies' ? <Companies {...props}/> : page === 'preferences' ? <PreferencesScreen {...props}/> : page === 'settings' ? <SettingsScreen {...props}/> : <Feed {...props} applications={page === 'applications'} confirmed={confirmed}/>}</main>
      <footer><span>JOB SCOUT</span> A thoughtful next move.<span className="footer-right">Your search. Your story. Your next chapter.</span></footer>
    </div>
    {tasks.length > 0 && <div className="task-progress" role="status"><span className="spinner"/>{tasks[0].kind === 'refresh' ? 'Refreshing company board' : tasks[0].kind === 'draft' ? 'Preparing grounded drafts' : tasks[0].kind === 'rank' ? 'Ranking a new job with AI' : 'Processing'}<small>{tasks.length} task{tasks.length > 1 ? 's' : ''} · safe to navigate</small></div>}
    {toast && <div className="toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" size={16}/></button></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
