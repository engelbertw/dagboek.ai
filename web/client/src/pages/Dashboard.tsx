import { Link } from 'react-router-dom';
import { api, deadlineTekst, type Actie, type DashboardData } from '../api';
import { Badge, Leeg, Melding, Systeemstatus, useLaden } from '../ui';

const Tegel = ({ waarde, label }: { waarde: string | number; label: string }) => (
  <div className="tegel"><strong>{waarde}</strong><span>{label}</span></div>
);

function ActieLijst({ titel, acties, leeg }: { titel: string; acties: Actie[]; leeg: string }) {
  return (
    <section className="paneel">
      <h2>{titel}</h2>
      {acties.length === 0 && <Leeg>{leeg}</Leeg>}
      {acties.map((a) => (
        <div key={a.id} className="punt">
          <span style={{ flex: 1, minWidth: 180 }}><Link to={a.topicId ? `/onderwerp/${a.topicId}` : a.klantId ? `/klanten/${a.klantId}` : '/werk'}>{a.tekst}</Link> <span className="zacht klein">· {a.topicTitel ?? a.klantNaam ?? 'zonder klant'}</span></span>
          <span className="zacht klein">{a.eigenaarNaam ?? (a.eigenaarExtern ? `${a.eigenaarExtern} (extern)` : 'Geen eigenaar')}</span>
          <Badge soort={titel.startsWith('Deadline verlopen') ? 'mislukt' : 'wacht'}>{deadlineTekst(a.deadline)}</Badge>
        </div>
      ))}
    </section>
  );
}

export function Dashboard() {
  const d = useLaden(() => api<DashboardData>('GET', '/dashboard'));
  const t = d.data?.totaal;
  const team = d.data?.team;
  return (
    <div className="stapel">
      <Systeemstatus />
      <div>
        <h1>Dashboard</h1>
        <p className="zacht">De stand van de afspraken uit gesprekken en het activiteitenregister. Dit zijn feiten over acties, geen beoordeling van mensen: een open of verlopen actie zegt niets over iemands functioneren.</p>
      </div>
      <Melding tekst={d.fout} />
      {t && team && d.data && (
        <>
          <div className="tegels">
            <Tegel waarde={t.open} label="open" />
            <Tegel waarde={t.teLaat} label="deadline verlopen" />
            <Tegel waarde={t.binnenkort} label="komende 7 dagen" />
            <Tegel waarde={t.zonderDeadline} label="geen deadline" />
            <Tegel waarde={t.opTijd} label="op of vóór de deadline afgerond" />
            <Tegel waarde={t.laatAfgerond} label="na de deadline afgerond" />
            <Tegel waarde={t.deadlineVerschoven} label="deadline verschoven" />
          </div>
          <p className="zacht klein">
            {team.onvoldoendeGegevens
              ? `Onvoldoende gegevens voor een percentage: er zijn ${team.basis} afgeronde of verlopen acties met een deadline in de afgelopen 90 dagen, en een percentage tonen we pas vanaf ${team.minimum}.`
              : `Indicatie voor het hele team: ${team.nakoming}% van de ${team.basis} acties met een deadline in de afgelopen 90 dagen is op of vóór de deadline afgerond. Verschoven deadlines tellen met hun nieuwe datum mee.`}
          </p>
          <section className="paneel">
            <h2>Per persoon</h2>
            <p className="zacht klein">Alfabetisch, alleen tellingen. Acties die nog gecontroleerd moeten worden tellen niet mee.</p>
            {d.data.perEigenaar.length === 0 && <Leeg>Nog geen acties. Ze verschijnen hier zodra ze uit een gesprek komen of handmatig zijn toegevoegd.</Leeg>}
            {d.data.perEigenaar.length > 0 && (
              <div className="tabelrand">
                <table>
                  <thead><tr><th>Naam</th><th>Open</th><th>Deadline verlopen</th><th>Komende 7 dagen</th><th>Geen deadline</th><th>Op tijd afgerond</th><th>Na deadline afgerond</th><th>Deadline verschoven</th></tr></thead>
                  <tbody>
                    {d.data.perEigenaar.map((e) => (
                      <tr key={e.id ?? e.naam}>
                        <th scope="row">{e.naam}</th><td>{e.open}</td><td>{e.teLaat}</td><td>{e.binnenkort}</td><td>{e.zonderDeadline}</td><td>{e.opTijd}</td><td>{e.laatAfgerond}</td><td>{e.deadlineVerschoven}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <ActieLijst titel="Deadline verlopen" acties={d.data.teLaat} leeg="Geen verlopen deadlines." />
          <ActieLijst titel="Komende 7 dagen" acties={d.data.binnenkort} leeg="Geen deadlines in de komende 7 dagen." />
        </>
      )}
    </div>
  );
}
