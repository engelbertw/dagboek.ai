# dagboek.ai

Een digitale assistent die collega's op ingestelde tijden belt voor een korte statusupdate en dat vastlegt in een dagboek. Elk gesprek levert een samenvatting, besluiten, vervolgacties met eigenaar en deadline, en suggesties voor nieuwe onderwerpen en verbeteringen op. Een dashboard laat zien in hoeverre afspraken worden nagekomen.

De assistent spreekt met een ElevenLabs-kloon van de stem van de opdrachtgever. Hij zegt aan het begin van elk gesprek dat hij een AI-systeem is en vraagt, zolang er geen toestemming is vastgelegd, of hij een samenvatting mag maken.

## Wat het doet

1. **Plannen.** Een *planning* is een terugkerende taak: dagen, één of meer tijden, een aantal pogingen en een groep medewerkers. Eén planning kan dus meerdere personen bellen.
2. **Bellen.** De scheduler start de gesprekken op het geplande moment (Nederlandse tijd, ook rond zomer- en wintertijd). De assistent loopt per medewerker de onderwerpen langs, vraagt naar wat er veranderd is, wat er openstaat en wat de volgende stap is.
3. **Vastleggen.** Na het gesprek maakt een taalmodel uit het transcript een dagboekupdate per onderwerp, besluiten, vervolgacties en suggesties.
4. **Opvolgen.** Acties staan in een activiteitenregister. Wat over de deadline is, komt in het volgende gesprek vooraan, en het dashboard toont per persoon hoeveel afspraken zijn nagekomen.

## Functionaliteiten

### Dagboek en onderwerpen
- **Onderwerpen** van het type project, thema of taak, met een status (actief, wacht, afgerond), een eigenaar (wie we hierover bellen) en een vrije aanwijzing "wat willen we weten".
- **Projecten** om onderwerpen te groeperen.
- **Updates** per onderwerp, uit een gesprek (bron: voice) of handmatig toegevoegd. Alles is te bewerken en elke bewerking bewaart de vorige tekst in de historie.

### Medewerkers
- Naam, telefoonnummer, e-mailadres, LOCGOV-gebruikersnaam, taal, actief of niet, en een notitie.
- Toestemming voor het bewaren van gesprekssamenvattingen: vast te leggen in het scherm, of uit het gesprek zelf af te leiden.
- **Bel nu**: een medewerker meteen bellen.

### Planning (terugkerende gesprekken)
- Eén planning voor één of meerdere personen, met dagen, tijden en een maximum aantal pogingen. Aanmaken, bewerken, uitzetten en verwijderen in het scherm Planning.
- **Nooit dubbel bellen**, ook niet na een herstart: elk gesprek wordt in de database geclaimd met een unieke sleutel (planning, persoon, tijdstip, poging).
- **Gemist tijdstip**: wordt nog een uur ingehaald, daarna niet meer.
- **Niet opgenomen, voicemail of mislukt**: na 30 minuten een nieuwe poging, tot het maximum.
- **Tegelijk geplande gesprekken** starten 20 seconden na elkaar. Wie al gebeld wordt, wordt overgeslagen.
- **Alles stilzetten**: één knop zet alle automatische gesprekken uit. *Bel nu* blijft werken.

### Het gesprek
- Vaste, in de code verankerde kern: onderwerpen langslopen, AI-melding, één vraag per keer, grenzen (geen vragen naar BSN, bankgegevens of gezondheid), twee vragen aan het eind (nieuw onderwerp? verbetering voor de app?) en netjes afsluiten.
- **Houding** (Instellingen): hoe de assistent zich gedraagt: meedenkend, vooruitstrevend, ondersteunend, kritisch bij gemiste deadlines, doorvragen naar weerstand en vragen hoe we dit voorkomen.
- **Gespreksinstructie**: wat de assistent in het gesprek doet. De algemene instructie staat in Instellingen. Een planning kan een eigen instructie hebben; zonder eigen instructie geldt de algemene. Elk gesprek bewaart de instructie die het kreeg.
- **Suggestie van een instructie**: op basis van de onderwerpen van de gekozen personen (of van één onderwerp) stelt het taalmodel een instructie voor. Een suggestie wordt nooit automatisch opgeslagen; je kiest Overnemen, Opnieuw of Verwerpen.
- Houding en instructies kunnen de vaste kern niet overschrijven.

