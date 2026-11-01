# dagboek.ai

Een digitale assistent die collega's op ingestelde tijden belt voor een korte statusupdate en dat vastlegt in een dagboek. Elk gesprek levert een samenvatting, besluiten, vervolgacties met eigenaar en deadline, en suggesties voor nieuwe onderwerpen en verbeteringen op. Een dashboard laat zien in hoeverre afspraken worden nagekomen.

De assistent spreekt met een ElevenLabs-kloon van de stem van de opdrachtgever. Hij zegt aan het begin van elk gesprek dat hij een AI-systeem is en vraagt, zolang er geen toestemming is vastgelegd, of hij een samenvatting mag maken.

## Wat het doet

1. **Plannen.** Een *planning* is een terugkerende taak: dagen, één of meer tijden, een aantal pogingen en een groep medewerkers. Eén planning kan dus meerdere personen bellen.
2. **Bellen.** De scheduler start de gesprekken op het geplande moment (Nederlandse tijd, ook rond zomer- en wintertijd). De assistent loopt per medewerker de onderwerpen langs, vraagt naar wat er veranderd is, wat er openstaat en wat de volgende stap is.
3. **Vastleggen.** Na het gesprek maakt een taalmodel uit het transcript een dagboekupdate per onderwerp, besluiten, vervolgacties en suggesties.
4. **Opvolgen.** Acties staan in één werkregister (scherm Werk), samen met de punten uit verkoop-debriefs. Wat over de deadline is, komt in het volgende gesprek vooraan, en het dashboard toont per persoon hoeveel afspraken zijn nagekomen.

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
| Contactpersonen | Alle contactpersonen van de klanten: zoeken, bewerken, verplaatsen naar een andere klant, verwijderen |
| Werk | Het werkregister: acties, afspraken, interne acties, kansen en risico’s, per klant of als één lijst |
| Medewerkers | Medewerkers, toestemming en *Bel nu* |
| Projecten | Projecten beheren |
| Gesprekken | Alle gesprekken met status, transcript en samenvatting |
| Planning | Terugkerende gesprekken en de noodschakelaar |
| Suggesties | Voorstellen uit gesprekken |
| Instellingen | Houding en algemene gespreksinstructie |

Alleen beheerders loggen in, via Keycloak met wachtwoord en een code uit een authenticator-app (zie Inloggen en gebruikers). Gebelde medewerkers hebben geen toegang. Het scherm **Gebruikers** (alleen met Keycloak ingesteld) voegt beheerders toe, zet ze uit, reset wachtwoord en MFA en verwijdert ze.

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
`employees`, `projects`, `topics`, `updates` met `update_historie`, `topics.klant_id` (een onderwerp kan bij een gemeente horen; de punten ervan staan dan ook onder die klant), `activiteiten` (het werkregister: acties, afspraken, interne acties, kansen, risico’s, doelen en resultaten; per klant en/of per onderwerp; vervangt `klant_activiteiten` en `open_items`, die tot de opruimmigratie als kopie blijft staan), `calls`, `schedules` met `schedule_employees` (de plannings), `suggesties`, `instellingen`, `toestemmingen` (register, alleen toevoegen), `call_log` (gespreksverloop), `opschoning_runs`, en voor de verkoop-debrief `klanten`, `klant_contacten`, en `bezoeken` (zie Verkoop-debrief). Migraties staan in `web/server/migrations/` en worden bij het starten toegepast (tabel `migraties`).

