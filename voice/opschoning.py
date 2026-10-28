"""Bewaartermijn voor wat de voice-service op de data-schijf bewaart: transcripten en gespreksopdrachten (bevatten telefoonnummer)."""
import os
import time
from pathlib import Path

from loguru import logger

import config

MAPPEN = ("transcripten", "_calls")


def ruim_op(dagen: int | None = None, nu: float | None = None) -> int:
    return ruim_op_detail(dagen, nu)[0]


def ruim_op_detail(dagen: int | None = None, nu: float | None = None) -> tuple[int, int]:
    """Wist bestanden ouder dan de bewaartermijn. Geeft (gewist, mislukt) terug."""
    dagen = config.TRANSCRIPT_BEWAAR_DAGEN if dagen is None else dagen
    if dagen < 1:
        return 0, 0
    mislukt = 0
    grens = (time.time() if nu is None else nu) - dagen * 86400
    gewist = 0
    for naam in MAPPEN:
        map_ = Path(config.DATA_DIR) / naam
        if not map_.is_dir():
            continue
        for pad in map_.glob("*.json"):
            try:
                if pad.stat().st_mtime < grens:
                    pad.unlink()
                    gewist += 1
            except OSError as e:
                mislukt += 1
                logger.warning(f"Opschonen van {pad.name} mislukt: {type(e).__name__}")
    if gewist or mislukt:
        logger.info(f"{gewist} bestand(en) ouder dan {dagen} dagen gewist, {mislukt} mislukt")
    return gewist, mislukt


def meld_run(gewist: int, mislukt: int, foutcode: str = "") -> bool:
    """Meldt het resultaat van een opschoonronde aan de web-service, zodat een beheerder kan zien dat het draait (of niet).
    Alleen aantallen en een foutcode (klassenaam): nooit bestandsnamen, inhoud of foutmeldingen."""
    import httpx

    url, sleutel = os.getenv("WEB_CALLBACK_URL", "").rstrip("/"), os.getenv("WEB_SERVICE_KEY", "")
    if not (url and sleutel):
        return False
    try:
        r = httpx.post(f"{url}/api/intern/opschoning", json={"gewist": gewist, "mislukt": mislukt, "foutcode": foutcode[:60]},
                       headers={"x-service-key": sleutel}, timeout=10)
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning(f"Opschoonresultaat melden mislukt: {type(e).__name__}")
        return False
