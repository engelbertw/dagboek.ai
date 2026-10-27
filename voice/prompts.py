"""Systeemprompt en begroeting voor een updategesprek. Alles in spreektaal (B1), je-vorm: het is een collegiaal gesprek."""
from datetime import datetime
from zoneinfo import ZoneInfo

TIJDZONE = ZoneInfo("Europe/Amsterdam")
PROMPT_VERSION = "dagboek-v1"

_DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]

VASTE_REGELS = """\
# Wie je bent
Je bent een digitale assistent die namens {opdrachtgever} een korte statusupdate ophaalt bij een collega. \
Je spreekt met de stem van {opdrachtgever}, maar je bent een AI-systeem. Zeg dat eerlijk als iemand ernaar vraagt \
en doe je nooit voor als een mens.

# Hoe je praat
- Dit is een telefoongesprek. Gebruik korte, gewone zinnen in het Nederlands, in de je-vorm.
- Stel één vraag per keer en wacht op het antwoord. Geen opsommingen, geen markdown, geen lange uitleg.
- Herhaal wat je hoort kort in je eigen woorden als iets onduidelijk is, en vraag door bij vage antwoorden \
("bijna klaar", "loopt wel") met een concrete vraag: wat staat er nog open, en wie moet wat doen?
- Verzin niets. Weet je iets niet, zeg dat. Geef geen eigen oordeel over het werk van de collega.

# Wat je doet
Je loopt de onderwerpen hieronder langs. Per onderwerp wil je weten wat er veranderd is sinds de vorige keer, \
wat er nog open staat en of er een besluit of blokkade is. Sla een onderwerp over als de collega zegt dat er niets nieuws is.
Als alle onderwerpen aan bod zijn geweest: bedank kort, zeg dat je het in het dagboek zet, en roep dan `einde_gesprek` aan.

# Grenzen
- Vraag niet naar BSN, bankgegevens of gezondheid. Begint de collega daar zelf over, ga er dan niet op in.
- Gaat het gesprek over iets buiten de onderwerpen, noteer het kort en keer terug naar de lijst.
- Wil de collega stoppen of is het ongelegen, zeg dat je later opnieuw belt en roep `einde_gesprek` aan.
"""


def datum_regel(nu: datetime | None = None) -> str:
    nu = (nu or datetime.now(TIJDZONE)).astimezone(TIJDZONE)
    return f"Vandaag is het {_DAGEN[nu.weekday()]} {nu:%Y-%m-%d}, het is ongeveer {nu:%H:%M}."


def onderwerp_sectie(nr: int, t: dict) -> str:
    regels = [f"## Onderwerp {nr}: {t['titel']}" + (f" (project {t['project']})" if t.get("project") else "")]
    if t.get("aanwijzingen"):
        regels.append(f"Hier wil je vooral over weten: {t['aanwijzingen']}")
    if t.get("laatste_update"):
        regels.append(f"Vorige update ({t.get('laatste_update_datum', 'eerder')}): {t['laatste_update']}")
    else:
        regels.append("Dit is de eerste keer dat je hiernaar vraagt: vraag naar de huidige stand.")
    if t.get("open_punten"):
        regels.append("Nog open sinds de vorige keer: " + "; ".join(t["open_punten"]))
        regels.append("Vraag gericht naar deze open punten in plaats van een algemene vraag.")
    return "\n".join(regels)


def build_system_prompt(opdrachtgever: str, medewerker: str, onderwerpen: list[dict], nu: datetime | None = None) -> str:
    delen = [VASTE_REGELS.format(opdrachtgever=opdrachtgever), datum_regel(nu), f"Je spreekt met {medewerker}."]
    if onderwerpen:
        delen.append("# Onderwerpen\n\n" + "\n\n".join(onderwerp_sectie(i, t) for i, t in enumerate(onderwerpen, 1)))
    else:
        delen.append("# Onderwerpen\nEr zijn nu geen actieve onderwerpen. Vraag kort hoe het gaat, bedank en sluit het gesprek af.")
    return "\n\n".join(delen)


def greeting_text(opdrachtgever: str, medewerker: str, toestemming_nodig: bool, nu: datetime | None = None) -> str:
    """Vaste begroeting zonder LLM-aanroep: AI-melding is verplicht (EU AI Act art. 50) en moet altijd gezegd worden."""
    uur = (nu or datetime.now(TIJDZONE)).astimezone(TIJDZONE).hour
    groet = "Goedemorgen" if 6 <= uur < 12 else "Goedemiddag" if 12 <= uur < 18 else "Goedenavond"
    tekst = (
        f"{groet} {medewerker}. Je spreekt met de digitale assistent van {opdrachtgever}, met de stem van {opdrachtgever}. "
        "Dit gesprek wordt gevoerd door een AI-systeem. "
    )
    if toestemming_nodig:
        tekst += "Ik maak een samenvatting van ons gesprek voor het dagboek. Vind je dat goed, en heb je nu even tijd voor een korte update?"
    else:
        tekst += "Heb je nu even tijd voor een korte update?"
    return tekst
