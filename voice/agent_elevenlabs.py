"""Tweede gespreksmotor: een volledige ElevenLabs-agent (spraakherkenning, taalmodel, beurtwisseling, stem en telefonie in één platform).

De voordeur (`POST /bel`), de idempotentie, de limieten en de terugmelding aan de web-service zijn dezelfde als bij Pipecat. Alleen het starten
van het gesprek en het ophalen van het eindtranscript verschillen: ElevenLabs belt zelf en meldt het gesprek na afloop via een webhook.
Veldnamen van de ElevenLabs-API zijn hier op één plek verzameld; controleer ze tegen de actuele documentatie bij het eerste echte gesprek.
"""
import hashlib
import hmac
import os
import re
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


def _init_antwoord(call_id: str, prompt: str, groet: str) -> dict:
    return {
        "type": "conversation_initiation_client_data",
        "dynamic_variables": {"call_id": call_id, "prompt_version": PROMPT_VERSION},
        "conversation_config_override": {"agent": {"prompt": {"prompt": prompt}, "first_message": groet, "language": "nl"}},
    }


def _afwijzing(reden: str) -> dict:
    """Een beller die we niet kunnen helpen: de agent zegt het kort, zonder gegevens, en hangt op."""
    cfg = config.get_config()
    zin = {
        "uit": "Bellen naar dit nummer is nog niet mogelijk.",
        "te_vaak": "Je hebt het afgelopen uur al vaker gebeld. Probeer het later nog eens.",
    }.get(reden, "Ik herken dit telefoonnummer niet, dus ik kan je nu niet helpen.")
    groet = f"Goedendag, je spreekt met de digitale assistent van {cfg['opdrachtgever']}. Dit is een AI-systeem. {zin} Tot ziens."
    prompt = (f"Je bent een digitale assistent (AI-systeem) van {cfg['opdrachtgever']}. Spreek de eerste zin uit en roep daarna meteen `end_call` aan. "
              "Geef geen informatie, beantwoord geen vragen en ga niet in op wat de beller zegt.")
    return _init_antwoord("", prompt, groet)


def verwerk_init(verzoek: dict) -> dict:
    """Conversation-initiation-webhook voor een inkomend gesprek: herken de medewerker aan het nummer en geef de agent zijn prompt en begroeting.
    Alleen voor ons eigen agent-nummer; de uitkomst van het gesprek loopt daarna via dezelfde post-call-webhook als bij uitgaand bellen."""
    agent_id = os.getenv("ELEVENLABS_AGENT_ID", "")
    if agent_id and verzoek.get("agent_id") not in ("", None, agent_id):
        return _afwijzing("onbekend")
    status, data = calls.vraag_inkomend(str(verzoek.get("caller_id") or ""))
    if status != 200 or not data.get("callId"):
        logger.info(f"Inkomend gesprek afgewezen (web-antwoord {status})")
        return _afwijzing("uit" if status == 403 else "te_vaak" if status == 429 else "onbekend")
    nieuw, call_id = calls.claim_web_call(data["callId"])
    if nieuw:
        calls.maak_opdracht(
            calls.normaliseer_nl_nummer(str(verzoek.get("caller_id") or "")) or "", data["medewerker"], data.get("onderwerpen", []),
            bool(data.get("toestemmingNodig")), data["callId"], data.get("houding", ""), data.get("instructie", ""), call_id=call_id, engine="elevenlabs_agent",
        )
        calls.update_opdracht(call_id, status="gesprek", agent_conversation_id=verzoek.get("conversation_id") or None, inkomend=True)
    spec = calls.lees_opdracht(call_id) or {}
    cfg = config.get_config()
    prompt = build_system_prompt(
        cfg["opdrachtgever"], spec.get("medewerker", data["medewerker"]), spec.get("onderwerpen", []),
        houding=spec.get("houding", ""), instructie=spec.get("instructie", ""), einde_tool="end_call", inkomend=True,
        hulp_id=data["callId"] if os.getenv("INKOMEND_TOOLS", "").lower() == "true" else "",
    )
    groet = greeting_text(cfg["opdrachtgever"], spec.get("medewerker", data["medewerker"]), bool(spec.get("toestemming_nodig")), inkomend=True)
    logger.info(f"Inkomend gesprek gestart (opdracht {call_id})")
    return _init_antwoord(call_id, prompt, groet)


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