### Gespreksmotor: Pipecat of ElevenLabs-agent
Een gesprek loopt via een van twee motoren, per gesprek te kiezen (Instellingen = standaard, Medewerkers → motorkeuze naast "Bel nu"). **Pipecat** is de eigen pijplijn (Whisper en taalmodel bij T-Systems, stem bij ElevenLabs). De **ElevenLabs-agent** (`voice/agent_elevenlabs.py`) doet spraakherkenning, taalmodel, beurtwisseling, stem en telefonie zelf: voice start het gesprek via `POST /v1/convai/twilio/outbound-call` met dezelfde prompt en begroeting (AI-melding en toestemmingsvraag) en ontvangt het eindtranscript via de webhook `POST /elevenlabs/webhook` (HMAC-handtekening, `ELEVENLABS_WEBHOOK_SECRET`). Blijft de webhook weg, dan vraagt een vangnet het gesprek na 15 minuten zelf op. Samenvatten, toestemming en de gespreksstatus zijn voor beide motoren gelijk. Het gesprek bewaart zijn motor (`calls.engine`); op Gesprekken kun je elk gesprek beoordelen (1 tot 5) en staat een vergelijking per motor. Eenmalig in ElevenLabs: een agent met de stemkloon, taal Nederlands, overrides voor prompt, first message en taal aan, de ingebouwde `end_call`-tool, de webhook en een eigen Twilio-nummer (niet het Inwoner.AI-demonummer: importeren wijzigt de Twilio-instellingen van het nummer). Nog niet in een echt gesprek bewezen; veldnamen van de API zijn op één plek verzameld in `agent_elevenlabs.py`.

### Na het gesprek
- **Samenvatting** met een taalmodel: update en besluiten per onderwerp, vervolgacties, afgeronde acties en suggesties. Het transcript gaat als gegevens naar het model, niet als opdracht.
- **Toestemming uit het gesprek**: bij een weigering wordt niets bewaard, ook het transcript niet. Bij onduidelijkheid wordt niets opgeslagen tot de toestemming handmatig is vastgelegd.
- Een mislukte samenvatting is opnieuw te proberen vanuit het scherm Gesprekken. Een samenvatting die blijft hangen na een herstart wordt automatisch teruggezet.

### Acties en dashboard
- **Activiteitenregister**: alle acties met eigenaar (collega of iemand buiten het team) en deadline, te filteren op status en eigenaar. Een deadline wordt alleen overgenomen uit een gesprek als het een echte datum is.
- **Dashboard** (alleen beheerder): percentage nagekomen afspraken (acties met een deadline in de afgelopen 90 dagen: op tijd afgerond, gedeeld door op tijd, te laat afgerond en nog open na de deadline), open, te laat, komende 7 dagen en zonder deadline, per persoon en als lijst.
- **Te late acties** staan in het volgende gesprek vooraan; de assistent vraagt dan zonder verwijt wat er is gebeurd en spreekt een nieuwe datum af.

### Suggesties
Aan het eind van elk gesprek vraagt de assistent naar nieuwe onderwerpen en verbeteringen. Die komen op de pagina Suggesties. Een voorgesteld onderwerp wordt pas een onderwerp als de beheerder het overneemt (de collega die het noemde wordt eigenaar). Verbeteringen markeer je als afgehandeld of wijs je af.

## Schermen

| Scherm | Doel |
|---|---|
| Dagboek | Overzicht van alle onderwerpen en hun laatste update; onderwerpen aanmaken |
| Onderwerp | Updates en historie, acties (eigenaar, deadline), gegevens van het onderwerp en een suggestie voor "wat willen we weten" |
| Dashboard | Hoe goed komen we afspraken na |
| Acties | Het activiteitenregister |
| Medewerkers | Medewerkers, toestemming en *Bel nu* |
| Projecten | Projecten beheren |
| Gesprekken | Alle gesprekken met status, transcript en samenvatting |
| Planning | Terugkerende gesprekken en de noodschakelaar |
| Suggesties | Voorstellen uit gesprekken |
| Instellingen | Houding en algemene gespreksinstructie |

