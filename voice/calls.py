"""Gespreksopdrachten en uitgaand bellen via Twilio.

Een opdracht (`CallSpec`) staat als JSON in DATA_DIR/_calls/<call_id>.json en wordt door de pipeline gelezen aan de hand
van het call_id dat als <Parameter> meekomt. Zo hoeft er geen gespreksinhoud in een URL. De uurlimiet telt de opdrachten van
het afgelopen uur, dus hij overleeft een herstart (Inwoner.AI hield die tellers in het geheugen).
"""
import json
import os
import re
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


def normaliseer_nl_nummer(ruw: str) -> str | None:
    cijfers = re.sub(r"[\s\-().]", "", ruw or "")
    m = _NL_NUMMER.match(cijfers)
    return f"+31{m.group(1)}" if m else None


def _map() -> Path:
    pad = Path(config.DATA_DIR) / "_calls"
    pad.mkdir(parents=True, exist_ok=True)
    return pad


def maak_opdracht(nummer: str, medewerker: str, onderwerpen: list[dict], toestemming_nodig: bool = True, web_call_id: str = "") -> str:
    call_id = uuid.uuid4().hex
    spec = {
        "call_id": call_id, "nummer": nummer, "medewerker": medewerker, "onderwerpen": onderwerpen,
        "toestemming_nodig": toestemming_nodig, "web_call_id": web_call_id, "aangemaakt": time.time(),
    }
    (_map() / f"{call_id}.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    return call_id


def lees_opdracht(call_id: str) -> dict | None:
    if not _CALL_ID.match(call_id or ""):
        return None
    pad = _map() / f"{call_id}.json"
    return json.loads(pad.read_text(encoding="utf-8")) if pad.exists() else None


def update_opdracht(call_id: str, **velden) -> None:
    spec = lees_opdracht(call_id)
    if spec is None:
        return
    spec.update(velden)
    (_map() / f"{call_id}.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")


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


def start_gesprek(call_id: str) -> dict:
    """Start het gesprek bij Twilio, met statuscallback, voicemailherkenning en een beltimeout."""
    from twilio.rest import Client as TwilioClient

    spec = lees_opdracht(call_id)
    van = os.getenv("TWILIO_FROM_NUMBER", "")
    sid, token, host = os.getenv("TWILIO_ACCOUNT_SID", ""), os.getenv("TWILIO_AUTH_TOKEN", ""), os.getenv("PUBLIC_HOST", "")
    if spec is None or not (van and sid and token and host):
        return {"gebeld": False, "reden": "bellen is niet volledig geconfigureerd of de opdracht ontbreekt"}
    q = urlencode({"call_id": call_id})
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
        logger.error(f"Bellen mislukt voor opdracht {call_id}: {type(e).__name__}: {e}")
        update_opdracht(call_id, status="mislukt", fout=type(e).__name__)
        return {"gebeld": False, "reden": "Twilio-aanroep mislukt"}
    update_opdracht(call_id, status="belt", twilio_sid=call.sid, gebeld_om=time.time())
    logger.info(f"Gesprek gestart (opdracht {call_id}, sid {call.sid})")
    return {"gebeld": True, "call_id": call_id}


# Uitkomsten die de web-service als definitief beschouwt; alleen daarvoor wordt `afgerond_om` gezet.
WEB_STATUSSEN = {"belt", "gesprek", "gesproken", "niet_bereikt", "voicemail", "mislukt"}


def rapporteer(call_id: str, status: str, **extra) -> bool:
    """Meldt de uitkomst van een gesprek aan de web-service (dagboek). Mislukt dit, dan blijft het gesprek zelf ongemoeid:
    de opdracht en het transcript staan ook op het volume. Geeft True terug als de web-service het heeft aangenomen."""
    import httpx

    spec = lees_opdracht(call_id)
    url, sleutel = os.getenv("WEB_CALLBACK_URL", "").rstrip("/"), os.getenv("WEB_SERVICE_KEY", "")
    web_id = (spec or {}).get("web_call_id", "")
    if not (spec and web_id and url and sleutel) or status not in WEB_STATUSSEN:
        return False
    body = {"status": status, **{k: v for k, v in extra.items() if v is not None}}
    try:
        r = httpx.post(f"{url}/api/intern/calls/{web_id}/resultaat", json=body, headers={"x-service-key": sleutel}, timeout=10)
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning(f"Terugmelden aan web-service mislukt voor opdracht {call_id}: {type(e).__name__}: {e}")
        return False
