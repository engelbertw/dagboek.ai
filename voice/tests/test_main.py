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