Alleen de beheerder logt in. Gebelde medewerkers hebben geen toegang.

## Architectuur

Drie services op Railway (project `dagboek-ai`), gedeployed vanaf de branch `main`:

```
            Twilio  <──────────►  voice  ◄──────────  ElevenLabs, T-Systems (STT + LLM)
                                    │  ▲
                       bel-opdracht │  │ uitkomst + transcript
                                    ▼  │
 beheerder ──► web (Fastify + React SPA) ──► Postgres
                    │
                    └──► T-Systems LLM (samenvatting, suggesties)
```

- **`voice/`** (Python, FastAPI, Pipecat, Twilio): voert het telefoongesprek. Ontvangt een opdracht van *web*, belt, voert het gesprek (spraak naar tekst, taalmodel, tekst naar spraak) en meldt de uitkomst en het transcript terug. Gebaseerd op de voice-kern van Inwoner.AI, zonder gemeente-logica.
  - `calls.py`: gespreksopdrachten, uitgaand bellen (statuscallback, voicemailherkenning, beltimeout) en limieten die een herstart overleven.
  - `prompts.py`: systeemprompt (vaste kern, houding, gespreksinstructie, onderwerpen) en de begroeting met AI-melding.
  - `processors.py`: watchdogs (stilte, trage reactie, STT-timeout) en afsluiting na het afscheid.
  - `pipeline.py`, `main.py`: de gespreksketen en de webhooks (`/incoming-call`, `/status`, `/amd`, `/bel`, `/ws`).
  - `persoonsgegevens.py` en `opschoning.py`: BSN en IBAN maskeren, en de bewaartermijn.
- **`web/`** (Node 24, Fastify 5, Drizzle ORM, zod, React met Vite): de API, de scheduler en het beheerportaal.
  - `server/scheduler.ts`, `gesprek-starten.ts`: de planning en het samenstellen en starten van een gesprek (ook voor *Bel nu*).
  - `server/samenvatten.ts`, `suggestie.ts`, `dashboard.ts`, `instellingen.ts`: de samenvatting na het gesprek, de instructiesuggesties, de berekening van het dashboard en de algemene instellingen.
  - `client/`: de React-schermen.
- **Postgres**: alle gegevens.

### Datamodel
`employees`, `projects`, `topics`, `updates` met `update_historie`, `open_items` (de acties), `calls`, `schedules` met `schedule_employees` (de plannings), `suggesties`, `instellingen`, `toestemmingen` (register, alleen toevoegen), `call_log` (gespreksverloop), `opschoning_runs`. Migraties staan in `web/server/migrations/` en worden bij het starten toegepast (tabel `migraties`).

