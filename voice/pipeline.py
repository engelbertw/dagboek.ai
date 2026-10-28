import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.workers.runner import WorkerRunner

import calls
import config
from persoonsgegevens import maskeer
from processors import AfsluitProcessor, SilenceTimeoutProcessor, SttTimeoutProcessor, TurnWatchdogProcessor
from prompts import PROMPT_VERSION, build_system_prompt, greeting_text


def _write_transcript(call_id: str, stream_sid: str, context: LLMContext, knelpunten: list[str]) -> list[dict] | None:
    """Transcript per gesprek op de data-schijf, met BSN en IBAN gemaskeerd. De samenvatting naar het dagboek volgt in fase 2."""
    try:
        berichten = context.get_messages() if hasattr(context, "get_messages") else context.messages
        schoon = [
            {**m, "content": maskeer(m["content"])} if isinstance(m, dict) and isinstance(m.get("content"), str) else m
            for m in berichten
        ]
        pad = Path(config.DATA_DIR) / "transcripten" / f"{datetime.now():%Y%m%d-%H%M%S}-{call_id}.json"
        pad.parent.mkdir(parents=True, exist_ok=True)
        pad.write_text(json.dumps(
            {"call_id": call_id, "stream_sid": stream_sid, "prompt_version": PROMPT_VERSION, "messages": schoon, "knelpunten": knelpunten},
            ensure_ascii=False, indent=2, default=str,
        ), encoding="utf-8")
        calls.update_opdracht(call_id, transcript=pad.name)
        logger.info(f"Transcript weggeschreven: {pad}")
        # Naar het dagboek gaat alleen het gesprek zelf, niet de systeemprompt.
        return [{"role": m["role"], "content": m["content"]} for m in schoon if isinstance(m, dict) and m.get("role") in ("assistant", "user") and isinstance(m.get("content"), str)]
    except Exception as e:
        logger.error(f"Transcript wegschrijven mislukt: {type(e).__name__}: {e}")
        return None


def _einde_gesprek_schema(afsluiting: AfsluitProcessor) -> FunctionSchema:
    async def _handler(params: FunctionCallParams) -> None:
        afsluiting.vraag_afsluiting()
        await params.result_callback({"afgesloten": True})

    return FunctionSchema(
        name="einde_gesprek",
        description=(
            "Beëindig het gesprek. Zeg eerst je afscheid, roep dit pas daarna aan. Gebruik dit als alle onderwerpen zijn "
            "besproken of als de collega wil stoppen."
        ),
        properties={},
        required=[],
        handler=_handler,
    )


async def run_voice_pipeline(websocket, token_geverifieerd: bool = False) -> None:
    await websocket.accept()
    ws_token = os.getenv("WS_TOKEN", "")
    stream_sid, custom = None, {}
    async for raw in websocket.iter_text():
        msg = json.loads(raw)
        if msg["event"] == "start":
            custom = msg["start"].get("customParameters") or {}
            if ws_token and not token_geverifieerd and custom.get("token") != ws_token:
                logger.warning("Stream geweigerd: ontbrekend of onjuist token in start-parameters")
                await websocket.close(code=1008)
                return
            stream_sid = msg["start"]["streamSid"]
            logger.info(f"Twilio stream gestart: {stream_sid}")
            break

    if not stream_sid:
        logger.error("Geen streamSid ontvangen, verbinding gesloten")
        await websocket.close()
        return

    call_id = custom.get("call_id", "")
    spec = calls.lees_opdracht(call_id)
    if spec is None:
        logger.error(f"Onbekende opdracht {call_id!r}, verbinding gesloten")
        await websocket.close(code=1008)
        return
    calls.update_opdracht(call_id, status="gesprek", stream_sid=stream_sid)
    await asyncio.to_thread(calls.rapporteer, call_id, "gesprek")

    cfg = config.get_config()
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True, audio_out_enabled=True, add_wav_header=False,
            serializer=TwilioFrameSerializer(stream_sid, params=TwilioFrameSerializer.InputParams(auto_hang_up=False)),
        ),
    )
    stt = OpenAISTTService(
        api_key=os.getenv("TSYSTEMS_API_KEY"), base_url=os.getenv("TSYSTEMS_BASE_URL"),
        model=cfg["stt_model"], language="nl",
    )
    llm = OpenAILLMService(
        api_key=os.getenv("TSYSTEMS_API_KEY"), base_url=os.getenv("TSYSTEMS_BASE_URL"), model=cfg["llm_model"],
    )
    tts = ElevenLabsTTSService(
        api_key=os.getenv("ELEVENLABS_API_KEY"), voice_id=cfg["elevenlabs_voice_id"], model="eleven_turbo_v2_5",
    )

    afsluiting = AfsluitProcessor()
    taal_status = {"huidige": "nl"}
    context = LLMContext(
        messages=[{"role": "system", "content": build_system_prompt(cfg["opdrachtgever"], spec["medewerker"], spec["onderwerpen"], houding=spec.get("houding", ""), instructie=spec.get("instructie", ""))}],
        tools=[_einde_gesprek_schema(afsluiting)],
    )
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(start_secs=cfg["vad_start_secs"], stop_secs=cfg["vad_stop_secs"]))
        ),
    )
    silence_timeout = SilenceTimeoutProcessor(timeout_secs=cfg["silence_timeout_secs"])
    turn_watchdog = TurnWatchdogProcessor(deadline_secs=cfg["turn_deadline_secs"], taal_status=taal_status)
    stt_timeout = SttTimeoutProcessor(timeout_secs=cfg["stt_timeout_secs"], taal_status=taal_status)

    pipeline = Pipeline([
        transport.input(), stt, silence_timeout, turn_watchdog, stt_timeout,
        user_aggregator, llm, tts, afsluiting, transport.output(), assistant_aggregator,
    ])
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(audio_in_sample_rate=8000, audio_out_sample_rate=8000, allow_interruptions=True),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"Client verbonden (prompt {PROMPT_VERSION})")
        groet = greeting_text(cfg["opdrachtgever"], spec["medewerker"], bool(spec.get("toestemming_nodig")))
        # Geen handmatige context.add_message: de assistant-aggregator vangt een TTSSpeakFrame zelf op.
        await worker.queue_frames([TTSSpeakFrame(groet)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client verbroken")
        knelpunten = [naam for naam, fired in (
            ("stilte_na_agent", silence_timeout.fired), ("geen_tijdige_reactie", turn_watchdog.fired),
            ("stt_geen_transcriptie", stt_timeout.fired),
        ) if fired]
        transcript = _write_transcript(call_id, stream_sid, context, knelpunten)
        calls.update_opdracht(call_id, status="gesproken", afgerond_om=datetime.now().timestamp(), afgesloten_door_model=afsluiting.gevraagd)
        await asyncio.to_thread(calls.rapporteer, call_id, "gesproken", transcript=transcript)
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False, force_gc=True)
    await runner.add_workers(worker)
    await runner.run()
