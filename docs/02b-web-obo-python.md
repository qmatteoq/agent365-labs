# Lab A365-02B - Web App Agent with User OBO (Python)

> **Stack**: Python 3.12, LangChain, FastAPI **Duration**: around 3 hours **Level**: Intermediate

## Scenario

You have a working agent: a user opens a web page, asks a question, and the agent reasons over it, calls tools, and answers. The agent has no identity in the tenant, reports no activity, and does not appear in the tenant inventory.

**Microsoft Agent 365** gives the agent:

- An identity visible in the tenant inventory
- Activity reporting to **Microsoft Defender**, **Microsoft Purview**, and the **Microsoft 365 admin center**
- A governed path to Microsoft 365 data

In this lab you take a plain Python agent running in a FastAPI web app and onboard it to Agent 365 step by step. The auth path is **User On-Behalf-Of (OBO)**: the user signs in, and everything the agent does is attributed to that person using that person's permissions.

## Lab objectives

After completing this lab, you will be able to:

- Register an agent blueprint and an agent identity in Microsoft Entra with the Agent 365 CLI
- Explain why a blueprint cannot sign users in, and register the separate application that can
- Configure a Python FastAPI app from a gitignored `.env` file
- Acquire a user token addressed to the blueprint and verify its claims
- Build the two-hop agent on-behalf-of token chain that lets an agent act for a signed-in user
- Instrument a Python LangChain agent with OpenTelemetry and the Agent 365 exporter
- Emit the semantic spans Agent 365 accepts, attributed to the correct caller
- Explain the current Work IQ support gap for Python with LangChain
- Verify that activity arrives in Defender and in the Microsoft 365 admin center

## Prerequisites

Complete the [prerequisites page](./00-prerequisites.md) before you start. You need Python 3.12, uv, the .NET 8 SDK for the Agent 365 CLI, the Agent 365 CLI itself, an Azure OpenAI resource, a tenant with Agent 365 enabled and at least one Agent 365 licence, and access to an administrator who can grant consent twice.

The starting point is the Python sample agent:

```bash
git clone https://github.com/qmatteoq/agent365-runbook
cd agent365-runbook/01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point/python
```

That folder contains a FastAPI web app backed by LangChain, Azure OpenAI and the official [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp). It includes the Microsoft Entra sign-in code that the OBO path depends on, but the sign-in stays dormant until you fill in the settings in Exercise 2.

## How the exercises work

From Exercise 3 onwards, most steps follow the same structure:

1. **What you type**, the prompt you give your coding assistant.
2. **What the skill does**, the changes it makes.
3. **Behind the scenes**, the CLI command or code it comes down to.
4. **How to verify**, how to confirm it worked before you move on.

To do everything by hand, read parts 3 and 4 and skip the rest. Exercise 2 is the exception: signing users in with Entra is ordinary web app work, not an Agent 365 task, so no skill covers it.

---

## Exercise 1: Run the agent as it is

Confirm that the agent works before adding anything. Start from a known-good baseline so that any failure after this point is something you introduced.

### Step 1: Configure the Azure OpenAI connection

The agent calls a model deployed in Azure OpenAI.

Copy `.env.example` to `.env`, then fill in the Azure OpenAI values from the prerequisites:

```bash
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=<your-deployment-name>
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_TENANT_ID=<tenant that owns the Azure OpenAI resource>
```

`.env` is gitignored, while `.env.example` is committed. The example file shows the settings the sample understands; the real file holds tenant-specific values outside source control.

> The tenant id is required when you work across more than one tenant. Without it, the credential returns a token from whichever tenant you last signed in to, which may not own the Azure OpenAI resource. The service responds with `HTTP 400` and `Tenant provided in token does not match resource token`. Pin the tenant to avoid this.

### Step 2: Decide how the agent authenticates to Azure OpenAI

The sample supports two authentication methods and chooses between them at startup: if an API key is configured it uses key auth; otherwise it uses Entra credentials.

|  | **Path A: Entra credentials** *(recommended)* | **Path B: API key** |
| --- | --- | --- |
| What it uses | `AzureCliCredential` locally, with `DefaultAzureCredential` when `AZURE_OPENAI_USE_MANAGED_IDENTITY=true` | A resource key, sent as a bearer secret |
| What you configure | Nothing beyond Step 1, you just need to be signed in | The key itself, kept in `.env` |
| What you need access to | The **Cognitive Services OpenAI User** role on the resource | The resource keys |
| Why you would pick it | No long-lived secret to leak or rotate; carries a real identity; only option in tenants where key auth is disabled by policy | Environments that still depend on keys |

For **Path A**, no additional configuration is needed for local development. Sign in to the tenant that owns the Azure OpenAI resource:

```bash
az login --tenant <tenant of the Azure OpenAI resource>
```

