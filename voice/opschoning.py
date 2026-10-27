"""Bewaartermijn voor wat de voice-service op de data-schijf bewaart: transcripten en gespreksopdrachten (bevatten telefoonnummer)."""
import time
from pathlib import Path

from loguru import logger

import config

MAPPEN = ("transcripten", "_calls")


def ruim_op(dagen: int | None = None, nu: float | None = None) -> int:
    dagen = config.TRANSCRIPT_BEWAAR_DAGEN if dagen is None else dagen
    if dagen < 1:
        return 0
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
                logger.warning(f"Opschonen van {pad.name} mislukt: {e}")
    if gewist:
        logger.info(f"{gewist} bestand(en) ouder dan {dagen} dagen gewist")
    return gewist
