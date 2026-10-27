import { Link } from 'react-router-dom';
import { api, deadlineTekst, type Actie, type DashboardData, type Stand } from '../api';
import { Badge, Leeg, Melding, useLaden } from '../ui';

const Tegel = ({ waarde, label, soort }: { waarde: string | number; label: string; soort?: 'fout' | 'ok' }) => (
  <div className={`tegel ${soort ?? ''}`}><strong>{waarde}</strong><span>{label}</span></div>
);
const procent = (s: Stand) => (s.nakoming === null ? '–' : `${s.nakoming}%`);

function ActieLijst({ titel, acties, leeg }: { titel: string; acties: Actie[]; leeg: string }) {
  return (
    <section className="paneel">
      <h2>{titel}</h2>
      {acties.length === 0 && <Leeg>{leeg}</Leeg>}
      {acties.map((a) => (
        <div key={a.id} className="punt">
          <span style={{ flex: 1, minWidth: 180 }}><Link to={`/onderwerp/${a.topicId}`}>{a.tekst}</Link> <span className="zacht klein">· {a.topicTitel}</span></span>
          <span className="zacht klein">{a.eigenaarNaam ?? (a.eigenaarExtern ? `${a.eigenaarExtern} (extern)` : 'Geen eigenaar')}</span>
          <Badge soort={titel.startsWith('Te laat') ? 'mislukt' : 'wacht'}>{deadlineTekst(a.deadline)}</Badge>
        </div>
      ))}
    </section>
  );
}

export function Dashboard() {
  const d = useLaden(() => api<DashboardData>('GET', '/dashboard'));
  const t = d.data?.totaal;
  return (
    <div className="stapel">
      <div><h1>Dashboard</h1><p className="zacht">Hoe goed komen we afspraken na? Het percentage telt acties met een deadline in de afgelopen 90 dagen: op tijd afgerond, ten opzichte van te laat of nog open na de deadline.</p></div>
      <Melding tekst={d.fout} />
      {t && d.data && (
        <>
          <div className="tegels">
            <Tegel waarde={procent(t)} label="afspraken nagekomen" soort={t.nakoming === null ? undefined : t.nakoming >= 80 ? 'ok' : 'fout'} />
            <Tegel waarde={t.open} label="open acties" />
            <Tegel waarde={t.teLaat} label="te laat" soort={t.teLaat ? 'fout' : 'ok'} />
            <Tegel waarde={t.binnenkort} label="komende 7 dagen" />
            <Tegel waarde={t.zonderDeadline} label="zonder deadline" />
          </div>
          <section className="paneel">
            <h2>Per persoon</h2>
            {d.data.perEigenaar.length === 0 && <Leeg>Nog geen acties. Ze verschijnen hier zodra ze uit een gesprek komen of handmatig zijn toegevoegd.</Leeg>}
            {d.data.perEigenaar.length > 0 && (
              <div className="tabelrand">
                <table>
                  <thead><tr><th>Naam</th><th>Nagekomen</th><th>Open</th><th>Te laat</th><th>Binnenkort</th><th>Zonder deadline</th></tr></thead>
                  <tbody>
                    {d.data.perEigenaar.map((e) => (
                      <tr key={e.id ?? e.naam}>
                        <th scope="row">{e.naam}</th><td>{procent(e)}</td><td>{e.open}</td>
                        <td className={e.teLaat ? 'fouttekst' : ''}>{e.teLaat}</td><td>{e.binnenkort}</td><td>{e.zonderDeadline}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <ActieLijst titel="Te laat" acties={d.data.teLaat} leeg="Niets te laat." />
          <ActieLijst titel="Komende 7 dagen" acties={d.data.binnenkort} leeg="Geen deadlines in de komende 7 dagen." />
        </>
      )}
    </div>
  );
}
