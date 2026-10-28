import hashlib
import hmac
import json
import time

import httpx
import pytest

import agent_elevenlabs as agent
import calls


@pytest.fixture(autouse=True)
def omgeving(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent_1")
    monkeypatch.setenv("ELEVENLABS_AGENT_PHONE_NUMBER_ID", "phnum_1")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "xi-test")
    monkeypatch.setenv("WEB_CALLBACK_URL", "http://web.test")
    monkeypatch.setenv("WEB_SERVICE_KEY", "sleutel")


@pytest.fixture
def gemeld(monkeypatch):
    rapporten = []
    monkeypatch.setattr(calls, "_verstuur", lambda web_id, body: rapporten.append((web_id, body)) or True)
    return rapporten


def opdracht(**kw):
    return calls.maak_opdracht("+31612345678", "Rombout", [{"titel": "iKlantgeleiding"}], True, "w" * 8, engine="elevenlabs_agent", **kw)


def test_belverzoek_gebruikt_dezelfde_begroeting_en_prompt_met_end_call():
    cid = opdracht()
    body = agent.bouw_belverzoek(calls.lees_opdracht(cid), "agent_1", "phnum_1")
    ov = body["conversation_initiation_client_data"]["conversation_config_override"]["agent"]
    assert body["to_number"] == "+31612345678" and body["agent_id"] == "agent_1"
    assert "AI-systeem" in ov["first_message"] and "samenvatting" in ov["first_message"]
    assert "`end_call`" in ov["prompt"]["prompt"] and "einde_gesprek" not in ov["prompt"]["prompt"]
    assert ov["language"] == "nl"
    assert body["conversation_initiation_client_data"]["dynamic_variables"]["call_id"] == cid


def test_start_bewaart_conversation_id(monkeypatch):
    cid = opdracht()
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(200, json={"success": True, "conversation_id": "conv_9", "callSid": "CA1"}))
    assert agent.start_gesprek_agent(cid) == {"gebeld": True, "call_id": cid}
    spec = calls.lees_opdracht(cid)
    assert spec["status"] == "belt" and spec["agent_conversation_id"] == "conv_9"
    assert calls.vind_op_conversation("conv_9")["call_id"] == cid


def test_start_onderscheidt_geweigerd_en_onzeker(monkeypatch):
    cid = opdracht()
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(422, json={}))
    r = agent.start_gesprek_agent(cid)
    assert r["gebeld"] is False and not r.get("onzeker") and calls.lees_opdracht(cid)["status"] == "mislukt"
    cid2 = opdracht()
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(503))
    assert agent.start_gesprek_agent(cid2)["onzeker"] is True
    def stuk(*a, **k):
        raise httpx.ReadTimeout("t")
    monkeypatch.setattr(httpx, "post", stuk)
    assert agent.start_gesprek_agent(opdracht())["onzeker"] is True


