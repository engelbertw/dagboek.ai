"""Instellingen van de voice-service, uit omgevingsvariabelen. De beheerder-UI (fase 1) vervangt dit later door waarden uit Postgres."""
import os

DATA_DIR = os.getenv("DATA_DIR", "./data")
TRANSCRIPT_BEWAAR_DAGEN = int(os.getenv("TRANSCRIPT_BEWAAR_DAGEN", "30"))
VOICE_ID_ENGELBERT = "enmqCP0KND7ESmQRStwc"


def get_config() -> dict:
    return {
        "stt_model": os.getenv("STT_MODEL", "whisper-large-v3-turbo"),
        "llm_model": os.getenv("LLM_MODEL", "gemma-4"),
        "elevenlabs_voice_id": os.getenv("ELEVENLABS_VOICE_ID", VOICE_ID_ENGELBERT),
        "vad_start_secs": float(os.getenv("VAD_START_SECS", "0.24")),
        "vad_stop_secs": float(os.getenv("VAD_STOP_SECS", "0.4")),
        "silence_timeout_secs": float(os.getenv("SILENCE_TIMEOUT_SECS", "20")),
        "turn_deadline_secs": float(os.getenv("TURN_DEADLINE_SECS", "15")),
        "stt_timeout_secs": float(os.getenv("STT_TIMEOUT_SECS", "10")),
        "opdrachtgever": os.getenv("OPDRACHTGEVER_NAAM", "Engelbert"),
    }