The Python sample uses `AzureCliCredential` locally, avoiding a managed identity endpoint lookup on your laptop. When hosting the app on Azure, set this value in the hosting environment:

```bash
AZURE_OPENAI_USE_MANAGED_IDENTITY=true
```

That setting makes the code use `DefaultAzureCredential`, which picks up the managed identity assigned to the Azure host.

For **Path B**, keep the key in `.env`, which is gitignored:

```bash
AZURE_OPENAI_API_KEY=<your-key>
```

Confirm `.env` is ignored before pasting a key into it. The repository's root `.gitignore` ignores `.env` while keeping `.env.example`.

### Step 3: Run the agent and ask it something

```bash
uv sync
uv run uvicorn app.main:app --reload
```

`uv sync` creates the virtual environment and installs dependencies from the lock file. The second command starts the FastAPI app with reload enabled. Open `http://localhost:8000` in a browser and ask a question:

```text
What is Microsoft Entra Conditional Access?
```

The agent should return a proper answer with links to Microsoft Learn, because it grounds its answers in the Learn MCP server.

> ✅ **Checkpoint.** The agent answers questions and cites its sources. There is still no trace of Agent 365 anywhere.

---

## Exercise 2: Sign users in with Microsoft Entra

This exercise is not specific to Agent 365. You register an ordinary Entra application, point the agent at it, and review the sign-in code that ships in the sample.

The OBO path attributes everything the agent does to the signed-in user, so a working sign-in is a prerequisite. One piece is missing at the end: the token this sign-in produces must be addressed to the agent's blueprint, which does not exist until Exercise 3. This exercise creates the sign-in client and fills in the settings; Exercise 3 supplies the last value and activates the sign-in.

### Step 1: Create the app registration that signs users in

Entra only redirects users back to an application it knows about.