def test_start_zonder_configuratie(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_AGENT_ID")
    assert agent.start_gesprek_agent(opdracht())["gebeld"] is False


def test_handtekening():
    body, geheim, t = b'{"a":1}', "geheim", int(time.time())
    goed = hmac.new(geheim.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    assert agent.controleer_handtekening(body, f"t={t},v0={goed}", geheim)
    assert not agent.controleer_handtekening(body, f"t={t},v0={'0' * 64}", geheim)
    assert not agent.controleer_handtekening(b'{"a":2}', f"t={t},v0={goed}", geheim)
    assert not agent.controleer_handtekening(body, f"t={t - 7200},v0={goed}", geheim)  # te oud
    assert not agent.controleer_handtekening(body, "", geheim)
    assert not agent.controleer_handtekening(body, f"t={t},v0={goed}", "")


def test_transcript_wordt_omgezet_en_gemaskeerd():
    uit = agent.naar_transcript([
        {"role": "agent", "message": "Goedemorgen."}, {"role": "user", "message": "Mijn IBAN is NL91ABNA0417164300."},
        {"role": "user", "message": "  "}, {"role": "tool", "message": "x"},
    ])
    assert [m["role"] for m in uit] == ["assistant", "user"]
    assert "NL91ABNA0417164300" not in uit[1]["content"]


def webhook(cid, conv="conv_1", soort="post_call_transcription", beurten=None):
    return {"type": soort, "data": {"conversation_id": conv, "transcript": beurten if beurten is not None else [
        {"role": "agent", "message": "Hoi"}, {"role": "user", "message": "Ja, ik heb tijd."}]}}


def test_webhook_levert_transcript_af_en_negeert_herhaling(gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="belt")
    assert agent.verwerk_webhook(webhook(cid)) == "afgerond"
    assert gemeld[0][1]["status"] == "gesproken" and gemeld[0][1]["transcript"][1] == {"role": "user", "content": "Ja, ik heb tijd."}
    assert agent.verwerk_webhook(webhook(cid)) == "genegeerd"
    assert len(gemeld) == 1


def test_gesprek_wordt_bij_elevenlabs_gewist_na_aanname_door_het_dagboek(monkeypatch, gemeld):
    gewist = []
    monkeypatch.setattr(agent, "verwijder_gesprek", lambda conv: gewist.append(conv))
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="belt")
    agent.verwerk_webhook(webhook(cid))
    assert gewist == ["conv_1"]
    # Nam de web-service het transcript niet aan (outbox), dan blijft de enige kopie staan.
    monkeypatch.setattr(calls, "_verstuur", lambda web_id, body: False)
    gewist.clear()
    cid2 = opdracht()
    calls.update_opdracht(cid2, agent_conversation_id="conv_2", status="belt")
    agent.verwerk_webhook(webhook(cid2, conv="conv_2"))
    assert gewist == []


def test_verwijderen_meldt_alleen_succes_en_respecteert_de_schakelaar(monkeypatch):
    monkeypatch.setattr(httpx, "delete", lambda *a, **k: httpx.Response(200))
    assert agent.verwijder_gesprek("conv_1") is True
    monkeypatch.setattr(httpx, "delete", lambda *a, **k: httpx.Response(401))
    assert agent.verwijder_gesprek("conv_1") is False
    monkeypatch.setenv("ELEVENLABS_VERWIJDER_GESPREK", "false")
    monkeypatch.setattr(httpx, "delete", lambda *a, **k: pytest.fail("mag niet wissen"))
    assert agent.verwijder_gesprek("conv_1") is False


def test_webhook_zonder_woorden_van_de_collega_is_niet_bereikt(gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="belt")
    assert agent.verwerk_webhook(webhook(cid, beurten=[{"role": "agent", "message": "Hallo?"}])) == "mislukt"
    assert gemeld[0][1]["status"] == "niet_bereikt"


def test_webhook_mislukte_verbinding_en_onbekend_gesprek(gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="belt")
    assert agent.verwerk_webhook(webhook(cid, soort="call_initiation_failure")) == "mislukt"
    assert gemeld[0][1]["status"] == "niet_bereikt"
    assert agent.verwerk_webhook(webhook(cid, conv="onbekend")) == "onbekend"


def test_vangnet_haalt_vastgelopen_gesprek_op(monkeypatch, gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="belt")
    monkeypatch.setattr(agent, "haal_gesprek_op", lambda conv: {"status": "done", "transcript": [{"role": "user", "message": "Hoi"}]})
    assert agent.herstel_agentgesprekken(nu=time.time() + 60) == 0  # nog te vers
    assert agent.herstel_agentgesprekken(nu=time.time() + 2000) == 1
    assert gemeld[0][1]["status"] == "gesproken"


def test_motor_wordt_per_opdracht_gekozen(monkeypatch):
    cid = calls.maak_opdracht("+31612345678", "X", [])
    assert calls.lees_opdracht(cid)["engine"] == "pipecat"
    gebruikt = []
    monkeypatch.setattr(agent, "start_gesprek_agent", lambda c: gebruikt.append(c) or {"gebeld": True, "call_id": c})
    monkeypatch.setattr(calls, "_start_gesprek_pipecat", lambda c: {"gebeld": True, "call_id": "pipecat"})
    assert calls.start_gesprek(cid)["call_id"] == "pipecat" and not gebruikt
    assert calls.start_gesprek(opdracht())["gebeld"] and len(gebruikt) == 1
