import asyncio
import hmac
import json
import os
import signal
from contextlib import asynccontextmanager
from typing import Literal

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.responses import Response
from loguru import logger
from pydantic import BaseModel, Field
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Connect, Stream, VoiceResponse

load_dotenv()

import calls
import logconfig
import opschoning

logconfig.instellen()

async def _opschoon_lus() -> None:
    while True:
        try:
            gewist, mislukt = await asyncio.to_thread(opschoning.ruim_op_detail)
            await asyncio.to_thread(opschoning.meld_run, gewist, mislukt)
        except Exception as e:
            logger.error(f"Opschoning mislukt: {type(e).__name__}")
            await asyncio.to_thread(opschoning.meld_run, 0, 1, type(e).__name__)
        await asyncio.sleep(6 * 3600)


async def _herstel_lus() -> None:
    """Elke minuut: eerder mislukte meldingen aan de web-service herhalen en afgebroken gesprekken melden."""
    while True:
        try:
            await asyncio.to_thread(calls.herstel_opdrachten)
            import agent_elevenlabs
            await asyncio.to_thread(agent_elevenlabs.herstel_agentgesprekken)
            await asyncio.to_thread(calls.herhaal_rapporten)
        except Exception as e:
            logger.error(f"Herstel mislukt: {type(e).__name__}")
        await asyncio.sleep(60)


# Bij een herstart (deploy) neemt de service geen nieuwe gesprekken meer aan; lopende gesprekken lopen door tot het platform stopt.
DRAINING = False


def _bij_sigterm(vorige):
    def handler(signum, frame):
        global DRAINING
        DRAINING = True
        logger.info("SIGTERM ontvangen: geen nieuwe gesprekken meer")
        if callable(vorige):
            vorige(signum, frame)
    return handler


@asynccontextmanager
async def _lifespan(_: FastAPI):
    try:
        signal.signal(signal.SIGTERM, _bij_sigterm(signal.getsignal(signal.SIGTERM)))
    except ValueError:  # niet in de hoofdthread (tests)
        pass
    taken = [asyncio.create_task(_opschoon_lus()), asyncio.create_task(_herstel_lus())]
    yield
    for t in taken:
        t.cancel()


app = FastAPI(lifespan=_lifespan)