# Zinnen die een antwoordapparaat zegt. Bewust alleen sterke signalen: "ik ben niet beschikbaar" zegt ook een collega.
_VOICEMAIL = re.compile(
    r"na de (?:toon|piep|beep)|laat (?:een|uw|je) (?:bericht|boodschap) (?:achter|na)|spreek (?:een|uw|je) (?:bericht|boodschap) in|toets 1|toets een"
    r"|beëindig (?:dit|het) gesprek|voicemail|antwoordapparaat|(?:kan|kunnen) (?:de|uw|je) oproep niet beantwoorden|momenteel niet bereikbaar",
    re.IGNORECASE,
)
# Een voicemailgroet is kort; wie zelf veel zegt, is een persoon.
VOICEMAIL_MAX_WOORDEN = 60


def lijkt_op_voicemail(transcript: list[dict]) -> bool:
    """Het gesprek bestaat alleen uit wat een antwoordapparaat zegt (de agent-motor heeft geen eigen voicemailherkenning zoals Twilio bij Pipecat)."""
    gebruiker = [m["content"] for m in transcript if m["role"] == "user"]
    return bool(gebruiker) and sum(len(t.split()) for t in gebruiker) <= VOICEMAIL_MAX_WOORDEN and any(_VOICEMAIL.search(t) for t in gebruiker)


def _spec_bij(data: dict) -> dict | None:
    spec = calls.vind_op_conversation(data.get("conversation_id", ""))
    if spec:
        return spec
    # Terugval: het eigen call-id dat we als dynamische variabele hebben meegestuurd.
    cid = ((data.get("conversation_initiation_client_data") or {}).get("dynamic_variables") or {}).get("call_id", "")
    return calls.lees_opdracht(cid)


def verwijder_gesprek(conversation_id: str) -> bool:
    """Wist het gesprek bij ElevenLabs zodra het transcript in het dagboek staat, zodat de gespreksinhoud niet bij hen blijft staan.
    Mislukt dat (bijvoorbeeld door ontbrekende schrijfrechten van de sleutel), dan blijft het gesprek daar staan en loggen we alleen de statuscode."""
    if os.getenv("ELEVENLABS_VERWIJDER_GESPREK", "true").lower() != "true" or not conversation_id:
        return False
    try:
        r = httpx.delete(f"{API}/v1/convai/conversations/{conversation_id}", headers={"xi-api-key": _sleutel()}, timeout=15)
    except httpx.HTTPError as e:
        logger.warning(f"Gesprek wissen bij ElevenLabs mislukt: {type(e).__name__}")
        return False
    if r.status_code >= 400:
        logger.warning(f"Gesprek wissen bij ElevenLabs mislukt: {r.status_code}")
        return False
    return True


def verwerk_webhook(gebeurtenis: dict) -> str:
    """Verwerkt een post-call-webhook. Geeft een korte uitkomst terug voor de log: 'afgerond', 'voicemail', 'mislukt', 'onbekend' of 'genegeerd'."""
    soort, data = gebeurtenis.get("type"), gebeurtenis.get("data") or {}
    spec = _spec_bij(data)
    if spec is None:
        return "onbekend"
    call_id = spec["call_id"]
    gemeld = spec.get("eind_gemeld")
    # Een herhaling is overbodig; alleen een gesprek met echte tekst mag een eerdere mislukte of afgebroken uitkomst nog vervangen.
    if gemeld == "gesproken":
        return "genegeerd"
    if soort == "call_initiation_failure":
        if gemeld:
            return "genegeerd"
        calls.update_opdracht(call_id, status="niet_bereikt", fout="agent_geen_verbinding")
        calls.rapporteer(call_id, "niet_bereikt", fout="Geen verbinding gekregen")
        return "mislukt"
    if soort != "post_call_transcription":
        return "genegeerd"
    transcript = naar_transcript(data.get("transcript"))
    if not any(m["role"] == "user" for m in transcript):
        # Niemand heeft iets gezegd: opgenomen zonder gesprek (niet opgenomen, voicemail of meteen opgehangen).
        if gemeld:
            return "genegeerd"
        calls.update_opdracht(call_id, status="niet_bereikt")
        calls.rapporteer(call_id, "niet_bereikt")
        return "mislukt"
    if lijkt_op_voicemail(transcript):
        # Geen persoon aan de lijn: het telt niet als gesproken, zodat de planning het later opnieuw kan proberen. Zonder transcript naar het web
        # en zonder wissen bij ElevenLabs, voor het geval de herkenning zich vergist.
        if gemeld:
            return "genegeerd"
        calls.update_opdracht(call_id, status="voicemail", afgerond_om=time.time(), agent_gesprek_afgerond=True)
        calls.rapporteer(call_id, "voicemail")
        return "voicemail"
    calls.update_opdracht(call_id, status="gesproken", afgerond_om=time.time(), agent_gesprek_afgerond=True)
    if calls.rapporteer(call_id, "gesproken", transcript=transcript):
        # Pas wissen als de web-service het transcript heeft aangenomen: dan is het dagboek de enige kopie.
        verwijder_gesprek(data.get("conversation_id", ""))
    return "afgerond"