### Beveiliging en privacy
- Inloggen met e-mail en wachtwoord (scrypt), sessiecookie `HttpOnly`, `Secure`, `SameSite=Strict`, begrenzing van mislukte pogingen.
- Twilio-webhooks controleren de handtekening; *voice* is alleen te bellen met `ADMIN_TOKEN`; de terugmelding van *voice* naar *web* gaat met `SERVICE_KEY`.
- BSN en IBAN worden in transcripten gemaskeerd. Het model krijgt de opdracht geen persoonsgegevens op te schrijven.
- **Bewaartermijn**: transcripten (in de database en op de schijf van *voice*) worden na `TRANSCRIPT_BEWAAR_DAGEN` (standaard 30) gewist; de samenvattingen blijven staan.
- Limieten voor uitgaand bellen (per uur en per nummer) die een herstart overleven.
- **Toestemming** staat in een register (wie, wanneer, bron, versie en doel van de vraag, citaat). Het oordeel van het taalmodel telt pas als de woorden van de collega letterlijk in het gesprek staan. Zonder bevestigde toestemming wordt een transcript hooguit `TRANSCRIPT_ONBEVESTIGD_UREN` (24) bewaard; bij weigering of intrekking meteen gewist. *voice* wist zijn eigen kopie zodra *web* het transcript heeft aangenomen.
- **Gegevens uit gesprekken en van het model zijn onbetrouwbare invoer.** Ze gaan zonder `<`/`>` en op één regel in prompts (ook in de prompt van het volgende gesprek). Afgeronde acties, deadlines en eigenaars zonder aantoonbare bron komen onder *Controle nodig* bij Acties en tellen niet mee tot de beheerder besluit.
- **Logs** bevatten geen gespreksinhoud, volledige telefoonnummers, BSN, IBAN of sleutels; een correlatie-id (het gesprek-id) loopt van planning tot samenvatting. Het verloop per gesprek staat onder Gesprekken. Het dashboard toont feiten over acties, geen score of ranglijst per persoon; monitoring van medewerkers kan instemming van de ondernemingsraad vereisen (juridisch punt, niet in de code opgelost).
- **Gezondheid**: `/api/health` en `/health` zijn alleen liveness. `/api/ready` en `/ready` controleren wat de instantie zelf nodig heeft (database, migraties, configuratie, schijf, herstartstatus), nooit externe diensten. Zet een platform-healthcheck op `/health`; gebruik `/ready` alleen om verkeer te sturen.
- Suggesties en samenvattingen zijn voorstellen die de beheerder controleert; een instructie in een onderwerptitel of transcript stuurt het gesprek niet.

## Instellingen (omgevingsvariabelen)

Voorbeelden staan in `web/.env.example` en `voice/.env.example`. Geheimen horen nooit in git.

**web**: `DATABASE_URL` (`memory` draait op een tijdelijke database om lokaal te proberen), `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SERVICE_KEY`, `VOICE_URL`, `VOICE_ADMIN_TOKEN`, `TSYSTEMS_BASE_URL`, `TSYSTEMS_API_KEY`, `LLM_MODEL`, `TRANSCRIPT_BEWAAR_DAGEN`, `TRANSCRIPT_ONBEVESTIGD_UREN` (standaard 24), `PORT`, `INSECURE_COOKIES` (alleen lokaal zonder https).

**voice**: `TSYSTEMS_BASE_URL`, `TSYSTEMS_API_KEY`, `LLM_MODEL`, `STT_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `PUBLIC_HOST`, `WS_TOKEN`, `ADMIN_TOKEN`, `DATA_DIR`, `OPDRACHTGEVER_NAAM`, `UITGAAND_MAX_PER_UUR`, `UITGAAND_MIN_SECS_PER_NUMMER`, `BEL_TIMEOUT_SECS`, `WEB_CALLBACK_URL`, `WEB_SERVICE_KEY`, `TRANSCRIPT_BEWAAR_DAGEN`, `LOG_LEVEL` (standaard INFO), `PIPECAT_LOG_LEVEL` (standaard WARNING; DEBUG zet gespreksinhoud in de logs), `ONDERBROKEN_NA_SECS` (standaard 1200), `VOICE_ENGINE` (`pipecat` of `elevenlabs_agent`, standaard `pipecat`), voor de ElevenLabs-agent `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID` en `ELEVENLABS_WEBHOOK_SECRET` (optioneel `ELEVENLABS_VERWIJDER_GESPREK`, standaard `true`: het gesprek wordt bij ElevenLabs gewist zodra het transcript in het dagboek staat; de API-sleutel heeft daarvoor schrijfrechten nodig).

Een wachtwoordhash maak je met `cd web && npx tsx server/hash.ts 'jouw-wachtwoord-van-12-tekens'`.

## Lokaal werken

```bash
# web: API en scheduler op een tijdelijke database, plus de SPA
cd web && npm ci
DATABASE_URL=memory SESSION_SECRET=… ADMIN_EMAIL=ik@voorbeeld.nl ADMIN_PASSWORD_HASH=… SERVICE_KEY=… INSECURE_COOKIES=true npm run dev:server
npm run dev:client          # in een tweede terminal
npm run typecheck && npm test
npm run test:pg             # tests tegen een echte Postgres (Docker, postgres:16-alpine): gelijktijdigheid, locks, migraties
npm run build && npm start  # productiebuild