PUBLIC_HOST = os.getenv("PUBLIC_HOST", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
WS_TOKEN = os.getenv("WS_TOKEN", "")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def _public_host(request: Request) -> str:
    if PUBLIC_HOST:
        return PUBLIC_HOST
    host = request.headers.get("host", "localhost:5000")
    logger.warning(f"PUBLIC_HOST niet gezet, Host-header '{host}' gebruikt (niet vertrouwd)")
    return host


async def _valid_twilio_signature(request: Request) -> bool:
    if not TWILIO_AUTH_TOKEN:
        logger.warning("TWILIO_AUTH_TOKEN niet gezet, signatuurvalidatie overgeslagen")
        return True
    url = f"https://{_public_host(request)}{request.url.path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"
    params = dict(await request.form()) if request.method == "POST" else {}
    return RequestValidator(TWILIO_AUTH_TOKEN).validate(url, params, request.headers.get("X-Twilio-Signature", ""))


def _hang_op(twilio_sid: str) -> None:
    from twilio.rest import Client
    Client(os.getenv("TWILIO_ACCOUNT_SID", ""), TWILIO_AUTH_TOKEN).calls(twilio_sid).update(status="completed")


@app.get("/health")
async def health() -> dict:
    """Liveness: het proces draait. Bewust zonder controles, zodat een storing elders het proces niet laat herstarten."""
    return {"ok": True}


# Wat deze instantie zelf nodig heeft om een gesprek te kunnen voeren. Externe diensten zelf worden niet aangeroepen.
_VERPLICHTE_INSTELLINGEN = (
    "ADMIN_TOKEN", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "PUBLIC_HOST",
    "WEB_CALLBACK_URL", "WEB_SERVICE_KEY", "TSYSTEMS_API_KEY", "TSYSTEMS_BASE_URL", "ELEVENLABS_API_KEY",
)


def _data_schijf_schrijfbaar() -> bool:
    try:
        pad = calls._map() / f".ready-{os.getpid()}"
        pad.write_text("ok")
        pad.unlink()
        return True
    except OSError:
        return False


@app.get("/ready")
async def ready():
    """Readiness: kan deze instantie nieuwe gesprekken aannemen? Alleen de opslag, de configuratie en de herstartstatus; geen externe diensten."""
    checks = {
        "data_schijf": "ok" if _data_schijf_schrijfbaar() else "fout",
        "configuratie": "ok" if all(os.getenv(k) for k in _VERPLICHTE_INSTELLINGEN) else "fout",
        "herstart": "fout" if DRAINING else "ok",
    }
    klaar = all(v == "ok" for v in checks.values())
    return Response(content=__import__("json").dumps({"ok": klaar, "checks": checks}), media_type="application/json", status_code=200 if klaar else 503)


@app.api_route("/incoming-call", methods=["GET", "POST"])
async def incoming_call(request: Request):
    if not await _valid_twilio_signature(request):
        logger.warning("Ongeldige Twilio-signatuur op /incoming-call, geweigerd")
        return Response(status_code=403)
    call_id = request.query_params.get("call_id", "")
    if calls.lees_opdracht(call_id) is None:
        logger.warning(f"/incoming-call zonder geldige opdracht ({call_id!r}), geweigerd")
        return Response(status_code=404)
    response = VoiceResponse()
    connect = Connect()
    stream = Stream(url=f"wss://{_public_host(request)}/ws")
    if WS_TOKEN:
        stream.parameter(name="token", value=WS_TOKEN)
    stream.parameter(name="call_id", value=call_id)
    connect.append(stream)
    response.append(connect)
    return Response(content=str(response), media_type="application/xml")


@app.post("/status")
async def status_callback(request: Request):
    """Twilio-statussen van het gesprek. Zonder `answered` volgt er geen websocket, dus hier ontstaat de uitkomst 'niet bereikt'."""
    if not await _valid_twilio_signature(request):
        return Response(status_code=403)
    call_id = request.query_params.get("call_id", "")
    form = await request.form()
    twilio_status = form.get("CallStatus", "")
    spec = calls.lees_opdracht(call_id)
    # Een melding die te laat komt (het gesprek is al verbonden of afgerond) mag de uitkomst niet terugdraaien.
    if spec is not None and spec.get("status") not in ("gesprek", "gesproken") and twilio_status in {"busy", "no-answer", "failed", "canceled"}:
        calls.update_opdracht(call_id, status="niet_bereikt", twilio_status=twilio_status)
        calls.rapporteer(call_id, "mislukt" if twilio_status == "failed" else "niet_bereikt", fout=f"Twilio: {twilio_status}", twilioSid=form.get("CallSid"))
    logger.info(f"Status opdracht {call_id}: {twilio_status}")
    return Response(status_code=204)


@app.post("/amd")
async def amd_callback(request: Request):
    """Asynchrone voicemailherkenning: bij een antwoordapparaat leggen we direct op in plaats van in te spreken."""
    if not await _valid_twilio_signature(request):
        return Response(status_code=403)
    call_id = request.query_params.get("call_id", "")
    form = await request.form()
    answered_by = form.get("AnsweredBy", "")
    spec = calls.lees_opdracht(call_id)
    if spec is not None and (answered_by.startswith("machine") or answered_by == "fax"):
        logger.info(f"Opdracht {call_id}: voicemail ({answered_by}), opgehangen")
        calls.update_opdracht(call_id, status="voicemail", answered_by=answered_by)
        calls.rapporteer(call_id, "voicemail")
        if spec and spec.get("twilio_sid"):
            _hang_op(spec["twilio_sid"])
    return Response(status_code=204)


class BelVerzoek(BaseModel):
    telefoonnummer: str = Field(min_length=6, max_length=20)
    medewerker: str = Field(min_length=1, max_length=100)
    onderwerpen: list[dict] = Field(default_factory=list, max_length=20)
    toestemming_nodig: bool = True
    web_call_id: str = Field(default="", max_length=64)
    houding: str = Field(default="", max_length=4000)
    instructie: str = Field(default="", max_length=4000)
    engine: Literal["pipecat", "elevenlabs_agent"] | None = None


@app.post("/bel")
async def bel(verzoek: BelVerzoek, authorization: str = Header(default="")):
    """Start een gesprek. Fase 0: alleen voor handmatige tests, achter ADMIN_TOKEN. De scheduler (fase 2) roept dezelfde functies aan."""
    if not ADMIN_TOKEN or not hmac.compare_digest(authorization, f"Bearer {ADMIN_TOKEN}"):
        raise HTTPException(status_code=401, detail="Niet toegestaan")
    if DRAINING:
        raise HTTPException(status_code=503, detail="herstart bezig, probeer het zo opnieuw")
    nummer = calls.normaliseer_nl_nummer(verzoek.telefoonnummer)
    if not nummer:
        return {"gebeld": False, "reden": "ongeldig telefoonnummer"}
    call_id = ""
    if verzoek.web_call_id:
        # Idempotent op web_call_id: een herhaald verzoek (time-out, retry) belt nooit een tweede keer.
        try:
            nieuw, call_id = calls.claim_web_call(verzoek.web_call_id)
        except ValueError:
            return {"gebeld": False, "reden": "ongeldige web_call_id"}
        if not nieuw:
            logger.info(f"Herhaald verzoek (web_call_id {verzoek.web_call_id}), niet opnieuw gebeld")
            return calls.uitkomst_van(call_id)
    mag, reden = calls.mag_bellen(nummer)
    if not mag:
        if call_id:
            calls.maak_opdracht(nummer, verzoek.medewerker, [], verzoek.toestemming_nodig, verzoek.web_call_id, call_id=call_id)
            calls.update_opdracht(call_id, status="mislukt", fout=reden, geweigerd=True, onderwerpen=[])
        return {"gebeld": False, "reden": reden}
    call_id = calls.maak_opdracht(nummer, verzoek.medewerker, verzoek.onderwerpen, verzoek.toestemming_nodig, verzoek.web_call_id, verzoek.houding, verzoek.instructie, call_id=call_id, engine=verzoek.engine or os.getenv("VOICE_ENGINE", "pipecat"))
    resultaat = calls.start_gesprek(call_id)
    if not resultaat.get("gebeld") and not resultaat.get("onzeker"):
        calls.rapporteer(call_id, "mislukt", fout=resultaat.get("reden"))
    return resultaat


@app.post("/elevenlabs/webhook")
async def elevenlabs_webhook(request: Request):
    """Post-call-webhook van de ElevenLabs-agent: levert het eindtranscript van een gesprek af of meldt dat er niet is opgenomen."""
    import agent_elevenlabs
    body = await request.body()
    if not agent_elevenlabs.controleer_handtekening(body, request.headers.get("elevenlabs-signature", ""), os.getenv("ELEVENLABS_WEBHOOK_SECRET", "")):
        return Response(status_code=401)
    try:
        gebeurtenis = json.loads(body)
    except ValueError:
        return Response(status_code=400)
    uitkomst = await asyncio.to_thread(agent_elevenlabs.verwerk_webhook, gebeurtenis)
    logger.info(f"ElevenLabs-webhook {gebeurtenis.get('type')}: {uitkomst}")
    return Response(status_code=200)


@app.post("/herstel/{web_call_id}")
async def herstel(web_call_id: str, authorization: str = Header(default="")):
    """Laat de web-service een agent-gesprek alsnog bij ElevenLabs ophalen en afleveren (vangnet of handmatig). Start nooit een gesprek."""
    if not ADMIN_TOKEN or not hmac.compare_digest(authorization, f"Bearer {ADMIN_TOKEN}"):
        raise HTTPException(status_code=401, detail="Niet toegestaan")
    import agent_elevenlabs
    gevonden = calls.opzoeken(web_call_id)
    if gevonden is None:
        raise HTTPException(status_code=404, detail="Onbekend")
    uitkomst = await asyncio.to_thread(agent_elevenlabs.herstel_gesprek, gevonden["call_id"])
    logger.info(f"Herstel van agent-gesprek: {uitkomst}")
    return {"uitkomst": uitkomst}


@app.get("/bel/{web_call_id}")
async def bel_opzoeken(web_call_id: str, authorization: str = Header(default="")):
    """Laat de web-service navragen wat er met een eerder verzoek is gebeurd (na een time-out of crash), zonder iets te starten."""
    if not ADMIN_TOKEN or not hmac.compare_digest(authorization, f"Bearer {ADMIN_TOKEN}"):
        raise HTTPException(status_code=401, detail="Niet toegestaan")
    gevonden = calls.opzoeken(web_call_id)
    if gevonden is None:
        raise HTTPException(status_code=404, detail="Onbekend")
    return gevonden


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    query_token = websocket.query_params.get("token")
    if WS_TOKEN and query_token is not None and query_token != WS_TOKEN:
        logger.warning("Websocket geweigerd: onjuist token in querystring")
        await websocket.close(code=1008)
        return
    from pipeline import run_voice_pipeline
    await run_voice_pipeline(websocket, token_geverifieerd=bool(WS_TOKEN) and query_token == WS_TOKEN)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 5000)), reload=False)
