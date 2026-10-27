export interface Medewerker { id: string; naam: string; telefoon: string; taal: 'nl' | 'en'; actief: boolean; toestemmingOp: string | null; notitie: string }
export interface Project { id: string; naam: string; omschrijving: string; status: 'actief' | 'afgerond' }
export type TopicStatus = 'actief' | 'wacht' | 'afgerond';
export type TopicType = 'project' | 'thema' | 'taak';
export interface TopicRegel {
  id: string; titel: string; type: TopicType; status: TopicStatus; aanwijzingen: string; projectId: string | null; projectNaam: string | null;
  eigenaarId: string | null; eigenaarNaam: string | null; updatedAt: string; afgerondOp: string | null; openPunten: number;
  laatsteUpdate: { samenvatting: string; createdAt: string } | null;
}
export interface Update { id: string; topicId: string; bron: 'voice' | 'handmatig'; samenvatting: string; besluiten: string; createdAt: string; bewerktOp: string | null }
export interface OpenPunt { id: string; tekst: string; status: 'open' | 'afgerond'; createdAt: string; afgerondOp: string | null }
export interface TopicDetail {
  id: string; titel: string; type: TopicType; status: TopicStatus; aanwijzingen: string; projectId: string | null; eigenaarId: string | null;
  updates: Update[]; openItems: OpenPunt[];
}
export interface Historie { id: string; vorigeSamenvatting: string; vorigeBesluiten: string; gewijzigdOp: string }
export interface Schema { id: string; dagen: number[]; tijden: string[]; actief: boolean; maxPogingen: number }
export type CallStatus = 'gepland' | 'belt' | 'gesprek' | 'gesproken' | 'niet_bereikt' | 'voicemail' | 'mislukt';
export type SamenvattingStatus = 'geen' | 'bezig' | 'klaar' | 'geen_inhoud' | 'geweigerd' | 'onduidelijk' | 'mislukt';
export interface GesprekRegel { id: string; status: CallStatus; bron: string; fout: string | null; samenvattingStatus: SamenvattingStatus; samenvattingFout: string | null; gestartOp: string | null; afgerondOp: string | null; createdAt: string; employeeId: string; employeeNaam: string }
export interface Gesprek extends GesprekRegel { transcript: { role: string; content: string }[] | null }

export class ApiFout extends Error {
  constructor(public status: number, message: string, public details: string[] = []) { super(message); }
}

export async function api<T>(method: string, pad: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${pad}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFout(r.status, data.fout ?? `Fout ${r.status}`, data.details ?? []);
  return data as T;
}

export const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const datumTijd = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
