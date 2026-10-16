import { Application, Job, Match, Ranking, Snapshot, State } from '../shared/schema';
import { z } from 'zod';

export type JobRow = { job: Job; snapshot: Snapshot; match?: Match; application?: z.infer<typeof Application>; ranking?: Ranking; rankingStale?: boolean };
export type Bootstrap = { state: State; token: string; providers: { openai: boolean; anthropic: boolean }; starters: { name: string; url: string }[]; stats: { active: number; saved: number; applied: number } };
export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? 'Could not connect to the local server. Check that Job Scout is running.'); }
  return response.json() as Promise<T>;
}
export async function base64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 8192) binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  return btoa(binary);
}
