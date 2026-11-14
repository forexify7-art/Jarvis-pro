# J.A.R.V.I.S. - Read-only Browser Use integration

J.A.R.V.I.S. has an optional, read-only Browser Research feature backed by the
Browser Use Python package in this folder. The Node app proxies one public page
URL and one research question to a loopback-only Python service.

## Run locally

Requires Python 3.11 or newer, Node.js 22.12 or newer, and Chromium. From the
repository root, create an isolated Python environment and install the
optional service and its Browser Use dependencies:

```bash
python3 -m venv .venv-browser
source .venv-browser/bin/activate
python -m pip install ./browser uv
browser-use install
```

On Windows, activate with `.venv-browser\Scripts\activate` instead.

Start the service in one terminal:

```bash
python3 browser/jarvis_browser_service.py
```

Then start J.A.R.V.I.S. in another terminal:

```bash
npm start
```

Enable **Full Access** in J.A.R.V.I.S., open Chat, choose **Read page**, enter
a public HTTP(S) URL and a question, and select **Read and summarize**. The
service binds only to `127.0.0.1:4174`; it has no CORS interface and is not
intended to be exposed publicly. It also rejects browser-originated requests;
the Node server is the only supported caller. Browser Research uses the AI provider already
configured in J.A.R.V.I.S. and passes its credential to the service over
loopback for the duration of a request. Keys are not written to disk or logged.

The app reports an explicit error if the optional service is not running or
Browser Use cannot launch a browser.

## Safety boundaries

- Each task starts with a user-entered public URL. IP literals, localhost,
  private or non-public DNS results, and local/test hostnames are rejected.
- Browser Use is limited to the requested hostname and blocks IP-address
  navigation. It gets an isolated temporary browser profile, no default
  extensions, and no existing browser cookies or saved credentials.
- The agent receives only read-oriented tools. Clicking, typing, form
  submission, downloads, file access, JavaScript evaluation, tab management,
  and navigation to other hosts are excluded from its action registry.
- Page text is treated as untrusted input. Results are displayed as text, not
  interpreted as HTML. No browser content is stored in chat history.
- Requests require J.A.R.V.I.S. API authorization and are limited to five per
  minute. Each task is bounded by a step limit and timeout.
- Browser Research is not an SSRF/network firewall. Only use it with trusted
  public sites; the browser's own outbound network remains subject to the
  machine's network policy.

## Upstream bundle

`browser_use/`, `pyproject.toml`, `README.md`, and `LICENSE` are the supplied
Browser Use source bundle. Keep its Python code separate from `public/`; the
Node app communicates with it only through the local service. The included
upstream package license remains in `LICENSE`.

Upstream source: https://github.com/browser-use/browser-use
