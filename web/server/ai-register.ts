/**
 * AI-register: de inventaris van alle AI-verwerkingen in dagboek.ai (vast, in code, zodat hij meebeweegt met de code en in review zichtbaar is)
 * en een logboek van de aanroepen van het taalmodel (alleen metadata: functie, model, tokens, duur, uitkomst en een verwijzing naar het
 * gesprek; nooit prompt, transcript, antwoord, namen of nummers).
 */
import { and, count, desc, eq, gte, lt, sql, sum } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AI_FUNCTIES, type AiFunctie, type LlmGebruik } from './ai-functies.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { aiActiviteiten, calls } from './schema.js';

/** Hoe lang het logboek wordt bewaard. */
export const AI_LOG_BEWAAR_DAGEN = 365;

export interface AiVerwerking {
  /** Sleutel waarmee aanroepen in het logboek bij deze regel horen; gesprekken via de voice-service hebben er geen. */
  sleutel: AiFunctie | 'gesprek_pipecat' | 'gesprek_elevenlabs';
  naam: string;
  stap: string;
  doel: string;
  leverancier: string;
  /** 'config' = het model uit de configuratie (LLM_MODEL). */
  model: 'config' | string;
  invoer: string;
  nietIn: string;
  uitvoer: string;
  menselijkeControle: string;
  bewaartermijn: string;
  bron: string;
  gelogd: boolean;
}

const LEVERANCIER_LLM = 'T-Systems (taalmodel via OpenAI-compatibele API)';
const NIET_IN_GESPREK = 'BSN, bankrekeningnummers en andere persoonsgegevens worden niet uitgevraagd en niet vastgelegd; telefoonnummers gaan niet naar het taalmodel.';

