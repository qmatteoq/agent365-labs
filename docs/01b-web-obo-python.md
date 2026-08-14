# Lab A365-01B - Web App Agent with User OBO (Python)

> **Stack**: Python 3.12, LangChain, FastAPI
> **Duration**: around 3 hours
> **Level**: Intermediate

## Scenario

You have an agent and it works. A user opens a web page, asks a question, the agent reasons over it,
calls a few tools, and answers. From the outside it looks finished.

From the point of view of the organization it runs in, that agent does not exist. Nobody can see it
in the tenant inventory. Nobody knows what it did yesterday, on whose behalf, or which data it
touched. If a security analyst asks which agents accessed customer mailboxes last week, your agent
will not be part of the answer, not because it behaved well, but because it never told anyone
anything.

**Microsoft Agent 365** closes that gap. It gives the agent an identity in the tenant, a way to
report its activity to Microsoft Defender, Microsoft Purview and the Microsoft 365 admin center, and
a governed path to Microsoft 365 data.

In this lab you will take a plain Python agent running in a FastAPI web app, with no Agent 365 code
in it whatsoever, and onboard it step by step. The path you will follow is **User On-Behalf-Of
(OBO)**, which is the right choice when a human drives the agent: the user signs in, and everything
the agent does is attributed back to that person, using that person's permissions.

## Lab objectives

After completing this lab, you will be able to:

- Register an agent blueprint and an agent identity in Microsoft Entra with the Agent 365 CLI
- Explain why a blueprint cannot sign users in, and register the separate application that can
- Configure a Python FastAPI app from a gitignored `.env` file
- Acquire a user token addressed to the blueprint, and prove it is the right token by reading its claims
- Build the two-hop agent on-behalf-of token chain that lets an agent act for a signed-in user
- Instrument a Python LangChain agent with OpenTelemetry and the Agent 365 exporter
- Emit the semantic spans Agent 365 accepts, and attribute them to the correct caller
- Explain the current Work IQ support gap for Python with LangChain
- Verify that activity actually arrives in Defender and in the Microsoft 365 admin center

## Prerequisites

Work through the [prerequisites page](./00-prerequisites.md) before you start. In short, you need
Python 3.12, uv, the .NET 8 SDK for the Agent 365 CLI, the Agent 365 CLI itself, an Azure OpenAI
resource, a tenant with Agent 365 enabled and at least one Agent 365 licence in it, and access to an
administrator who can grant consent twice.

The starting point for this lab is the Python sample agent:

```bash
git clone https://github.com/qmatteoq/agent365-runbook
cd agent365-runbook/01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point/python
```

That folder contains a FastAPI web app backed by LangChain, Azure OpenAI and the official
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp). It already contains the Microsoft
Entra sign-in that the OBO path depends on, but that sign-in stays dormant until you fill the
settings in, which is what Exercise 2 is for.

## How the exercises work

From Exercise 3 onwards, most steps are built the same way, so you always know what you are looking
at:

1. **What you type**, the prompt you give your coding assistant.
2. **What the skill does**, the changes it is about to make, so nothing comes as a surprise.
3. **Behind the scenes**, the CLI command or the code it all comes down to.
4. **How to verify**, how to know it worked before you move on.

If you would rather do everything by hand, read parts 3 and 4 and ignore the rest. The lab works
that way too. Exercise 2 is the exception, because signing users in with Entra is ordinary web app
work rather than an Agent 365 task, so no skill covers it.

---

## Exercise 1: Run the agent as it is

Before you add anything, make sure the agent works the way it arrived.

Exercise 4 adds a fair number of moving parts, and if the agent is broken to begin with you will
spend hours working out which layer is at fault. Start from something that answers questions
correctly, and every failure afterwards is one you introduced.

### Step 1: Configure the Azure OpenAI connection

The agent reasons using a model deployed in Azure OpenAI, so the first thing it needs to know is
which resource to call and which deployment on it to use.

Copy `.env.example` to `.env`, then fill in the Azure OpenAI values you collected in the
prerequisites:

```bash
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=<your-deployment-name>
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_TENANT_ID=<tenant that owns the Azure OpenAI resource>
```

`.env` is gitignored, while `.env.example` is committed. That split is deliberate: the example file
shows the settings the sample understands, and the real file can hold tenant-specific values without
putting them in source control.

> The tenant id is easy to skim past and it is not optional if you work across more than one tenant.
> Leave it out and the credential hands back a token from whichever tenant you last signed in to,
> which may not own the Azure OpenAI resource, and the service answers with `HTTP 400` and
> `Tenant provided in token does not match resource token`. Pinning the tenant avoids an error that
> otherwise looks like a code problem.

### Step 2: Decide how the agent authenticates to Azure OpenAI

The sample supports two ways of authenticating and chooses between them at startup with a simple
rule: if an API key is configured, use key auth, and if not, use Entra credentials. There is no flag
to flip, the presence or absence of the key is the switch.

