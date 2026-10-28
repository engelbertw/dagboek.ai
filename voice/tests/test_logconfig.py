import logconfig
from loguru import logger


def test_maskeert_telefoon_bsn_iban_token_en_mail():
    tekst = ("Bellen naar +31612345678 en 06-12345678 of 020 1234567, bsn 111222333, rekening NL91 ABNA 0417 1643 00, "
             "Bearer abcdefgh12345678, sleutel sk-abcdefghijklmnop1234, mail jan.jansen@gemeente.nl")
    uit = logconfig.maskeer_log(tekst)
    for geheim in ("612345678", "12345678", "1234567", "111222333", "ABNA", "abcdefgh12345678", "sk-abcdefghijklmnop1234", "jan.jansen"):
        assert geheim not in uit, geheim


def test_laat_correlatie_ids_en_datums_staan():
    for tekst in ("call 8f3a2b1c-1234-5678-9abc-def012345678", "opdracht 0123456789abcdef0123456789abcdef", "slot 2026-10-29 09:00", "poging 2 van 3"):
        assert logconfig.maskeer_log(tekst) == tekst


def test_sink_krijgt_gemaskeerde_berichten_zonder_pipecat_debug():
    regels: list[str] = []
    logconfig.instellen(sink=regels.append)
    try:
        logger.info("Gesprek met +31612345678")
        with logger.contextualize(corr="abc-123"):
            logger.info("Status gewijzigd")
        logger.debug("te gedetailleerd")  # onder INFO: niet getoond
    finally:
        logger.remove()
        logconfig.instellen()
    tekst = "".join(regels)
    assert "612345678" not in tekst and "[tel]" in tekst
    assert "abc-123" in tekst and "te gedetailleerd" not in tekst


def test_pipecat_debug_met_gespreksinhoud_wordt_onderdrukt():
    debug = {"name": "pipecat.services.tts_service", "level": logger.level("DEBUG")}
    warn = {"name": "pipecat.services.tts_service", "level": logger.level("WARNING")}
    eigen = {"name": "calls", "level": logger.level("INFO")}
    assert logconfig._filter(debug) is False
    assert logconfig._filter(warn) is True
    assert logconfig._filter(eigen) is True