### Beveiliging en privacy
- Inloggen via Keycloak (authorization code met PKCE, `state` en `nonce`; wachtwoord van minimaal 12 tekens en verplichte TOTP, brute-force-beveiliging), sessiecookie `HttpOnly`, `Secure`, `SameSite=Strict`. De tweede factor wordt door Keycloak afgedwongen (vereiste actie `CONFIGURE_TOTP`); de app controleert alleen de beheerdersrol. De noodingang met `ADMIN_EMAIL` en wachtwoord (scrypt, begrenzing van mislukte pogingen) staat met Keycloak uit tenzij `NOODLOGIN=aan` en heeft geen tweede factor; gebruik wordt gelogd (`login.noodingang`).
- Twilio-webhooks controleren de handtekening; *voice* is alleen te bellen met `ADMIN_TOKEN`; de terugmelding van *voice* naar *web* gaat met `SERVICE_KEY`.
- BSN en IBAN worden in transcripten gemaskeerd. Het model krijgt de opdracht geen persoonsgegevens op te schrijven.
- **Bewaartermijn**: transcripten (in de database en op de schijf van *voice*) worden na `TRANSCRIPT_BEWAAR_DAGEN` (standaard 30) gewist; de samenvattingen blijven staan.
- Limieten voor uitgaand bellen (per uur en per nummer) die een herstart overleven.
- **Toestemming** staat in een register (wie, wanneer, bron, versie en doel van de vraag, citaat). Het oordeel van het taalmodel telt pas als de woorden van de collega letterlijk in het gesprek staan. Zonder bevestigde toestemming wordt een transcript hooguit `TRANSCRIPT_ONBEVESTIGD_UREN` (24) bewaard; bij weigering of intrekking meteen gewist. *voice* wist zijn eigen kopie zodra *web* het transcript heeft aangenomen.
- **Gegevens uit gesprekken en van het model zijn onbetrouwbare invoer.** Ze gaan zonder `<`/`>` en op één regel in prompts (ook in de prompt van het volgende gesprek). Afgeronde acties, deadlines en eigenaars zonder aantoonbare bron komen onder *Controle nodig* bij Werk en tellen niet mee tot de beheerder besluit.
- **Logs** bevatten geen gespreksinhoud, volledige telefoonnummers, BSN, IBAN of sleutels; een correlatie-id (het gesprek-id) loopt van planning tot samenvatting. Het verloop per gesprek staat onder Gesprekken. Het dashboard toont feiten over acties, geen score of ranglijst per persoon; monitoring van medewerkers kan instemming van de ondernemingsraad vereisen (juridisch punt, niet in de code opgelost).
- **Gezondheid**: `/api/health` en `/health` zijn alleen liveness. `/api/ready` en `/ready` controleren wat de instantie zelf nodig heeft (database, migraties, configuratie, schijf, herstartstatus), nooit externe diensten. Zet een platform-healthcheck op `/health`; gebruik `/ready` alleen om verkeer te sturen.
- Suggesties en samenvattingen zijn voorstellen die de beheerder controleert; een instructie in een onderwerptitel of transcript stuurt het gesprek niet.

## Instellingen (omgevingsvariabelen)

Voorbeelden staan in `web/.env.example` en `voice/.env.example`. Geheimen horen nooit in git.

**web**: `DATABASE_URL` (`memory` draait op een tijdelijke database om lokaal te proberen), `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SERVICE_KEY`, `VOICE_URL`, `VOICE_ADMIN_TOKEN`, `TSYSTEMS_BASE_URL`, `TSYSTEMS_API_KEY`, `LLM_MODEL`, `TRANSCRIPT_BEWAAR_DAGEN`, `TRANSCRIPT_ONBEVESTIGD_UREN` (standaard 24), `PORT`, `INSECURE_COOKIES` (alleen lokaal zonder https).

