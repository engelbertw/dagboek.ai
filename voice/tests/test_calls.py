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
    assert verstuurd["headers"] == {"x-service-key": "sleutel", "x-correlation-id": "abc-123"}
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


# ── Idempotentie, outbox en herstel ──────────────────────────────────────────

def test_claim_web_call_geeft_bij_herhaling_hetzelfde_call_id():
    nieuw, cid = calls.claim_web_call("web-1")
    assert nieuw
    nieuw2, cid2 = calls.claim_web_call("web-1")
    assert not nieuw2 and cid2 == cid
    assert calls.claim_web_call("web-2")[1] != cid


def test_claim_weigert_onveilige_sleutels():
    import pytest
    for slecht in ("../x", "a/b", "", "x" * 65, "a b"):
        with pytest.raises(ValueError):
            calls.claim_web_call(slecht)


def test_gelijktijdige_claims_hebben_precies_een_winnaar():
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(20) as pool:
        uitkomsten = list(pool.map(lambda _: calls.claim_web_call("race"), range(40)))
    assert sum(1 for nieuw, _ in uitkomsten if nieuw) == 1
    assert len({cid for _, cid in uitkomsten}) == 1


def test_opzoeken_onderscheidt_zeker_niet_gebeld_van_onzeker():
    assert calls.opzoeken("nooit") is None
    _, cid = calls.claim_web_call("a")
    assert calls.opzoeken("a") == {"call_id": cid, "gebeld": False, "onzeker": False}  # crash vóór de spec: zeker niet gebeld
    calls.maak_opdracht("+31612345678", "D", [], web_call_id="a", call_id=cid)
    assert calls.opzoeken("a")["onzeker"] is False
    calls.update_opdracht(cid, twilio_poging=time.time())
    assert calls.opzoeken("a") == {"call_id": cid, "gebeld": False, "onzeker": True}  # Twilio-aanroep gestart, uitkomst onbekend
    calls.update_opdracht(cid, twilio_sid="CA1")
    assert calls.opzoeken("a") == {"call_id": cid, "gebeld": True, "onzeker": False}


def test_twilio_fout_wordt_geclassificeerd(monkeypatch):
    class TwilioRestException(Exception): pass
    class Boem(Exception): pass

    def nep(exc):
        class Calls:
            def create(self, **kw): raise exc
        class Client:
            def __init__(self, *a): self.calls = Calls()
        return Client

    import sys, types
    for k, v in {"TWILIO_FROM_NUMBER": "+31000000000", "TWILIO_ACCOUNT_SID": "AC", "TWILIO_AUTH_TOKEN": "t", "PUBLIC_HOST": "h"}.items():
        monkeypatch.setenv(k, v)
    for exc, onzeker in ((TwilioRestException("401 +31612345678"), False), (Boem("timeout"), True)):
        mod = types.ModuleType("twilio.rest"); mod.Client = nep(exc)
        monkeypatch.setitem(sys.modules, "twilio.rest", mod)
        _, cid = calls.claim_web_call(f"t{onzeker}")
        calls.maak_opdracht("+31612345678", "D", [], web_call_id=f"t{onzeker}", call_id=cid)
        r = calls.start_gesprek(cid)
        assert r["gebeld"] is False and r["onzeker"] is onzeker
        assert calls.opzoeken(f"t{onzeker}")["onzeker"] is onzeker


def _met_web(monkeypatch, verzonden, ok=True):
    import httpx

    class Antwoord:
        def raise_for_status(self):
            if not ok:
                raise httpx.ConnectError("web ligt er even uit")

    def nep_post(url, json=None, headers=None, timeout=None):
        verzonden.append((url, json))
        return Antwoord()

    monkeypatch.setattr(httpx, "post", nep_post)
    monkeypatch.setenv("WEB_CALLBACK_URL", "https://web.test")
    monkeypatch.setenv("WEB_SERVICE_KEY", "sleutel")


def test_mislukte_eindmelding_gaat_in_de_outbox_en_wordt_herhaald(monkeypatch):
    verzonden: list = []
    _met_web(monkeypatch, verzonden, ok=False)
    cid = calls.maak_opdracht("+31612345678", "D", [], web_call_id="w1")
    assert calls.rapporteer(cid, "gesproken", transcript=[{"role": "user", "content": "hoi"}]) is False
    assert calls.lees_opdracht(cid)["rapport_open"][0]["status"] == "gesproken"
    _met_web(monkeypatch, verzonden, ok=True)
    assert calls.herhaal_rapporten() == 1
    assert calls.lees_opdracht(cid)["rapport_open"] == []
    assert verzonden[-1][1]["transcript"] == [{"role": "user", "content": "hoi"}]
    assert calls.herhaal_rapporten() == 0  # niet nogmaals


