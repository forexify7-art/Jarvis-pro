"""Local OmniVoice text-to-speech sidecar for J.A.R.V.I.S.

Runs on 127.0.0.1 only. The Node server (server.js) proxies POST /api/tts to
this process, so browsers never talk to it directly and no API key is needed.

    pip install -r voice/omnivoice-server/requirements.txt
    python voice/omnivoice-server/server.py

The first start downloads the k2-fsa/OmniVoice model from Hugging Face
(several GB). If this process is not running, J.A.R.V.I.S. automatically
keeps using the browser voice.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = logging.getLogger("jarvis-omnivoice")
MAX_BODY_BYTES = 16_000
MAX_TEXT_CHARS = 1_200
SAMPLE_RATE = 24_000
LANGUAGES = {"en": "English", "hi": "Hindi"}


class Engine:
    """Lazy-loads OmniVoice once and serialises generation (one request at a time)."""

    def __init__(self, model_id: str, device: str | None, num_step: int, voice: str | None) -> None:
        self.model_id = model_id
        self.requested_device = device
        self.num_step = num_step
        self.voice = voice
        self.model = None
        self.device = ""
        self.error: str | None = None
        self._lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self.model is not None

    def load(self) -> None:
        try:
            import torch
            from omnivoice import OmniVoice
            from omnivoice.utils.common import get_best_device

            device = self.requested_device or get_best_device()
            dtype = torch.float16 if str(device).startswith(("cuda", "mps", "xpu")) else torch.float32
            LOG.info("Loading %s on %s ...", self.model_id, device)
            self.model = OmniVoice.from_pretrained(self.model_id, device_map=device, dtype=dtype)
            self.device = str(device)
            LOG.info("OmniVoice ready.")
        except Exception as error:  # noqa: BLE001 - reported through /health, never hidden
            self.error = f"{type(error).__name__}: {error}"
            LOG.error("OmniVoice failed to load: %s", self.error)

    def synthesize(self, text: str, language: str) -> bytes:
        import soundfile as sf

        if not self.ready:
            raise RuntimeError(self.error or "model is still loading")
        kwargs = {"text": text, "language": LANGUAGES.get(language, "English"), "num_step": self.num_step}
        if self.voice:
            kwargs["instruct"] = self.voice
        with self._lock:
            audio = self.model.generate(**kwargs)
        buffer = io.BytesIO()
        sf.write(buffer, audio[0], SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return buffer.getvalue()


def make_handler(engine: Engine):
    class Handler(BaseHTTPRequestHandler):
        server_version = "JarvisOmniVoice/1.0"

        def log_message(self, fmt, *args):  # keep request text out of the logs
            LOG.debug("%s - %s", self.address_string(), fmt % args)

        def _json(self, status: int, payload: dict) -> None:
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _reject_browser(self) -> bool:
            # Only the Node server may call this service; browsers send an Origin header.
            if self.headers.get("origin"):
                self._json(403, {"error": "Browser requests are not allowed."})
                return True
            return False

        def do_GET(self):
            if self.path != "/health" or self._reject_browser():
                if self.path != "/health":
                    self._json(404, {"error": "Not found."})
                return
            self._json(200, {
                "engine": "omnivoice",
                "ready": engine.ready,
                "device": engine.device,
                "languages": sorted(LANGUAGES),
                **({"error": engine.error} if engine.error else {}),
            })

        def do_POST(self):
            if self.path != "/tts":
                self._json(404, {"error": "Not found."})
                return
            if self._reject_browser():
                return
            try:
                length = int(self.headers.get("content-length", "0"))
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BODY_BYTES:
                self._json(400, {"error": "Invalid request size."})
                return
            try:
                body = json.loads(self.rfile.read(length))
                text = " ".join(str(body.get("text", "")).split())
                language = "hi" if body.get("language") == "hi" else "en"
            except (ValueError, AttributeError):
                self._json(400, {"error": "Invalid JSON."})
                return
            if not text or len(text) > MAX_TEXT_CHARS:
                self._json(400, {"error": "Text is empty or too long."})
                return
            if not engine.ready:
                self._json(503, {"error": engine.error or "OmniVoice is still loading."})
                return
            try:
                wav = engine.synthesize(text, language)
            except Exception as error:  # noqa: BLE001
                LOG.error("Synthesis failed: %s", type(error).__name__)
                self._json(500, {"error": "Speech generation failed."})
                return
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description="Local OmniVoice TTS sidecar for J.A.R.V.I.S.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("OMNIVOICE_PORT", "4175")))
    parser.add_argument("--model", default=os.environ.get("OMNIVOICE_MODEL", "k2-fsa/OmniVoice"))
    parser.add_argument("--device", default=os.environ.get("OMNIVOICE_DEVICE"), help="cuda:0, mps, xpu or cpu (default: auto)")
    parser.add_argument("--num-step", type=int, default=int(os.environ.get("OMNIVOICE_STEPS", "16")),
                        help="diffusion steps; 16 is fast, 32 is higher quality")
    parser.add_argument("--voice", default=os.environ.get("OMNIVOICE_VOICE"),
                        help='optional voice design, e.g. "male, low pitch, british accent"')
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    engine = Engine(args.model, args.device, args.num_step, args.voice)
    # Bind loopback only. Model loads in the background so /health answers immediately.
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(engine))
    threading.Thread(target=engine.load, daemon=True).start()
    LOG.info("OmniVoice sidecar listening on http://127.0.0.1:%d", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
