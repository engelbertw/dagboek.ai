"""Watchdogs rond de gespreksketen, overgenomen uit Inwoner.AI (pipeline.py): ze spreken buiten het LLM om,
zodat een hangende STT/LLM/TTS-provider nooit tot stilte op de lijn leidt."""
import asyncio

from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

_STT_TIMEOUT_MELDING = {
    "nl": "Sorry, ik heb dat niet goed verstaan. Kun je dat nog een keer zeggen?",
    "en": "Sorry, I didn't quite catch that. Could you say that again?",
}
_TURN_WATCHDOG_MELDING = {
    "nl": "Excuses, er ging iets mis aan mijn kant. Kun je dat nog een keer zeggen?",
    "en": "Sorry, something went wrong on my end. Could you say that again?",
}


class SilenceTimeoutProcessor(FrameProcessor):
    """Beëindigt het gesprek na N seconden stilte nadat de agent klaar is met spreken."""

    def __init__(self, *, timeout_secs: float, **kwargs):
        super().__init__(**kwargs)
        self._timeout = timeout_secs
        self._timer = None
        self.fired = False

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, BotStoppedSpeakingFrame):
            logger.info("SilenceTimeout: BotStoppedSpeakingFrame → timer start")
            self._reset_timer()
        elif isinstance(frame, BotStartedSpeakingFrame):
            logger.info("SilenceTimeout: BotStartedSpeakingFrame → timer cancel")
            self._cancel_timer()
        elif isinstance(frame, UserStartedSpeakingFrame):
            logger.info("SilenceTimeout: UserStartedSpeakingFrame → timer cancel")
            self._cancel_timer()
        elif isinstance(frame, TranscriptionFrame):
            logger.info(f"SilenceTimeout: TranscriptionFrame → timer cancel (tekens={len(frame.text or '')})")
            self._cancel_timer()

        await self.push_frame(frame, direction)

    def _cancel_timer(self):
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def _reset_timer(self):
        self._cancel_timer()
        self._timer = self.create_task(self._run_timer())

    async def _run_timer(self):
        await asyncio.sleep(self._timeout)
        logger.info(f"{self._timeout}s stilte na agent — gesprek beëindigd")
        self.fired = True
        await self.push_frame(EndFrame())

    async def cleanup(self):
        self._cancel_timer()
        await super().cleanup()


class TurnWatchdogProcessor(FrameProcessor):
    """Per-turn deadline: als de agent na een transcriptie niet binnen N seconden
    begint te spreken (hangende STT/LLM/TTS-provider), meld dat hoorbaar in
    plaats van stil te blijven op een live lijn. Loopt de turn daarna alsnog
    vast, dan ruimt de SilenceTimeoutProcessor het gesprek op."""

    def __init__(self, *, deadline_secs: float, taal_status: dict | None = None, **kwargs):
        super().__init__(**kwargs)
        self._deadline = deadline_secs
        self._taal_status = taal_status or {}
        self._timer = None
        self.fired = False

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            self._arm()
        elif isinstance(frame, (BotStartedSpeakingFrame, UserStartedSpeakingFrame)):
            self._disarm()

        await self.push_frame(frame, direction)

    def _disarm(self):
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def _arm(self):
        self._disarm()
        self._timer = self.create_task(self._run_timer())

    async def _run_timer(self):
        await asyncio.sleep(self._deadline)
        logger.error(f"TurnWatchdog: geen agent-reactie binnen {self._deadline}s — hoorbare foutmelding")
        self.fired = True
        taal = self._taal_status.get("huidige", "nl")
        await self.push_frame(TTSSpeakFrame(
            _TURN_WATCHDOG_MELDING.get(taal, _TURN_WATCHDOG_MELDING["nl"])
        ))

    async def cleanup(self):
        self._disarm()
        await super().cleanup()


