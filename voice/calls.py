"""Gespreksopdrachten en uitgaand bellen via Twilio.

Een opdracht (`CallSpec`) staat als JSON in DATA_DIR/_calls/<call_id>.json en wordt door de pipeline gelezen aan de hand
van het call_id dat als <Parameter> meekomt. Zo hoeft er geen gespreksinhoud in een URL. De uurlimiet telt de opdrachten van
het afgelopen uur, dus hij overleeft een herstart (Inwoner.AI hield die tellers in het geheugen).
"""
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode

from loguru import logger

import config

MAX_PER_UUR = int(os.getenv("UITGAAND_MAX_PER_UUR", "20"))
MIN_SECS_TUSSEN_POGINGEN = float(os.getenv("UITGAAND_MIN_SECS_PER_NUMMER", "300"))

_NL_NUMMER = re.compile(r"^(?:\+31|0031|0)(6\d{8}|[1-9]\d{7,8})$")
_CALL_ID = re.compile(r"^[0-9a-f]{32}$")
_WEB_CALL_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_LOCK = threading.RLock()
# Een gesprek dat zo lang in 'belt'/'gesprek' staat zonder eindmelding is afgebroken (bijvoorbeeld door een herstart).
ONDERBROKEN_NA_SECS = float(os.getenv("ONDERBROKEN_NA_SECS", "1200"))


def normaliseer_nl_nummer(ruw: str) -> str | None:
    cijfers = re.sub(r"[\s\-().]", "", ruw or "")
    m = _NL_NUMMER.match(cijfers)
    return f"+31{m.group(1)}" if m else None


def _map() -> Path:
    pad = Path(config.DATA_DIR) / "_calls"
    pad.mkdir(parents=True, exist_ok=True)
    return pad


