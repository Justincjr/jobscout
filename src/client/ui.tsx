import { ReactNode, cloneElement, isValidElement, useEffect, useId, useRef } from 'react';

const paths: Record<string, ReactNode> = {
  compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/></>,
  bookmark: <path d="M6 4h12v17l-6-4-6 4Z"/>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></>,
  building: <><path d="M4 21V7l8-4 8 4v14M2 21h20M9 21v-5h6v5"/><path d="M8 9h1m6 0h1m-8 3h1m6 0h1"/></>,
  sliders: <><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
  settings: <><circle cx="12" cy="12" r="4"/><path d="m10 2 4 0 1 3 3-1 2 3-2 3 3 1v3l-3 1 1 3-3 2-3-2-1 3h-3l-1-3-3 1-2-3 2-3-3-1v-3l3-1-1-3 3-2 3 2Z"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  plus: <path d="M12 4v16M4 12h16"/>,
  search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
  check: <path d="m5 12 4 4 10-10"/>,
  pin: <><path d="M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
  refresh: <><path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6"/></>,
  external: <><path d="M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7"/></>,
  file: <><path d="M5 2h9l5 5v15H5Z M14 2v6h5M8 12h8M8 16h8"/></>,
  close: <path d="m5 5 14 14M19 5 5 19"/>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/></>,
};
export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.file}</svg>;
}
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={close} className="modal"><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><Icon name="close" /></button></div>{children}</dialog>;
}
export function Empty({ icon = 'compass', title, children, action }: { icon?: string; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Icon name={icon} size={30}/></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  const generatedId = useId();
  const child = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children) ? children : null;
  const id = child?.props.id ?? generatedId;
  return <div className="field"><label htmlFor={id}>{label}</label>{child ? cloneElement(child, { id, 'aria-describedby': help ? `${id}-help` : undefined }) : children}{help && <small id={`${id}-help`}>{help}</small>}</div>;
}
export function timeAgo(iso: string | null) {
  if (!iso) return 'Never refreshed';
  const hours = Math.floor((Date.now() - Date.parse(iso)) / 3600000);
  return hours < 1 ? 'Just refreshed' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