def haal_gesprek_op(conversation_id: str) -> dict | None:
    """Vangnet: het gesprek zelf opvragen als de webhook niet aankwam."""
    try:
        r = httpx.get(f"{API}/v1/convai/conversations/{conversation_id}", headers={"xi-api-key": _sleutel()}, timeout=15)
        return r.json() if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


def herstel_gesprek(call_id: str) -> str:
    """Haalt een agent-gesprek bij ElevenLabs op en verwerkt het als de webhook. Geeft 'afgerond', 'mislukt', 'genegeerd', 'nog_bezig',
    'geen_gesprek' of 'onbekend' terug."""
    spec = calls.lees_opdracht(call_id)
    if not spec or spec.get("engine") != "elevenlabs_agent" or not spec.get("agent_conversation_id"):
        return "onbekend"
    conv = spec["agent_conversation_id"]
    gesprek = haal_gesprek_op(conv)
    if gesprek is None:
        return "geen_gesprek"
    if gesprek.get("status") not in ("done", "failed"):
        return "nog_bezig"
    return verwerk_webhook({"type": "post_call_transcription", "data": {"conversation_id": conv, "transcript": gesprek.get("transcript")}})


# Een gesprek dat voice al als niet-gesproken heeft gemeld, vragen we nog een paar keer na: de webhook kan te vroeg, leeg of nooit zijn aangekomen.
NAVRAAG_STATUSSEN = ("onderbroken", "niet_bereikt", "mislukt")
NAVRAAG_MAX = 3
NAVRAAG_INTERVAL_SECS = 600
NAVRAAG_TOT_SECS = 48 * 3600


def herstel_agentgesprekken(nu: float | None = None, minimaal_secs: float = 900) -> int:
    """Een agent-gesprek dat lang in 'belt' of 'gesprek' blijft staat zonder webhook: vraag het gesprek bij ElevenLabs op en rond het af.
    Hetzelfde geldt voor een gesprek dat als niet gesproken is gemeld, maar bij ElevenLabs wel woorden bevat. Geeft het aantal afgeronde gesprekken terug."""
    nu = time.time() if nu is None else nu
    n = 0
    for pad in list(calls._map().glob("*.json")):
        spec = calls.lees_opdracht(pad.stem)
        if not spec or spec.get("engine") != "elevenlabs_agent" or not spec.get("agent_conversation_id") or spec.get("eind_gemeld") == "gesproken":
            continue
        if spec.get("eind_gemeld"):
            if (spec["eind_gemeld"] not in NAVRAAG_STATUSSEN or spec.get("herstel_pogingen", 0) >= NAVRAAG_MAX
                    or nu - spec.get("herstel_laatst", 0) < NAVRAAG_INTERVAL_SECS
                    or nu - spec.get("gebeld_om", spec.get("aangemaakt", nu)) > NAVRAAG_TOT_SECS):
                continue
            calls.update_opdracht(pad.stem, herstel_pogingen=spec.get("herstel_pogingen", 0) + 1, herstel_laatst=nu)
        elif spec.get("status") not in ("belt", "gesprek") or nu - spec.get("bijgewerkt", nu) < minimaal_secs:
            continue
        if herstel_gesprek(pad.stem) == "afgerond":
            n += 1
    return n
