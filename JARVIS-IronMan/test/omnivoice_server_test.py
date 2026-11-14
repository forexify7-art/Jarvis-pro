"""Protocol tests for voice/omnivoice-server/server.py using a stub engine (no model needed)."""
import importlib.util
import json
import pathlib
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

path = pathlib.Path(__file__).resolve().parents[1] / "voice/omnivoice-server/server.py"
spec = importlib.util.spec_from_file_location("omnivoice_sidecar", path)
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)


class StubEngine:
    ready = True
    device = "stub"
    error = None

    def __init__(self):
        self.calls = []

    def synthesize(self, text, language):
        self.calls.append((text, language))
        return b"RIFF" + b"\0" * 40


class SidecarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = StubEngine()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), sidecar.make_handler(cls.engine))
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join(timeout=2)

    def post(self, body, headers=None):
        request = urllib.request.Request(
            f"{self.base}/tts", data=json.dumps(body).encode(), headers={"content-type": "application/json", **(headers or {})}
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            try:
                return error.code, error.read()
            finally:
                error.close()

    def test_health_reports_languages(self):
        with urllib.request.urlopen(f"{self.base}/health") as response:
            data = json.loads(response.read())
        self.assertTrue(data["ready"])
        self.assertEqual(data["languages"], ["en", "hi"])

    def test_hindi_text_is_passed_through_with_language(self):
        status, body = self.post({"text": "  नमस्ते   दुनिया ", "language": "hi"})
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith(b"RIFF"))
        self.assertEqual(self.engine.calls[-1], ("नमस्ते दुनिया", "hi"))

    def test_unknown_language_defaults_to_english(self):
        self.post({"text": "hello", "language": "xx"})
        self.assertEqual(self.engine.calls[-1], ("hello", "en"))

    def test_rejects_empty_oversized_and_browser_requests(self):
        before = len(self.engine.calls)
        self.assertEqual(self.post({"text": ""})[0], 400)
        self.assertEqual(self.post({"text": "a" * 1300})[0], 400)
        self.assertEqual(self.post({"text": "hi"}, {"origin": "https://evil.example"})[0], 403)
        self.assertEqual(len(self.engine.calls), before)

    def test_unknown_route_is_404(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(f"{self.base}/other")
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()


if __name__ == "__main__":
    unittest.main()
