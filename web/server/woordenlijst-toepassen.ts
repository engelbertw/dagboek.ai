/**
 * De woordenlijst terugwerkend toepassen op wat al is vastgelegd: bewaarde transcripten (stopwoorden weg, varianten goed) en de teksten die uit gesprekken zijn gemaakt
 * (verslagen, omschrijvingen, citaten). Eerst een voorbeeld met aantallen en een paar voor/na-regels; pas bij toepassen wordt er iets overschreven. Het origineel blijft
 * niet apart bewaard, dus dit is niet terug te draaien.
 */
import { eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { activiteiten, bezoeken, calls, consultantDebriefs, updates } from './schema.js';
import type { Beurt } from './vertrouwen.js';
import { corrigeerTranscript, vervangVarianten, type Woord } from './woordenlijst.js';

export interface Voorbeeldregel { waar: string; voor: string; na: string }
export interface Toepassing { voorbeeld: boolean; transcripten: number; teksten: Record<string, number>; regels: Voorbeeldregel[] }

const MAX_REGELS = 8;
/** Een korte omgeving van de eerste wijziging, zodat de beheerder ziet wat er verandert zonder het hele verslag te tonen. */
function uitsnede(voor: string, na: string): { voor: string; na: string } {
  let i = 0;
  while (i < voor.length && i < na.length && voor[i] === na[i]) i++;
  const van = Math.max(0, i - 30);
  return { voor: voor.slice(van, i + 40), na: na.slice(van, i + 40) };
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function pasWoordenlijstToeOpBestaand(db: Db, lijst: Woord[], voorbeeld: boolean): Promise<Toepassing> {
  const uit: Toepassing = { voorbeeld, transcripten: 0, teksten: {}, regels: [] };
  const noteer = (waar: string, voor: string, na: string) => {
    if (uit.regels.length < MAX_REGELS) uit.regels.push({ waar, ...uitsnede(voor, na) });
  };
  const doe = async (tx: Db | Tx) => {
    // Transcripten: stopwoorden en varianten, alleen waar er iets verandert.
    for (const c of await tx.select({ id: calls.id, transcript: calls.transcript }).from(calls)) {
      if (!Array.isArray(c.transcript)) continue;
      const oud = c.transcript as Beurt[];
      const nieuw = corrigeerTranscript(oud, lijst);
      const verschil = nieuw.findIndex((m, i) => m !== oud[i]);
      if (verschil < 0) continue;
      uit.transcripten++;
      noteer('transcript', oud[verschil].content, nieuw[verschil].content);
      if (!voorbeeld) await tx.update(calls).set({ transcript: nieuw }).where(eq(calls.id, c.id));
    }
    // Teksten die uit gesprekken zijn gemaakt: alleen de varianten (stopwoorden staan daar niet).
    const tekstveld = async <R extends { id: string }>(naam: string, rijen: R[], velden: (keyof R & string)[], bewaar: (id: string, wijziging: Record<string, string>) => Promise<unknown>) => {
      for (const r of rijen) {
        const wijziging: Record<string, string> = {};
        for (const v of velden) {
          const waarde = r[v];
          if (typeof waarde !== 'string' || !waarde) continue;
          const nieuw = vervangVarianten(waarde, lijst);
          if (nieuw !== waarde) { wijziging[v] = nieuw; noteer(`${naam}.${v}`, waarde, nieuw); }
        }
        if (Object.keys(wijziging).length) {
          uit.teksten[naam] = (uit.teksten[naam] ?? 0) + 1;
          if (!voorbeeld) await bewaar(r.id, wijziging);
        }
      }
    };
    await tekstveld('updates', await tx.select({ id: updates.id, samenvatting: updates.samenvatting, besluiten: updates.besluiten }).from(updates), ['samenvatting', 'besluiten'],
      (id, w) => tx.update(updates).set(w).where(eq(updates.id, id)));
    await tekstveld('activiteiten', await tx.select({ id: activiteiten.id, omschrijving: activiteiten.omschrijving, citaat: activiteiten.citaat }).from(activiteiten), ['omschrijving', 'citaat'],
      (id, w) => tx.update(activiteiten).set(w).where(eq(activiteiten.id, id)));
    await tekstveld('bezoeken', await tx.select({ id: bezoeken.id, samenvatting: bezoeken.samenvatting }).from(bezoeken), ['samenvatting'],
      (id, w) => tx.update(bezoeken).set(w).where(eq(bezoeken.id, id)));
    const debriefs = await tx.select({ id: consultantDebriefs.id, samenvatting: consultantDebriefs.samenvatting, werkzaamheden: consultantDebriefs.werkzaamheden }).from(consultantDebriefs);
    await tekstveld('consultantdebriefs', debriefs, ['samenvatting'], (id, w) => tx.update(consultantDebriefs).set(w).where(eq(consultantDebriefs.id, id)));
    for (const d of debriefs) {
      const nieuw = (d.werkzaamheden ?? []).map((t) => vervangVarianten(t, lijst));
      if (nieuw.some((t, i) => t !== d.werkzaamheden[i])) {
        uit.teksten['consultantdebriefs'] = (uit.teksten['consultantdebriefs'] ?? 0) + 1;
        if (!voorbeeld) await tx.update(consultantDebriefs).set({ werkzaamheden: nieuw }).where(eq(consultantDebriefs.id, d.id));
      }
    }
  };
  if (voorbeeld) await doe(db); else await db.transaction(doe);
  return uit;
}