|  | **Path A: Entra credentials** *(recommended)* | **Path B: API key** |
| --- | --- | --- |
| What it uses | `AzureCliCredential` locally, with `DefaultAzureCredential` when `AZURE_OPENAI_USE_MANAGED_IDENTITY=true` | A resource key, sent as a bearer secret |
| What you configure | Nothing beyond Step 1, you just need to be signed in | The key itself, kept in `.env` |
| What you need access to | The **Cognitive Services OpenAI User** role on the resource | The resource keys |
| Why you would pick it | No long-lived secret to leak or rotate, the call carries a real identity, and it is the only option in tenants where key auth is disabled by policy | Environments that still depend on keys |

For **Path A**, there is nothing to add to the configuration for local development. Sign in to the
tenant that owns the Azure OpenAI resource:

```bash
az login --tenant <tenant of the Azure OpenAI resource>
```

The Python sample uses `AzureCliCredential` locally so it does not try a managed identity endpoint
that does not exist on your laptop. When you later host the app on Azure, set this value in the
hosting environment:

```bash
AZURE_OPENAI_USE_MANAGED_IDENTITY=true
```

That setting makes the code use `DefaultAzureCredential`, which can pick up the managed identity
assigned to the Azure host.

For **Path B**, keep the key in `.env`, which is gitignored:

```bash
AZURE_OPENAI_API_KEY=<your-key>
```

Take a second to confirm `.env` is ignored before you paste a key into it. The repository's root
`.gitignore` ignores `.env` while keeping `.env.example`, but secrets are the kind of thing you
check rather than assume.

### Step 3: Run the agent and ask it something

```bash
uv sync
uv run uvicorn app.main:app --reload
```

`uv sync` creates the virtual environment and installs the dependencies from the lock file. The
second command starts the FastAPI app with reload enabled for development. Open
`http://localhost:8000` in a browser and ask a question:

```text
What is Microsoft Entra Conditional Access?
```

You should get a proper answer with links to Microsoft Learn at the end of it, because this agent
grounds its answers in the Learn MCP server rather than answering from the model's own memory.

> ✅ **Checkpoint.** The agent answers questions and cites its sources. There is still no trace of
> Agent 365 anywhere.

---

## Exercise 2: Sign users in with Microsoft Entra

Nothing in this exercise is specific to Agent 365. You are going to register an ordinary Entra
application, point the agent at it, and read through the sign-in code that already ships in the
sample. If you have built a web app that signs users in with Entra before, this will be familiar.

You do it first, before touching Agent 365 at all, because the OBO path attributes everything the
agent does back to the person who asked for it, and it cannot do that until there is a signed-in
person to attribute it to.

One piece will be missing at the end. The token this sign-in eventually produces has to be addressed
to the agent's blueprint, and the blueprint does not exist until Exercise 3. So this exercise gets
you a registered sign-in client, the settings filled in and a clear picture of the code, and
Exercise 3 supplies the last value and switches the whole thing on.

### Step 1: Create the app registration that signs users in

Signing a user in means sending their browser to Entra and getting them back again, and Entra will
only do that for an application it knows about.