# voice
cd voice && pip install -r requirements.txt -r requirements-dev.txt && pytest
```

De tests draaien zonder netwerk: *web* op PGlite (Postgres in het geheugen), *voice* met nagebootste diensten. `pipecat-ai` staat bewust op een exacte versie (`1.8.1`); een nieuwere geeft een Twilio-fout.

## Deployen

Railway bouwt `web` (rootmap `web`, healthcheck `/api/health`) en `voice` (rootmap `voice`, volume op `/data`, healthcheck `/health`) vanaf `main`. Migraties draaien bij het starten van *web*. Alleen de branch `main` wordt gebruikt.

**Volgorde en gedrag bij een deploy.** Deploy eerst *voice*, dan *web*: *web* vraagt bij een onzekere uitkomst via `GET /bel/{id}` aan *voice* wat er is gebeurd, en een *voice* zonder die route zegt niets over een verzoek (*web* neemt dan aan dat het niet weet, niet dat er niet gebeld is). Een gesprek dat tijdens een deploy loopt, valt niet dubbel of verloren: *voice* herhaalt een niet aangekomen eindmelding elke minuut (de uitkomst en het transcript blijven op de schijf tot *web* ze heeft), meldt een afgebroken gesprek als `onderbroken` met het laatste tussentijdse transcript, en belt nooit automatisch opnieuw als onzeker is of er is gebeld. *web* hervat een samenvatting die nooit begon (maximaal drie keer) en zet gesprekken zonder uitkomst na 45 minuten op `onderbroken`. Zet in Railway de draining-tijd van *voice* op minstens 120 seconden zodat een lopend gesprek kan uitlopen (instelling op het platform, niet in de code).

## API (kort)

Alles onder `/api` vraagt een sessie, behalve `login`, `health` en de interne terugmelding (`/api/intern/…`, met `SERVICE_KEY`).

| Onderdeel | Routes |
|---|---|
| Sessie | `POST /login`, `POST /logout`, `GET /me`, `GET /health` |
| Medewerkers | `GET/POST /employees`, `PATCH/DELETE /employees/:id`, `POST /employees/:id/bel` |
| Projecten en onderwerpen | `/projects`, `/topics`, `/topics/:id`, `POST /topics/suggestie` |
| Updates | `POST /topics/:id/updates`, `PATCH/DELETE /updates/:id`, `GET /updates/:id/historie` |
| Acties | `POST /topics/:id/open-items`, `PATCH/DELETE /open-items/:id`, `GET /acties`, `GET /dashboard` |
| Gesprekken | `GET /calls`, `GET /calls/:id`, `POST /calls/:id/samenvatten` |
| Planning | `GET/POST /plannings`, `PATCH/DELETE /plannings/:id`, `POST /plannings/suggestie` |
| Suggesties | `GET /suggesties`, `PATCH /suggesties/:id`, `POST /suggesties/:id/overnemen` |
| Instellingen | `/instellingen/houding`, `/instellingen/gespreksinstructie`, `/instellingen/automatisch-bellen` |

## Stand en wat nog niet is gebouwd

Gebouwd en gedekt door automatische tests: alles hierboven. Live geverifieerd: een testgesprek (bellen, begroeting, spraak naar tekst, taalmodel, tekst naar spraak), de terugmelding van *voice* naar *web*, en de samenvatting en de suggesties met het echte taalmodel.

Nog niet (of niet live) bewezen:
- De nieuwe gespreksprompt (houding, doorvragen, eindvragen) en `einde_gesprek` in een echt gesprek; de begroeting is met ongeveer 16 seconden nog te lang.
- De scheduler met een echte klok in productie; de logica is getest met een nagebootste klok.
- Het eigen Twilio-nummer: tijdelijk wordt het demonummer van Inwoner.AI gebruikt.

Gepland: een wachtwoord wijzigen in het scherm, een verlofperiode per medewerker, de koppeling met Confluence en het terugsturen van de Jira-status naar het dagboek, het domein dagboek.ai, meerdere organisaties en inloggen via Keycloak/LOCGOV.

## Afspraken

- Alleen branch `main`; Railway deployt daarvan.
- Geen secrets in git (`.env` staat in `.gitignore`).

## Jira: open punten als ticket

Bij **Acties** kun je van een open punt (of alle zichtbare open punten) een Jira-ticket maken, na een voorbeeld en jouw bevestiging. Er gaat alleen de tekst van het punt, het onderwerp, de eigenaar, de deadline en een link naar het dagboek naar Jira, nooit een gesprek of transcript.

- Instellingen: bij **Instellingen → Jira** vul je de site (`naam.atlassian.net`), de projectsleutel en het issuetype in. Alleen `atlassian.net` is toegestaan.
- Inloggegevens: `JIRA_EMAIL` en `JIRA_API_TOKEN` als variabelen op de web-service (nooit in de database). Gebruik een apart Atlassian-account; een token verloopt na een jaar. Optioneel `PUBLIC_URL` voor de link terug naar het dagboek.
- Een punt krijgt nooit twee tickets: de ticketsleutel is uniek en elk ticket krijgt het label `dagboek-<id van het punt>`; voor het aanmaken wordt daarop gezocht, ook als een eerdere poging halverwege mislukte.
- Punten die nog gecontroleerd moeten worden of al zijn afgerond worden overgeslagen. De eigenaar wordt alleen toegewezen als het e-mailadres van de medewerker precies één Jira-gebruiker oplevert.
- Optioneel een team-id (veld Team): dat wordt dan aan elk ticket gekoppeld.
- Migratie `015_jira.sql` voegt alleen kolommen toe.

## Inbellen (medewerker belt zelf)
Een medewerker kan het nummer van de ElevenLabs-agent bellen en de update geven. Standaard uit: zet **Instellingen → Inbellen** aan.

1. Bij ElevenLabs: agent → Security → *conversation initiation webhook* naar `https://<voice>/elevenlabs/init`, met een secret als header `x-init-secret`. Sta overrides voor prompt en eerste bericht toe.
2. Op `voice`: zet `ELEVENLABS_INIT_SECRET` op dezelfde waarde. Zonder dit geheim antwoordt de route met 401.
3. De beller wordt herkend aan het telefoonnummer bij Medewerkers (precies één actieve medewerker per nummer). Onbekend, uitgeschakeld of meer dan 5 gesprekken per uur (instelbaar met `INKOMEND_MAX_PER_UUR` op web): de agent zegt een korte melding zonder gegevens en hangt op.
4. Het gesprek krijgt bron `inkomend` en loopt daarna via dezelfde post-call-webhook, samenvatting en acties als een uitgaand gesprek.

