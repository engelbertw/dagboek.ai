import { MOTOR_LABEL, api, type GesprekRegel } from '../api';
import { Leeg, Melding, useLaden } from '../ui';

/** Per motor naast elkaar: aantal gesprekken, hoeveel er zijn gesproken, de gemiddelde duur en de gemiddelde beoordeling. */
function Vergelijking({ lijst }: { lijst: GesprekRegel[] }) {
  const groepen = new Map<string, GesprekRegel[]>();
  for (const g of lijst) groepen.set(g.engine ?? 'pipecat', [...(groepen.get(g.engine ?? 'pipecat') ?? []), g]);
  const gem = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return (
    <section className="paneel stapel" aria-label="Vergelijking van gespreksmotoren">
      <h2>Vergelijking per motor</h2>
      <table>
        <thead><tr><th>Motor</th><th>Gesprekken</th><th>Gesproken</th><th>Samengevat</th><th>Gem. duur</th><th>Gem. beoordeling</th></tr></thead>
        <tbody>
          {[...groepen].map(([motor, gs]) => {
            const gesproken = gs.filter((g) => g.status === 'gesproken');
            const duur = gem(gesproken.filter((g) => g.gestartOp && g.afgerondOp).map((g) => (new Date(g.afgerondOp!).getTime() - new Date(g.gestartOp!).getTime()) / 60000));
            const score = gem(gs.filter((g) => g.beoordeling).map((g) => g.beoordeling!));
            return (
              <tr key={motor}>
                <td>{MOTOR_LABEL[motor as keyof typeof MOTOR_LABEL] ?? motor}</td><td>{gs.length}</td><td>{gesproken.length}</td>
                <td>{gesproken.filter((g) => g.samenvattingStatus === 'klaar').length}</td>
                <td>{duur === null ? '–' : `${duur.toFixed(1)} min`}</td><td>{score === null ? '–' : score.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}


export function Spraakmotoren() {
  const lijst = useLaden(() => api<GesprekRegel[]>('GET', '/calls'));
  const motoren = new Set((lijst.data ?? []).map((g) => g.engine ?? 'pipecat'));
  return (
    <div className="stapel">
      <div><h1>Spraakmotoren</h1><p className="zacht">De gespreksmotoren naast elkaar: hoeveel gesprekken, hoeveel er zijn gesproken en samengevat, de gemiddelde duur en de beoordeling.</p></div>
      <Melding tekst={lijst.fout} />
      {lijst.data && motoren.size < 2 && <Leeg>Er is nog maar één motor gebruikt; de vergelijking verschijnt zodra gesprekken met een tweede motor zijn gevoerd.</Leeg>}
      {lijst.data && motoren.size >= 2 && <Vergelijking lijst={lijst.data} />}
    </div>
  );
}