export const AI_VERWERKINGEN: AiVerwerking[] = [
  {
    sleutel: 'dagboekverslag', naam: 'Dagboekverslag', stap: 'Na het gesprek (dagboek)', gelogd: true,
    doel: 'Van een telefoongesprek een samenvatting, besluiten, nieuwe en afgeronde open punten, suggesties en de toestemming maken.',
    leverancier: LEVERANCIER_LLM, model: 'config', invoer: 'Transcript van het gesprek, de titels en open punten van de besproken onderwerpen, namen van collega\'s, woordenlijst.',
    nietIn: NIET_IN_GESPREK, uitvoer: 'Samenvatting en besluiten per onderwerp, open punten met citaat en eigenaar, toestemmingsbeoordeling.',
    menselijkeControle: 'Elk punt en elke afronding moet onderbouwd zijn met een letterlijk citaat uit het gesprek; toestemming alleen met citaat. Punten kunnen bij Werk worden aangepast of verwijderd.',
    bewaartermijn: 'Transcript volgens de bewaartermijn (standaard 30 dagen, korter zonder toestemming); samenvattingen blijven in het dagboek.', bron: 'web/server/samenvatten.ts',
  },
  {
    sleutel: 'verkoopdebrief', naam: 'Verkoop-debrief', stap: 'Na het gesprek (accountmanager)', gelogd: true,
    doel: 'Van een gesprek over een klantbezoek de klant, samenvatting, tevredenheid en punten (acties, kansen, risico\'s) vastleggen.',
    leverancier: LEVERANCIER_LLM, model: 'config', invoer: 'Transcript, lijst met klantnamen, collega\'s, woordenlijst.',
    nietIn: NIET_IN_GESPREK, uitvoer: 'Bezoek met samenvatting en punten; een klant die niet herkend wordt, wordt een voorstel.',
    menselijkeControle: 'Citaatverificatie; onzekere punten krijgen "controle nodig"; nieuwe klanten zijn voorstel tot een beheerder ze bevestigt; scherm Kwaliteit voor dubbelen.',
    bewaartermijn: 'Zoals het dagboekverslag.', bron: 'web/server/debrief.ts',
  },
  {
    sleutel: 'routebepaling', naam: 'Route bepalen', stap: 'Na het gesprek (iemand die accountmanager én consultant is)', gelogd: true,
    doel: 'Bepalen of het gesprek een verkoop-debrief of een consultantdebrief is.',
    leverancier: LEVERANCIER_LLM, model: 'config', invoer: 'Transcript van het gesprek.', nietIn: NIET_IN_GESPREK,
    uitvoer: 'Route (verkoop of consultant) met bewijs.', menselijkeControle: 'De keuze telt alleen met een letterlijk citaat van de beller; anders volgt "Controle nodig".',
    bewaartermijn: 'Het resultaat staat bij het gesprek; geen aparte opslag.', bron: 'web/server/consultant-debrief.ts',
  },
  {
    sleutel: 'consultantdebrief', naam: 'Consultantdebrief', stap: 'Na het gesprek (consultant)', gelogd: true,
    doel: 'Een consultantgesprek omzetten in verslag en punten voor project, implementatie of SamenVerder.',
    leverancier: LEVERANCIER_LLM, model: 'config', invoer: 'Transcript, klantnamen, bestaande open punten, context van de variant, woordenlijst.', nietIn: NIET_IN_GESPREK,
    uitvoer: 'Verslag, werkzaamheden, punten, koppeling met klant, onderwerp en programma.',
    menselijkeControle: 'Citaatverificatie; variant en klant moeten bewezen zijn, anders "Controle nodig"; de functie staat standaard uit (instelling).',
    bewaartermijn: 'Zoals het dagboekverslag.', bron: 'web/server/consultant-debrief.ts',
  },
  {
    sleutel: 'weekoverzicht', naam: 'Weekoverzicht', stap: 'Dagboek (overzicht)', gelogd: true,
    doel: 'Een korte actuele samenvatting maken van de verslagen over de gemeenten van de afgelopen week.',
    leverancier: LEVERANCIER_LLM, model: 'config', invoer: 'Samenvattingen van updates, bezoeken en debriefs (geen transcripten, citaten of telefoonnummers).', nietIn: 'Transcripten, citaten, telefoonnummers.',
    uitvoer: 'Korte tekst bovenaan Dagboek en in de RSS-feed.', menselijkeControle: 'Alleen lezen, de bron (het verslag) staat eronder; een beheerder kan hem vernieuwen. Een verwijderd verslag wist de bewaarde samenvatting.',
    bewaartermijn: 'Eén bewaarde samenvatting per periode.', bron: 'web/server/dagboek-feed.ts',
  },
  {
    sleutel: 'instructiesuggestie', naam: 'Instructie voorstellen', stap: 'Planning en onderwerpen', gelogd: true,
    doel: 'Een gespreksinstructie voorstellen voor een planning of onderwerp.',
    leverancier: LEVERANCIER_LLM, model: 'config', invoer: 'Titels en open punten van onderwerpen.', nietIn: 'Transcripten en persoonsgegevens.',
    uitvoer: 'Voorstel in een tekstveld.', menselijkeControle: 'Alleen een voorstel: de beheerder past aan en slaat zelf op.', bewaartermijn: 'Alleen wat de beheerder opslaat.', bron: 'web/server/suggestie.ts',
  },
  {
    sleutel: 'woordvoorstellen', naam: 'Woordvoorstellen', stap: 'Na het gesprek (woordenlijst)', gelogd: true,
    doel: 'Verkeerd gehoorde producten, afdelingen en namen herkennen en een juiste term voorstellen.',
    leverancier: LEVERANCIER_LLM, model: 'config', invoer: 'Wat de beller zei (transcript), bekende termen en namen.', nietIn: 'Wat de assistent zei; er wordt geen transcripttekst bewaard bij het voorstel.',
    uitvoer: 'Voorstel (term en hoe het gehoord werd) in Beheer → Woordenlijst.', menselijkeControle: 'Een voorstel verandert niets tot de beheerder het goedkeurt.', bewaartermijn: 'Voorstel zonder transcripttekst.', bron: 'web/server/woordvoorstellen.ts',
  },
  {
    sleutel: 'gesprek_pipecat', naam: 'Gesprek voeren (Pipecat)', stap: 'Tijdens het gesprek', gelogd: false,
    doel: 'Het telefoongesprek voeren: spraak naar tekst, antwoord bedenken en tekst naar spraak.',
    leverancier: 'Spraakherkenning (STT), T-Systems-taalmodel en ElevenLabs (stem, kloon van de beheerder)', model: 'Volgens de voice-configuratie (STT, LLM, TTS)',
    invoer: 'Gesproken tekst van de collega en de gespreksinstructie met de onderwerpen.', nietIn: NIET_IN_GESPREK,
    uitvoer: 'Gesproken antwoord en een transcript.', menselijkeControle: 'De assistent meldt dat hij een digitale assistent is, vraagt toestemming en legt niets vast zonder toestemming.',
    bewaartermijn: 'Transcript volgens de bewaartermijn; geen audio bewaard.', bron: 'voice/pipeline.py',
  },
  {
    sleutel: 'gesprek_elevenlabs', naam: 'Gesprek voeren (ElevenLabs-agent)', stap: 'Tijdens het gesprek', gelogd: false,
    doel: 'Het telefoongesprek voeren met de agent van ElevenLabs.', leverancier: 'ElevenLabs (agent met eigen spraakherkenning, taalmodel en stem)', model: 'Zoals ingesteld in de ElevenLabs-agent',
    invoer: 'Gesproken tekst en de gespreksinstructie met de onderwerpen.', nietIn: NIET_IN_GESPREK, uitvoer: 'Gesproken antwoord en een transcript dat na het gesprek wordt opgehaald.',
    menselijkeControle: 'Zoals Pipecat; het gesprek wordt na ophalen bij ElevenLabs verwijderd (instelling).', bewaartermijn: 'Zoals Pipecat.', bron: 'voice/agent_elevenlabs.py',
  },
];