class SttTimeoutProcessor(FrameProcessor):
    """Vangnet voor een hangende of falende STT-provider — het incident van
    2026-09-10, waarbij de T-Systems-Whisper-gateway niet meer reageerde: de
    beller had duidelijk gesproken (VAD zag spraak starten én stoppen), maar
    er kwam nooit een TranscriptionFrame terug. Geen van de twee bestaande
    vangnetten kon dat opvangen — SilenceTimeoutProcessor reageert pas ná
    bot-spraak (die komt er hier nooit, want het model krijgt nooit tekst),
    en TurnWatchdogProcessor arm't juist pas ná een transcriptie. Dit
    vangnet vult precies dat gat: als de beller stopt met praten maar er
    binnen N seconden geen transcriptie volgt, meldt de agent dat hoorbaar
    in plaats van de lijn eindeloos stil te laten.

    Ontdekt op 2026-09-11 (live testgesprekken, "sorry"-melding kwam elke keer
    exact stt_timeout_secs na een AL GESLAAGDE beurt): OpenAISTTService/
    Whisper-wrapper duwt bij succes eerst de TranscriptionFrame door en pas
    daarna de oorspronkelijke UserStoppedSpeakingFrame verder (passthrough,
    ná afronding van de Whisper-aanroep). Zonder onderscheid triggerde elke
    UserStoppedSpeakingFrame een nieuwe 10s-countdown — ook ná een prima
    verstane beurt — die dan alsnog afliep zodra de volgende inbreng van de
    beller langer dan timeout_secs op zich liet wachten (heel gewoon tijdens
    een rustig gesprek). `_transcript_ontvangen` onderscheidt nu "we wachten
    nog op een transcriptie voor dit spraaksegment" van "we hebben 'm al en
    dit is alleen de doorgestuurde afronding" — alleen in het eerste geval
    wordt de timer gewapend."""

    def __init__(self, *, timeout_secs: float, taal_status: dict | None = None, **kwargs):
        super().__init__(**kwargs)
        self._timeout = timeout_secs
        self._taal_status = taal_status or {}
        self._timer = None
        self._transcript_ontvangen = False
        self.fired = False

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, UserStartedSpeakingFrame):
            logger.info("SttTimeout: UserStartedSpeakingFrame → timer cancel, nieuw spraaksegment")
            self._transcript_ontvangen = False
            self._cancel_timer()
        elif isinstance(frame, TranscriptionFrame):
            logger.info("SttTimeout: TranscriptionFrame → timer cancel")
            self._transcript_ontvangen = True
            self._cancel_timer()
        elif isinstance(frame, UserStoppedSpeakingFrame):
            if self._transcript_ontvangen:
                # Doorgestuurde afronding ná een al geslaagde transcriptie voor
                # dít segment (zie klasse-docstring) — geen nieuwe wachttijd.
                logger.info("SttTimeout: UserStoppedSpeakingFrame na geslaagde transcriptie → genegeerd")
            else:
                logger.info("SttTimeout: UserStoppedSpeakingFrame zonder transcriptie → timer start")
                self._reset_timer()

        await self.push_frame(frame, direction)

    def _cancel_timer(self):
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def _reset_timer(self):
        self._cancel_timer()
        self._timer = self.create_task(self._run_timer())

    async def _run_timer(self):
        await asyncio.sleep(self._timeout)
        logger.error(f"SttTimeout: geen transcriptie binnen {self._timeout}s na spraak — hoorbare foutmelding")
        self.fired = True
        taal = self._taal_status.get("huidige", "nl")
        await self.push_frame(TTSSpeakFrame(
            _STT_TIMEOUT_MELDING.get(taal, _STT_TIMEOUT_MELDING["nl"])
        ))

    async def cleanup(self):
        self._cancel_timer()
        await super().cleanup()




class AfsluitProcessor(FrameProcessor):
    """Beëindigt het gesprek zodra het model `einde_gesprek` heeft aangeroepen en de afscheidszin is uitgesproken.
    Zonder dit praat de assistent door of blijft de lijn open tot de stiltetimer afloopt."""

    def __init__(self, *, max_wachttijd_secs: float = 8.0, **kwargs):
        super().__init__(**kwargs)
        self._max_wachttijd = max_wachttijd_secs
        self._timer = None
        self.gevraagd = False

    def vraag_afsluiting(self) -> None:
        """Aangeroepen door de tool. Valt terug op een timer als het afscheid nooit wordt uitgesproken."""
        self.gevraagd = True
        if self._timer:
            self._timer.cancel()
        self._timer = self.create_task(self._na_wachttijd())

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, BotStoppedSpeakingFrame) and self.gevraagd:
            logger.info("Afsluiting: afscheid uitgesproken, gesprek wordt beëindigd")
            await self.push_frame(EndFrame())
            return
        await self.push_frame(frame, direction)

    async def _na_wachttijd(self):
        await asyncio.sleep(self._max_wachttijd)
        logger.warning("Afsluiting: geen afscheid binnen de wachttijd, gesprek wordt toch beëindigd")
        await self.push_frame(EndFrame())

    async def cleanup(self):
        if self._timer:
            self._timer.cancel()
        await super().cleanup()
