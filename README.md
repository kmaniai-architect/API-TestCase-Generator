# API Test Case Generator

Describe an API call (by hand, from an API-documentation PDF, or from a Swagger/OpenAPI URL), generate a test suite
with offline rules or an LLM, tick the cases you want, and export them as **CSV**, **JSON** or a ready-to-run
**Postman collection**. Past suites live in the left sidebar (like a chat history) and are saved in `testcase.db`
(SQLite, built into Node 22.5+; set `DB_FILE` in `.env` to move it), so they survive restarts.

## Look & feel

A ☀️/🌙 switch in the top-right corner toggles **dark mode**. It follows your OS setting until you pick one, and then
remembers your choice. Buttons have a ripple, cards/stats/history items lift on hover, dialogs fade and spring in, and
keyboard focus is clearly outlined.

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
| 📄 **PDF Based** | Choose an API-documentation PDF. Every endpoint found is listed in a table (method, endpoint, request, response); click **Use** on a row to fill the form. Text is read in your browser — the PDF is not sent anywhere (the PDF reader, pdf.js, is loaded from cdnjs, so first use needs internet). |
| 🔗 **Swagger / URL Based** | Paste an OpenAPI/Swagger **JSON** URL to list all its operations (example bodies are taken from the spec or built from its schemas), or paste an endpoint that returns JSON to use that response as the expected response. YAML specs are not supported yet. |