1. Go to the [Entra admin center](https://entra.microsoft.com) and navigate to **Identity**, then
   **Applications**, then **App registrations**.
2. Select **New registration**.
3. Give it a name that makes its role obvious, something like `my-agent-web-signin`. Exercise 3 adds
   two more identities for this one agent, so a vague name will cost you time later.
4. For **Supported account types**, choose **Accounts in this organizational directory only (Single
   tenant)**.
5. Under **Redirect URI**, select the **Web** platform and enter
   `http://localhost:8000/signin-oidc`, which matches the FastAPI callback route and the
   `AZURE_AD_REDIRECT_URI` value in `.env.example`.
6. Select **Register**.

You will land on the **Overview** blade. Copy the **Application (client) ID** and the **Directory
(tenant) ID** and keep them somewhere handy, because you need both in Step 3.

> The redirect URI has to match what the browser sees, scheme included. It is easy to register the
> `https` address and then run the app over plain `http`, and Entra answers that with `AADSTS50011`,
> which reads like a mistake in the app rather than a mismatched string.

> `localhost` and `127.0.0.1` are not interchangeable here, even though they reach the same process.
> The browser treats them as different origins and scopes the session cookie accordingly, so if you
> register the callback on `localhost` and then browse the app on `127.0.0.1`, the cookie set just
> before the redirect is not sent back on the way in. The sign-in then fails in a way that looks like
> a lost session rather than a mismatched host.

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

The value is shown once. Navigate away and it is gone forever, and you will have to create another
one. Store it where the repository cannot reach it, which on this Python sample means the gitignored
`.env` file, never `.env.example`.

While you are in the registration, have a look at **API permissions**. A new registration usually
arrives with **Microsoft Graph** and `User.Read` and nothing else, which is fine: MSAL adds the OIDC
scopes to the request itself, and the sample never calls Graph. There is nothing to add here yet and
nothing that needs an administrator. You will come back to this blade once, in Exercise 3, to point
this registration at the agent's blueprint.

### Step 3: Fill in the sign-in settings

The sign-in settings live in `.env`, and `.env.example` already lists them with the redirect URI
filled in and the rest blank:

```bash
AZURE_AD_TENANT_ID=
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_REDIRECT_URI=http://localhost:8000/signin-oidc
AGENTS365OBSERVABILITY__AGENTBLUEPRINTID=
```

Fill in `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID` and `AZURE_AD_CLIENT_SECRET` from the registration
you just created, and leave `AGENTS365OBSERVABILITY__AGENTBLUEPRINTID` blank. Leaving it blank now is
the correct thing to do rather than an omission you will fix later.

The double underscore in `AGENTS365OBSERVABILITY__AGENTBLUEPRINTID` looks like a .NET configuration
convention because it is one. The Python sample uses it deliberately because that is the name the
Agent 365 tooling and instrumentation expect. `app/config.py` maps it explicitly with Pydantic and
then derives the blueprint scope in one place:

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

That property matters more than its few lines suggest. The scope is
`api://<blueprint-id>/access_agent_as_user`, it has to be byte for byte identical in the sign-in
request, in the token acquisition, and in anything you paste into a debugger later, and a typo in any
copy of it produces a token with the wrong audience rather than an error you can read.

### Step 4: See how the app decides whether to sign anybody in

The app reads its configuration at startup and asks one question: is every required sign-in value
present? If anything is missing it skips the whole authentication setup and behaves exactly as it did
in Exercise 1. If everything is there, it wires it up. This is the same pattern as the Azure OpenAI
key switch from Exercise 1, Step 2: presence of configuration is the switch, and there is no separate
flag to forget to flip.

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

`agent_blueprint_id` is one of the required values, which is why the app still starts anonymously
after you fill in the first three Entra settings. That is expected. Exercise 3, Step 4 is where the
blueprint id appears and the sign-in switches on.

`app/main.py` uses that property to decide whether to construct the auth service:

```python
auth_service = AuthService(settings) if settings.entra_sign_in_enabled else None
```

When `auth_service` exists, FastAPI includes the sign-in routes. When it does not, the app still
serves `/api/me` with an anonymous response so the front end can render cleanly instead of treating a
missing auth API as a broken page.

### Step 5: Read the sign-in code

You now have an app that will sign users in and a rough idea of how it decides to. What is left is
to read the code that actually does it, because in Exercise 4 you will call into it once per turn and
it helps a great deal to know what is on the other side of that call.

The destination is a method that hands back an access token for the blueprint's scope, belonging to
the person currently signed in. It is called `acquire_user_assertion`, and that token is the *user
assertion*, the input to hop 2 of the token chain. Everything else here exists to produce it.

FastAPI has no built-in identity story, so `app/auth.py` drives the authorization-code flow directly
with MSAL. The flow needs somewhere to survive the round trip to Entra, and that somewhere has to be
the server, so `AuthService` keeps a dictionary of sessions and hands the browser an opaque cookie
that points into it. No token ever reaches the browser.

Going out to Entra looks like this:

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

`initiate_auth_code_flow` generates the state, nonce and PKCE verifier and returns them in the
`flow` dictionary that MSAL will validate on the callback. The important line is the `scopes`
argument: it asks for `agent_blueprint_scope`, so the access token that comes back is addressed to
the blueprint rather than to Microsoft Graph or the sign-in client.

The cookie that carries the session id is deliberately opaque and protected from browser script:

```python
response.set_cookie(
    SESSION_COOKIE_NAME,
    session_id,
    httponly=True,
    samesite="lax",
)
```

`httponly` means client-side code cannot read the cookie, and `samesite="lax"` means the browser
still sends it on the redirect back from Entra. A strict cookie would be withheld on that callback,
and the server-side session would look as if it had been lost.

Coming back, `/signin-oidc` completes the flow and stores the claims the app needs later:

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

The `session.pop("flow")` call matters because an authorization-code flow is good for one callback.
Removing it before the rest of the method continues means a replayed callback cannot reuse the same
flow object.

Finally, this is the method the token chain will call on every chat turn:

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

`acquire_token_silent` reads from the MSAL cache populated during sign-in and refreshes the token
when it can, so this is normally silent. When MSAL cannot produce a token, the method raises
`AuthRequiredError`, and `/api/chat` turns that into a 401 rather than a 500.

This is also where the Python app differs from the .NET lab in a way you should expect to see in the
browser. There is no `AuthorizeRouteView` and no framework-owned redirect before the page renders.
The page still loads, `/api/me` tells the front end who is signed in, and `/api/chat` returns 401 if
there is no usable user assertion. A reader coming from the .NET lab should not expect an automatic
page-level redirect here.

> ✅ **Checkpoint.** The sign-in client is registered, the app is pointed at it, and you have read
> the code that will use it. The sign-in is still dormant, because the scope it asks for is built
> from a blueprint id that does not exist yet.

---

## Exercise 3: Register the agent with Agent 365

Now the agent stops being code on your laptop and becomes an object in your tenant. Two objects,
actually, and the difference between them matters for everything that follows:

- The **blueprint** is the parent app registration. It holds the permissions and it owns the agent.
  Think of it as the definition of the agent.
- The **agent identity** is a child principal of that blueprint. It is the thing that actually
  *acts*, and it is the principal your telemetry is attributed to.

The exercise ends by going back to the sign-in from Exercise 2 and giving it the piece it was
missing.

### Step 1: Run the setup skill

**What you type**

```text
Set up Agent 365 for this agent. It's a web app where users sign in,
not a Teams agent and not an AI Teammate. Use the OBO auth mode.
```

This prompt is intentionally about the scenario rather than the language. The Agent 365 identities
live in Entra, and the same registration path applies to the Python sample.

**What the skill does**

The `a365-setup` skill runs first. It checks the prerequisites, offers to install anything missing,
and confirms which Azure identity you are signed in as. Then it asks two questions, and these two
answers determine everything that follows:

| Question | Your answer for this lab | Why |
| --- | --- | --- |
| Agent kind? | **Agent (Non AI Teammate)** | A human drives this agent, it has no mailbox or presence in Teams |
| Auth mode? | **`obo`** | Everything the agent does is attributed to the signed-in user |

Once you have answered, `a365-setup` hands off to `make-a365-agent`, which performs the actual
registration.

**Behind the scenes**

Whatever the skill says, this is what it comes down to:

```bash
a365 setup all --agent-name "my-agent" --dry-run    # preview what will happen
a365 setup all --agent-name "my-agent"              # actually do it
```

Always run the dry run first and read the output. And do not worry about running the real command
more than once, because `a365 setup all` is idempotent and safe to re-run after fixing a problem.

It creates an **agent blueprint** app registration together with a client secret, an **agent
identity** as a child of that blueprint, the API permissions the agent needs including
`Agent365.Observability.OtelWrite`, which is the one that lets it write telemetry, and a file called
`a365.generated.config.json` holding all the generated identifiers.

**How to verify**

Open `a365.generated.config.json` and confirm there is an `agentBlueprintId` and an agent identity id
in it. Then go to the [Entra admin center](https://entra.microsoft.com), open **App registrations**,
and confirm the blueprint is listed.

> ⚠️ If you are not a Global Administrator, read the summary the CLI printed carefully. It contains a
> consent snippet for an administrator to run. Until somebody runs it the permissions exist but are
> not granted, and Exercise 4 fails with a consent error that looks like a bug in your code. This is
> the first of the two admin handoffs.

### Step 2: Store the blueprint secret somewhere safe

`a365 setup all` generated a client secret for the blueprint. That secret is what proves, when you
build the token chain in Exercise 4, that your code is allowed to act as this agent, so it must never
end up in source control.

Put it in `.env`:

```bash
AGENT365_BLUEPRINT_CLIENT_SECRET=<secret>
```

The runbook adds this value to the Python app during the observability work. It is not in the
starting `.env.example`, but the sample's convention still applies: real secrets go in the
gitignored `.env`, not in committed files.

If you lose it you do not have to re-register anything. You can read it back on the same machine,
signed in as the same user:

```bash
a365 setup blueprint --agent-name "my-agent" --show-secret
```

That command prints the generated blueprint secret again. Treat the output the same way you treated
the original value from setup.

### Step 3: Give the sign-in app permission to call the blueprint

Here is where the two halves meet. Exercise 2 left you with an app that can authenticate a user, and
Step 1 gave you a blueprint. What you do not have yet is a token that links them, which is the whole
point of the OBO path.

The obvious question is why the blueprint cannot sign users in itself, given that it is an app
registration like any other. The reason is that a blueprint is an **agentic application**, and
Microsoft Entra bars agentic applications from interactive `/authorize` flows. A blueprint can never
present a sign-in page. That is precisely why Exercise 2 came first, and why what you registered
there was a separate, completely ordinary application.

So this lab has three identities in it, and keeping them straight makes everything else easier:

| Identity | Who creates it | What it does |
| --- | --- | --- |
| **Sign-in client** | You, in Exercise 2 | Signs the user in, and requests the blueprint's scope |
| **Blueprint** | `a365 setup all` | Owns the permissions, and authenticates hop 1 of the token chain |
| **Agent identity** | `a365 setup all` | The principal the agent acts as, and that spans are exported as |

Keep `a365.generated.config.json` open, because you need the **blueprint's app id** twice below.

1. Back in the sign-in registration, go to **API permissions**.
2. Select **Add a permission**.
3. Choose the **APIs my organization uses** tab.
4. Paste the **blueprint's app id** into the search box and select it from the results.
5. Choose **Delegated permissions**.
6. Tick **`access_agent_as_user`**.
7. Select **Add permissions**.
8. Select **Grant admin consent for \<your tenant\>**.

That last one genuinely needs an administrator, because `access_agent_as_user` is not a permission
users can consent to for themselves. If the button is greyed out for you, this is the second admin
handoff. A permission that is recorded but not consented to behaves exactly like one that was never
added.

> If the blueprint does not come up in the search, search by its app id rather than its display name,
> because the CLI appends `" Blueprint"` to the name you chose and what you type may not match. And
> if you find the API but it exposes no scopes at all, open the **blueprint's** registration, go to
> **Expose an API** and then **Add a scope**, create a scope named exactly `access_agent_as_user`,
> set **Who can consent?** to **Admins and users**, leave the state **Enabled**, and come back here.

From the command line, the same two operations are:

```bash
# The scope id is on the blueprint's "Expose an API" blade
az ad app permission add --id <sign-in client app id> \
  --api <blueprint-app-id> --api-permissions <scope-id>=Scope

az ad app permission admin-consent --id <sign-in client app id>
```

Note that `az ad app permission add` only records the permission. The consent grant on the second
line is what makes it usable.

> Do not mix up the two secrets. You now have a blueprint secret and a sign-in client secret, and
> they do completely different jobs. The blueprint secret authenticates hop 1 of the token chain, the
> sign-in client secret authenticates the web sign-in. Swapping them produces authentication errors
> that are genuinely hard to read.

### Step 4: Give the app the blueprint id

This is the value you left blank in Exercise 2, and it is the one that switches the sign-in on. Take
`agentBlueprintId` from `a365.generated.config.json` and put it in `.env`:

```bash
AGENTS365OBSERVABILITY__AGENTBLUEPRINTID=<blueprint app id>
```

That single value does two things at once. It completes the set of settings the startup check looks
for, so the authentication code you read through in Exercise 2 finally gets activated, and it
supplies the resource half of `api://<blueprint-id>/access_agent_as_user`, which is the scope the
sign-in asks for.

That scope is worth slowing down over, because an app can sign users in perfectly well and never ask
for it. You would have a working login and a token that the next exercise rejects. The scope
determines who the token is *addressed to*, and hop 2 of the token chain only accepts an assertion
addressed to the blueprint. Not `User.Read`, and not the blueprint's `.default`.

Restart the app afterwards. The Python sample reads settings once at startup, so a running process
will not notice a changed `.env` file.

### Step 5: Verify the token you get back

Open the app. The page still loads, because Python does not use Blazor's `AuthorizeRouteView` or an
equivalent framework redirect. The line under the title should now show a sign-in path rather than
anonymous mode. Sign in, then send a message so `/api/chat` calls `acquire_user_assertion`.

Set a breakpoint on the `return result["access_token"]` line in `app/auth.py` and send a message.
Copy the return value out of the debugger.

Paste it into [jwt.ms](https://jwt.ms), which decodes it in the browser without sending it anywhere,
and check four claims:

| Claim | What it should say |
| --- | --- |
| `aud` | The **blueprint's** app id, or `api://<blueprint-id>`, **not** the sign-in client's id |
| `scp` | It should contain `access_agent_as_user` |
| `oid` | The signed-in user's object id |
| `tid` | Your tenant id |

If `aud` is the sign-in client, or Microsoft Graph, the scope was not requested correctly. The usual
cause is a blueprint id that is present but wrong, a stale one from an earlier `a365 setup all` run
for example, which builds a scope pointing at a resource that is not your blueprint.

While you have the decoded token in front of you, make a note of the `oid` value. Exercise 4, Step 7
comes back to it.

> ✅ **Checkpoint.** This is a good place to stop if you need to. The agent is registered and
> governed, it shows up in your tenant, and users sign in to it with a token addressed to the
> blueprint. It does not emit any telemetry yet.

---

## Exercise 4: Instrument the agent for observability

This is the longest exercise and it delivers most of the value. By the end of it every turn the
agent takes produces telemetry, attributed to the user who caused it, and visible in Defender,
Purview and the Microsoft 365 admin center.

It also has the most moving parts, so here is the shape of it before you start. You install the
telemetry distro, wire it into the app's startup, obtain a token the exporter is allowed to use, make
sure every turn carries the identity information the service partitions on, and finally wrap the turn
in the specific span types Agent 365 accepts.

### Step 1: Run the observability skill

**What you type**

```text
Instrument this agent with Agent 365 observability. It's an
Agent (Non AI Teammate) using the obo auth mode.
```

The prompt says `obo` because this is a user-driven web app. A Teams-hosted agent or an agent acting
without a signed-in user would use a different path.

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

> Read the auth mode it reports back before letting it continue. For this lab `obo` is correct. It
> is not correct for a Teams-hosted agent, and the skill has been known to choose it there anyway.

> The skill instruments a signed-in app, it does not create the sign-in. Phase 5 above implements
> the token resolver on the assumption that something upstream already hands it a user assertion.
> That something is the sign-in you switched on in Exercise 3, so make sure Exercise 3, Step 5 is
> done and verified before running this.

The rest of this exercise walks through what those changes actually are, in the order the skill
makes them. **If you ran the skill, you do not need to perform these steps.** Read them as an
explanation of the code you now have, and as a checklist if something is not working.

### Step 2: Install the distro

The Agent 365 telemetry support ships as an OpenTelemetry distro: a wrapper around standard OTel
that adds the Agent 365 exporter and the span processing the service expects.

```bash
uv add microsoft-opentelemetry
```

That command updates the Python project's dependency metadata and lock file so the app can import
`microsoft.opentelemetry`.

### Step 3: Wire the exporter into the entry point

Now initialise the distro when the app starts. On Python the exact location of this call matters
more than the call itself, because the distro patches LangChain and the Azure OpenAI SDK as they are
imported.

At the very top of `app/main.py`, before importing `app.agent`, LangChain or the Azure OpenAI SDK,
add the distro setup:

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

There are two Agent 365 switches here. `enable_a365` registers the span processors that shape the
spans, while `a365_enable_observability_exporter` actually ships them. The `a365_token_resolver`
points at the token store you fill in later, `enable_sensitive_data` writes prompts and completions
onto spans, and `disable_metrics` keeps metric output from burying the trace information you are
trying to read while learning the flow.

> Put this call before LangChain or the Azure OpenAI SDK are imported. If LangChain loads first, the
> auto-instrumentation silently does not attach, the app still answers questions, and you get no
> `chat` spans. This load-order trap is the Python failure you will see most often.

### Step 4: Implement the two-hop token chain

This is the most important part of the OBO path and the part most worth reading even if the skill
wrote it for you.

The exporter needs a token to talk to the Agent 365 Observability API, and it has to be a specific
one: a token issued to the agent identity, acting on behalf of the signed-in user. A plain delegated
user token is rejected, because its principal is the human rather than the agent. Getting the right
token takes two hops.

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

The `fmi_path` parameter is what turns this from an ordinary client-credentials call into an agent
flow. It effectively says: issue me an assertion I can use to act as this child identity. What comes
back is not an access token and cannot be used as one. It is only usable as a client assertion in the
second hop.

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

Look at the two assertions side by side, because that pairing is the whole idea. `client_assertion`
says which agent is asking, and `assertion` says who it is asking for. That second one is the user
token you so carefully addressed to the blueprint in Exercise 3, and the app obtains it on every
turn through `acquire_user_assertion()`. The result is a token that represents the agent acting for
that specific person.

On Python, MSAL supports `fmi_path` natively on `acquire_token_for_client` as of MSAL 1.37, so hop 1
needs no hand-written HTTP. The form posts above are still useful because they show the exact shape
of the exchange, but MSAL saves you from building that first request yourself.

One practical point: **cache both hops, and refresh a few minutes before expiry**. A token that
expires halfway through a turn disables the export with no visible error at all. The agent keeps
answering and the telemetry quietly stops.

### Step 5: Bridge the token across to the exporter

You have a token. Now the exporter has to be able to find it, and that is less trivial than it
sounds.

The exporter does not flush spans on the request thread but on a background loop, where there is no
HTTP request, no signed-in user, and therefore nothing to exchange on behalf of. So the pattern is to
acquire the token while you still have a user, park it somewhere both threads can see, and let the
exporter read it from there. The store is a small dictionary keyed on the agent id and the tenant id,
and its read method is the one you already handed to the distro in Step 3.

```python
# In the /api/chat handler, before invoking the agent:
user_assertion = auth.acquire_user_assertion(request)
agent_token = obo_tokens.get_agent_token(user_assertion, OBSERVABILITY_SCOPE)
token_store.set(agent_identity_client_id, tenant_id, agent_token)
```

The starting point already calls `acquire_user_assertion` in `/api/chat`, purely to reject anonymous
callers with a 401. After instrumentation, you keep the returned token and exchange it for the agent
token the exporter needs.

> Do not try to acquire the token inside the resolver itself. It is a tempting simplification and it
> cannot work, because by the time the resolver runs there is no user left to act on behalf of.

### Step 6: Open a baggage scope around every turn

Baggage is OpenTelemetry's mechanism for carrying contextual values alongside the current execution
context, and Agent 365 uses it to carry the identity dimensions it partitions telemetry by: which
tenant, which agent, which user, which conversation.

Spans emitted outside an active baggage scope are dropped, and the exporter tells you so with the
message `Partitioned into 0 identity groups`. Everything looks like it is working and nothing
arrives.

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

The `with` block defines the region where the baggage is active, so make sure the agent invocation
happens inside that block. Opening the scope before the turn is not enough, it has to be open for the
turn.

`.agent_blueprint_id()` is worth calling out, because it populates `TargetAgentBlueprintId` in
reporting, which is how the activity gets tied back to the blueprint you registered in Exercise 3.

### Step 7: Resolve the caller correctly

The Microsoft 365 admin center needs the caller's **directory object id** to show you who did what.
Give it anything else and the export still returns `HTTP 200` and the row still arrives, it just
never resolves to a person, and you get activity attributed to nobody.

The object id is the `oid` claim, the one you noted down in Exercise 3, Step 5. The trap is that
several other claims sit nearby and look like plausible identifiers without being one: `sub` is a
pairwise identifier that differs per application, and the `nameidentifier` claim that some frameworks
map `oid` onto can turn out to be a base64-looking hash instead.

On the Python sample, read `oid` from the validated token claims stored on the server-side session,
and read `name` for the display name.

```python
claims = session.get("claims") or {}
user_id = claims.get("oid") or "unknown"
user_name = claims.get("name") or "unknown"
user_email = claims.get("preferred_username") or ""
```

Use the ID token claims that MSAL validated during the sign-in flow. Do not decode some later access
token just to find a user id, because the resource you request can change and you do not want caller
identity to move with it.

### Step 8: Wrap the turn in the semantic scopes

There is one more constraint to satisfy: Agent 365 does not accept arbitrary spans. It only ingests
spans whose `gen_ai.operation.name` is one of `invoke_agent`, `chat`, `execute_tool` or
`output_messages`. Anything else is dropped, span by span.

The one that matters most is `invoke_agent`. Open an `InvokeAgentScope` at the start of every turn.
It becomes the root span for that turn, and it is the only span the Microsoft 365 admin center
ingests. Defender is happy to take everything, the admin center is not.

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

The session, conversation and channel have to be on the request object, not only in baggage. This
trips people up because baggage does land on the span tags, so it looks like the information is
there. But the exported `invoke_agent` payload is built from the request object you pass to the
scope, so leaving them out exports a span that is accepted and yet shows no run context at all.

On supported stacks, `chat` spans come from auto-instrumentation. Python with LangChain is the stack
where you need to be most careful: the distro has to run before LangChain is imported, and if that
order is wrong the `chat` spans will be missing even though the agent still works. If you still do
not see them after fixing the import order, the runbook calls out that you may need to wrap LLM calls
with an inference scope by hand.

### Step 9: Verify that the telemetry is actually leaving

Before going anywhere near Defender, confirm from the app's own logs that spans are being exported.
Turn on the exporter's logging:

```powershell
$env:OTEL_LOG_LEVEL="INFO"
$env:A365_OBSERVABILITY_LOG_LEVEL="debug"
```

Both variables matter. `OTEL_LOG_LEVEL` controls the OpenTelemetry SDK's own diagnostics, while
`A365_OBSERVABILITY_LOG_LEVEL` is what makes the Agent 365 components talk. Set only the first and
you see the SDK start up and then apparent silence from the part you actually wanted to watch.

Ask the agent a question and read the output. There are four things to look for, and all four have
to be right:

- `Partitioned into 1 identity groups`, **not 0**. Zero means the baggage scope is not active around
  the turn, so go back to Step 6.
- An `invoke_agent` span, and it must be a **root** span.
- `HTTP 200` on the export itself.
- The caller id in the payload is a **GUID**, not a long base64-looking hash. If it is the latter you
  are reading the wrong claim, so go back to Step 7.

> ✅ **Checkpoint.** The agent is registered and it is observable. This is another good place to
> stop.

---

## Exercise 5: Give the agent access to Microsoft 365 data

With observability in place, the .NET and Node.js versions of this lab can give the agent access to
Microsoft 365 data, Mail, Calendar and more, through the Work IQ MCP servers. That access uses the
signed-in user's own permissions, so the agent can never see anything the person driving it could not
already see.

The Python LangChain sample is different at the time of writing. Work IQ is not available for Python
with LangChain yet, and the skill stops rather than half-instrumenting the project. Keep this
exercise in place for parity with the other labs, but treat it as read-only for now and come back
when support lands.

### Step 1: Run the Work IQ skill

**What you type**

```text
Add Work IQ tools to this agent. I want Mail and Calendar.
```

This is the same prompt the other stacks use. On this Python sample it should not modify the project
until Python LangChain support exists.

**What the skill does**

On supported stacks, `add-workiq-tools` shows you the catalog of available servers, adds the ones you
pick, writes a `ToolingManifest.json` describing them, wires a registration service into your agent
code, and walks you through the permissions handoff that each server needs.

**Behind the scenes**

```bash
a365 develop list-available                          # see what's in the catalog
a365 develop add-mcp-servers --servers mail,calendar # add the ones you want
```

Those are the commands the supported stacks eventually come down to. For Python with LangChain, do
not force these changes into the sample by hand as part of this lab, because the integration path is
not available yet.

**How to verify**

There is nothing to verify in the Python project for now. Do not expect a `ToolingManifest.json`, and
do not make Exercise 6 depend on Mail or Calendar. The tool-call activity you need for end-to-end
verification can come from the Microsoft Learn MCP calls the sample already makes.

> ✅ **Checkpoint.** You know where Work IQ would fit, and you have left the Python project unchanged
> until Python LangChain support lands.

---

## Exercise 6: Verify it end to end

Everything so far proves the agent *emits* telemetry. This exercise proves it *arrives*, which is
not the same thing at all. As you have seen, there are several ways for a span to be accepted and
then quietly discarded.

### Step 1: Produce some activity

Ask the agent three or four questions. There is a set of them in
[sample prompts](./99-sample-prompts.md) if you want a starting point. Make sure at least one causes
a tool call, so you have more than inference spans to look at.

For this Python lab, use a prompt that makes the existing Microsoft Learn MCP tools run. Exercise 5
did not add Work IQ tools, so do not use a mail or calendar question as your proof.

### Step 2: Check Microsoft Defender

Go to [Advanced hunting](https://security.microsoft.com) in the Defender portal and query the
`CloudAppEvents` table. Defender accepts every operation type, so this is where you see the fullest
picture:

```kusto
CloudAppEvents
| where ActionType in ("InvokeAgent", "InferenceCall", "ExecuteToolBySDK", "ExecuteToolByGateway", "ExecuteToolByMCPServer")
| where RawEventData.TargetAgentName == "your-agent-name" or RawEventData.AgentName == "your-agent-name"
| order by Timestamp desc
```

Defender has to index the events, so give it around five minutes before concluding something is
wrong.

### Step 3: Check the Microsoft 365 admin center

Now go to [admin.cloud.microsoft](https://admin.cloud.microsoft), find your agent in the inventory,
and open its activity.

This surface behaves differently from Defender, and understanding how saves a lot of debugging: the
admin center ingests `invoke_agent` rows only, and it reads the caller identity off that one span.
Which means the combination of what you see in each portal tells you precisely where a problem is:

| What you see | Where the problem is |
| --- | --- |
| Nothing anywhere | Export, token, or baggage scope. Go back to Exercise 4, Step 9 |
| Defender ✅, admin center ❌ | Your `invoke_agent` span. Nine times out of ten it is the caller id, so Exercise 4, Step 7 |
| Both ✅, but no user shown | The caller resolved to something that is not a directory object id |
| Both ✅, but no run context | Session, conversation or channel missing from the request object, so Exercise 4, Step 8 |

### Step 4: Optional, let a skill check the code for you

There is a skill that reviews the instrumentation and reports what is wrong without changing
anything:

```text
Validate the Agent 365 observability code in this project.
```

`a365-code-validator` checks that the exporter is actually activated, that the runtime agent identity
is bound correctly, that the required spans are present, and that the token has the right shape for
the endpoint you are posting to. It is read-only by default, so it is safe to run at any point.

> ✅ **Checkpoint.** You have produced activity, checked both portals, and you know how to interpret
> the difference between Defender and the Microsoft 365 admin center.

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

Congratulations, you have completed **Lab A365-01B**. You started with an ordinary Python web agent
that answered questions for anyone who opened the page and knew nothing about the tenant it ran in,
and along the way you learned:

- ✅ **Identity separation**: why an agent needs three identities, a sign-in client, a blueprint and
  an agent identity, and why a blueprint can never sign users in.

- ✅ **Registration**: how `a365 setup all` creates the blueprint and the agent identity, and what
  the generated configuration contains.

- ✅ **The right token**: how to make the sign-in ask for
  `api://<blueprint-id>/access_agent_as_user`, and how to prove you got what you asked for by
  reading the claims.

- ✅ **The two-hop chain**: how `fmi_path` turns a client-credentials call into an agent flow, how
  MSAL 1.37 can handle hop 1 on Python, and how pairing a client assertion with a user assertion
  produces a token that means "this agent, for this person".

- ✅ **Observability**: how to wire the A365 exporter into a FastAPI app before LangChain imports,
  bridge a per-request token to a background flush thread, and open the baggage scope that keeps
  your spans from being silently dropped.

- ✅ **Semantic spans**: which four operation names Agent 365 accepts, why `invoke_agent` is the one
  the admin center cares about, and why the caller has to be a directory object id.

- ✅ **Microsoft 365 data**: why Work IQ stays read-only in the Python LangChain lab for now, and
  where it will fit when support lands.

- ✅ **Verification**: how to read the exporter's own logs, and how the difference between what
  Defender shows and what the admin center shows tells you where a problem is.

What is worth taking away is that none of this changed what the agent *does*. It answers exactly the
same Microsoft Learn questions it answered in Exercise 1. What changed is that the organization can
now see it, govern it, and hold it accountable, which is the difference between a demo and something
you can put in front of users.

### Related resources

| Resource | Link |
| --- | --- |
| Prerequisites | [00-prerequisites.md](./00-prerequisites.md) |
| Sample prompts | [99-sample-prompts.md](./99-sample-prompts.md) |
| The same lab in .NET | [01a-web-obo-dotnet.md](./01a-web-obo-dotnet.md) |
| The same lab in Node.js | [01c-web-obo-nodejs.md](./01c-web-obo-nodejs.md) |
| Agent on-behalf-of OAuth flow | https://learn.microsoft.com/entra/agent-id/agent-on-behalf-of-oauth-flow |
| Agent 365 observability concepts | https://learn.microsoft.com/microsoft-agent-365/developer/observability-concepts |
| Agent 365 Skills | https://github.com/microsoft/agent365-skills |