def test_tussenstatus_die_niet_aankomt_wordt_niet_bewaard(monkeypatch):
    _met_web(monkeypatch, [], ok=False)
    cid = calls.maak_opdracht("+31612345678", "D", [], web_call_id="w2")
    calls.rapporteer(cid, "gesprek")
    assert not calls.lees_opdracht(cid).get("rapport_open")


def test_herstel_meldt_afgebroken_gesprek_als_onderbroken_met_checkpoint(monkeypatch):
    verzonden: list = []
    _met_web(monkeypatch, verzonden)
    cid = calls.maak_opdracht("+31612345678", "D", [], web_call_id="w3")
    calls.update_opdracht(cid, status="gesprek")
    calls.schrijf_checkpoint(cid, [{"role": "assistant", "content": "Hallo"}, {"role": "user", "content": "Dag"}])
    assert calls.herstel_opdrachten() == 0  # nog jong: een gesprek kan nog lopen
    assert calls.herstel_opdrachten(nu=time.time() + calls.ONDERBROKEN_NA_SECS + 5) == 1
    assert verzonden[-1][1]["status"] == "onderbroken"
    assert verzonden[-1][1]["transcript"] == [{"role": "assistant", "content": "Hallo"}, {"role": "user", "content": "Dag"}]
    assert calls.lees_opdracht(cid)["status"] == "onderbroken"
    assert calls.herstel_opdrachten(nu=time.time() + 99999) == 0  # eenmaal gemeld


def test_herstel_levert_eindtranscript_dat_nooit_gemeld_werd(monkeypatch, data_dir):
    verzonden: list = []
    _met_web(monkeypatch, verzonden)
    cid = calls.maak_opdracht("+31612345678", "D", [], web_call_id="w4")
    (data_dir / "transcripten").mkdir()
    (data_dir / "transcripten" / "t.json").write_text('{"messages":[{"role":"system","content":"geheim"},{"role":"user","content":"ja"}]}')
    calls.update_opdracht(cid, status="gesproken", transcript="t.json")
    calls.herstel_opdrachten(nu=time.time() + calls.ONDERBROKEN_NA_SECS + 5)
    assert verzonden[-1][1] == {"status": "gesproken", "transcript": [{"role": "user", "content": "ja"}]}


def test_schrijven_van_de_opdracht_is_atomair(data_dir):
    from concurrent.futures import ThreadPoolExecutor
    cid = calls.maak_opdracht("+31612345678", "D", [])
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda i: calls.update_opdracht(cid, **{f"veld{i}": i}), range(40)))
        for _ in range(50):
            assert calls.lees_opdracht(cid) is not None  # nooit een half bestand
    spec = calls.lees_opdracht(cid)
    assert all(spec[f"veld{i}"] == i for i in range(40))  # geen verloren updates
    assert not list((data_dir / "_calls").glob(".*.tmp"))


def test_transcript_op_schijf_wordt_gewist_zodra_de_web_service_het_heeft(monkeypatch, data_dir):
    _met_web(monkeypatch, [])
    (data_dir / "transcripten").mkdir()
    bestand = data_dir / "transcripten" / "t.json"
    bestand.write_text("{}")
    cid = calls.maak_opdracht("+31612345678", "D", [], web_call_id="w9")
    calls.update_opdracht(cid, transcript="t.json")
    calls.schrijf_checkpoint(cid, [{"role": "user", "content": "x"}])
    assert calls.rapporteer(cid, "gesproken", transcript=[]) is True
    assert not bestand.exists() and not (data_dir / "transcripten" / f"checkpoint-{cid}.json").exists()


def test_transcript_blijft_staan_zolang_de_web_service_het_niet_heeft_en_wordt_daarna_gewist(monkeypatch, data_dir):
    _met_web(monkeypatch, [], ok=False)
    (data_dir / "transcripten").mkdir()
    bestand = data_dir / "transcripten" / "t.json"
    bestand.write_text("{}")
    cid = calls.maak_opdracht("+31612345678", "D", [], web_call_id="w10")
    calls.update_opdracht(cid, transcript="t.json")
    assert calls.rapporteer(cid, "gesproken", transcript=[]) is False
    assert bestand.exists()  # nog niet afgeleverd: de enige kopie blijft bewaard
    _met_web(monkeypatch, [], ok=True)
    assert calls.herhaal_rapporten() == 1
    assert not bestand.exists()
