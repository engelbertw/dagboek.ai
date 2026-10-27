import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiFout } from './api';

export function useLaden<T>(laad: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const ververs = useCallback(async () => {
    try { setData(await laad()); setFout(null); } catch (e) { setFout(e instanceof Error ? e.message : 'Er ging iets mis'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void ververs(); }, [ververs]);
  return { data, fout, ververs };
}

export function foutTekst(e: unknown): string {
  if (e instanceof ApiFout) return e.details.length ? `${e.message}: ${e.details.join('; ')}` : e.message;
  return e instanceof Error ? e.message : 'Er ging iets mis';
}

export function Melding({ tekst, soort = 'fout' }: { tekst: string | null; soort?: 'fout' | 'ok' }) {
  return tekst ? <p className={`melding ${soort}`} role={soort === 'fout' ? 'alert' : 'status'}>{tekst}</p> : null;
}

export function Veld({ label, children }: { label: string; children: ReactNode }) {
  return <label className="veld"><span>{label}</span>{children}</label>;
}

export function Badge({ children, soort }: { children: ReactNode; soort?: string }) {
  return <span className={`badge ${soort ?? ''}`}>{children}</span>;
}

export function Leeg({ children }: { children: ReactNode }) {
  return <p className="leeg">{children}</p>;
}