**voice**: `TSYSTEMS_BASE_URL`, `TSYSTEMS_API_KEY`, `LLM_MODEL`, `STT_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `PUBLIC_HOST`, `WS_TOKEN`, `ADMIN_TOKEN`, `DATA_DIR`, `OPDRACHTGEVER_NAAM`, `UITGAAND_MAX_PER_UUR`, `UITGAAND_MIN_SECS_PER_NUMMER`, `BEL_TIMEOUT_SECS`, `WEB_CALLBACK_URL`, `WEB_SERVICE_KEY`, `TRANSCRIPT_BEWAAR_DAGEN`, `LOG_LEVEL` (standaard INFO), `PIPECAT_LOG_LEVEL` (standaard WARNING; DEBUG zet gespreksinhoud in de logs), `ONDERBROKEN_NA_SECS` (standaard 1200), `VOICE_ENGINE` (`pipecat` of `elevenlabs_agent`, standaard `pipecat`), voor de ElevenLabs-agent `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID` en `ELEVENLABS_WEBHOOK_SECRET` (optioneel `ELEVENLABS_VERWIJDER_GESPREK`, standaard `true`: het gesprek wordt bij ElevenLabs gewist zodra het transcript in het dagboek staat; de API-sleutel heeft daarvoor schrijfrechten nodig).

**Keycloak (web):** `KEYCLOAK_ISSUER` (bijvoorbeeld `https://…/realms/dagboek`), `KEYCLOAK_CLIENT_ID` (`dagboek-web`), `KEYCLOAK_CLIENT_SECRET`, voor het scherm Gebruikers `KEYCLOAK_ADMIN_CLIENT_ID` (`dagboek-beheer`) en `KEYCLOAK_ADMIN_CLIENT_SECRET`, optioneel `NOODLOGIN=aan` en `PUBLIC_URL` (de terugkeer-URL is `PUBLIC_URL/api/auth/callback`). Zonder `KEYCLOAK_ISSUER` werkt alleen de login met `ADMIN_EMAIL`.

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
| Werk | `GET/POST /activiteiten` (filters `klantId`, `topicId`), `PATCH/DELETE /activiteiten/:id`, `POST /activiteiten/:id/controle`, `POST /activiteiten/jira`, `GET /dashboard` |
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

Gepland: een verlofperiode per medewerker, de koppeling met Confluence en het terugsturen van de Jira-status naar het dagboek, het domein dagboek.ai, meerdere organisaties en inloggen via Keycloak/LOCGOV.

## Afspraken

- Alleen branch `main`; Railway deployt daarvan.
- Geen secrets in git (`.env` staat in `.gitignore`).

## Jira: open punten als ticket

Bij **Werk** kun je van een open punt (of alle zichtbare open punten) een Jira-ticket maken, na een voorbeeld en jouw bevestiging. Er gaat alleen de tekst van het punt, het onderwerp, de eigenaar, de deadline en een link naar het dagboek naar Jira, nooit een gesprek of transcript.

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
- Een toegevoegd aandachtspunt is een open punt met bron `gesprek` dat eerst bij Werk gecontroleerd moet worden; het komt daarna pas in een volgend gesprek.
- Instellen: zet `MCP_KEY` op `web` en `INKOMEND_TOOLS=true` op `voice`; voeg bij ElevenLabs een custom MCP-server toe met URL `https://<web>/mcp` en een secret-header `Authorization` met `Bearer <MCP_KEY>`, en koppel die aan de agent (tool approval: altijd vragen bij `voeg_aandachtspunt_toe`).

