"""Logconfiguratie: zonder gespreksinhoud, telefoonnummers of sleutels in de logs.

Pipecat logt op DEBUG de gesproken tekst (STT, TTS) en de volledige systeemprompt (met onderwerpen en open punten). Dat hoort niet in
de logs van het platform: eigen meldingen gaan op INFO, pipecat alleen op WARNING of hoger, en alles gaat door een masker.
Elke regel heeft een correlatie-id (het call-id van de web-service) om een gesprek van planning tot samenvatting te kunnen volgen."""
import os
import re
import sys

from loguru import logger

_PATRONEN: list[tuple[re.Pattern, str]] = [
    (re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE), "Bearer [token]"),
    (re.compile(r"\b(?:sk|xi)[-_][A-Za-z0-9_-]{16,}\b"), "[sleutel]"),
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[e-mail]"),
    (re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b"), "[iban]"),
    (re.compile(r"(?:\+|\b00)\d{1,3}[\s-]?\(?\d?\)?(?:[\s-]?\d){7,11}\b"), "[tel]"),
    (re.compile(r"\b0\d{1,2}(?:[\s-]?\d){7,9}\b"), "[tel]"),
    (re.compile(r"(?<![\w-])\d{9}(?![\w-])"), "[nummer]"),  # onder meer een BSN
]


def maskeer_log(tekst: str) -> str:
    for patroon, vervanging in _PATRONEN:
        tekst = patroon.sub(vervanging, tekst)
    return tekst


def _patch(record) -> None:
    record["message"] = maskeer_log(record["message"])


def _filter(record) -> bool:
    if record["name"].startswith("pipecat"):
        return record["level"].no >= logger.level(os.getenv("PIPECAT_LOG_LEVEL", "WARNING").upper()).no
    return True


def instellen(sink=None) -> None:
    logger.remove()
    logger.configure(extra={"corr": "-"}, patcher=_patch)
    logger.add(
        sink or sys.stderr, level=os.getenv("LOG_LEVEL", "INFO").upper(), filter=_filter,
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <7} | {extra[corr]} | {name}:{function}:{line} - {message}",
    )
