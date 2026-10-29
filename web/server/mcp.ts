import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { bevestigCodewoord, voegAandachtspuntToe, zoekPunten } from './gesprek-tools.js';

/**
 * Een kleine MCP-server (streamable HTTP, zonder sessies) met hulpmiddelen voor de gespreksmotor. De gespreksmotor noemt per aanroep het gesprek-id;
 * dat id hoort bij een lopend inkomend gesprek en bepaalt wie er belt. Zonder `MCP_KEY` bestaat de route niet.
 */
const TOOLS = [
  {
    name: 'bevestig_codewoord',
    description: 'Controleer het codewoord van de beller. Nodig voordat je gegevens van een collega opzoekt of iets bij een collega toevoegt. Vraag de beller eerst om het codewoord.',
    inputSchema: { type: 'object', properties: { gesprek_id: { type: 'string' }, codewoord: { type: 'string' } }, required: ['gesprek_id', 'codewoord'] },
  },
  {
    name: 'zoek_punten_van_collega',
    description: 'Geeft de onderwerpen en open punten van een collega. Werkt alleen nadat het codewoord is bevestigd.',
    inputSchema: { type: 'object', properties: { gesprek_id: { type: 'string' }, medewerker: { type: 'string', description: 'Naam of deel van de naam' } }, required: ['gesprek_id', 'medewerker'] },
  },
  {
    name: 'voeg_aandachtspunt_toe',
    description: 'Noteert een aandachtspunt of actie bij een onderwerp van een collega. Alleen na het codewoord en nadat de beller hardop heeft gezegd dat je het mag noteren.',
    inputSchema: {
      type: 'object',
      properties: { gesprek_id: { type: 'string' }, medewerker: { type: 'string' }, onderwerp: { type: 'string', description: 'Titel of deel van de titel van het onderwerp' }, tekst: { type: 'string', description: 'Het aandachtspunt, kort' } },
      required: ['gesprek_id', 'medewerker', 'onderwerp', 'tekst'],
    },
  },
];

const rpc = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional() });
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 1000) : '');

export function registreerMcp(app: FastifyInstance, { db, config }: { db: Db; config: Config }) {
  const toegestaan = (header: string | undefined) => {
    if (!config.mcpKey) return false;
    const a = Buffer.from(header ?? ''), b = Buffer.from(`Bearer ${config.mcpKey}`);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  app.get('/mcp', async (_req, reply) => reply.code(405).send());
  app.post('/mcp', async (req, reply) => {
    if (!toegestaan(req.headers.authorization)) return reply.code(401).send({ fout: 'Niet toegestaan' });
    const p = rpc.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Ongeldig verzoek' } });
    const { id, method, params } = p.data;
    if (id === undefined) return reply.code(202).send(); // notificatie
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    if (method === 'initialize') {
      return ok({ protocolVersion: str(params?.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'dagboek', version: '1' } });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: TOOLS });
    if (method === 'tools/call') {
      const a = (params?.arguments ?? {}) as Record<string, unknown>;
      let uitkomst: unknown;
      switch (params?.name) {
        case 'bevestig_codewoord': uitkomst = await bevestigCodewoord(db, str(a.gesprek_id), str(a.codewoord)); break;
        case 'zoek_punten_van_collega': uitkomst = await zoekPunten(db, str(a.gesprek_id), str(a.medewerker)); break;
        case 'voeg_aandachtspunt_toe': uitkomst = await voegAandachtspuntToe(db, str(a.gesprek_id), str(a.medewerker), str(a.onderwerp), str(a.tekst)); break;
        default: return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Onbekend hulpmiddel' } };
      }
      const mislukt = (uitkomst as { ok?: boolean }).ok === false;
      return ok({ content: [{ type: 'text', text: JSON.stringify(uitkomst) }], isError: mislukt });
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Onbekende methode' } };
  });
}
