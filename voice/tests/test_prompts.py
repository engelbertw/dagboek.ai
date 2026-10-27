from datetime import datetime

import prompts

NU = datetime(2026, 10, 27, 9, 30, tzinfo=prompts.TIJDZONE)  # dinsdag


def test_begroeting_bevat_ai_melding_en_geen_u_vorm():
    tekst = prompts.greeting_text("Engelbert", "Daan", toestemming_nodig=True, nu=NU)
    assert tekst.startswith("Goedemorgen Daan")
    assert "AI-systeem" in tekst
    assert "samenvatting" in tekst
    assert " u " not in f" {tekst.lower()} " and "uw" not in tekst.lower().split()


def test_begroeting_zonder_toestemming_vraagt_alleen_om_tijd():
    tekst = prompts.greeting_text("Engelbert", "Daan", toestemming_nodig=False, nu=NU)
    assert "samenvatting" not in tekst
    assert "AI-systeem" in tekst


def test_begroeting_dagdeel():
    avond = datetime(2026, 10, 27, 19, 0, tzinfo=prompts.TIJDZONE)
    assert prompts.greeting_text("E", "D", False, nu=avond).startswith("Goedenavond")


def test_prompt_noemt_open_punten_en_aanwijzingen():
    onderwerp = {
        "titel": "MijnServices", "aanwijzingen": "offertes en klantafstemming",
        "laatste_update": "Offerte verstuurd", "laatste_update_datum": "2026-10-20",
        "open_punten": ["Akkoord klant", "Intern overleg"],
    }
    tekst = prompts.build_system_prompt("Engelbert", "Daan", [onderwerp], nu=NU)
    assert "offertes en klantafstemming" in tekst
    assert "Akkoord klant; Intern overleg" in tekst
    assert "Je spreekt met Daan." in tekst
    assert "dinsdag 2026-10-27" in tekst


def test_eerste_keer_vraagt_naar_huidige_stand():
    tekst = prompts.build_system_prompt("E", "D", [{"titel": "Nieuw"}], nu=NU)
    assert "eerste keer" in tekst


def test_zonder_onderwerpen_staat_er_een_veilige_instructie():
    assert "geen actieve onderwerpen" in prompts.build_system_prompt("E", "D", [], nu=NU)
