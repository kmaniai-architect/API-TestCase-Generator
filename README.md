# API Test Case Generator

Describe an API call (by hand, from an API-documentation PDF, or from a Swagger/OpenAPI URL), generate a test suite
with offline rules or an LLM, tick the cases you want, and export them as **CSV**, **JSON** or a ready-to-run
**Postman collection**. Past suites live in the left sidebar (like a chat history) and are saved in `testcase.db`
(SQLite, built into Node 22.5+; set `DB_FILE` in `.env` to move it), so they survive restarts.

## Generation modes (Manual / AI toggle)

| Mode | How it generates | Needs |
|---|---|---|
| Manual | Offline, deterministic rules built from your request/response bodies | Nothing |
| AI | An LLM infers business rules and writes the cases (only the LLM's cases are listed — Manual rule cases are not mixed in) | One API key in `.env` |

## Input Mode

The **Input Mode** section has three tabs. Whatever you pick fills the same form (method, endpoint, request body,
response body), which you can still edit before generating.

| Tab | What it does |
|---|---|
| ✍ **Manually** (default) | Type the method, endpoint and bodies yourself. |
| 📄 **PDF Based** | Choose an API-documentation PDF. Every endpoint found is listed in a table (method, endpoint, request, response); click **Use** on a row to fill the form. Text is read in your browser — the PDF is not uploaded (the PDF reader, pdf.js, is loaded from cdnjs, so first use needs internet). |
| 🔗 **Swagger / URL Based** | Paste an OpenAPI/Swagger **JSON** URL to list all its operations (example bodies are taken from the spec or built from its schemas), or paste an endpoint that returns JSON to use that response as the expected response. YAML specs are not supported yet. |

Supported PDF layouts (scanned/image-only PDFs can't be read):

```
API 1:                                   POST /v1/users
Endpoint : https://host/posts/1          Request:  { "name": "John" }
Method : Get                             Response: { "id": 1 }
Request : { title: 'foo' }
Response : { "id": 101 }
```

Request/response examples may be loose JSON (single quotes, unquoted keys, trailing commas, wrapped lines). If the PDF
only gives relative paths, a **Base URL** field appears. URLs are fetched by the local server (`/api/fetch-url`,
GET only, http/https, 15 s / 3 MB limits) so browser CORS rules don't get in the way.

## Request headers & authentication (optional)

A switch above the bodies — **off by default**, since the focus is manual test cases. When on you get:
- Authentication: none, Bearer token, API key (custom header name) or Basic username/password.
- An editable headers table (starts with `Content-Type` / `Accept: application/json`).
- Live validation (valid header names, no empty values/line breaks/duplicates) and a live preview of the final
  headers, with secrets masked until you click *Show secrets*.

Valid headers are used in the Postman export and given to the AI as context (secret values sent as `<redacted>`).
Invalid headers block **Generate** while the switch is on.

## Test case list

- Search, filter by type / priority / source, category chips, expandable rows with steps and expected result.
- Mark each case **Pass / Fail / Blocked**; progress ring shows how many are executed.
- A **checkbox column** (with select-all for the rows currently shown) chooses which cases to export.

## Exports (act on the ticked cases)

| Button | Result |
|---|---|
| ⬇ CSV (N selected) | `test-cases.csv` (UTF-8 with BOM so Excel shows special characters correctly) |
| ⬇ Postman (N selected) | Opens a dialog, then downloads a Postman Collection v2.1 |
| ⬇ JSON | All test cases with their Pass/Fail marks |

**Postman dialog**
- **Collection name** — used as the collection name and for the file names (remembered for next time).
- **Base-URL variable** (on by default) — requests keep only the path (`{{baseUrl}}/v1/users`); the collection stores
  the value, and an environment file can be downloaded too so you can switch dev/QA/prod by changing
  one variable. `{id}` path placeholders become `{{id}}`.
- **Files to download** — two checkboxes choose what you get: the **Collection** (`<name>.postman_collection.json`)
  and/or the **Environment** (`<name>.postman_environment.json`: the base URL plus every variable used in the
  auth/headers, with the values you entered). Both are on by default; at least one is required, and the
  environment option is disabled when there are no variables to export.
- **Headers** — the headers/auth set on the main page are attached to every request (read-only preview in the dialog).
- Each request carries a test script asserting the expected status code, and cases are grouped into one folder per
  category. The download button stays disabled until everything validates.
- **Auth as a variable** — tick *Use a Postman variable instead of the real value* (next to the auth fields) and the
  requests carry e.g. `Bearer {{authToken}}`. The real token is optional and goes only into the environment file
  (type *secret*), never the collection, so when it changes you update one environment value instead of regenerating
  the tests. You can also type `{{anyVariable}}` straight into the auth fields (token, API key, username/password)
  or any header value; each variable is listed under *Variables used* with an optional value that goes to the
  environment file. For Basic auth with variables the collection uses Postman's own Basic auth
  (`{{user}}` / `{{pass}}`), since a header can't compute base64.
- Without the variable option, credentials are written into the downloaded file in plain text — don't share it.

## History sidebar

- Nothing is added to the history automatically. After generating, a **Save test suite?** popup asks for a name
  (**Save to history** / **Not now**); the **💾 Save** button in the results toolbar saves later (it turns into
  **✓ Saved** once stored). Saved suites can be renamed, deleted and searched, and their Pass/Fail marks are stored too.
- Entries are grouped by date (**Today, Yesterday, Previous 7 days, Previous 30 days, Older**). Click a heading to
  expand/collapse it — Today and Yesterday start open, the rest closed, and your choice is remembered. Searching
  opens every group so no match is hidden.
- Each entry shows its **Input** (✍ Manually · 📄 PDF · 🔗 Swagger · 🔗 URL, with the file name or URL) and whether the
  cases came from the Manual rules or an LLM. An entry still counts as imported if you only fill in `{id}` values or
  add a query string.

## Supported LLM providers

Gemini · Claude (Anthropic) · OpenAI · Groq · Mistral · DeepSeek · OpenRouter · Ollama (local, no key).

The provider and model are configured **only in `.env`** — there is no provider dropdown or key box in the UI. The
active LLM (e.g. *AI · Google Gemini · gemini-3.8-flash*) is shown in the badge at the top of the page and in the AI
options; if none is configured the page says so and **Generate** in AI mode is blocked with a pointer to `.env`.
The server uses `LLM_PROVIDER` if set, otherwise the first provider that has a key.

## Run

```
copy .env.example .env      # add the key(s) you have, e.g. GEMINI_API_KEY=...
npm start                   # http://localhost:3000   (no npm install needed — zero dependencies)
```

Restart the server after editing `.env` or pulling code changes (the database gains new columns on start-up), and
hard-refresh the page (Ctrl+F5). Manual mode needs no key; the page must be opened through the server (not as a file)
for history, URL import and AI mode.

Adding another OpenAI-compatible provider = one line in the `PROVIDERS` table in `server.js`.

## Structure

```
server.js          static server + API: /api/status, /api/generate (provider adapters via fetch),
                   /api/suites (SQLite history), /api/fetch-url (URL import proxy)
.env.example       all supported keys / model overrides
public/
  index.html, css/styles.css
  js/  config        shared state and constants
       utils         helpers
       generator     Manual (offline rules) engine
       input         method / endpoint / body inputs
       import        Input Mode tabs: PDF + Swagger/URL parsing and the operations table
       mode          Manual/AI toggle, "LLM in use" display
       agent         Generate flow + progress, LLM call
       ui            dashboard, test case table, checkbox selection
       export        CSV / JSON export
       postman       headers & auth editor + Postman collection/environment export
       history       sidebar (date groups, input-mode labels)
       main          start-up
```
