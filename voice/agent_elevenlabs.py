"""Tweede gespreksmotor: een volledige ElevenLabs-agent (spraakherkenning, taalmodel, beurtwisseling, stem en telefonie in één platform).

De voordeur (`POST /bel`), de idempotentie, de limieten en de terugmelding aan de web-service zijn dezelfde als bij Pipecat. Alleen het starten
van het gesprek en het ophalen van het eindtranscript verschillen: ElevenLabs belt zelf en meldt het gesprek na afloop via een webhook.
Veldnamen van de ElevenLabs-API zijn hier op één plek verzameld; controleer ze tegen de actuele documentatie bij het eerste echte gesprek.
"""
import hashlib
import hmac
import os
import time

import httpx
from loguru import logger

import calls
import config
from persoonsgegevens import maskeer
from prompts import PROMPT_VERSION, build_system_prompt, greeting_text

API = os.getenv("ELEVENLABS_API_BASE", "https://api.elevenlabs.io")
# Tolerantie voor de tijdstempel in de handtekening van een webhook.
HANDTEKENING_MARGE_SECS = 30 * 60


def _sleutel() -> str:
    return os.getenv("ELEVENLABS_API_KEY", "")


def bouw_belverzoek(spec: dict, agent_id: str, nummer_id: str) -> dict:
    """De body voor de outbound-call van ElevenLabs. Prompt en begroeting komen uit dezelfde bron als bij Pipecat, zodat beide motoren
    dezelfde AI-melding en toestemmingsvraag uitspreken."""
    cfg = config.get_config()
    prompt = build_system_prompt(
        cfg["opdrachtgever"], spec["medewerker"], spec["onderwerpen"],
        houding=spec.get("houding", ""), instructie=spec.get("instructie", ""), einde_tool="end_call",
    )
    groet = greeting_text(cfg["opdrachtgever"], spec["medewerker"], bool(spec.get("toestemming_nodig")))
    return {
        "agent_id": agent_id,
        "agent_phone_number_id": nummer_id,
        "to_number": spec["nummer"],
        "conversation_initiation_client_data": {
            "conversation_config_override": {
                "agent": {"prompt": {"prompt": prompt}, "first_message": groet, "language": "nl"},
            },
            "dynamic_variables": {"call_id": spec["call_id"], "prompt_version": PROMPT_VERSION},
        },
    }


def start_gesprek_agent(call_id: str) -> dict:
    """Laat ElevenLabs bellen. Zelfde antwoordvorm als de Pipecat-motor: gebeld, of niet (met reden), eventueel onzeker."""
    spec = calls.lees_opdracht(call_id)
    agent_id, nummer_id, sleutel = os.getenv("ELEVENLABS_AGENT_ID", ""), os.getenv("ELEVENLABS_AGENT_PHONE_NUMBER_ID", ""), _sleutel()
    if spec is None or not (agent_id and nummer_id and sleutel):
        return {"gebeld": False, "reden": "de ElevenLabs-agent is niet volledig geconfigureerd of de opdracht ontbreekt"}
    # Vanaf hier is niet meer zeker of er gebeld is als het proces stopt.
    calls.update_opdracht(call_id, twilio_poging=time.time())
    try:
        r = httpx.post(
            f"{API}/v1/convai/twilio/outbound-call", json=bouw_belverzoek(spec, agent_id, nummer_id),
            headers={"xi-api-key": sleutel}, timeout=30,
        )
    except httpx.HTTPError as e:
        logger.error(f"ElevenLabs-aanroep onzeker voor opdracht {call_id}: {type(e).__name__}")
        return {"gebeld": False, "reden": "ElevenLabs-aanroep mislukt", "onzeker": True}
    if r.status_code >= 500:
        logger.error(f"ElevenLabs gaf {r.status_code} voor opdracht {call_id}")
        return {"gebeld": False, "reden": f"ElevenLabs gaf {r.status_code}", "onzeker": True}
    if r.status_code >= 400:
        logger.error(f"ElevenLabs weigerde opdracht {call_id}: {r.status_code}")
        calls.update_opdracht(call_id, status="mislukt", fout=f"elevenlabs_{r.status_code}", twilio_afgewezen=True)
        return {"gebeld": False, "reden": f"ElevenLabs weigerde het verzoek ({r.status_code})"}
    try:
        data = r.json()
    except ValueError:
        data = {}
    if data.get("success") is False:
        calls.update_opdracht(call_id, status="mislukt", fout="elevenlabs_geweigerd", twilio_afgewezen=True)
        return {"gebeld": False, "reden": "ElevenLabs kon het gesprek niet starten"}
    calls.update_opdracht(
        call_id, status="belt", twilio_sid=data.get("callSid") or data.get("call_sid"),
        agent_conversation_id=data.get("conversation_id"), gebeld_om=time.time(),
    )
    logger.info(f"Agent-gesprek gestart (opdracht {call_id})")
    return {"gebeld": True, "call_id": call_id}