// ── Logboek ────────────────────────────────────────────────────────────

export async function schrijfActiviteit(db: Db, g: LlmGebruik): Promise<void> {
  await db.insert(aiActiviteiten).values({
    functie: g.functie, model: g.model.slice(0, 100), tokensIn: g.tokensIn, tokensUit: g.tokensUit, duurMs: g.duurMs, uitkomst: g.uitkomst,
    foutCode: g.foutCode?.slice(0, 80) ?? null, referentie: g.referentie?.slice(0, 80) ?? null,
  });
}

export async function ruimAiActiviteitenOp(db: Db, dagen = AI_LOG_BEWAAR_DAGEN, nu = new Date()): Promise<number> {
  const weg = await db.delete(aiActiviteiten).where(lt(aiActiviteiten.tijdstip, new Date(nu.getTime() - dagen * 86_400_000))).returning({ id: aiActiviteiten.id });
  return weg.length;
}

export function registreerAiRegister(app: FastifyInstance, db: Db, config: Config) {
  const modelVan = (v: AiVerwerking) => (v.model === 'config' ? config.llmModel : v.model);

  app.get('/api/ai-register', async () => {
    const vanaf = new Date(Date.now() - 30 * 86_400_000);
    const [perFunctie, perMotor] = await Promise.all([
      db.select({
        functie: aiActiviteiten.functie, aanroepen: count(), tokensIn: sum(aiActiviteiten.tokensIn), tokensUit: sum(aiActiviteiten.tokensUit),
        fouten: sql<number>`count(*) filter (where ${aiActiviteiten.uitkomst} = 'fout')`, laatst: sql<string | null>`max(${aiActiviteiten.tijdstip})`,
      }).from(aiActiviteiten).where(gte(aiActiviteiten.tijdstip, vanaf)).groupBy(aiActiviteiten.functie),
      db.select({ engine: calls.engine, gesprekken: count() }).from(calls).where(gte(calls.createdAt, vanaf)).groupBy(calls.engine),
    ]);
    const stat = new Map(perFunctie.map((r) => [r.functie, { aanroepen: Number(r.aanroepen), tokensIn: Number(r.tokensIn ?? 0), tokensUit: Number(r.tokensUit ?? 0), fouten: Number(r.fouten), laatst: r.laatst }]));
    const motor = new Map(perMotor.map((r) => [r.engine ?? '', Number(r.gesprekken)]));
    const verwerkingen = AI_VERWERKINGEN.map((v) => ({
      ...v, model: modelVan(v),
      laatste30Dagen: v.gelogd ? (stat.get(v.sleutel) ?? { aanroepen: 0, tokensIn: 0, tokensUit: 0, fouten: 0, laatst: null })
        : { gesprekken: v.sleutel === 'gesprek_elevenlabs' ? (motor.get('elevenlabs_agent') ?? 0) : [...motor.entries()].filter(([e]) => e !== 'elevenlabs_agent').reduce((t, [, n]) => t + n, 0) },
    }));
    const totaal = [...stat.values()].reduce((t, s) => ({ aanroepen: t.aanroepen + s.aanroepen, tokens: t.tokens + s.tokensIn + s.tokensUit, fouten: t.fouten + s.fouten }), { aanroepen: 0, tokens: 0, fouten: 0 });
    // Aanroepen zonder functie in de inventaris (bijvoorbeeld 'overig') vallen buiten de lijst; ze tellen wel mee in het totaal.
    return { verwerkingen, totaal, bewaarDagen: AI_LOG_BEWAAR_DAGEN };
  });

  app.get('/api/ai-register/activiteiten', async (req) => {
    const q = z.object({
      functie: z.enum(AI_FUNCTIES).optional(), uitkomst: z.enum(['ok', 'fout']).optional(),
      dagen: z.coerce.number().int().min(1).max(AI_LOG_BEWAAR_DAGEN).default(30), limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    const vanaf = new Date(Date.now() - q.dagen * 86_400_000);
    return db.select().from(aiActiviteiten)
      .where(and(gte(aiActiviteiten.tijdstip, vanaf), q.functie ? eq(aiActiviteiten.functie, q.functie) : undefined, q.uitkomst ? eq(aiActiviteiten.uitkomst, q.uitkomst) : undefined))
      .orderBy(desc(aiActiviteiten.tijdstip)).limit(q.limit);
  });
}