If a URL fails with a certificate error, see [Troubleshooting](#troubleshooting).

Each tab keeps its **own** form values, import results and generated test cases: switching from Manually to PDF to Swagger
shows a clean tab each time, and switching back restores exactly what you had there (until you reload the page).

**Partial documents are fine.** Every reader runs, and whatever a section contains is used: the heading can be `API-01 …`,
`POST /users` or a numbered title (`4.1 Create Invoice`); the method / URL may come from an *Attribute | Value* table, from
`Method: POST` / `URL: …` lines, or from the heading itself; the request can come from a field table, a *Sample Request* or a
JSON block; the response from a *Sample Response*, a *Response* JSON block or a field table. Whatever is missing is listed
under that endpoint in the import table (⚠ *missing: request body, response sample, headers*) and counted in the
verification step, instead of the read failing. If the same endpoint shows up in several places (e.g. the summary table and
its own section) the pieces are merged into one row.

**Validate → format → scrutinise.** Whatever the readers produce is checked before it is shown: field names must look like field
names (a "request" made of sentences, bullets or `Response->id(int)` keys is a mis-read and is **discarded**, not displayed),
URLs are normalised (`/users/:id` → `/users/{id}`, `api.host.com/v1` → `https://…`, a bare path gets the document's *Base URL*),
and every `POST /path` the text mentions is compared with what was found. If the result is not trustworthy — unreadable blocks,
mentioned endpoints not captured, or half the endpoints incomplete — and an LLM is configured, the AI step runs **automatically**.
Each endpoint has a **Details** toggle with clean tables (headers, request fields, response fields, status codes) and its
**scrutiny notes** (e.g. *response sample and field table differ*, *required request field missing*, *method has no body*, *URL has
no host*, *"patch?" – method uncertain*).

Messy prose documents are handled too: sections are found by any heading style (`API-01 …`, `POST /users`, `Get User GET /users/:id`,
`2. Create user [POST] /users`, `1) Login`), bullet lists of fields, a mixed *Field | dtype | Mandatory? | Req/Resp* table (split by its
Req/Resp column, "same as above" expanded), JSON samples broken across lines, and summary tables listing `GET/POST/PUT/DELETE`.

**AI-assisted reading with learning (RAG).** The built-in readers run first. If nothing is found — or important details are
missing (request body / response sample) — and an LLM is configured in `.env`, the fifth checklist step takes over:
1. the PDF text is cut into passages (one per API section where possible, else per page; tables are flattened to `a | b | c`);
2. **retrieval** picks the passages most likely to describe APIs (verbs, paths, *request/response/headers* wording), so even
   very large PDFs fit the model's limit;
3. the most similar **earlier examples** are retrieved and shown to the model as few-shot guidance — a "supervised" loop
   that gets better with use: every PDF that is read cleanly stores its endpoints as *auto* examples, and every endpoint you
   generate tests from (the final request/response in the form) is stored as a *confirmed* example, weighted higher;
4. the LLM returns each API as **normalised tables** (headers, request fields, response fields, status codes, notes — never inventing
   endpoints or fields); the **server builds the request/response JSON from those tables** (names validated, types → sample values,
   enums, nesting) and scrutinises it; the result is the primary one and the built-in readers only fill what it left out.
When nothing is found the AI runs automatically; when only details are missing a **✨ Fill the gaps with AI** button appears
(so you decide whether to spend a call). Learned examples are kept only in your local `testcase.db` (table `pdf_examples`) and
sent to your LLM provider only as the few-shot examples of an AI-assisted read; a **forget** link under the checklist clears them.
This is retrieval-based learning, not model training: the model itself is never changed.

When you choose a PDF, a checklist runs and shows each result as it happens:
1. **Upload** — the file is loaded into the browser with progress (it is not sent to any server); non-PDF names, empty files and files over 25 MB are rejected.
2. **Check the PDF file** — real `%PDF` header, not password-protected, opens correctly; shows the PDF version and page count.
3. **Read the text** — counts the text lines; a PDF with no selectable text (scanned images) is reported as unreadable.
4. **Verify the content** — says which layout was recognised (table, label | value tables, labelled blocks, plain lines), how many
   endpoints were found, and warns about POST/PUT/PATCH endpoints without a request body, endpoints without a response sample,
   duplicate method + URL pairs, relative paths (need a Base URL), URLs that do not look valid, and tables matched by order.

**Tables in the PDF** are read by their position on the page, so wrapped text, centred headers and tables that span
pages work:
- **API specification documents with one section per endpoint** (e.g. *API-01 User Login*): each section's
  *Attribute | Value* table (Method, Endpoint, Full URL …), *Request Headers*, *Path / Query Parameters*, *Request Body Fields*,
  *Response Fields*, *Status Codes* and *Sample Response* are read. The **request JSON is built from the Request Body Fields
  table** (names like `address.city` / `items[].productId` become nested objects; values come from the data type, an
  `A | B | C` enum in the description, or the field name); the **response is the Sample Response JSON**, or is built from the
  Response Fields table. Summary tables, common-header/common-error sections and repeated page headers/footers are ignored;
  the Base URL is taken from the document when a section only gives a path;
- an *operations table* — columns **Endpoint, Method** plus any of **Header, Source, Destination, Operation** — gives the
  endpoint list (header/source/destination show under each endpoint);
- the same details laid out **vertically** — one small table per API with the label in the left column and the value beside
  it (`Endpoint | https://…`, `Method | POST`, `Header | …`, `Source | …`, `Destination Operation | …`, optionally `Request` /
  `Response` rows holding JSON);
- *request-parameter* and *response* tables — columns **Name/Parameter/Field**, **Type**, **Required**, **Sample/Example**,
  **Description** — are turned into JSON bodies (`address.city` becomes a nested object, `items[0].id` an array). A table is
  matched to its endpoint by its heading (`API 2`, the operation name or the last path segment); otherwise by document
  order, and the page tells you when it had to guess;
- sample data given as plain JSON blocks instead of tables is used for whatever is still missing, when the counts match.

Other supported layouts (scanned/image-only PDFs can't be read):

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

## Troubleshooting

**URL import: `Could not reach … unable to get issuer cert locally` (or `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `SELF_SIGNED_CERT_IN_CHAIN`)**

Your network (corporate proxy, VPN or antivirus) re-signs HTTPS traffic with its own root certificate, which Node does not
trust by default. Try, in this order:

1. **Update Node** to 22.19+ / 24.5+. The server then also trusts the operating system's certificate store, where your IT
   department's root CA normally lives — no configuration needed. Check with `node -v`.
2. **Give Node the root CA** (export it from the Windows certificate store as Base-64 `.pem`, or ask IT):
   ```
   $env:NODE_EXTRA_CA_CERTS="C:/certs/corp-root.pem"; npm start        # PowerShell
   node --use-system-ca server.js                                       # alternative on newer Node
   ```
3. **Testing only:** add `IMPORT_INSECURE_TLS=true` to `.env` and restart. URL imports then skip certificate verification
   (GET only, size/time capped). Don't leave this on for untrusted URLs.

Restart the server after any of these.

**AI mode: `HTTP 503 … high demand` (or 429 / 500 / 502 / 504)**

The provider is overloaded or rate-limiting you — temporary, not a problem with your key. The server now retries up to 3 times
(after 2 s, 6 s, 15 s, or the provider's `Retry-After`) before giving up. If it keeps failing, wait a minute and press Generate
again, or add a second model to fall back to in `.env`, e.g. `GEMINI_FALLBACK_MODEL=<another model name>` (the same pattern works
for every provider: `OPENAI_FALLBACK_MODEL`, `ANTHROPIC_FALLBACK_MODEL` …). The model that actually answered is shown on the
AI badge of each case.

**AI mode: `… returned HTTP 403` (or 401)**

The provider rejected the API key. The error now includes the provider's own explanation — read that first. Typical causes:
- the key is wrong/incomplete, belongs to a different provider than `LLM_PROVIDER`, or `.env` was edited without restarting the server;
- the key is not enabled for the API (Gemini: turn on the *Generative Language API* for the key's project, and remove any
  IP/app restriction on the key), or billing/quota is not active;
- your country/region is not supported by the provider, or a VPN/proxy is blocking the request;
- the key was revoked (e.g. it was pasted somewhere public) — create a new one.

**AI mode: `Cannot connect to … (no answer within 10 s)` / `Could not reach … timeout`**

Your machine cannot reach the provider (for Gemini: `generativelanguage.googleapis.com`) — a firewall, VPN, missing proxy
setting, or a blocked region. The server checks connectivity first so you hear about it after 10 s instead of minutes.
1. Test from PowerShell: `Invoke-WebRequest https://generativelanguage.googleapis.com -UseBasicParsing` — if that also hangs, it is the network.
2. Behind a proxy, add `HTTPS_PROXY=http://proxy-host:port` (and optionally `NO_PROXY=localhost,127.0.0.1`) to `.env` and
   restart; the server then routes its outgoing calls through it (Node 22.21+/24+).
3. Try another network (e.g. a phone hotspot), another provider whose host is reachable, or Ollama (local, no internet).

**Other quick checks**
- *"Server not reachable" / history not saving* — open the app through `npm start` (http://localhost:3000), not the HTML file.
- *AI mode says no LLM configured* — add a key to `.env` (e.g. `GEMINI_API_KEY`) and restart.
- *PDF says no endpoints found* — the PDF must contain selectable text (not scanned images) in one of the layouts above.
  The message includes a **What was read from the PDF** panel listing every text line with its column position; if a
  layout still isn't recognised, copy that panel's text — it shows exactly what the reader saw.
- *Page looks stale after an update* — hard-refresh with Ctrl+F5.

## Structure

```
server.js          static server + API: /api/status, /api/generate (provider adapters via fetch),
                   /api/suites (SQLite history), /api/fetch-url (URL import proxy)
.env.example       all supported keys / model overrides
public/
  index.html, css/styles.css, css/polish.css (theme + interaction polish)
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
       theme         dark-mode switch + button ripple
       main          start-up
```
