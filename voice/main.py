import asyncio
import hmac
import os
from contextlib import asynccontextmanager

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
import opschoning

async def _opschoon_lus() -> None:
    while True:
        try:
            await asyncio.to_thread(opschoning.ruim_op)
        except Exception as e:
            logger.error(f"Opschoning mislukt: {type(e).__name__}: {e}")
        await asyncio.sleep(6 * 3600)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    taak = asyncio.create_task(_opschoon_lus())
    yield
    taak.cancel()


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
    return {"ok": True}


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
    if spec is not None and twilio_status in {"busy", "no-answer", "failed", "canceled"}:
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
    onderwerpen: list[dict] = Field(default_factory=list, max_length=10)
    toestemming_nodig: bool = True
    web_call_id: str = Field(default="", max_length=64)
    houding: str = Field(default="", max_length=4000)


@app.post("/bel")
async def bel(verzoek: BelVerzoek, authorization: str = Header(default="")):
    """Start een gesprek. Fase 0: alleen voor handmatige tests, achter ADMIN_TOKEN. De scheduler (fase 2) roept dezelfde functies aan."""
    if not ADMIN_TOKEN or not hmac.compare_digest(authorization, f"Bearer {ADMIN_TOKEN}"):
        raise HTTPException(status_code=401, detail="Niet toegestaan")
    nummer = calls.normaliseer_nl_nummer(verzoek.telefoonnummer)
    if not nummer:
        return {"gebeld": False, "reden": "ongeldig telefoonnummer"}
    mag, reden = calls.mag_bellen(nummer)
    if not mag:
        return {"gebeld": False, "reden": reden}
    call_id = calls.maak_opdracht(nummer, verzoek.medewerker, verzoek.onderwerpen, verzoek.toestemming_nodig, verzoek.web_call_id, verzoek.houding)
    resultaat = calls.start_gesprek(call_id)
    if not resultaat.get("gebeld"):
        calls.rapporteer(call_id, "mislukt", fout=resultaat.get("reden"))
    return resultaat


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
