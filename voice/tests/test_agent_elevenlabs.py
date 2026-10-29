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


def test_lang_agentgesprek_wordt_niet_als_onderbroken_gemeld(gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="belt")
    assert calls.herstel_opdrachten(nu=time.time() + 3 * calls.ONDERBROKEN_NA_SECS) == 0
    assert gemeld == []


def test_webhook_na_onderbroken_of_niet_bereikt_levert_het_gesprek_alsnog_af(gemeld):
    for eerder in ("onderbroken", "niet_bereikt"):
        cid = opdracht()
        calls.update_opdracht(cid, agent_conversation_id=f"conv_{eerder}", status="belt", eind_gemeld=eerder)
        assert agent.verwerk_webhook(webhook(cid, conv=f"conv_{eerder}")) == "afgerond"
        assert gemeld[-1][1]["status"] == "gesproken"
        assert agent.verwerk_webhook(webhook(cid, conv=f"conv_{eerder}")) == "genegeerd"


def test_lege_webhook_na_een_eerdere_uitkomst_meldt_niet_opnieuw(gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="niet_bereikt", eind_gemeld="niet_bereikt")
    assert agent.verwerk_webhook(webhook(cid, beurten=[{"role": "agent", "message": "Hallo?"}])) == "genegeerd"
    assert gemeld == []


def test_herstel_gesprek_wacht_op_een_lopend_gesprek_en_kent_geen_pipecat_opdracht(monkeypatch, gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="belt")
    monkeypatch.setattr(agent, "haal_gesprek_op", lambda conv: {"status": "in-progress", "transcript": []})
    assert agent.herstel_gesprek(cid) == "nog_bezig"
    monkeypatch.setattr(agent, "haal_gesprek_op", lambda conv: None)
    assert agent.herstel_gesprek(cid) == "geen_gesprek"
    pipecat = calls.maak_opdracht("+31612345678", "X", [])
    assert agent.herstel_gesprek(pipecat) == "onbekend"
    assert gemeld == []


def test_vangnet_vraagt_een_als_niet_gesproken_gemeld_gesprek_nog_na_maar_beperkt(monkeypatch, gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="onderbroken", eind_gemeld="onderbroken", gebeld_om=time.time())
    opgevraagd = []
    monkeypatch.setattr(agent, "haal_gesprek_op", lambda conv: opgevraagd.append(conv) or {"status": "done", "transcript": [{"role": "agent", "message": "Hallo?"}]})
    nu = time.time()
    assert agent.herstel_agentgesprekken(nu=nu) == 0 and len(opgevraagd) == 1
    assert agent.herstel_agentgesprekken(nu=nu + 60) == 0 and len(opgevraagd) == 1  # te snel na de vorige poging
    for i in range(1, 6):
        agent.herstel_agentgesprekken(nu=nu + i * 700)
    assert len(opgevraagd) == agent.NAVRAAG_MAX
    # Bevat het gesprek bij ElevenLabs wel woorden, dan wordt het afgeleverd.
    cid2 = opdracht()
    calls.update_opdracht(cid2, agent_conversation_id="conv_2", status="onderbroken", eind_gemeld="onderbroken", gebeld_om=time.time())
    monkeypatch.setattr(agent, "haal_gesprek_op", lambda conv: {"status": "done", "transcript": [{"role": "user", "message": "Hoi"}]})
    assert agent.herstel_agentgesprekken(nu=time.time() + 700) == 1
    assert gemeld[-1][1]["status"] == "gesproken"
    # Een gesprek dat al gesproken is gemeld wordt niet meer opgevraagd.
    monkeypatch.setattr(agent, "haal_gesprek_op", lambda conv: pytest.fail("mag niet opvragen"))
    agent.herstel_agentgesprekken(nu=time.time() + 5000)


VOICEMAIL = [
    {"role": "agent", "message": "Goedemorgen Daan."},
    {"role": "user", "message": "Is niet beschikbaar. Laat een bericht achter na de toon."},
    {"role": "agent", "message": "Het lijkt erop dat je niet beschikbaar bent."},
    {"role": "user", "message": "Als u klaar bent, beëindig dit gesprek of voor meer opties toets 1."},
]


def test_voicemailgroet_wordt_als_voicemail_gemeld_zonder_transcript_en_zonder_wissen(monkeypatch, gemeld):
    gewist = []
    monkeypatch.setattr(agent, "verwijder_gesprek", lambda conv: gewist.append(conv))
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="belt")
    assert agent.verwerk_webhook(webhook(cid, beurten=VOICEMAIL)) == "voicemail"
    assert gemeld[0][1] == {"status": "voicemail"} and calls.lees_opdracht(cid)["status"] == "voicemail"
    assert gewist == []
    assert agent.verwerk_webhook(webhook(cid, beurten=VOICEMAIL)) == "genegeerd" and len(gemeld) == 1


