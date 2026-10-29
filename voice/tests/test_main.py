import pytest
from fastapi.testclient import TestClient

import calls
import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "TWILIO_AUTH_TOKEN", "")
    monkeypatch.setattr(main, "WS_TOKEN", "geheim")
    monkeypatch.setattr(main, "PUBLIC_HOST", "voorbeeld.test")
    return TestClient(main.app)


def test_incoming_call_zonder_opdracht_wordt_geweigerd(client):
    assert client.post("/incoming-call?call_id=" + "0" * 32).status_code == 404
    assert client.post("/incoming-call").status_code == 404


def test_incoming_call_geeft_stream_met_call_id_en_token(client):
    cid = calls.maak_opdracht("+31612345678", "Daan", [])
    r = client.post(f"/incoming-call?call_id={cid}")
    assert r.status_code == 200
    assert f'<Parameter name="call_id" value="{cid}"' in r.text
    assert '<Parameter name="token" value="geheim"' in r.text
    assert "wss://voorbeeld.test/ws" in r.text


def test_status_zonder_antwoord_wordt_niet_bereikt(client):
    cid = calls.maak_opdracht("+31612345678", "Daan", [])
    client.post(f"/status?call_id={cid}", data={"CallStatus": "no-answer"})
    assert calls.lees_opdracht(cid)["status"] == "niet_bereikt"


def test_voicemail_legt_op(client, monkeypatch):
    opgehangen = []
    monkeypatch.setattr(main, "_hang_op", opgehangen.append)
    cid = calls.maak_opdracht("+31612345678", "Daan", [])
    calls.update_opdracht(cid, twilio_sid="CA123")
    client.post(f"/amd?call_id={cid}", data={"AnsweredBy": "machine_end_beep"})
    assert opgehangen == ["CA123"]
    assert calls.lees_opdracht(cid)["status"] == "voicemail"


def test_mens_wordt_niet_opgehangen(client, monkeypatch):
    opgehangen = []
    monkeypatch.setattr(main, "_hang_op", opgehangen.append)
    cid = calls.maak_opdracht("+31612345678", "Daan", [])
    calls.update_opdracht(cid, twilio_sid="CA123")
    client.post(f"/amd?call_id={cid}", data={"AnsweredBy": "human"})
    assert opgehangen == []


def test_bel_vereist_admin_token(client, monkeypatch):
    monkeypatch.setattr(main, "ADMIN_TOKEN", "")
    body = {"telefoonnummer": "0612345678", "medewerker": "Daan"}
    assert client.post("/bel", json=body).status_code == 401
    monkeypatch.setattr(main, "ADMIN_TOKEN", "sleutel")
    assert client.post("/bel", json=body).status_code == 401
    assert client.post("/bel", json=body, headers={"Authorization": "Bearer fout"}).status_code == 401
    monkeypatch.setattr(calls, "start_gesprek", lambda cid: {"gebeld": True, "call_id": cid})
    r = client.post("/bel", json=body, headers={"Authorization": "Bearer sleutel"})
    assert r.status_code == 200 and r.json()["gebeld"] is True


# ── /bel is idempotent op web_call_id ───────────────────────────────────────

def _bel_opzet(monkeypatch):
    monkeypatch.setattr(main, "ADMIN_TOKEN", "admin")
    gebeld = []

    def nep_start(call_id):
        gebeld.append(call_id)
        calls.update_opdracht(call_id, twilio_sid="CA1", gebeld_om=__import__("time").time())
        return {"gebeld": True, "call_id": call_id}

    monkeypatch.setattr(calls, "start_gesprek", nep_start)
    return gebeld


BODY = {"telefoonnummer": "0612345678", "medewerker": "Daan", "web_call_id": "web-abc", "onderwerpen": []}
KOP = {"authorization": "Bearer admin"}


def test_bel_twee_keer_met_zelfde_sleutel_belt_een_keer(client, monkeypatch):
    gebeld = _bel_opzet(monkeypatch)
    eerste = client.post("/bel", json=BODY, headers=KOP).json()
    tweede = client.post("/bel", json=BODY, headers=KOP).json()
    assert eerste["gebeld"] is True and tweede == eerste
    assert len(gebeld) == 1


def test_bel_herhaling_na_weigering_blijft_geweigerd_en_belt_niet(client, monkeypatch):
    gebeld = _bel_opzet(monkeypatch)
    cid = calls.maak_opdracht("+31612345678", "X", [])
    calls.update_opdracht(cid, gebeld_om=__import__("time").time())  # nummer is net gebeld
    a = client.post("/bel", json=BODY, headers=KOP).json()
    b = client.post("/bel", json=BODY, headers=KOP).json()
    assert a["gebeld"] is False and b["gebeld"] is False and b["onzeker"] is False
    assert gebeld == []


def test_bel_na_crash_tussen_claim_en_twilio_belt_niet_automatisch_opnieuw(client, monkeypatch):
    gebeld = _bel_opzet(monkeypatch)
    nieuw, cid = calls.claim_web_call("web-abc")  # eerder proces claimde en stierf
    calls.maak_opdracht("+31612345678", "Daan", [], web_call_id="web-abc", call_id=cid)
    calls.update_opdracht(cid, twilio_poging=__import__("time").time())
    r = client.post("/bel", json=BODY, headers=KOP).json()
    assert r["gebeld"] is False and r["onzeker"] is True
    assert gebeld == []