1. Go to the [Entra admin center](https://entra.microsoft.com) and navigate to **Identity**, then **Applications**, then **App registrations**.
2. Select **New registration**.
3. Enter a descriptive name, such as `my-agent-web-signin`. Exercise 3 adds two more identities for this agent.
4. For **Supported account types**, choose **Accounts in this organizational directory only (Single tenant)**.
5. Under **Redirect URI**, select the **Web** platform and enter `http://localhost:8000/signin-oidc`, which matches the FastAPI callback route and the `AZURE_AD_REDIRECT_URI` value in `.env.example`.
6. Select **Register**.

Copy the **Application (client) ID** and the **Directory (tenant) ID** from the **Overview** blade. You need both in Step 3.

> The redirect URI must match what the browser sees, including the scheme. Registering `https` and running the app over `http` produces `AADSTS50011`.

> `localhost` and `127.0.0.1` are not interchangeable. The browser treats them as different origins and scopes the session cookie accordingly. If you register the callback on `localhost` and browse the app on `127.0.0.1`, the cookie set before the redirect is not sent back, and the sign-in fails.

If you prefer the command line, the registration is one command:

```bash
az ad app create --display-name "my-agent-web-signin" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "http://localhost:8000/signin-oidc"
```

That command creates only the registration. You still need a client secret, which is the next step.

### Step 2: Create a client secret

1. In the same registration, go to **Certificates & secrets**.
2. On the **Client secrets** tab, select **New client secret**.
3. Give it a description and pick an expiry.
4. Select **Add**, then **copy the Value immediately**.

The value is shown once. Store it in the gitignored `.env` file, not in `.env.example`.

The **API permissions** blade should show **Microsoft Graph** with `User.Read`, which is sufficient. MSAL adds the OIDC scopes to the request itself, and the sample never calls Graph. There is nothing to add here and nothing that requires an administrator. You return to this blade in Exercise 3 to point this registration at the agent's blueprint.

### Step 3: Fill in the sign-in settings

The sign-in settings live in `.env`. `.env.example` lists them with the redirect URI filled in and the rest blank:

```bash
AZURE_AD_TENANT_ID=
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_REDIRECT_URI=http://localhost:8000/signin-oidc
AGENTS365OBSERVABILITY__AGENTBLUEPRINTID=
```

Fill in `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID` and `AZURE_AD_CLIENT_SECRET` from the registration you just created. Leave `AGENTS365OBSERVABILITY__AGENTBLUEPRINTID` blank for now.

The double underscore in `AGENTS365OBSERVABILITY__AGENTBLUEPRINTID` follows the .NET configuration convention deliberately, because the Agent 365 tooling and instrumentation expect that name. `app/config.py` maps it with Pydantic and derives the blueprint scope in one place:

```python
agent_blueprint_id: str | None = Field(
    default=None,
    validation_alias="AGENTS365OBSERVABILITY__AGENTBLUEPRINTID",
)

@property
def agent_blueprint_scope(self) -> str:
    blueprint_id = (self.agent_blueprint_id or "").strip()
    if not blueprint_id:
        raise RuntimeError("The agent blueprint id is not configured.")

    return f"api://{blueprint_id}/access_agent_as_user"
```

The scope is `api://<blueprint-id>/access_agent_as_user`. It must be identical in the sign-in request, in the token acquisition, and in any debugging. A typo in any copy produces a token with the wrong audience.

### Step 4: See how the app decides whether to sign anybody in

The app reads its configuration at startup and checks whether every required sign-in value is present. If anything is missing, it skips authentication and behaves as it did in Exercise 1. If everything is there, it wires up the sign-in. This follows the same pattern as the Azure OpenAI key switch from Exercise 1, Step 2: the presence of configuration is the switch.

The decision lives in `app/config.py`:

```python
@property
def entra_sign_in_enabled(self) -> bool:
    required_values = [
        self.azure_ad_tenant_id,
        self.azure_ad_client_id,
        self.azure_ad_client_secret,
        self.azure_ad_redirect_uri,
        self.agent_blueprint_id,
    ]
    return all(value is not None and value.strip() for value in required_values)
```

`agent_blueprint_id` is one of the required values, so the app still starts anonymously after you fill in only the Entra settings. Exercise 3, Step 4 supplies the blueprint id and activates the sign-in.

`app/main.py` uses that property to decide whether to construct the auth service:

```python
auth_service = AuthService(settings) if settings.entra_sign_in_enabled else None
```

When `auth_service` exists, FastAPI includes the sign-in routes. When it does not, the app still serves `/api/me` with an anonymous response so the front end renders without treating a missing auth API as a broken page.

### Step 5: Read the sign-in code

The sign-in code produces an access token for the blueprint's scope, belonging to the signed-in user. The method is `acquire_user_assertion`, and that token (the *user assertion*) is the input to hop 2 of the token chain. Everything else in this step exists to produce it.

FastAPI has no built-in identity framework, so `app/auth.py` drives the authorization-code flow with MSAL. `AuthService` keeps a dictionary of sessions and hands the browser an opaque cookie that points into it. No token reaches the browser.

Going out to Entra:

```python
async def signin(self, request: Request) -> RedirectResponse:
    session_id = self._get_session_id(request) or self._new_session_id()
    session = self._sessions[session_id]
    flow = self._client.initiate_auth_code_flow(
        scopes=[self._settings.agent_blueprint_scope],
        redirect_uri=self._settings.azure_ad_redirect_uri,
    )
    session["flow"] = flow

    response = RedirectResponse(flow["auth_uri"])
    self._set_session_cookie(response, session_id)
    return response
```

`initiate_auth_code_flow` generates the state, nonce and PKCE verifier and returns them in the `flow` dictionary that MSAL validates on the callback. The `scopes` argument asks for `agent_blueprint_scope`, so the access token is addressed to the blueprint.

The session cookie is opaque and protected from browser script:

```python
response.set_cookie(
    SESSION_COOKIE_NAME,
    session_id,
    httponly=True,
    samesite="lax",
)
```

`httponly` prevents client-side code from reading the cookie. `samesite="lax"` allows the browser to send it on the redirect back from Entra (a `strict` cookie would be withheld on that callback).

Coming back, `/signin-oidc` completes the flow and stores the claims:

```python
result = self._client.acquire_token_by_auth_code_flow(
    session.pop("flow"),
    dict(request.query_params),
)
if "error" in result:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=result.get("error_description") or result["error"],
    )

claims = result.get("id_token_claims", {})
session["claims"] = claims
```

`session.pop("flow")` removes the flow object so a replayed callback cannot reuse it. An authorization-code flow is valid for one callback only.

This is the method the token chain calls on every chat turn:

```python
def acquire_user_assertion(self, request: Request) -> str:
    """Return a blueprint-scoped access token for the signed-in user."""
    session = self._get_session(request)
    if not session:
        raise AuthRequiredError("Sign in before chatting with the agent.")

    account = self._get_account(session)
    if not account:
        raise AuthRequiredError("Sign in before chatting with the agent.")

    result = self._client.acquire_token_silent(
        [self._settings.agent_blueprint_scope],
        account=account,
    )
    if not result or "access_token" not in result:
        raise AuthRequiredError("Sign in again so the app can get a user assertion.")

    return result["access_token"]
```

`acquire_token_silent` reads from the MSAL cache populated during sign-in and refreshes the token when possible. When MSAL cannot produce a token, the method raises `AuthRequiredError`, and `/api/chat` returns a 401.

The Python app differs from the .NET lab here: there is no `AuthorizeRouteView` or framework-owned redirect before the page renders. The page loads, `/api/me` reports who is signed in, and `/api/chat` returns 401 if there is no usable user assertion.

> ✅ **Checkpoint.** The sign-in client is registered, the app is pointed at it, and you have read the code that will use it. The sign-in is still dormant, because the scope it asks for is built from a blueprint id that does not exist yet.

---

## Exercise 3: Register the agent with Agent 365

This exercise gives the agent a tenant identity. Two objects are created, and the difference between them matters:

- The **blueprint** is the parent app registration. It holds the permissions and defines the agent.
- The **agent identity** is a child principal of that blueprint. It is the principal that acts, and that telemetry is attributed to.

The exercise ends by going back to the sign-in from Exercise 2 and supplying the missing value.

### Step 1: Run the setup skill

**What you type**

```text
Set up Agent 365 for this agent. It's a web app where users sign in,
not a Teams agent and not an AI Teammate. Use the OBO auth mode.
```

This prompt describes the scenario, not the language. The Agent 365 identities live in Entra, and the same registration path applies to the Python sample.

**What the skill does**

The `a365-setup` skill runs first. It checks the prerequisites, offers to install anything missing, and confirms which Azure identity you are signed in as. It asks two questions:

| Question | Your answer for this lab | Why |
| --- | --- | --- |
| Agent kind? | **Agent (Non AI Teammate)** | A human drives this agent, it has no mailbox or presence in Teams |
| Auth mode? | **`obo`** | Everything the agent does is attributed to the signed-in user |

Once you have answered, `a365-setup` hands off to `make-a365-agent`, which performs the actual registration.

**Behind the scenes**

The skill comes down to:

```bash
a365 setup all --agent-name "my-agent" --dry-run    # preview what will happen
a365 setup all --agent-name "my-agent"              # actually do it
```

Run the dry run first and read the output. `a365 setup all` is idempotent and safe to re-run.

It creates:

- An **agent blueprint** app registration with a client secret
- An **agent identity** as a child of that blueprint
- The API permissions the agent needs, including `Agent365.Observability.OtelWrite`
- A file called `a365.generated.config.json` with all generated identifiers

**How to verify**

Open `a365.generated.config.json` and confirm there is an `agentBlueprintId` and an agent identity id in it. Then go to the [Entra admin center](https://entra.microsoft.com), open **App registrations**, and confirm the blueprint is listed.

> ⚠️ If you are not a Global Administrator, read the CLI output carefully. It contains a consent snippet for an administrator to run. Until the consent is granted, the permissions exist but are not effective, and Exercise 4 fails with a consent error. This is the first of two admin handoffs.

### Step 2: Store the blueprint secret somewhere safe

`a365 setup all` generated a client secret for the blueprint. This secret proves, when you build the token chain in Exercise 4, that your code is allowed to act as this agent. It must not end up in source control.

Put it in `.env`:

```bash
AGENT365_BLUEPRINT_CLIENT_SECRET=<secret>
```

The runbook adds this value to the Python app during the observability work. It is not in the starting `.env.example`, but the same convention applies: real secrets go in the gitignored `.env`.

If you lose it, you can read it back on the same machine, signed in as the same user:

```bash
a365 setup blueprint --agent-name "my-agent" --show-secret
```

That command prints the generated blueprint secret. Treat the output the same way you treated the original value.

### Step 3: Give the sign-in app permission to call the blueprint

Exercise 2 gave you an app that can authenticate a user. Step 1 gave you a blueprint. You now need a token that links them, which is the purpose of the OBO path.

A blueprint is an **agentic application**, and Microsoft Entra bars agentic applications from interactive `/authorize` flows. A blueprint cannot present a sign-in page. That is why Exercise 2 registered a separate, ordinary application.

This lab has three identities:

| Identity | Who creates it | What it does |
| --- | --- | --- |
| **Sign-in client** | You, in Exercise 2 | Signs the user in, and requests the blueprint's scope |
| **Blueprint** | `a365 setup all` | Owns the permissions, and authenticates hop 1 of the token chain |
| **Agent identity** | `a365 setup all` | The principal the agent acts as, and that spans are exported as |

Keep `a365.generated.config.json` open; you need the **blueprint's app id** twice below.

1. In the sign-in registration, go to **API permissions**.
2. Select **Add a permission**.
3. Choose the **APIs my organization uses** tab.
4. Paste the **blueprint's app id** into the search box and select it.
5. Choose **Delegated permissions**.
6. Tick **`access_agent_as_user`**.
7. Select **Add permissions**.
8. Select **Grant admin consent for \<your tenant\>**.

Step 8 requires an administrator, because `access_agent_as_user` is not a user-consentable permission. If the button is greyed out, this is the second admin handoff. A permission that is recorded but not consented to has no effect.

> If the blueprint does not appear in the search, search by its app id. The CLI appends `" Blueprint"` to the name you chose, so the display name may not match. If the API exposes no scopes, open the **blueprint's** registration, go to **Expose an API**, select **Add a scope**, create a scope named exactly `access_agent_as_user`, set **Who can consent?** to **Admins and users**, leave the state **Enabled**, and return here.

From the command line, the same two operations are:

```bash
# The scope id is on the blueprint's "Expose an API" blade
az ad app permission add --id <sign-in client app id> \
  --api <blueprint-app-id> --api-permissions <scope-id>=Scope

az ad app permission admin-consent --id <sign-in client app id>
```

`az ad app permission add` only records the permission. The consent grant on the second line makes it usable.

> You now have a blueprint secret and a sign-in client secret. The blueprint secret authenticates hop 1 of the token chain; the sign-in client secret authenticates the web sign-in. Do not swap them.

### Step 4: Give the app the blueprint id

Take `agentBlueprintId` from `a365.generated.config.json` and add it to `.env`:

```bash
AGENTS365OBSERVABILITY__AGENTBLUEPRINTID=<blueprint app id>
```

This value does two things:

- It completes the settings the startup check looks for, so the sign-in code from Exercise 2 activates.
- It supplies the resource half of `api://<blueprint-id>/access_agent_as_user`, which is the scope the sign-in requests.

The scope determines who the token is *addressed to*. Hop 2 of the token chain only accepts an assertion addressed to the blueprint (not `User.Read`, not the blueprint's `.default`).

Restart the app. The Python sample reads settings once at startup and does not pick up `.env` changes at runtime.

### Step 5: Verify the token you get back

Open the app. The Python app does not use Blazor's `AuthorizeRouteView`, so there is no automatic redirect. The line under the title should now show a sign-in path. Sign in, then send a message so `/api/chat` calls `acquire_user_assertion`.

Set a breakpoint on the `return result["access_token"]` line in `app/auth.py` and send a message. Copy the return value out of the debugger.

Paste it into [jwt.ms](https://jwt.ms) (decodes in the browser, sends nothing externally) and check four claims:

| Claim | What it should say |
| --- | --- |
| `aud` | The **blueprint's** app id, or `api://<blueprint-id>`, **not** the sign-in client's id |
| `scp` | It should contain `access_agent_as_user` |
| `oid` | The signed-in user's object id |
| `tid` | Your tenant id |

If `aud` is the sign-in client or Microsoft Graph, the scope was not requested correctly. The usual cause is a wrong or stale blueprint id from an earlier `a365 setup all` run.

Make a note of the `oid` value. Exercise 4, Step 7 uses it.

> ✅ **Checkpoint.** The agent is registered, it appears in the tenant, and users sign in with a token addressed to the blueprint. No telemetry is emitted yet.

---

## Exercise 4: Instrument the agent for observability

By the end of this exercise, every turn the agent takes produces telemetry attributed to the signed-in user, visible in **Defender**, **Purview** and the **Microsoft 365 admin center**.

The steps are:

1. Install the telemetry distro
2. Wire it into the app's startup
3. Obtain a token the exporter can use
4. Attach identity information to every turn
5. Wrap the turn in the span types Agent 365 accepts

### Step 1: Run the observability skill

**What you type**

```text
Instrument this agent with Agent 365 observability. It's an
Agent (Non AI Teammate) using the obo auth mode.
```

The prompt specifies `obo` because this is a user-driven web app. A Teams-hosted agent, or an agent acting without a signed-in user, would use a different path.

**What the skill does**

`instrument-observability` works through eight internal phases:

| Phase | What it changes |
| --- | --- |
| 0.5 | Confirms the agent kind and the auth mode. **Check that it says `obo`** |
| 1 | Detects your stack and loads the matching reference patterns |
| 2 | Installs the A365 OpenTelemetry distro |
| 3 | Wires the distro into your entry point |
| 4 | Adds a baggage scope to your message handler |
| 5 | Implements the token resolver |
| 5.5 | Adds the manual instrumentation scopes |
| 6 to 8 | Updates configuration, builds, and smoke-tests the result |

> Verify the auth mode before continuing. For this lab `obo` is correct. It is *not* correct for a Teams-hosted agent, and the skill has been known to choose it there anyway.

> The skill instruments a signed-in app; it does not create the sign-in. Phase 5 implements the token resolver on the assumption that something upstream provides a user assertion. That is the sign-in you activated in Exercise 3. Complete Exercise 3, Step 5 before running this.

The rest of this exercise walks through what those changes are. **If you ran the skill, you do not need to perform these steps.** Read them as an explanation of the code, and as a checklist if something is not working.

### Step 2: Install the distro

The Agent 365 telemetry support ships as an OpenTelemetry distro that adds the Agent 365 exporter and the span processing the service expects.

```bash
uv add microsoft-opentelemetry
```

That command updates the Python project's dependency metadata and lock file so the app can import `microsoft.opentelemetry`.

### Step 3: Wire the exporter into the entry point

Initialise the distro when the app starts. On Python, the distro must run before LangChain and the Azure OpenAI SDK are imported, because it patches them at import time.

At the very top of `app/main.py`, before importing `app.agent`, LangChain or the Azure OpenAI SDK, add:

```python
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(
    enable_a365=True,
    # Both flags are needed: enable_a365 only registers the span processors.
    a365_enable_observability_exporter=True,
    a365_token_resolver=token_store.get,
    # OBO posts to /observability/, so leave a365_use_s2s_endpoint at its default.
    enable_sensitive_data=True,
    disable_metrics=True,
)
```

There are two Agent 365 switches:

- `enable_a365` registers the span processors that shape the spans.
- `a365_enable_observability_exporter` ships them.

`a365_token_resolver` points at the token store you fill in later. `enable_sensitive_data` writes prompts and completions onto spans. `disable_metrics` suppresses metric output so you can focus on traces.

> Place this call before LangChain or the Azure OpenAI SDK are imported. If LangChain loads first, auto-instrumentation does not attach, and you get no `chat` spans.

### Step 4: Implement the two-hop token chain

The exporter needs a token to call the Agent 365 Observability API. The token must be issued to the agent identity, acting on behalf of the signed-in user. A plain delegated user token is rejected because its principal is the human, not the agent. Getting the right token takes two hops.

**Hop 1**: the blueprint proves that it owns the agent identity, and gets back an assertion.

```python
form = {
    "client_id": blueprint_client_id,
    "client_secret": blueprint_client_secret,
    "scope": "api://AzureADTokenExchange/.default",
    "fmi_path": agent_identity_client_id,
    "grant_type": "client_credentials",
}
# POST to https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
```

`fmi_path` turns an ordinary client-credentials call into an agent flow. It requests an assertion that allows acting as the child identity. The result is not an access token; it is only usable as a client assertion in hop 2.

**Hop 2**: the agent identity exchanges the user's token for the one you actually want.

```python
form = {
    "client_id": agent_identity_client_id,
    "scope": resource_scope,
    "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    "client_assertion": t1_token,          # proves which agent
    "assertion": user_access_token,        # proves for whom
    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
    "requested_token_use": "on_behalf_of",
}
```

The two assertions work together: `client_assertion` identifies the agent, and `assertion` identifies the user. The user token is the one you addressed to the blueprint in Exercise 3, obtained on every turn through `acquire_user_assertion()`. The result is a token representing the agent acting for that specific person.

On Python, MSAL supports `fmi_path` natively on `acquire_token_for_client` as of MSAL 1.37, so hop 1 needs no hand-written HTTP. The form posts above show the exact shape of the exchange.

**Cache both hops, and refresh a few minutes before expiry.** A token that expires mid-turn disables the export silently. The agent keeps answering and telemetry stops.

### Step 5: Bridge the token across to the exporter

The exporter flushes spans on a background loop, not on the request thread. There is no HTTP request and no signed-in user on that thread. The pattern is:

1. Acquire the token while the user context is available.
2. Store it in a dictionary keyed on agent id and tenant id.
3. Let the exporter read from the store (the reader you handed to the distro in Step 3).

```python
# In the /api/chat handler, before invoking the agent:
user_assertion = auth.acquire_user_assertion(request)
agent_token = obo_tokens.get_agent_token(user_assertion, OBSERVABILITY_SCOPE)
token_store.set(agent_identity_client_id, tenant_id, agent_token)
```

The starting point already calls `acquire_user_assertion` in `/api/chat` to reject anonymous callers with a 401. After instrumentation, keep the returned token and exchange it for the agent token the exporter needs.

> Do not acquire the token inside the resolver itself. By the time the resolver runs there is no user context to act on behalf of.

### Step 6: Open a baggage scope around every turn

**Baggage** is OpenTelemetry's mechanism for carrying contextual values alongside the current execution context. Agent 365 uses it to carry identity dimensions it partitions telemetry by: tenant, agent, user, and conversation.

Spans emitted outside an active baggage scope are dropped. The exporter logs `Partitioned into 0 identity groups`.

```python
with (
    BaggageBuilder()
    .tenant_id(tenant_id)
    .agent_id(agent_identity_client_id)
    .agent_name(agent_name)
    .agent_blueprint_id(blueprint_client_id)
    .conversation_id(conversation_id)
    .session_id(conversation_id)
    .user_id(user_id)
    .user_name(user_name)
    .user_email(user_email)
    .channel_name("web")
    .build()
):
    reply = await agent.ask(session_id, message)
```

The agent invocation must happen inside the `with` block.

`.agent_blueprint_id()` populates `TargetAgentBlueprintId` in reporting, which ties the activity to the blueprint registered in Exercise 3.

### Step 7: Resolve the caller correctly

The **Microsoft 365 admin center** needs the caller's **directory object id** to resolve the user. Any other identifier results in activity attributed to nobody (the export still returns `HTTP 200` and the row arrives, but it never resolves to a person).

The object id is the `oid` claim from Exercise 3, Step 5. Other nearby claims are not valid substitutes: `sub` is a pairwise identifier that differs per application, and the `nameidentifier` claim some frameworks map `oid` onto can be a different hash.

Read `oid` from the validated token claims stored on the server-side session:

```python
claims = session.get("claims") or {}
user_id = claims.get("oid") or "unknown"
user_name = claims.get("name") or "unknown"
user_email = claims.get("preferred_username") or ""
```

Use the ID token claims that MSAL validated during sign-in. Do not decode a later access token to find the user id.

### Step 8: Wrap the turn in the semantic scopes

Agent 365 only ingests spans whose `gen_ai.operation.name` is one of `invoke_agent`, `chat`, `execute_tool` or `output_messages`. Other spans are dropped.

The most important is `invoke_agent`. Open an `InvokeAgentScope` at the start of every turn. It becomes the root span for that turn. The **Microsoft 365 admin center** ingests only `invoke_agent` spans; **Defender** accepts all operation types.

```python
with InvokeAgentScope.start(
    request=Request(
        content=user_text,
        session_id=conversation_id,
        conversation_id=conversation_id,
        channel=Channel(name="web"),
    ),
    invoke_scope_details=InvokeAgentScopeDetails(endpoint=endpoint),
    agent_details=agent_details,
    caller_details=caller_details,
):
    reply = await agent.ask(session_id, message)
```

The session, conversation and channel must be on the request object, not only in baggage. Baggage values do land on span tags, but the exported `invoke_agent` payload is built from the request object. Omitting them exports a span with no run context.

On supported stacks, `chat` spans come from auto-instrumentation. On Python with LangChain, the distro must run before LangChain is imported. If `chat` spans are still missing after fixing the import order, you may need to wrap LLM calls with an inference scope manually.

### Step 9: Verify that the telemetry is actually leaving

Confirm from the app's own logs that spans are being exported. Turn on logging:

```powershell
$env:OTEL_LOG_LEVEL="INFO"
$env:A365_OBSERVABILITY_LOG_LEVEL="debug"
```

Both variables matter. `OTEL_LOG_LEVEL` controls the OpenTelemetry SDK diagnostics. `A365_OBSERVABILITY_LOG_LEVEL` controls the Agent 365 components.

Ask the agent a question and check the output for four things:

- `Partitioned into 1 identity groups`, **not 0**. Zero means the baggage scope is not active around the turn, so go back to Step 6.
- An `invoke_agent` span, and it must be a **root** span.
- `HTTP 200` on the export itself.
- The caller id in the payload is a **GUID**, not a long base64-looking hash. If it is the latter you are reading the wrong claim, so go back to Step 7.

> ✅ **Checkpoint.** The agent is registered and it is observable. This is another good place to stop.

---

## Exercise 5: Give the agent access to Microsoft 365 data

The .NET and Node.js versions of this lab give the agent access to Microsoft 365 data (Mail, Calendar and more) through the **Work IQ** MCP servers. That access uses the signed-in user's own permissions, so the agent cannot see anything the user could not already see.

Python with LangChain is different at the time of writing. Work IQ is not available for this stack yet. Keep this exercise for parity with the other labs, but treat it as read-only and return when support lands.

### Step 1: Run the Work IQ skill

**What you type**

```text
Add Work IQ tools to this agent. I want Mail and Calendar.
```

This is the same prompt the other stacks use. On this Python sample it does not modify the project until Python LangChain support exists.

**What the skill does**

On supported stacks, `add-workiq-tools` shows the catalog of available servers, adds the ones you pick, writes a `ToolingManifest.json`, wires a registration service into your agent code, and walks through the permissions handoff each server needs.

**Behind the scenes**

```bash
a365 develop list-available                          # see what's in the catalog
a365 develop add-mcp-servers --servers mail,calendar # add the ones you want
```

Those are the commands the supported stacks use. For Python with LangChain, do not force these changes into the sample manually; the integration path is not available yet.

**How to verify**

Nothing to verify in the Python project for now. Do not expect a `ToolingManifest.json`, and do not make Exercise 6 depend on Mail or Calendar. Use the Microsoft Learn MCP calls the sample already makes for end-to-end verification.

> ✅ **Checkpoint.** Work IQ is not yet available for Python with LangChain. The project is unchanged.

---

## Exercise 6: Verify it end to end

The previous exercises prove the agent *emits* telemetry. This exercise confirms it *arrives*.

### Step 1: Produce some activity

Ask the agent three or four questions. [Sample prompts](./99-sample-prompts.md) has suggestions. Include at least one that triggers a tool call.

For this Python lab, use a prompt that exercises the Microsoft Learn MCP tools. Exercise 5 did not add Work IQ tools, so do not use a mail or calendar question.

### Step 2: Check Microsoft Defender

Go to [Advanced hunting](https://security.microsoft.com) in the **Defender** portal and query the `CloudAppEvents` table:

```kusto
CloudAppEvents
| where ActionType in ("InvokeAgent", "InferenceCall", "ExecuteToolBySDK", "ExecuteToolByGateway", "ExecuteToolByMCPServer")
| where RawEventData.TargetAgentName == "your-agent-name" or RawEventData.AgentName == "your-agent-name"
| order by Timestamp desc
```

Allow about five minutes for Defender to index the events.

### Step 3: Check the Microsoft 365 admin center

Go to [admin.cloud.microsoft](https://admin.cloud.microsoft), find your agent in the inventory, and open its activity.

The admin center ingests `invoke_agent` rows only and reads the caller identity from that span. The combination of what each portal shows tells you where a problem is:

| What you see | Where the problem is |
| --- | --- |
| Nothing anywhere | Export, token, or baggage scope. Go back to Exercise 4, Step 9 |
| Defender ✅, admin center ❌ | Your `invoke_agent` span. Nine times out of ten it is the caller id, so Exercise 4, Step 7 |
| Both ✅, but no user shown | The caller resolved to something that is not a directory object id |
| Both ✅, but no run context | Session, conversation or channel missing from the request object, so Exercise 4, Step 8 |

### Step 4: Optional, let a skill check the code for you

A skill can review the instrumentation without changing anything:

```text
Validate the Agent 365 observability code in this project.
```

`a365-code-validator` checks that the exporter is activated, the runtime agent identity is bound correctly, the required spans are present, and the token has the right shape. It is read-only by default.

> ✅ **Checkpoint.** Activity appears in both **Defender** and the **Microsoft 365 admin center**. You know how to interpret the differences between the two portals.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Partitioned into 0 identity groups` | No active baggage scope around the turn. Exercise 4, Step 6 |
| `HTTP 200`, but nothing lands anywhere | No user in the tenant holds an Agent 365 licence |
| `AADSTS500011` resource principal not found | Agent 365 is not provisioned in this tenant |
| Consent errors on the observability scope | The admin consent handoff from Exercise 3, Step 1 was never run |
| `AADSTS50011` redirect URI mismatch | The registered redirect URI does not match the address the browser is on, scheme included. Exercise 2, Step 1 |
| Hop 2 rejects the assertion | The sign-in asked for the wrong scope, so the user token is not addressed to the blueprint. Exercise 3, Step 5 |
| The app starts anonymously with a filled-in `.env` | The settings are read once at startup, so restart the process. Exercise 3, Step 4 |
| Sign-in loops back to the sign-in page | The browser is on `127.0.0.1` and the app set its cookie on `localhost`, or the other way round. Exercise 2, Step 1 |
| No `chat` spans | The distro was initialised after LangChain was imported. Exercise 4, Step 3 |

## Completion

You have completed **Lab A365-02B**. You started with a Python web agent that answered questions anonymously and onboarded it to Agent 365. Along the way you learned:

- ✅ **Identity separation**: why an agent needs three identities (sign-in client, blueprint, agent identity) and why a blueprint cannot sign users in.

- ✅ **Registration**: how `a365 setup all` creates the blueprint and the agent identity, and what the generated configuration contains.

- ✅ **The right token**: how to request `api://<blueprint-id>/access_agent_as_user` and verify the token claims.

- ✅ **The two-hop chain**: how `fmi_path` turns a client-credentials call into an agent flow, how MSAL 1.37 handles hop 1 on Python, and how pairing a client assertion with a user assertion produces a token meaning "this agent, for this person".

- ✅ **Observability**: how to wire the A365 exporter into a FastAPI app before LangChain imports, bridge a per-request token to a background flush thread, and open the baggage scope that keeps spans from being dropped.

- ✅ **Semantic spans**: which four operation names Agent 365 accepts, why `invoke_agent` is the one the admin center requires, and why the caller must be a directory object id.

- ✅ **Microsoft 365 data**: why Work IQ is not yet available for Python with LangChain, and where it fits when support lands.

- ✅ **Verification**: how to read the exporter's logs, and how the differences between Defender and the admin center indicate where a problem is.

### Related resources

| Resource | Link |
| --- | --- |
| Prerequisites | [00-prerequisites.md](./00-prerequisites.md) |
| Sample prompts | [99-sample-prompts.md](./99-sample-prompts.md) |
| The same lab in .NET | [02a-web-obo-dotnet.md](./02a-web-obo-dotnet.md) |
| The same lab in Node.js | [02c-web-obo-nodejs.md](./02c-web-obo-nodejs.md) |
| Agent on-behalf-of OAuth flow | https://learn.microsoft.com/entra/agent-id/agent-on-behalf-of-oauth-flow |
| Agent 365 observability concepts | https://learn.microsoft.com/microsoft-agent-365/developer/observability-concepts |
| Agent 365 Skills | https://github.com/microsoft/agent365-skills |
