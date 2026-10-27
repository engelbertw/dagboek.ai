import time

import calls


def test_nummers_worden_genormaliseerd():
    assert calls.normaliseer_nl_nummer("06 12345678") == "+31612345678"
    assert calls.normaliseer_nl_nummer("+31 (0)6-12345678") is None  # (0) na landcode wordt bewust niet geraden
    assert calls.normaliseer_nl_nummer("0031612345678") == "+31612345678"
    assert calls.normaliseer_nl_nummer("020 1234567") == "+31201234567"
    assert calls.normaliseer_nl_nummer("12345") is None
    assert calls.normaliseer_nl_nummer("") is None


def test_opdracht_roundtrip_en_ongeldig_id():
    cid = calls.maak_opdracht("+31612345678", "Daan", [{"titel": "X"}])
    assert calls.lees_opdracht(cid)["medewerker"] == "Daan"
    calls.update_opdracht(cid, status="belt")
    assert calls.lees_opdracht(cid)["status"] == "belt"
    assert calls.lees_opdracht("../../etc/passwd") is None
    assert calls.lees_opdracht("0" * 32) is None


def test_zelfde_nummer_niet_binnen_vijf_minuten(monkeypatch):
    cid = calls.maak_opdracht("+31612345678", "Daan", [])
    calls.update_opdracht(cid, gebeld_om=time.time())
    mag, reden = calls.mag_bellen("+31612345678")
    assert not mag and "recent" in reden
    assert calls.mag_bellen("+31687654321")[0]
    assert calls.mag_bellen("+31612345678", nu=time.time() + 400)[0]


def test_uurlimiet_overleeft_herstart(monkeypatch):
    monkeypatch.setattr(calls, "MAX_PER_UUR", 2)
    for nummer in ("+31611111111", "+31622222222"):
        cid = calls.maak_opdracht(nummer, "X", [])
        calls.update_opdracht(cid, gebeld_om=time.time())
    mag, reden = calls.mag_bellen("+31633333333")
    assert not mag and "uurlimiet" in reden
    assert calls.mag_bellen("+31633333333", nu=time.time() + 3700)[0]


def test_start_gesprek_zonder_config_belt_niet(monkeypatch):
    for k in ("TWILIO_FROM_NUMBER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "PUBLIC_HOST"):
        monkeypatch.delenv(k, raising=False)
    cid = calls.maak_opdracht("+31612345678", "Daan", [])
    assert calls.start_gesprek(cid)["gebeld"] is False


def test_rapporteer_stuurt_status_met_servicesleutel(monkeypatch):
    import httpx

    verstuurd = {}

    class Antwoord:
        def raise_for_status(self): pass

    def nep_post(url, json=None, headers=None, timeout=None):
        verstuurd.update(url=url, json=json, headers=headers)
        return Antwoord()

    monkeypatch.setattr(httpx, "post", nep_post)
    monkeypatch.setenv("WEB_CALLBACK_URL", "https://dagboek.test/")
    monkeypatch.setenv("WEB_SERVICE_KEY", "sleutel")
    cid = calls.maak_opdracht("+31612345678", "Daan", [], web_call_id="abc-123")
    assert calls.rapporteer(cid, "gesproken", transcript=[{"role": "user", "content": "hoi"}], fout=None) is True
    assert verstuurd["url"] == "https://dagboek.test/api/intern/calls/abc-123/resultaat"
    assert verstuurd["headers"] == {"x-service-key": "sleutel"}
    assert verstuurd["json"] == {"status": "gesproken", "transcript": [{"role": "user", "content": "hoi"}]}


def test_rapporteer_zonder_web_id_of_config_doet_niets(monkeypatch):
    monkeypatch.setenv("WEB_CALLBACK_URL", "https://dagboek.test")
    monkeypatch.setenv("WEB_SERVICE_KEY", "sleutel")
    assert calls.rapporteer(calls.maak_opdracht("+31612345678", "D", []), "gesproken") is False
    monkeypatch.delenv("WEB_SERVICE_KEY")
    assert calls.rapporteer(calls.maak_opdracht("+31612345678", "D", [], web_call_id="x"), "gesproken") is False


def test_rapporteer_vangt_netwerkfouten_af(monkeypatch):
    import httpx

    def stuk(*a, **k): raise httpx.ConnectError("nee")

    monkeypatch.setattr(httpx, "post", stuk)
    monkeypatch.setenv("WEB_CALLBACK_URL", "https://dagboek.test")
    monkeypatch.setenv("WEB_SERVICE_KEY", "sleutel")
    cid = calls.maak_opdracht("+31612345678", "D", [], web_call_id="x")
    assert calls.rapporteer(cid, "voicemail") is False