def test_bel_opzoeken(client, monkeypatch):
    _bel_opzet(monkeypatch)
    assert client.get("/bel/web-abc", headers=KOP).status_code == 404
    assert client.get("/bel/web-abc").status_code == 401
    client.post("/bel", json=BODY, headers=KOP)
    r = client.get("/bel/web-abc", headers=KOP).json()
    assert r["gebeld"] is True and r["onzeker"] is False


def test_bel_tijdens_herstart_wordt_geweigerd(client, monkeypatch):
    gebeld = _bel_opzet(monkeypatch)
    monkeypatch.setattr(main, "DRAINING", True)
    assert client.post("/bel", json=BODY, headers=KOP).status_code == 503
    assert gebeld == []


def test_ongeldige_sleutel_belt_niet(client, monkeypatch):
    gebeld = _bel_opzet(monkeypatch)
    r = client.post("/bel", json={**BODY, "web_call_id": "../etc"}, headers=KOP).json()
    assert r["gebeld"] is False and gebeld == []


def test_late_status_draait_een_lopend_gesprek_niet_terug(client):
    cid = calls.maak_opdracht("+31612345678", "Daan", [])
    calls.update_opdracht(cid, status="gesprek")
    client.post(f"/status?call_id={cid}", data={"CallStatus": "no-answer"})
    assert calls.lees_opdracht(cid)["status"] == "gesprek"


# ── liveness en readiness ────────────────────────────────────────────────────

ENV = ("ADMIN_TOKEN", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "PUBLIC_HOST", "WEB_CALLBACK_URL", "WEB_SERVICE_KEY",
       "TSYSTEMS_API_KEY", "TSYSTEMS_BASE_URL", "ELEVENLABS_API_KEY")


def test_health_is_altijd_ok_ook_bij_herstart_en_zonder_configuratie(client, monkeypatch):
    for k in ENV:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(main, "DRAINING", True)
    assert client.get("/health").json() == {"ok": True}


def test_ready_is_ok_met_schijf_en_configuratie(client, monkeypatch):
    for k in ENV:
        monkeypatch.setenv(k, "x")
    r = client.get("/ready")
    assert r.status_code == 200 and r.json() == {"ok": True, "checks": {"data_schijf": "ok", "configuratie": "ok", "herstart": "ok"}}


def test_ready_geeft_503_bij_ontbrekende_configuratie_herstart_of_onbeschrijfbare_schijf(client, monkeypatch):
    for k in ENV:
        monkeypatch.setenv(k, "x")
    monkeypatch.delenv("TWILIO_AUTH_TOKEN")
    r = client.get("/ready")
    assert r.status_code == 503 and r.json()["checks"]["configuratie"] == "fout"
    assert "x" not in {v for v in r.json()["checks"].values() if v not in ("ok", "fout")}  # geen waarden of namen van geheimen
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "x")
    monkeypatch.setattr(main, "DRAINING", True)
    assert client.get("/ready").json()["checks"]["herstart"] == "fout"
    monkeypatch.setattr(main, "DRAINING", False)
    monkeypatch.setattr(main, "_data_schijf_schrijfbaar", lambda: False)
    assert client.get("/ready").status_code == 503


def test_ready_belt_geen_externe_diensten(client, monkeypatch):
    for k in ENV:
        monkeypatch.setenv(k, "x")
    import httpx
    monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("extern netwerk")))
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("extern netwerk")))
    assert client.get("/ready").status_code == 200


def test_elevenlabs_webhook_vereist_geldige_handtekening(client, monkeypatch):
    import hashlib, hmac, json, time
    monkeypatch.setenv("ELEVENLABS_WEBHOOK_SECRET", "geheim")
    body = json.dumps({"type": "post_call_transcription", "data": {"conversation_id": "onbekend"}}).encode()
    assert client.post("/elevenlabs/webhook", content=body).status_code == 401
    assert client.post("/elevenlabs/webhook", content=body, headers={"elevenlabs-signature": "t=1,v0=00"}).status_code == 401
    t = int(time.time())
    sig = hmac.new(b"geheim", f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    assert client.post("/elevenlabs/webhook", content=body, headers={"elevenlabs-signature": f"t={t},v0={sig}"}).status_code == 200


def test_bel_accepteert_twintig_onderwerpen_en_weigert_eenentwintig():
    from main import BelVerzoek
    from pydantic import ValidationError
    basis = {"telefoonnummer": "+31612345678", "medewerker": "Daan"}
    assert len(BelVerzoek(**basis, onderwerpen=[{"titel": f"t{i}"} for i in range(20)]).onderwerpen) == 20
    try:
        BelVerzoek(**basis, onderwerpen=[{"titel": f"t{i}"} for i in range(21)])
        assert False, "21 onderwerpen hadden geweigerd moeten worden"
    except ValidationError:
        pass