Het nummer van een beller kan vervalst zijn; de assistent noemt daarom alleen de eigen onderwerpen van die medewerker.

### Collega's opvragen tijdens het inbellen (MCP)
Een medewerker met **overzichtsrol** (Medewerkers → Instellingen → Overzicht via de telefoon, met een codewoord) kan tijdens een inkomend gesprek de punten van een collega opvragen en een aandachtspunt of actie toevoegen. Zonder rol of codewoord noemt de agent alleen de eigen onderwerpen van de beller.

- Hulpmiddelen (MCP, streamable HTTP, `POST /mcp` op de web-service, header `Authorization: Bearer <MCP_KEY>`): `bevestig_codewoord`, `zoek_punten_van_collega`, `voeg_aandachtspunt_toe`. Zonder `MCP_KEY` op web bestaat de route niet.
- Het codewoord wordt als hash bewaard, een beller heeft 3 pogingen per gesprek en de verificatie geldt 60 minuten. Alle aanroepen komen zonder inhoud in het verloop van het gesprek.
- Een toegevoegd aandachtspunt is een open punt met bron `gesprek` dat eerst bij Acties gecontroleerd moet worden; het komt daarna pas in een volgend gesprek.
- Instellen: zet `MCP_KEY` op `web` en `INKOMEND_TOOLS=true` op `voice`; voeg bij ElevenLabs een custom MCP-server toe met URL `https://<web>/mcp` en een secret-header `Authorization` met `Bearer <MCP_KEY>`, en koppel die aan de agent (tool approval: altijd vragen bij `voeg_aandachtspunt_toe`).
