"""Herkenning en maskering van persoonsgegevens die een inwoner (onbedoeld) in de chat typt.

Aanleiding: DPIA-advies van de FG bij een gemeentelijke chatbot (Montferland, 24-10-2024): ingevoerde persoonsgegevens
moeten worden gedetecteerd en verwijderd, en de gebruiker moet het zelf kunnen melden. Hier alleen de gegevens die de
assistent nooit nodig heeft: BSN en IBAN worden gemaskeerd (ook voor het taalmodel en in het transcript), en
gezondheids- of geloofsgegevens leiden tot een waarschuwing. E-mail, telefoon en geboortedatum horen bij een afspraak en
vallen er bewust buiten.

Geen pipecat-import."""

import re

_BSN_KANDIDAAT = re.compile(r"(?<![\d.])(\d{3}[ .\-]?\d{3}[ .\-]?\d{3})(?![\d])")
_IBAN_KANDIDAAT = re.compile(r"\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?)\b", re.IGNORECASE)

# Bewust voorzichtig: alleen formuleringen waarin iemand over zichzelf iets bijzonders vertelt, zodat een gewone vraag
# ('mag ik trouwen in een kerk?') geen waarschuwing geeft.
_BIJZONDER = re.compile(
    r"\b(ik ben (ziek|zwanger|kankerpati[eë]nt)|mijn (diagnose|ziekte|medicijnen|aandoening|depressie|handicap)|"
    r"ik heb (kanker|hiv|aids|diabetes|een depressie|een burn-?out|psychische)|mijn (geloof|religie|seksuele geaardheid)|"
    r"ik ben (homo|lesbisch|biseksueel|transgender|moslim|christen|joods|hindoe|boeddhist))\b", re.IGNORECASE)


def _elfproef(cijfers: str) -> bool:
    if len(cijfers) != 9 or not cijfers.isdigit() or cijfers == "0" * 9:
        return False
    som = sum(int(c) * (9 - i) for i, c in enumerate(cijfers[:8])) - int(cijfers[8])
    return som % 11 == 0


def _iban_geldig(tekst: str) -> bool:
    iban = re.sub(r"\s+", "", tekst).upper()
    if not 15 <= len(iban) <= 34:
        return False
    omgezet = iban[4:] + iban[:4]
    getal = "".join(str(int(c, 36)) for c in omgezet)
    return int(getal) % 97 == 1


def soorten(tekst: str) -> list[str]:
    """Welke soorten gevoelige gegevens staan in deze tekst? Subset van ['bsn', 'iban', 'bijzonder']."""
    gevonden: list[str] = []
    if any(_elfproef(re.sub(r"\D", "", m.group(1))) for m in _BSN_KANDIDAAT.finditer(tekst or "")):
        gevonden.append("bsn")
    if any(_iban_geldig(m.group(1)) for m in _IBAN_KANDIDAAT.finditer(tekst or "")):
        gevonden.append("iban")
    if _BIJZONDER.search(tekst or ""):
        gevonden.append("bijzonder")
    return gevonden


def maskeer(tekst: str) -> str:
    """Vervangt een geldig BSN en een geldig IBAN door een neutrale aanduiding; de rest van de tekst blijft gelijk."""
    if not tekst:
        return tekst
    uit = _BSN_KANDIDAAT.sub(
        lambda m: "[BSN verwijderd]" if _elfproef(re.sub(r"\D", "", m.group(1))) else m.group(0), tekst)
    return _IBAN_KANDIDAAT.sub(lambda m: "[IBAN verwijderd]" if _iban_geldig(m.group(1)) else m.group(0), uit)


def waarschuwing_voor_model(soort: list[str]) -> str | None:
    """Systeemopdracht voor het model als de inwoner zojuist iets gevoeligs noemde."""
    if not soort:
        return None
    delen = []
    if "bsn" in soort or "iban" in soort:
        delen.append("De inwoner noemde een BSN of bankrekeningnummer; dat is uit het gesprek gehaald en je hebt het nooit "
                     "nodig. Herhaal het niet en vraag er niet naar.")
    if "bijzonder" in soort:
        delen.append("De inwoner vertelde iets over gezondheid, geloof of een andere bijzondere persoonlijke omstandigheid. "
                     "Ga er niet inhoudelijk op in en geef geen advies.")
    delen.append("Zeg in één korte, vriendelijke zin dat de inwoner dit soort gegevens hier niet hoeft te delen, dat het "
                 "gesprek met de knop 'Wis dit gesprek' kan worden verwijderd, en ga daarna verder met de vraag.")
    return " ".join(delen)
