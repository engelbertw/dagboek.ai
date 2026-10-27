import os
import time

import config
import opschoning


def _bestand(map_, naam, dagen_oud):
    pad = config.DATA_DIR and __import__("pathlib").Path(config.DATA_DIR) / map_ / naam
    pad.parent.mkdir(parents=True, exist_ok=True)
    pad.write_text("{}")
    t = time.time() - dagen_oud * 86400
    os.utime(pad, (t, t))
    return pad


def test_wist_alleen_bestanden_ouder_dan_de_termijn():
    oud = _bestand("transcripten", "oud.json", 31)
    nieuw = _bestand("transcripten", "nieuw.json", 29)
    oude_opdracht = _bestand("_calls", "oud.json", 45)
    assert opschoning.ruim_op(30) == 2
    assert not oud.exists() and not oude_opdracht.exists() and nieuw.exists()


def test_negeert_andere_bestanden_en_ontbrekende_mappen():
    assert opschoning.ruim_op(30) == 0
    vreemd = _bestand("transcripten", "notitie.txt", 100)
    assert opschoning.ruim_op(30) == 0 and vreemd.exists()


def test_ongeldige_termijn_wist_niets():
    oud = _bestand("transcripten", "oud.json", 400)
    assert opschoning.ruim_op(0) == 0 and oud.exists()
