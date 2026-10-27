# dagboek.ai

Belt medewerkers op ingestelde tijden voor een korte statusupdate en legt die vast in een dagboek per project, thema of taak, tot het onderwerp is afgerond. Alles is bewerkbaar. De stem is een ElevenLabs-kloon.

Status: fase 0 (opzet): voice-service gestript en getest zonder netwerk; nog geen live testgesprek, geen database en geen beheerportaal. Het plan staat in het projectplan van Engelbert; MVP 1 = bellen, dagboek en onderwerpen. Atlassian (Jira/Confluence) volgt als apart traject.

## Mappen

- `voice/`: de voice-service (FastAPI + Pipecat + Twilio + ElevenLabs), gebaseerd op de voice-kern van Inwoner.AI maar zonder gemeente-logica.
  - `calls.py`: gespreksopdrachten, uitgaand bellen (statuscallback, voicemailherkenning, beltimeout) en limieten die een herstart overleven.
  - `prompts.py`: systeemprompt per medewerker en onderwerpen, vaste AI-melding in de begroeting.
  - `processors.py`: watchdogs (stilte, trage reactie, STT-timeout) en afsluiting na het afscheid.
  - `pipeline.py`, `main.py`: de gespreksketen en de webhooks (`/incoming-call`, `/status`, `/amd`, `/bel`, `/ws`).
  - `persoonsgegevens.py`: maskeert BSN en IBAN in transcripten.
  - Tests: `cd voice && pip install -r requirements.txt -r requirements-dev.txt && pytest`.

## Afspraken

- Alleen branch `main`; Railway deployt daarvan.
- Geen secrets in git (`.env` staat in `.gitignore`).