def controleer_handtekening(body: bytes, header: str, geheim: str, nu: float | None = None) -> bool:
    """`ElevenLabs-Signature: t=<tijd>,v0=<hex>` met hex = HMAC-SHA256(geheim, "<tijd>.<body>")."""
    if not (geheim and header):
        return False
    delen = dict(d.split("=", 1) for d in header.split(",") if "=" in d)
    tijd, ontvangen = delen.get("t", ""), delen.get("v0", "")
    try:
        if abs((time.time() if nu is None else nu) - int(tijd)) > HANDTEKENING_MARGE_SECS:
            return False
    except ValueError:
        return False
    verwacht = hmac.new(geheim.encode(), f"{tijd}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(verwacht, ontvangen)


def naar_transcript(beurten: list[dict]) -> list[dict]:
    """ElevenLabs-beurten (`agent`/`user`, `message`) naar het formaat van de web-service, met BSN en IBAN gemaskeerd."""
    uit = []
    for b in beurten or []:
        tekst = b.get("message")
        if not isinstance(tekst, str) or not tekst.strip():
            continue
        rol = "assistant" if b.get("role") == "agent" else "user" if b.get("role") == "user" else None
        if rol:
            uit.append({"role": rol, "content": maskeer(tekst)})
    return uit


def _spec_bij(data: dict) -> dict | None:
    spec = calls.vind_op_conversation(data.get("conversation_id", ""))
    if spec:
        return spec
    # Terugval: het eigen call-id dat we als dynamische variabele hebben meegestuurd.
    cid = ((data.get("conversation_initiation_client_data") or {}).get("dynamic_variables") or {}).get("call_id", "")
    return calls.lees_opdracht(cid)


def verwerk_webhook(gebeurtenis: dict) -> str:
    """Verwerkt een post-call-webhook. Geeft een korte uitkomst terug voor de log: 'afgerond', 'mislukt', 'onbekend' of 'genegeerd'."""
    soort, data = gebeurtenis.get("type"), gebeurtenis.get("data") or {}
    spec = _spec_bij(data)
    if spec is None:
        return "onbekend"
    call_id = spec["call_id"]
    if spec.get("eind_gemeld"):
        return "genegeerd"  # herhaalde webhook
    if soort == "call_initiation_failure":
        calls.update_opdracht(call_id, status="niet_bereikt", fout="agent_geen_verbinding")
        calls.rapporteer(call_id, "niet_bereikt", fout="Geen verbinding gekregen")
        return "mislukt"
    if soort != "post_call_transcription":
        return "genegeerd"
    transcript = naar_transcript(data.get("transcript"))
    if not any(m["role"] == "user" for m in transcript):
        # Niemand heeft iets gezegd: opgenomen zonder gesprek (niet opgenomen, voicemail of meteen opgehangen).
        calls.update_opdracht(call_id, status="niet_bereikt")
        calls.rapporteer(call_id, "niet_bereikt")
        return "mislukt"
    calls.update_opdracht(call_id, status="gesproken", afgerond_om=time.time(), agent_gesprek_afgerond=True)
    calls.rapporteer(call_id, "gesproken", transcript=transcript)
    return "afgerond"


def haal_gesprek_op(conversation_id: str) -> dict | None:
    """Vangnet: het gesprek zelf opvragen als de webhook niet aankwam."""
    try:
        r = httpx.get(f"{API}/v1/convai/conversations/{conversation_id}", headers={"xi-api-key": _sleutel()}, timeout=15)
        return r.json() if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


def herstel_agentgesprekken(nu: float | None = None, minimaal_secs: float = 900) -> int:
    """Een agent-gesprek dat lang in 'belt' of 'gesprek' blijft staat zonder webhook: vraag het gesprek bij ElevenLabs op en rond het af.
    Geeft het aantal afgeronde gesprekken terug."""
    nu = time.time() if nu is None else nu
    n = 0
    for pad in list(calls._map().glob("*.json")):
        spec = calls.lees_opdracht(pad.stem)
        if not spec or spec.get("engine") != "elevenlabs_agent" or spec.get("eind_gemeld") or not spec.get("agent_conversation_id"):
            continue
        if spec.get("status") not in ("belt", "gesprek") or nu - spec.get("bijgewerkt", nu) < minimaal_secs:
            continue
        gesprek = haal_gesprek_op(spec["agent_conversation_id"])
        if not gesprek or gesprek.get("status") not in ("done", "failed"):
            continue
        verwerk_webhook({"type": "post_call_transcription", "data": {"conversation_id": spec["agent_conversation_id"], "transcript": gesprek.get("transcript")}})
        n += 1
    return n