def _schrijf(pad: Path, spec: dict) -> None:
    """Atomair schrijven: een crash laat het oude of het nieuwe bestand achter, nooit een half bestand."""
    tmp = pad.with_name(f".{pad.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, pad)


def maak_opdracht(nummer: str, medewerker: str, onderwerpen: list[dict], toestemming_nodig: bool = True, web_call_id: str = "", houding: str = "", instructie: str = "", call_id: str = "", engine: str = "pipecat") -> str:
    call_id = call_id or uuid.uuid4().hex
    spec = {
        "call_id": call_id, "nummer": nummer, "medewerker": medewerker, "onderwerpen": onderwerpen,
        "toestemming_nodig": toestemming_nodig, "web_call_id": web_call_id, "houding": houding, "instructie": instructie, "engine": engine, "aangemaakt": time.time(),
        "bijgewerkt": time.time(),
    }
    with _LOCK:
        _schrijf(_map() / f"{call_id}.json", spec)
    return call_id


def lees_opdracht(call_id: str) -> dict | None:
    if not _CALL_ID.match(call_id or ""):
        return None
    pad = _map() / f"{call_id}.json"
    try:
        return json.loads(pad.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def update_opdracht(call_id: str, **velden) -> None:
    with _LOCK:
        spec = lees_opdracht(call_id)
        if spec is None:
            return
        spec.update(velden)
        spec["bijgewerkt"] = time.time()
        _schrijf(_map() / f"{call_id}.json", spec)


def claim_web_call(web_call_id: str) -> tuple[bool, str]:
    """Idempotency: de web-service stuurt per gesprek een vaste sleutel mee. De eerste aanroep wint de claim (os.link faalt atomair
    als het bestand al bestaat); een herhaling krijgt het eerdere call_id terug en belt dus nooit een tweede keer. Geeft (nieuw, call_id)."""
    if not _WEB_CALL_ID.match(web_call_id or ""):
        raise ValueError("ongeldige web_call_id")
    pad = _map() / f"web-{web_call_id}.claim"
    call_id = uuid.uuid4().hex
    tmp = pad.with_name(f".{pad.name}.{call_id}.tmp")
    tmp.write_text(call_id, encoding="utf-8")
    try:
        os.link(tmp, pad)
        return True, call_id
    except FileExistsError:
        return False, pad.read_text(encoding="utf-8").strip()
    finally:
        tmp.unlink(missing_ok=True)


def opzoeken(web_call_id: str) -> dict | None:
    """Wat weten we over een eerder verzoek met deze sleutel? None = nooit ontvangen. `onzeker`: de Twilio-aanroep is mogelijk wel gedaan."""
    if not _WEB_CALL_ID.match(web_call_id or ""):
        return None
    claim = _map() / f"web-{web_call_id}.claim"
    if not claim.exists():
        return None
    call_id = claim.read_text(encoding="utf-8").strip()
    spec = lees_opdracht(call_id)
    if spec and spec.get("twilio_sid"):
        return {"call_id": call_id, "gebeld": True, "onzeker": False}
    if spec is None or not spec.get("twilio_poging"):
        return {"call_id": call_id, "gebeld": False, "onzeker": False}  # crash vóór de Twilio-aanroep: zeker niet gebeld
    if spec.get("twilio_afgewezen") or spec.get("geweigerd"):
        return {"call_id": call_id, "gebeld": False, "onzeker": False}
    return {"call_id": call_id, "gebeld": False, "onzeker": True}  # aanroep gestart maar uitkomst onbekend


def uitkomst_van(call_id: str) -> dict:
    """Antwoord op een herhaald verzoek met dezelfde sleutel."""
    spec = lees_opdracht(call_id) or {}
    if spec.get("twilio_sid"):
        return {"gebeld": True, "call_id": call_id}
    onzeker = bool(spec.get("twilio_poging")) and not (spec.get("twilio_afgewezen") or spec.get("geweigerd"))
    return {"gebeld": False, "reden": spec.get("fout") or "eerder verzoek met dezelfde sleutel", "onzeker": onzeker}


def mag_bellen(nummer: str, nu: float | None = None) -> tuple[bool, str]:
    nu = time.time() if nu is None else nu
    laatste_uur, laatste_nummer = 0, 0.0
    for pad in _map().glob("*.json"):
        try:
            spec = json.loads(pad.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not spec.get("gebeld_om"):
            continue
        if nu - spec["gebeld_om"] < 3600:
            laatste_uur += 1
        if spec.get("nummer") == nummer:
            laatste_nummer = max(laatste_nummer, spec["gebeld_om"])
    if nu - laatste_nummer < MIN_SECS_TUSSEN_POGINGEN:
        return False, "dit nummer is recent al gebeld"
    if laatste_uur >= MAX_PER_UUR:
        return False, "uurlimiet voor uitgaande gesprekken bereikt"
    return True, ""


def vind_op_conversation(conversation_id: str) -> dict | None:
    """De opdracht die bij een ElevenLabs-gesprek hoort (de agent-motor meldt zich alleen met zijn eigen gespreks-id)."""
    if not conversation_id:
        return None
    for pad in _map().glob("*.json"):
        spec = lees_opdracht(pad.stem)
        if spec and spec.get("agent_conversation_id") == conversation_id:
            return spec
    return None


def start_gesprek(call_id: str) -> dict:
    """Start het gesprek met de gekozen motor: Pipecat via Twilio (standaard) of een ElevenLabs-agent."""
    spec = lees_opdracht(call_id)
    if spec and spec.get("engine") == "elevenlabs_agent":
        import agent_elevenlabs
        return agent_elevenlabs.start_gesprek_agent(call_id)
    return _start_gesprek_pipecat(call_id)


def _start_gesprek_pipecat(call_id: str) -> dict:
    """Start het gesprek bij Twilio, met statuscallback, voicemailherkenning en een beltimeout."""
    from twilio.rest import Client as TwilioClient

    spec = lees_opdracht(call_id)
    van = os.getenv("TWILIO_FROM_NUMBER", "")
    sid, token, host = os.getenv("TWILIO_ACCOUNT_SID", ""), os.getenv("TWILIO_AUTH_TOKEN", ""), os.getenv("PUBLIC_HOST", "")
    if spec is None or not (van and sid and token and host):
        return {"gebeld": False, "reden": "bellen is niet volledig geconfigureerd of de opdracht ontbreekt"}
    q = urlencode({"call_id": call_id})
    # Vanaf hier is niet meer zeker of er gebeld is als het proces stopt; zo kan de web-service dat onderscheiden.
    update_opdracht(call_id, twilio_poging=time.time())
    try:
        call = TwilioClient(sid, token).calls.create(
            to=spec["nummer"], from_=van,
            url=f"https://{host}/incoming-call?{q}",
            status_callback=f"https://{host}/status?{q}",
            status_callback_event=["initiated", "ringing", "answered", "completed"],
            status_callback_method="POST",
            machine_detection="Enable",
            async_amd=True,
            async_amd_status_callback=f"https://{host}/amd?{q}",
            timeout=int(os.getenv("BEL_TIMEOUT_SECS", "30")),
        )
    except Exception as e:
        logger.error(f"Bellen mislukt voor opdracht {call_id}: {type(e).__name__}")
        # Een foutantwoord van Twilio betekent dat er niet gebeld is; een time-out of netwerkfout laat dat in het midden.
        afgewezen = type(e).__name__ == "TwilioRestException"
        update_opdracht(call_id, status="mislukt", fout=type(e).__name__, twilio_afgewezen=afgewezen)
        return {"gebeld": False, "reden": "Twilio-aanroep mislukt", "onzeker": not afgewezen}
    update_opdracht(call_id, status="belt", twilio_sid=call.sid, gebeld_om=time.time())
    logger.info(f"Gesprek gestart (opdracht {call_id}, sid {call.sid})")
    return {"gebeld": True, "call_id": call_id}


# Uitkomsten die de web-service kent. 'onderbroken': het gesprek is afgebroken zonder eigen uitkomst (herstart, crash).
WEB_STATUSSEN = {"belt", "gesprek", "gesproken", "niet_bereikt", "voicemail", "mislukt", "onderbroken"}
EIND_STATUSSEN = WEB_STATUSSEN - {"belt", "gesprek"}


def _verstuur(web_id: str, body: dict) -> bool:
    import httpx

    url, sleutel = os.getenv("WEB_CALLBACK_URL", "").rstrip("/"), os.getenv("WEB_SERVICE_KEY", "")
    try:
        r = httpx.post(f"{url}/api/intern/calls/{web_id}/resultaat", json=body, headers={"x-service-key": sleutel, "x-correlation-id": web_id}, timeout=10)
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning(f"Terugmelden aan web-service mislukt (web_call_id {web_id}): {type(e).__name__}")
        return False


def rapporteer(call_id: str, status: str, **extra) -> bool:
    """Meldt de uitkomst van een gesprek aan de web-service (dagboek). Een definitieve uitkomst die niet aankomt (web-service in deploy)
    gaat in de outbox van de opdracht en wordt herhaald door `herhaal_rapporten`; de web-service negeert herhalingen.
    Geeft True terug als de web-service het heeft aangenomen."""
    spec = lees_opdracht(call_id)
    url, sleutel = os.getenv("WEB_CALLBACK_URL", "").rstrip("/"), os.getenv("WEB_SERVICE_KEY", "")
    web_id = (spec or {}).get("web_call_id", "")
    if not (spec and web_id and url and sleutel) or status not in WEB_STATUSSEN:
        return False
    body = {"status": status, **{k: v for k, v in extra.items() if v is not None}}
    if _verstuur(web_id, body):
        if status in EIND_STATUSSEN:
            update_opdracht(call_id, eind_gemeld=status)
        if status in ("gesproken", "onderbroken"):
            _wis_transcript(call_id)
        return True
    if status in EIND_STATUSSEN:
        with _LOCK:
            open_ = (lees_opdracht(call_id) or {}).get("rapport_open", [])
            update_opdracht(call_id, eind_gemeld=status, rapport_open=[*open_, body])
    return False


def _wis_transcript(call_id: str) -> None:
    """Zodra de web-service het transcript heeft aangenomen is dat de enige blijvende kopie: het bestand op de data-schijf wordt gewist.
    Mislukt het wissen, dan blijft de bewaartermijn (opschoning op leeftijd) als vangnet."""
    spec = lees_opdracht(call_id) or {}
    naam = Path(str(spec.get("transcript") or "")).name
    try:
        if naam:
            (Path(config.DATA_DIR) / "transcripten" / naam).unlink(missing_ok=True)
        wis_checkpoint(call_id)
        update_opdracht(call_id, transcript=None, transcript_gewist=time.time())
    except OSError as e:
        logger.warning(f"Transcript wissen na melding mislukt (opdracht {call_id}): {type(e).__name__}")


def herhaal_rapporten() -> int:
    """Verstuurt opnieuw wat eerder niet aankwam. Geeft het aantal alsnog afgeleverde meldingen terug."""
    verstuurd = 0
    for pad in list(_map().glob("*.json")):
        spec = lees_opdracht(pad.stem)
        if not spec or not spec.get("rapport_open") or not spec.get("web_call_id"):
            continue
        rest = list(spec["rapport_open"])
        while rest and _verstuur(spec["web_call_id"], rest[0]):
            afgeleverd = rest.pop(0)
            verstuurd += 1
            if afgeleverd.get("status") in ("gesproken", "onderbroken"):
                _wis_transcript(pad.stem)
        update_opdracht(pad.stem, rapport_open=rest)
    return verstuurd


def _checkpoint_pad(call_id: str) -> Path:
    pad = Path(config.DATA_DIR) / "transcripten"
    pad.mkdir(parents=True, exist_ok=True)
    return pad / f"checkpoint-{call_id}.json"


def schrijf_checkpoint(call_id: str, berichten: list[dict]) -> None:
    """Tussentijds (gemaskeerd) transcript, zodat een afgebroken gesprek niet alles kwijtraakt. Het eindtranscript vervangt dit."""
    if _CALL_ID.match(call_id or ""):
        _schrijf(_checkpoint_pad(call_id), {"call_id": call_id, "messages": berichten})


def wis_checkpoint(call_id: str) -> None:
    if _CALL_ID.match(call_id or ""):
        _checkpoint_pad(call_id).unlink(missing_ok=True)


def herstel_opdrachten(nu: float | None = None) -> int:
    """Meldt gesprekken die zijn blijven hangen in 'belt'/'gesprek' (proces gestopt tijdens het gesprek) als 'onderbroken',
    met het laatste tussentijdse transcript. Het gesprek zelf wordt nooit opnieuw gebeld."""
    nu = time.time() if nu is None else nu
    n = 0
    for pad in list(_map().glob("*.json")):
        spec = lees_opdracht(pad.stem)
        if not spec or spec.get("status") not in ("belt", "gesprek", "gesproken") or spec.get("eind_gemeld") or not spec.get("web_call_id"):
            continue
        if nu - spec.get("bijgewerkt", spec.get("aangemaakt", nu)) < ONDERBROKEN_NA_SECS:
            continue
        if spec["status"] == "gesproken":
            # Proces stopte nadat het gesprek was afgelopen maar vóór de melding: lever het eindtranscript alsnog af.
            try:
                eind = json.loads((Path(config.DATA_DIR) / "transcripten" / Path(str(spec.get("transcript", ""))).name).read_text(encoding="utf-8"))
                tr = [{"role": m["role"], "content": m["content"]} for m in eind.get("messages", []) if m.get("role") in ("assistant", "user") and isinstance(m.get("content"), str)]
            except (OSError, ValueError):
                tr = None
            rapporteer(spec["call_id"], "gesproken", transcript=tr)
            n += 1
            continue
        transcript = None
        try:
            cp = json.loads(_checkpoint_pad(spec["call_id"]).read_text(encoding="utf-8"))
            transcript = [{"role": m["role"], "content": m["content"]} for m in cp.get("messages", []) if m.get("role") in ("assistant", "user") and isinstance(m.get("content"), str)]
        except (OSError, ValueError):
            pass
        update_opdracht(spec["call_id"], status="onderbroken")
        rapporteer(spec["call_id"], "onderbroken", fout="Gesprek afgebroken zonder uitkomst", transcript=transcript)
        n += 1
    return n
