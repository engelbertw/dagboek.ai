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