def test_een_persoon_die_zegt_niet_beschikbaar_te_zijn_of_veel_praat_is_geen_voicemail(gemeld):
    assert agent.lijkt_op_voicemail(agent.naar_transcript(VOICEMAIL)) is True
    assert agent.lijkt_op_voicemail(agent.naar_transcript([{"role": "user", "message": "Ik ben even niet beschikbaar, bel over een uur terug."}])) is False
    lang = "Ik zat net te denken aan het project. " * 20 + "Je kunt me bereiken, toets 1 op de telefoon is niet nodig."
    assert agent.lijkt_op_voicemail(agent.naar_transcript([{"role": "user", "message": lang}])) is False
    assert agent.lijkt_op_voicemail([]) is False


def test_een_eerder_als_gesproken_gemeld_gesprek_wordt_niet_alsnog_voicemail(gemeld):
    cid = opdracht()
    calls.update_opdracht(cid, agent_conversation_id="conv_1", status="gesproken", eind_gemeld="gesproken")
    assert agent.verwerk_webhook(webhook(cid, beurten=VOICEMAIL)) == "genegeerd"
    assert gemeld == []


# ── Inkomend bellen ──────────────────────────────────────────────────────────

WEB_ANTWOORD = {
    "ok": True, "callId": "c0ffee00-0000-4000-8000-000000000001", "medewerker": "Daan", "toestemmingNodig": True,
    "onderwerpen": [{"titel": "Goes"}], "houding": "", "instructie": "",
}


def test_inkomend_geeft_prompt_en_begroeting_en_koppelt_het_gesprek(monkeypatch, gemeld):
    monkeypatch.setattr(calls, "vraag_inkomend", lambda beller: (200, WEB_ANTWOORD))
    antw = agent.verwerk_init({"caller_id": "+31612345678", "agent_id": "agent_1", "conversation_id": "conv_in"})
    call_id = antw["dynamic_variables"]["call_id"]
    assert call_id
    override = antw["conversation_config_override"]["agent"]
    assert "Daan" in override["first_message"] and "AI-systeem" in override["first_message"] and "Fijn dat je belt" in override["first_message"]
    assert "Goes" in override["prompt"]["prompt"] and "belt zelf naar jou" in override["prompt"]["prompt"]
    # Het gesprek wordt later via de gewone post-call-webhook afgeleverd, op het eigen gespreks-id.
    assert agent.verwerk_webhook(webhook(call_id, conv="conv_in", beurten=[{"role": "agent", "message": "Hoi"}, {"role": "user", "message": "Het gaat goed met Goes, we zijn bijna klaar."}])) == "afgerond"
    assert gemeld[-1][0] == WEB_ANTWOORD["callId"] and gemeld[-1][1]["status"] == "gesproken"


def test_inkomend_onbekend_of_uitgeschakeld_geeft_een_korte_afwijzing_zonder_gegevens(monkeypatch):
    for status, tekst in ((404, "herken dit telefoonnummer niet"), (403, "nog niet mogelijk"), (429, "vaker gebeld"), (0, "herken dit telefoonnummer niet")):
        monkeypatch.setattr(calls, "vraag_inkomend", lambda beller, s=status: (s, {}))
        antw = agent.verwerk_init({"caller_id": "+31600000000", "agent_id": "agent_1"})
        assert antw["dynamic_variables"]["call_id"] == ""
        assert tekst in antw["conversation_config_override"]["agent"]["first_message"]
        assert "Goes" not in antw["conversation_config_override"]["agent"]["prompt"]["prompt"]


def test_inkomend_negeert_een_ander_agent_en_een_herhaald_verzoek_maakt_geen_tweede_opdracht(monkeypatch):
    aangeroepen = []
    monkeypatch.setattr(calls, "vraag_inkomend", lambda beller: aangeroepen.append(beller) or (200, WEB_ANTWOORD))
    assert agent.verwerk_init({"caller_id": "+31612345678", "agent_id": "andere"})["dynamic_variables"]["call_id"] == ""
    assert aangeroepen == []
    a = agent.verwerk_init({"caller_id": "+31612345678", "agent_id": "agent_1", "conversation_id": "conv_x"})
    b = agent.verwerk_init({"caller_id": "+31612345678", "agent_id": "agent_1", "conversation_id": "conv_x"})
    assert a["dynamic_variables"]["call_id"] == b["dynamic_variables"]["call_id"]


def test_inkomend_noemt_het_gesprek_id_voor_de_hulpmiddelen_alleen_als_die_aanstaan(monkeypatch):
    monkeypatch.setattr(calls, "vraag_inkomend", lambda beller: (200, WEB_ANTWOORD))
    uit = agent.verwerk_init({"caller_id": "+31612345678", "agent_id": "agent_1", "conversation_id": "conv_a"})["conversation_config_override"]["agent"]["prompt"]["prompt"]
    assert WEB_ANTWOORD["callId"] not in uit and "bevestig_codewoord" not in uit
    monkeypatch.setenv("INKOMEND_TOOLS", "true")
    aan = agent.verwerk_init({"caller_id": "+31612345678", "agent_id": "agent_1", "conversation_id": "conv_b"})["conversation_config_override"]["agent"]["prompt"]["prompt"]
    assert WEB_ANTWOORD["callId"] in aan and "bevestig_codewoord" in aan and "Zal ik dit noteren?" in aan