## Verkoop-debrief (accountmanager belt na een klantbezoek)
Een accountmanager belt hetzelfde nummer als een collega voor het dagboek. Is de beller een actieve medewerker met de rol **accountmanager** (Medewerkers → Rol), dan start geen dagboekgesprek maar een debrief in drie stappen: eerst vertelt de accountmanager vrij alles wat die kwijt wil (de assistent luistert en onderbreekt niet), daarna stelt de assistent alleen korte aanvullende vragen, één per keer, over wat nog ontbreekt (klant, doelen, resultaten, tevredenheid, afspraken, kansen, risico's, vervolgacties, contactpersonen), en tot slot vat de assistent samen met een bevestiging. Dat kan een klantbezoek zijn, een vervolggesprek of alleen een update over eerdere afspraken en acties. Het gesprek gebruikt dezelfde inbelroute en toestemmingsregels als het dagboek (zie Inbellen); het type staat op het gesprek (`calls.type`).

- **Register, los van het dagboek.** Een debrief levert een bezoek (`bezoeken`) en activiteiten (`activiteiten`: doel, resultaat, afspraak, actie, intern, kans, risico) per klant (`klanten`, met `klant_contacten`). Ze staan onder **Werk** (per klant of als lijst, met filters op soort, status, eigenaar en te laat) en op de klantkaart onder **Klanten**. Een *interne* actie is wat wij zelf intern moeten doen; die van het dagboek hebben dezelfde soort, met een onderwerp. De velden van een kans (indicatie, fase, beslisser, verwachte datum, concurrent, budget, contract) staan in `details`; wat de accountmanager niet noemde blijft leeg.
- **Onbetrouwbare invoer.** Net als bij het dagboek telt alleen wat in het gesprek is terug te vinden: een punt zonder letterlijk citaat, een klant of eigenaar die niet in het gesprek voorkomt of een niet-herkende klant komt onder *Controle nodig* bij Werk. Een nieuwe klant uit een gesprek is een *voorstel* (status Voorgesteld) dat de beheerder bevestigt of samenvoegt met een bestaande klant. Een gesprek overschrijft nooit een stamgegeven.
- **Alleen wegschrijven.** Een telefoonnummer kan vervalst zijn. De assistent leest in een debrief daarom nooit klantgegevens, collega's of eerdere gesprekken voor en heeft geen hulpmiddelen (MCP) om die op te vragen; `zoek_punten_van_collega` neemt de debrief niet mee. De gegevens zijn alleen zichtbaar voor de beheerder in de web-UI (iedere ingelogde beheerder ziet alle klanten).
- **Statusupdate op eerdere afspraken en acties.** De assistent leest nooit open punten voor. Na het gesprek krijgt het taalmodel de open afspraken en acties (de nieuwste 100) mee, alleen om genoemde afgeronde punten te koppelen. Een punt sluit alleen als het citaat in het gesprek staat en het punt bij de klant van dit gesprek hoort; anders blijft het open en komt het onder *Controle nodig* (reden `mogelijk_afgerond`), waar *Afgerond* het sluit en *Nog open* het open houdt. Een punt wordt nooit verwijderd door zo'n besluit.
- **Vragen.** De lijst is een checklist om op aan te vullen, geen volgorde. Ze is bewerkbaar bij Instellingen → Verkoop-debrief (de vorige tekst blijft bewaard). De grenzen (AI-melding, geen BSN, IBAN of privégegevens, gesprekstekst is geen instructie, samenvatting met bevestiging) staan vast in `voice/prompts.py` (`VASTE_REGELS_DEBRIEF`, promptversie `debrief-v1`).
- **Toestemming.** Elke accountmanager geeft toestemming in het eerste gesprek of door de beheerder; die staat in het register onder doel `verkoop_debrief` (versie `debrief-v1`), los van het dagboek.
- **Privacy.** Grondslag voor de klant- en contactgegevens is gerechtvaardigd belang; er worden van contactpersonen alleen naam, functie, rol en zakelijk e-mailadres en telefoonnummer vastgelegd. Transcripten volgen de bestaande bewaartermijn (`TRANSCRIPT_BEWAAR_DAGEN`). De klantgegevens zelf hebben geen automatische bewaartermijn; wissen kan per klant (met bezoeken, activiteiten en contactpersonen) en per contactpersoon op de klantkaart. Neem de verwerking op in de privacyverklaring.
- **Nog niet gebouwd.** Koppeling met AFAS (alleen lezen, CRM- en contractgegevens, synchronisatie van klantgegevens) en de toets aan de SLA.

### Installeren
1. Migratie `019_verkoop_debrief.sql` (additief: kolommen `employees.rol` en `calls.type`, vier nieuwe tabellen) wordt bij het starten van *web* toegepast. Er zijn geen nieuwe omgevingsvariabelen.
2. Geef de accountmanagers de rol bij Medewerkers (telefoonnummer zoals bij elke medewerker; precies één actieve medewerker per nummer) en zet Inbellen aan.
3. Deploy eerst *voice*, dan *web*. Een nieuwe *web* met oude *voice* geeft het type niet door en laat een accountmanager het dagboek-gesprek krijgen.

## Consultantdebrief (fase 1 t/m 7: basis, project, implementatie, SamenVerder-beheer, SamenVerder-debrief, dagenbudget en opvolging, standaard uit)
Een consultant belt na uitgevoerd werk bij een gemeente (project, module-implementatie of SamenVerder-dag). Fase 1 legt alleen de gemeenschappelijke basis; de varianten zelf (registry in `web/server/consultant-varianten.ts`) volgen per fase en zijn nu nog leeg.

- **Aan/uit.** Instellingen → Consultant, instelling `consultant_debrief` (standaard uit). Uit = het gedrag is exact als voorheen; het vinkje *consultant* bij Medewerkers wordt dan genegeerd.
- **Route.** `calls.type` is `dagboek`, `verkoop_debrief`, `consultant_debrief` of (bij iemand die accountmanager én consultant is) `debrief_keuze`. In dat laatste geval vraagt de assistent "Wil je een verkoop- of consultancy-debrief doen?"; de gekozen route wordt achteraf met een citaat uit het gesprek geverifieerd (`routering.ts`, `debrief-gedeeld.ts`). Lukt dat niet, dan blijft het gesprek op `debrief_keuze` met status *onduidelijk* en kiest de beheerder bij Gesprekken ("Verwerken als verkoop-/consultancy-debrief", `POST /api/calls/:id/route`).
- **Variant.** Wordt in het gesprek bevestigd en achteraf geverifieerd; zonder bewijs blijft de variant leeg en komt er een Controle-nodig-punt (`variant_onzeker`). Er wordt nooit gegokt.
- **Gemeente als spil.** Alles bij één debrief moet bij dezelfde klant horen (`klant_inconsistent`); contactpersonen worden alleen vastgelegd als de naam in het gesprek valt, nooit met e-mail of telefoon uit spraak.
- **Toestemming.** Eigen doel `consultant_debrief` (versie `consultant-debrief-v1`), los van dagboek en verkoop. Promptversies: `consultant-debrief-v1` en `debrief-keuze-v1`.
- **Projectvariant (fase 2).** `consultant-project.ts`, geregistreerd bij het starten (`consultant-standaard.ts`), promptversie `consultant-project-v1`. De debrief koppelt alleen aan een **bestaand** project (`topics.type='project'`) van **dezelfde gemeente** en alleen als de naam in het gesprek valt; een onbekend project, een project zonder gemeente (`onderwerp_klant_koppelen`) of van een andere gemeente (`klant_inconsistent`) wordt nooit aangemaakt of gekoppeld maar komt onder Controle nodig, met de genoemde naam in `variantdata.genoemd_onderwerp`. Fase, scopewijziging en volgende mijlpaal blijven alleen bewaard met een citaat uit het gesprek. De checklist is bewerkbaar onder Instellingen → Consultant.
- **Bezoekvoorbereiding (fase 2).** Klant → *Bereid bezoek voor* (`/klanten/:id/voorbereiding`, `GET /api/klanten/:id/voorbereiding`, `voorbereiding.ts`): kerngegevens, contactpersonen met *laatst gesproken* (berekend), dagboek per onderwerp, laatste bezoeken en debriefs, openstaande punten per soort, en apart *Niet bevestigd*. Uitsluitend uit vastgelegde records samengesteld (geen taalmodel), met datum en bron, zonder transcripten of citaten; beheerder en accountmanager mogen het lezen. Latere fasen voegen hun blok toe.
- **Implementatievariant (fase 3).** Een module-implementatie is een onderwerp (`topics`) met een rij in `implementaties` (migratie `024_implementaties.sql`: module, fase, teststatus, geplande/werkelijke livegang, acceptatie, nazorg, bovenliggend project, contactpersoon; geen tweede statusveld). Beheerders markeren een onderwerp als implementatie in het scherm Onderwerp; een gesprek maakt er nooit een aan. Een debrief (`consultant-implementatie-v1`) koppelt alleen aan een bestaande implementatie van dezelfde gemeente en werkt daarbij uitsluitend **fase, teststatus en geplande livegang** bij, elk met een citaat van de consultant (een datum alleen met een echte datum in dat citaat). **Werkelijke livegang, acceptatie en einde nazorg** blijven een voorstel in de debrief en gelden pas na *Overnemen* door de beheerder; acceptatie telt alleen met de woorden van de consultant zelf. Projecten en implementaties worden elkaar nooit aangeboden. Wisselt een onderwerp van gemeente, dan vervallen contactpersoon en bovenliggend project. `GET/PUT/DELETE /api/implementaties/:topicId` (alleen beheerder); de implementaties staan ook in de bezoekvoorbereiding.
- **SamenVerder-beheer (fase 4).** Migratie `025_samenverder.sql` (additief): `samenverder_programmas` (per gemeente en periode; een eerder jaar is een eigen rij; de gemeente is na aanmaken niet te wijzigen), `samenverder_sessies` (soort, dagnummer, onderwerp, doel, datum, omvang in dagen, status gepland/uitgevoerd/geannuleerd/verplaatst, extra, contactpersoon), consultants en onderwerpen per sessie, en nog ongebruikte koppelkolommen op `activiteiten` en `consultant_debriefs` voor fase 5. De database zelf dwingt af dat een geplande of uitgevoerde sessie een datum heeft, dat *uitgevoerd* een bevestiging heeft (`bevestigd_op`) en dat de omvang tussen 0 en 20 dagen ligt. Scherm **SamenVerder** (`/samenverder`, `/samenverder/:id`): programma aanmaken, sessies plannen, consultants en onderwerpen koppelen, en per sessie *Bevestig uitgevoerd*, *Verplaatsen* (de nieuwe sessie telt, de oude blijft als verplaatst staan), *Annuleren* en *Weer inplannen*, met op de tijdlijn wat er per sessie is vastgelegd. Alleen een beheerder wijzigt; een accountmanager kan lezen (`GET /api/samenverder/programmas[/:id]`). Er is nog **geen dagenbudget** en een gesprek wijzigt nooit een sessie. Het programma staat ook in de bezoekvoorbereiding en via *SamenVerder* op de klantpagina.
- **SamenVerder-variant (fase 5).** Een debrief (`consultant-samenverder-v1`, `web/server/consultant-samenverder.ts`) koppelt alleen aan een **bestaand** programma en een **eenduidige geplande sessie** (afgelopen 7 dagen, bij deze gemeente, aan deze consultant toegewezen of zonder consultants); anders Controle nodig (`programma_onbekend` / `sessie_onbekend`) en wordt er niets aangemaakt. Het gesprek zet een sessie **nooit op uitgevoerd** en wijzigt nooit datum, omvang, doel of budget: wat de consultant daarover zegt (uitgevoerd ja/nee, genoemde duur) blijft een voorstel in `variantdata.sessie_voorstel`. Punten uit het gesprek krijgen programma en sessie mee; een voorgesteld volgend onderwerp komt als *voorgesteld* bij de eerstvolgende geplande sessie; een samenwerkingssignaal wordt een risico met `details.categorie = 'samenwerking'` en altijd een citaat (geen score of oordeel). Elk veld telt alleen met de woorden van de consultant in het gesprek. Bij het inbellen bewaart de server een planningsvoorstel (`calls.context`, en `voorstel` in het antwoord van `/api/intern/inkomend/start`) als de consultant vandaag precies één geplande sessie heeft; de voice-assistant noemt dat voorstel nog niet, dus tot een voice-aanpassing wordt de variant mondeling bepaald.
- **Dagenbudget (fase 6).** Migratie `027_samenverder_budget.sql` (additief): `samenverder_budgetmutaties`, een register van afgesproken dagen per programma (start, uitbreiding, correctie; elke regel met reden en wie) dat de database zelf beschermt tegen wijzigen en verwijderen (trigger); hooguit één start; alleen een correctie haalt dagen af; het totaal kan niet onder nul. Een beheerder legt vast (`POST /api/samenverder/programmas/:id/budget`), een accountmanager leest. Alles wat verder getoond wordt is **berekend** (`samenverder-budget.ts`), nooit opgeslagen en nooit door het taalmodel: *afgesproken* (som van de mutaties), *uitgevoerd* (sessies met status uitgevoerd én bevestiging door een beheerder), *gepland* (sessies met status gepland) en *nog niet gepland* (afgesproken − uitgevoerd − gepland). Een negatieve waarde is een *overschrijding* en wordt getoond, niet geblokkeerd. Geannuleerde en verplaatste sessies tellen niet mee (bij verplaatsen telt de nieuwe sessie). Extra dagen: een uitbreiding plus een sessie met *Extra dag*. De stand staat op het programma, in het overzicht en in de bezoekvoorbereiding. Wat een consultant in een debrief zegt over uitvoering of duur is alleen een voorstel dat bij de sessie wordt getoond; het budget verandert pas als de beheerder de sessie bevestigt. Een programma met een budget kan niet worden verwijderd (zet het op afgerond). Het woord *resterend* wordt nergens gebruikt.
- **Opvolging van vervolgsignalen (fase 7).** Een vervolgsignaal is een behoefte die mogelijk buiten de huidige opdracht valt; of het een commerciële kans is, beoordeelt accountmanagement. In het werkregister staat bij een gecontroleerd, open signaal *Maak er een kans van…* en *Geen vervolg…* (`POST /api/activiteiten/:id/opvolging`, `GET` voor het besluit en de herleiding naar de debrief). Dat mag een beheerder of de **accountmanager van die gemeente** (de server vergelijkt het e-mailadres van de ingelogde gebruiker met dat van de accountmanager bij de klant; zonder accountmanager alleen een beheerder). Het signaal blijft bewaard met zijn citaat en wordt alleen afgerond; een besloten signaal kan niet worden verwijderd. Bij *kans* ontstaat een nieuw, **leeg** punt (geen bedrag, fase, beslisser of datum; de omschrijving wordt één keer overgenomen, citaat en transcript niet) met `bron_activiteit_id` naar het signaal en de accountmanager van de gemeente als eigenaar; bij *geen vervolg* is een reden verplicht. Het besluit staat in het register `opvolgingen` (migratie `029_opvolging.sql`, één per signaal, door een trigger tegen wijzigen beschermd; de migratie 028 is gereserveerd voor het verwijderen van de kolom Sales AM). Een nog niet gecontroleerd signaal kan niet worden opgevolgd.
- **Installeren.** De migraties `023_consultant_basis.sql`, `024_implementaties.sql`, `025_samenverder.sql`, `027_samenverder_budget.sql` en `029_opvolging.sql` zijn additief en draaien bij het starten van *web*. Deploy eerst *voice* (onbekende soorten vallen daar terug op het dagboek), dan *web*, en zet de schakelaar pas aan als beide draaien.

## Kwaliteit van de registratie
Scherm **Kwaliteit** (`/kwaliteit`, ook via de klantpagina; voor beheerder en accountmanager) controleert wat al is vastgelegd. Alles is deterministisch (geen taalmodel) en alleen een aanwijzing: de accountmanager beoordeelt en voert uit; er wordt nooit automatisch samengevoegd of verwijderd.
- **Meldingen** (`GET /api/kwaliteit`, code in `datakwaliteit.ts` en `namen.ts`): dubbele contactpersonen (zelfde e-mail of telefoon, dezelfde naam of een bijna gelijke naam bij dezelfde gemeente, ook als e-mail of telefoon in het naamveld staat), dubbele gemeenten, dubbele open punten (zelfde soort, inhoudelijk gelijk), gegevens in het naamveld (met een voorstel om ze te verplaatsen), onvolledige naam, afwijkend of onvolledig e-mail/telefoon, en ontbrekende functie en rol. Een bijna gelijke achternaam (een of twee letters verschil, zelfde voornaam) vangt spelfouten van de spraakherkenning ("Muntinga", "Mentenga", "Munterga").
- **Opschonen:** *Behoud deze, voeg de rest samen* (`POST /api/klant-contacten/samenvoegen`, alleen binnen één gemeente) vult lege velden aan, overschrijft nooit een bestaande waarde (een afwijkende waarde wordt gemeld) en verhuist punten, debriefs, SamenVerder-sessies en implementaties naar het behouden contact. Voor punten: *Houd dit punt over*. Voor gemeenten: samenvoegen op de klantpagina (alleen beheerder, zoals voorheen). *Dit zijn verschillende* / *Geen probleem* wordt bewaard (`kwaliteit_besluiten`, migratie `026_kwaliteit.sql`); komt er een record bij dat erbij hoort, dan verschijnt de melding opnieuw.
- **Dubbelen voorkomen:** een contactpersoon of gemeente die lijkt op een bestaande wordt bij handmatig toevoegen niet zonder bevestiging bewaard (409 "Mogelijk dubbel"); in een gesprek wordt zo'n contactpersoon niet nogmaals aangemaakt (verkoop-debrief slaat hem over, de consultantdebrief zet hem onder Controle nodig).
- **LinkedIn:** alleen een zoeklink per contactpersoon (naam en gemeente alvast ingevuld, opent in een nieuw tabblad); er wordt niets opgehaald of bewaard.
- **AFAS:** nog niet gekoppeld; een vergelijking met de CRM volgt later.

## Inloggen en gebruikers (Keycloak)
Keycloak draait als eigen service in het Railway-project (map `keycloak/`: `Dockerfile`, realm `realm-dagboek.json`, inlogthema `themes/dagboek` in de huisstijl van Inwoner.AI). De realm `dagboek` heeft de rollen `beheerder` (alles), `accountmanager` (alleen Werk en Klanten, ook op de server afgedwongen in `rollen.ts`) en `administratie` (alleen klantgegevens: het aantal inwoners en de contactpersonen, geen Werk, gesprekken of instellingen; wie meer rollen heeft krijgt de eerste uit beheerder, accountmanager, administratie). Het aantal **inwoners** van een gemeente wijzigt alleen beheer of administratie; een accountmanager ziet het veld alleen-lezen (de server geeft 403 bij een wijziging) en administratie wijzigt verder niets aan de klant. In een bestaande realm maak je een nieuwe rol (`accountmanager`, `administratie`) eenmalig aan via de admin-console (Realm roles), want de import slaat een bestaande realm over en het service-account `dagboek-beheer` mag geen rollen aanmaken, de client `dagboek-web` (code + PKCE, geheim) voor het inloggen en de client `dagboek-beheer` (service-account met alleen `manage-users`, `view-users`, `query-users` en `view-realm`) voor het scherm Gebruikers. Gebruikersgegevens staan alleen in Keycloak, niet in de database van het dagboek.

- **Eerste login van een nieuwe gebruiker:** het scherm Gebruikers toont eenmalig een tijdelijk wachtwoord. Bij de eerste login kiest de gebruiker een eigen wachtwoord (minimaal 12 tekens) en koppelt een authenticator-app; daarna vraagt Keycloak bij elke login om de code. *MFA resetten* verwijdert de koppeling en eist een nieuwe. Er is geen SMTP: uitnodigingen en wachtwoord-vergeten per e-mail kunnen pas met een mailrelay.
- **Medewerkers toegang geven:** in Gebruikers maak je in één keer accounts voor medewerkers uit de lijst Medewerkers (met een e-mailadres, nog zonder account), standaard met de rol accountmanager. Er gaat geen mail uit (geen SMTP): de tijdelijke wachtwoorden worden eenmalig getoond.
- **Beveiligd:** een rol wijzig je niet bij jezelf; je kunt je eigen account niet uitzetten of verwijderen en de laatste actieve beheerder blijft altijd bestaan. De app slaat geen tokens op; Keycloak-geheimen staan alleen als variabelen.
- **Keycloak-service (Railway):** variabelen `KC_DB=postgres`, `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD`, `KC_HOSTNAME` (de publieke URL), `KC_HTTP_ENABLED=true`, `KC_PROXY_HEADERS=xforwarded`, `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD`, en voor de realm-import `DAGBOEK_WEB_SECRET`, `DAGBOEK_BEHEER_SECRET` en `DAGBOEK_PUBLIC_URL` (de URL van de web-service). Alleen de eerste start importeert de realm (strategie IGNORE_EXISTING); latere wijzigingen gaan via de admin-console.
- **Uitrolvolgorde:** (1) Keycloak-service opzetten en de eerste beheerders aanmaken (Engelbert en Ruben) met MFA; (2) de web-service met de `KEYCLOAK_*`-variabelen uitrollen terwijl de noodingang nog werkt (`NOODLOGIN=aan`) en controleren dat beiden via Keycloak binnenkomen; (3) `NOODLOGIN` weghalen (of op `uit`), zodat de noodingang dicht is. Bij een Keycloak-storing zet je `NOODLOGIN=aan` tijdelijk terug (de `ADMIN_*`-variabelen moeten dan nog bestaan).
- **Lokaal proberen:** `docker run … quay.io/keycloak/keycloak:26.2.1 start-dev --import-realm` met `realm-dagboek.json` en `themes/dagboek` gemount, en de drie `DAGBOEK_*`-variabelen.
