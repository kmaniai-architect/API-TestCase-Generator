# API Test Case Generator

One app, two engines — switch with the **Manual / AI** toggle. Past suites live in the left sidebar (like a chat history) and are saved in `testcase.db` (SQLite, built into Node 22.5+; set `DB_FILE` in `.env` to move it), so they survive restarts.

| Mode | How it generates | Needs |
|---|---|---|
| Manual | Offline, deterministic rules built from your request/response bodies | Nothing |
| AI | Any LLM infers business rules and writes the cases (optional baseline of Manual cases merged in) | One API key |

## Supported LLM providers
Gemini · Claude (Anthropic) · OpenAI · Groq · Mistral · DeepSeek · OpenRouter · Ollama (local, no key).
Configure them in `.env`; the AI dropdown marks ✓ the ones that have a key. You can also paste a key in the page
(used for that session only) and override the model name.

## Run
```
copy .env.example .env      # add the key(s) you have, e.g. GEMINI_API_KEY=...
npm start                   # http://localhost:3000   (no npm install needed — zero dependencies)
```
Set `LLM_PROVIDER` in `.env` to choose the pre-selected provider. Manual mode needs no key and also works by opening
`public/index.html` directly.

Adding another OpenAI-compatible provider = one line in the `PROVIDERS` table in `server.js`.

## Structure
```
server.js          static server + /api/status + /api/generate (provider adapters via fetch)
.env.example       all supported keys / model overrides
public/
  index.html, css/styles.css
  js/  config, utils, generator (Manual engine), input, mode (toggle + provider picker),
       agent (Generate flow + progress), ui, export, history (sidebar), main
```
