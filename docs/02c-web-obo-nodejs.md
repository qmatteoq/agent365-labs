# Lab A365-02C - Web App Agent with User OBO (Node.js)

> **Stack**: Node.js 20.10, TypeScript, LangChain, Express **Duration**: around 3 hours **Level**: Intermediate

## Scenario

You have a working agent: a user opens a web page, asks a question, and the agent reasons over it, calls tools, and answers. The agent has no identity in the tenant, reports no activity, and does not appear in the tenant inventory.

**Microsoft Agent 365** gives the agent:

- An identity visible in the tenant inventory
- Activity reporting to **Microsoft Defender**, **Microsoft Purview**, and the **Microsoft 365 admin center**
- A governed path to Microsoft 365 data

In this lab you take a plain Node.js agent running in an Express app and onboard it to Agent 365 step by step. The auth path is **User On-Behalf-Of (OBO)**: the user signs in, and everything the agent does is attributed to that person using that person's permissions.

## Lab objectives

After completing this lab, you will be able to:

- Register an agent blueprint and an agent identity in Microsoft Entra with the Agent 365 CLI
- Explain why a blueprint cannot sign users in, and register the separate application that can
- Acquire a user token addressed to the blueprint and verify its claims
- Build the two-hop agent on-behalf-of token chain that lets an agent act for a signed-in user
- Instrument a Node.js LangChain agent with OpenTelemetry and the Agent 365 exporter
- Emit the semantic spans Agent 365 accepts, attributed to the correct caller
- Give the agent access to Microsoft 365 data through the Work IQ MCP servers
- Verify that activity arrives in Defender and in the Microsoft 365 admin center

## Prerequisites

Work through the [prerequisites page](./00-prerequisites.md) before you start. In short, you need Node.js 20.10 or later, the .NET 8 SDK for the Agent 365 CLI, the Agent 365 CLI itself, an Azure OpenAI resource, a tenant with Agent 365 enabled and at least one Agent 365 licence in it, and access to an administrator who can grant consent twice.

The starting point for this lab is the Node.js sample agent:

```bash
git clone https://github.com/qmatteoq/agent365-runbook
cd agent365-runbook/01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point/nodejs
```

The sample is a research assistant that answers questions about Microsoft products by searching the [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) and citing what it found. It uses Express, LangChain, TypeScript, and Azure OpenAI. It already contains the Microsoft Entra sign-in that the OBO path depends on; the sign-in stays dormant until you fill in the settings in Exercise 2.

The shared prerequisites page lists the main settings this lab uses. The Node sample also has two settings in `.env.example`:

- `LEARN_MCP_ENDPOINT` (defaults to the Microsoft Learn MCP server)
- `AZURE_OPENAI_USE_MANAGED_IDENTITY` (`false` locally, `true` when hosted on Azure)

## How the exercises work

From Exercise 3 onwards, most steps follow the same structure:

1. **What you type**, the prompt you give your coding assistant.
2. **What the skill does**, the changes it makes.
3. **Behind the scenes**, the CLI command or code it comes down to.
4. **How to verify**, how to confirm it worked before you move on.

To do everything by hand, read parts 3 and 4 and skip the rest. Exercise 2 is the exception: signing users in with Entra is standard web app work, not an Agent 365 task, so no skill covers it.

---

## Exercise 1: Run the agent as it is

Confirm that the agent works before adding anything. Start from a known-good baseline so that any failure after this point is something you introduced.

### Step 1: Configure the Azure OpenAI connection

The agent uses an Azure OpenAI model. Copy `.env.example` to `.env` and fill in the Azure OpenAI values from the prerequisites:

```bash
cp .env.example .env
```

The example file is committed so you can see the shape of the configuration. The `.env` file is gitignored; local secrets belong there, not in `.env.example`.

```bash
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=<your-deployment-name>
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_TENANT_ID=<tenant that owns the Azure OpenAI resource>
```

These four values tell LangChain which Azure OpenAI deployment to use. Only the endpoint is required by `src/config.ts`: the sample falls back to `gpt-4.1` and API version `2024-10-21` if those are omitted, and throws a startup error if the endpoint is missing.

> The tenant id is required if you work across more than one tenant. Without it, the credential returns a token from whichever tenant you last signed in to. If that tenant does not own the Azure OpenAI resource, the service responds with `HTTP 400` and `Tenant provided in token does not match resource token`.

The same `.env.example` also includes these defaults:

```bash
LEARN_MCP_ENDPOINT=https://learn.microsoft.com/api/mcp
AZURE_OPENAI_USE_MANAGED_IDENTITY=false
HOST=localhost
PORT=8000
```

`LEARN_MCP_ENDPOINT` points the sample at the public Microsoft Learn MCP server. `AZURE_OPENAI_USE_MANAGED_IDENTITY=false` makes the code use `AzureCliCredential` locally; set it to `true` on Azure to use `DefaultAzureCredential`. `HOST` and `PORT` are the values Express binds to and determine the redirect URI `http://localhost:8000/signin-oidc` in Exercise 2.

### Step 2: Decide how the agent authenticates to Azure OpenAI

The sample supports two authentication methods. If an API key is configured, it uses key auth; otherwise it uses Entra credentials. There is no flag; the presence or absence of the key is the switch.

|  | **Path A: Entra credentials** *(recommended)* | **Path B: API key** |
| --- | --- | --- |
| What it uses | `AzureCliCredential` locally, and `DefaultAzureCredential` when `AZURE_OPENAI_USE_MANAGED_IDENTITY=true` once hosted on Azure | A resource key, sent as a bearer secret |
| What you configure | Nothing beyond Step 1; you just need to be signed in | The key itself, kept in the gitignored `.env` file |
| What you need access to | The **Cognitive Services OpenAI User** role on the resource | The resource keys |
| Why you would pick it | No long-lived secret to leak or rotate; the call carries a real identity; the only option in tenants where key auth is disabled by policy | Environments that still depend on keys |

For **Path A**, there is nothing to add. Sign in to the tenant that owns the Azure OpenAI resource:

```bash
az login --tenant <tenant of the Azure OpenAI resource>
```

Locally there is no managed identity endpoint, so `src/agent.ts` skips managed identity and pins the Azure CLI credential to the configured tenant. When deploying to Azure, set `AZURE_OPENAI_USE_MANAGED_IDENTITY=true` and assign the App Service identity access to the Azure OpenAI resource.

For **Path B**, add the key to `.env` (gitignored):

```bash
AZURE_OPENAI_API_KEY=<your-key>
```

That one value switches the sample to key auth. Confirm `.env` is gitignored before pasting a key into it.

### Step 3: Run the agent and ask it something

Install the dependencies and start the development server:

```bash
npm install
npm run dev
```

`npm run dev` runs the TypeScript through `tsx` in watch mode, restarting on every change. `npm start` runs without the watcher, and `npm run build` compiles into `dist/`.

> Use `npm run dev` while doing the lab. Debugging compiled output from `npm run build` places breakpoints in `dist/` files, not the `.ts` source files.

The app listens on `http://localhost:8000`. Open it in a browser and ask a question:

```text
What is Microsoft Entra Conditional Access?
```

You should get an answer with links to Microsoft Learn, because the agent grounds its answers in the Learn MCP server.

> The Node.js sample uses the same port as the Python sample. Do not run both at once unless you change one of the `PORT` values and the matching redirect URI.

> ✅ **Checkpoint.** The agent answers questions and cites its sources. There is still no trace of Agent 365 anywhere.

---

## Exercise 2: Sign users in with Microsoft Entra

Nothing in this exercise is specific to Agent 365. You register an Entra application, point the agent at it, and read through the sign-in code that ships in the sample.

The OBO path attributes everything the agent does to the signed-in user, so a sign-in must exist before Agent 365 can be added.

One piece is missing at the end of this exercise: the token the sign-in produces must be addressed to the agent's blueprint, which does not exist until Exercise 3. This exercise creates the sign-in client and fills in its settings; Exercise 3 supplies the final value and switches sign-in on.

### Step 1: Create the app registration that signs users in

Entra only redirects users back to an application it knows about.

1. Go to the [Entra admin center](https://entra.microsoft.com) and navigate to **Identity**, then **Applications**, then **App registrations**.
2. Select **New registration**.
3. Name it clearly, for example `my-agent-web-signin`. Exercise 3 adds two more identities for this agent.
4. For **Supported account types**, choose **Accounts in this organizational directory only (Single tenant)**.
5. Under **Redirect URI**, select the **Web** platform and enter `http://localhost:8000/signin-oidc` (from `HOST`, `PORT` and `AZURE_AD_REDIRECT_URI` in `.env.example`).
6. Select **Register**.

Copy the **Application (client) ID** and the **Directory (tenant) ID** from the **Overview** blade. You need both in Step 3.

> The redirect URI must match what the browser sees, including the scheme. Registering `https` and running over `http` produces `AADSTS50011`.

> `localhost` and `127.0.0.1` are not interchangeable. The browser treats them as different origins and scopes the session cookie accordingly. If you register the callback on `localhost` and browse on `127.0.0.1`, the cookie set before the redirect is not sent back on the callback. The sample sets `HOST=localhost` for this reason.

If you prefer the command line, the registration is one command:

```bash
az ad app create --display-name "my-agent-web-signin" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "http://localhost:8000/signin-oidc"
```

### Step 2: Create a client secret

1. In the same registration, go to **Certificates & secrets**.
2. On the **Client secrets** tab, select **New client secret**.
3. Give it a description and pick an expiry.
4. Select **Add**, then **copy the Value immediately**. It is shown once.

Store the secret in the gitignored `.env` file, not in `.env.example`.

While you are in the registration, check **API permissions**. A new registration typically has **Microsoft Graph** `User.Read` only, which is sufficient. MSAL adds the OIDC scopes to the request itself, and the sample never calls Graph. You will return to this blade in Exercise 3 to point the registration at the agent's blueprint.

### Step 3: Fill in the sign-in settings

The Node sample reads sign-in settings from `.env`, and `.env.example` already lists the values you need:

```bash
# Entra sign-in for the web app. Leave blank until the runbook creates the app registration.
AZURE_AD_TENANT_ID=
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_REDIRECT_URI=http://localhost:8000/signin-oidc

# Agent blueprint id. The runbook fills this in once the agent is registered, and the
# sign-in stays off until it is set.
AGENTS365OBSERVABILITY__AGENTBLUEPRINTID=

HOST=localhost
PORT=8000
```

Fill in `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID` and `AZURE_AD_CLIENT_SECRET` from the app registration. Leave `AGENTS365OBSERVABILITY__AGENTBLUEPRINTID` blank for now; Exercise 3 provides this value.

The double underscore in `AGENTS365OBSERVABILITY__AGENTBLUEPRINTID` is a .NET configuration convention. The Agent 365 tooling writes this key, and the Node sample reads it directly so both sign-in and observability share the same `.env` file.

The blueprint id determines the scope: `api://<blueprint-id>/access_agent_as_user`. This scope must be identical in the sign-in request, in the token acquisition, and in any debugger inspection. The sample derives it in exactly one place from the blueprint id to avoid mismatches.

In `src/config.ts`, that derivation is a getter:

```ts
agentBlueprintId: optional("AGENTS365OBSERVABILITY__AGENTBLUEPRINTID"),

get agentBlueprintScope(): string {
    const blueprintId = this.agentBlueprintId?.trim();

    if (!blueprintId) {
        throw new Error("The agent blueprint id is not configured.");
    }

    return `api://${blueprintId}/access_agent_as_user`;
},
```

The getter is used instead of a plain field because the settings object is built at import time, when the blueprint id may still be absent. A field would be evaluated too early and fail before the app can run anonymously. The getter is only evaluated when the sign-in code needs the scope, which is the point at which the blueprint id must exist.

### Step 4: See how the app decides whether to sign anybody in

At startup the app checks whether every required sign-in value is present. If anything is missing, the sign-in routes are skipped and the app behaves as it did in Exercise 1. If everything is present, the routes are wired up.

The decision lives in `entraSignInEnabled` in `src/config.ts`:

```ts
get entraSignInEnabled(): boolean {
    return [
        this.azureAdTenantId,
        this.azureAdClientId,
        this.azureAdClientSecret,
        this.azureAdRedirectUri,
        this.agentBlueprintId,
    ].every((value) => Boolean(value?.trim()));
},
```

The blueprint id is one of the five values it checks. Restarting the app now still leaves it in anonymous mode because that value is blank. Exercise 3, Step 4 fills it in.

`src/main.ts` uses the getter to decide whether the `AuthService` exists at all:

```ts
const authService = settings.entraSignInEnabled ? new AuthService(settings) : undefined;

if (authService) {
    app.use(authService.router);
    console.info(`Entra sign-in is configured; requesting user tokens for ${settings.agentBlueprintScope}.`);
} else {
    console.info(
        "Entra sign-in is not configured; running anonymously. Fill in the AZURE_AD settings in .env to enable it.",
    );

    app.get("/api/me", (_req, res) => {
        res.json({ authenticationConfigured: false, authenticated: false, user: null });
    });
}
```

`AuthService` owns its own `express.Router`, so the sign-in is a single object to add or leave out. The anonymous branch still answers `/api/me` because the front end calls it on every page load; a 404 there would break the UI.

### Step 5: Read the sign-in code

Read the code that performs the sign-in. Exercise 4 calls into it once per turn.

The key method is `acquireUserAssertion(req)`, which returns an access token for the blueprint's scope belonging to the signed-in user. That token is the *user assertion*, the input to hop 2 of the token chain.

Express has no built-in identity story, so `src/auth.ts` drives the authorization-code flow directly with `@azure/msal-node`. The structure is simple: a `Map` of server-side sessions, an opaque cookie that points into it, and no token in the browser.

Node's MSAL is lower level than Python's. There is no helper that bundles state, nonce and PKCE into a single flow object, so the sample generates the PKCE pair and state itself:

```ts
private async signin(req: Request, res: Response): Promise<void> {
    const sessionId = this.getSessionId(req) ?? this.newSessionId();
    const session = this.sessions.get(sessionId)!;

    const { verifier, challenge } = await this.crypto.generatePkceCodes();
    const state = this.crypto.createNewGuid();
    session.flow = { state, codeVerifier: verifier };

    const authUrl = await this.client.getAuthCodeUrl({
        scopes: [this.settings.agentBlueprintScope],
        redirectUri: this.settings.azureAdRedirectUri,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        state,
    });

    this.setSessionCookie(res, sessionId);
    res.redirect(authUrl);
}
```

The important line is `scopes: [this.settings.agentBlueprintScope]`. This makes the returned token addressed to the blueprint. The verifier stays on the server (it is the secret half of the PKCE pair) and the state stays with it for comparison on the callback.

The browser only receives an opaque session id, stored in a cookie:

```ts
res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    // Entra redirects back from another site, so a strict cookie would be withheld on
    // the callback and the server-side session would look as if it had been lost.
    sameSite: "lax",
});
```

The cookie is `httpOnly` so browser script cannot read it, and `sameSite` is `lax` so it still arrives on the redirect back from Entra. Setting it to `strict` would cause the callback to lose the session.

Coming back, `/signin-oidc` clears the one-time flow before doing anything else, checks the returned state, and then calls `acquireTokenByCode`:

```ts
// A flow is good for exactly one callback; dropping it here stops a replayed
// callback from reusing the same verifier.
session.flow = undefined;

const { code, state, error, error_description: errorDescription } = req.query;

if (typeof error === "string") {
    res.status(401).send(typeof errorDescription === "string" ? errorDescription : error);
    return;
}

if (typeof code !== "string" || state !== flow.state) {
    res.status(401).send("The sign-in response did not match the request.");
    return;
}

const result = await this.client.acquireTokenByCode({
    code,
    scopes: [this.settings.agentBlueprintScope],
    redirectUri: this.settings.azureAdRedirectUri,
    codeVerifier: flow.codeVerifier,
});

session.claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;
session.accountId = result.account?.homeAccountId;
```

That `state !== flow.state` comparison is not optional. It stops an attacker from getting a victim's browser to complete a sign-in the attacker started. Clearing `session.flow` first matters for the same reason: one callback per flow, so a replayed callback finds nothing to reuse.

Then comes the method the token chain calls:

```ts
/** Return a blueprint-scoped access token for the signed-in user. */
async acquireUserAssertion(req: Request): Promise<string> {
    const session = this.getSession(req);
    if (!session) {
        throw new AuthRequiredError("Sign in before chatting with the agent.");
    }

    const account = await this.getAccount(session);
    if (!account) {
        throw new AuthRequiredError("Sign in before chatting with the agent.");
    }

    const result = await this.client
        .acquireTokenSilent({ account, scopes: [this.settings.agentBlueprintScope] })
        .catch(() => null);

    if (!result?.accessToken) {
        throw new AuthRequiredError("Sign in again so the app can get a user assertion.");
    }

    return result.accessToken;
}
```

`acquireTokenSilent` reads MSAL's cache and refreshes the token when possible. The `.catch(() => null)` converts Node MSAL's thrown exception into a null result. Every failure becomes an `AuthRequiredError`, and `/api/chat` returns that as a 401:

```ts
if (authService) {
    try {
        await authService.acquireUserAssertion(req);
    } catch (error) {
        if (error instanceof AuthRequiredError) {
            res.status(401).json({ reply: error.message });
            return;
        }

        console.error("Could not acquire the user assertion", error);
        res.status(401).json({ reply: "Sign in before chatting with the agent." });
        return;
    }
}
```

This is where Node.js differs from the .NET lab. The page still renders, `/api/me` answers even in anonymous mode, and `/api/chat` returns 401 when a signed-in user is required. There is no framework redirect like `AuthorizeRouteView` in the .NET sample.

> This in-process session `Map` is a sample trade-off. Restarting the app signs everybody out, and multiple instances behind a load balancer would not share sessions. Replace it with a shared session store for production use.

> ✅ **Checkpoint.** The sign-in client is registered, the app is pointed at it, and you have read the code that will use it. The sign-in is still dormant, because the scope it asks for is built from a blueprint id that does not exist yet.

---

## Exercise 3: Register the agent with Agent 365

This exercise registers the agent in your tenant as two objects:

- The **blueprint** is the parent app registration. It holds the permissions and owns the agent.
- The **agent identity** is a child principal of the blueprint. It is the principal that acts and that telemetry is attributed to.

The exercise ends by giving the sign-in from Exercise 2 the value it was missing.

### Step 1: Run the setup skill

**What you type**

```text
Set up Agent 365 for this agent. It's a web app where users sign in,
not a Teams agent and not an AI Teammate. Use the OBO auth mode.
```

**What the skill does**

The `a365-setup` skill runs first. It checks the prerequisites, offers to install anything missing, and confirms which Azure identity you are signed in as. It asks two questions:

| Question | Your answer for this lab | Why |
| --- | --- | --- |
| Agent kind? | **Agent (Non AI Teammate)** | A human drives this agent; it has no mailbox or Teams presence |
| Auth mode? | **`obo`** | Activity is attributed to the signed-in user |

Once answered, `a365-setup` hands off to `make-a365-agent` for the registration.

**Behind the scenes**

```bash
a365 setup all --agent-name "my-agent" --dry-run    # preview what will happen
a365 setup all --agent-name "my-agent"              # actually do it
```

Run the dry run first and read the output. `a365 setup all` is idempotent and safe to re-run.

It creates:

- An **agent blueprint** app registration with a client secret
- An **agent identity** as a child of the blueprint
- The API permissions the agent needs, including `Agent365.Observability.OtelWrite`
- A file called `a365.generated.config.json` with all generated identifiers

**How to verify**

Open `a365.generated.config.json` and confirm there is an `agentBlueprintId` and an agent identity id in it. Then go to the [Entra admin center](https://entra.microsoft.com), open **App registrations**, and confirm the blueprint is listed.

> ⚠️ If you are not a Global Administrator, read the consent snippet the CLI printed. An administrator must run it. Until they do, the permissions exist but are not granted, and Exercise 4 fails with a consent error. This is the first of the two admin handoffs.

### Step 2: Store the blueprint secret somewhere safe

`a365 setup all` generated a client secret for the blueprint. This secret is used in the token chain (Exercise 4) to prove your code is allowed to act as this agent.

Add it to `.env` (gitignored):

```bash
AGENT365_BLUEPRINT_CLIENT_SECRET=<secret>
```

If you lose the secret, you can retrieve it on the same machine, signed in as the same user:

```bash
a365 setup blueprint --agent-name "my-agent" --show-secret
```

### Step 3: Give the sign-in app permission to call the blueprint

Exercise 2 created an app that can authenticate a user. Step 1 created a blueprint. The missing piece is a token that links them.

A blueprint is an **agentic application**, and Microsoft Entra bars agentic applications from interactive `/authorize` flows. A blueprint cannot present a sign-in page. That is why Exercise 2 registered a separate, ordinary application.

This lab uses three identities:

| Identity | Who creates it | What it does |
| --- | --- | --- |
| **Sign-in client** | You, in Exercise 2 | Signs the user in and requests the blueprint's scope |
| **Blueprint** | `a365 setup all` | Owns the permissions and authenticates hop 1 of the token chain |
| **Agent identity** | `a365 setup all` | The principal the agent acts as; spans are exported under this identity |

Open `a365.generated.config.json` and note the **blueprint's app id**. You need it twice below.

1. Back in the sign-in registration, go to **API permissions**.
2. Select **Add a permission**.
3. Choose the **APIs my organization uses** tab.
4. Paste the **blueprint's app id** into the search box and select it from the results.
5. Choose **Delegated permissions**.
6. Tick **`access_agent_as_user`**.
7. Select **Add permissions**.
8. Select **Grant admin consent for <your tenant>**.

Step 8 requires an administrator. `access_agent_as_user` is not a permission users can consent to themselves. If the button is greyed out, this is the second admin handoff. A permission that is recorded but not consented to is not effective.

> If the blueprint does not appear in the search, search by its app id. The CLI appends `" Blueprint"` to the name, so the display name may not match what you type. If you find the API but it exposes no scopes, open the **blueprint's** registration, go to **Expose an API**, select **Add a scope**, create a scope named exactly `access_agent_as_user`, set **Who can consent?** to **Admins and users**, leave the state **Enabled**, and return here.

From the command line, the same two operations are:

```bash
# The scope id is on the blueprint's "Expose an API" blade
az ad app permission add --id <sign-in client app id> \
  --api <blueprint-app-id> --api-permissions <scope-id>=Scope

az ad app permission admin-consent --id <sign-in client app id>
```

`az ad app permission add` only records the permission. The consent grant on the second line makes it usable.

> Do not mix up the two secrets. The blueprint secret authenticates hop 1 of the token chain; the sign-in client secret authenticates the web sign-in. Swapping them produces authentication errors that are hard to diagnose.

### Step 4: Give the app the blueprint id

This is the value left blank in Exercise 2. Take `agentBlueprintId` from `a365.generated.config.json` and add it to `.env`:

```bash
AGENTS365OBSERVABILITY__AGENTBLUEPRINTID=<blueprint app id>
```

This value does two things:

- Completes the set of settings the startup check requires, so the authentication routes are registered.
- Supplies the resource half of `api://<blueprint-id>/access_agent_as_user`, which is the scope the sign-in requests.

Hop 2 of the token chain only accepts an assertion addressed to the blueprint. The scope must be the blueprint's `access_agent_as_user`, not `User.Read` or the blueprint's `.default`.

Restart the app. The Node sample reads `.env` once at startup.

### Step 5: Verify the token you get back

Open the app. The status line changes from the anonymous message to a **Sign in** link. Select **Sign in** and complete the Entra flow. On first use in a tenant without prior admin consent, you will be prompted to approve the permissions.

Once signed in, set a breakpoint on the `return result.accessToken` line in `src/auth.ts` and send a message. `/api/chat` calls `acquireUserAssertion(req)` before anything else, so the breakpoint hits on the first turn. The sample runs TypeScript through `tsx`, so point your debugger at `npm run dev`. For Chrome DevTools:

```bash
node --inspect node_modules/tsx/dist/cli.mjs src/main.ts
```

Paste the returned token into [jwt.ms](https://jwt.ms) (decodes in the browser without sending it anywhere) and check four claims:

| Claim | What it should say |
| --- | --- |
| `aud` | The **blueprint's** app id, or `api://<blueprint-id>`, **not** the sign-in client's id |
| `scp` | It should contain `access_agent_as_user` |
| `oid` | The signed-in user's object id |
| `tid` | Your tenant id |

If `aud` is the sign-in client or Microsoft Graph, the scope was not requested correctly. The usual cause is an incorrect blueprint id (for example, a stale one from an earlier `a365 setup all` run) that builds a scope pointing at a different resource.

Note the `oid` value. Exercise 4, Step 7 uses it.

> ✅ **Checkpoint.** The agent is registered, it appears in the tenant, and users sign in with a token addressed to the blueprint. No telemetry is emitted yet.

---

## Exercise 4: Instrument the agent for observability

This exercise adds telemetry to every agent turn, attributed to the signed-in user, and visible in **Defender**, **Purview** and the **Microsoft 365 admin center**.

The steps are: install the telemetry distro, wire it into startup, obtain the correct token for the exporter, set identity baggage on each turn, and wrap the turn in the span types Agent 365 accepts.

### Step 1: Run the observability skill

**What you type**

```text
Instrument this agent with Agent 365 observability. It's an
Agent (Non AI Teammate) using the obo auth mode.
```

**What the skill does**

`instrument-observability` works through eight internal phases:

| Phase | What it changes |
| --- | --- |
| 0.5 | Confirms the agent kind and auth mode. **Check that it says `obo`** |
| 1 | Detects your stack and loads the matching reference patterns |
| 2 | Installs the A365 OpenTelemetry distro |
| 3 | Wires the distro into your entry point |
| 4 | Adds a baggage scope to your message handler |
| 5 | Implements the token resolver |
| 5.5 | Adds the manual instrumentation scopes |
| 6 to 8 | Updates configuration, builds, and smoke-tests the result |

> Verify the auth mode before continuing. For this lab `obo` is correct. It is *not* correct for a Teams-hosted agent, and the skill has been known to choose it there anyway.

> The skill instruments a signed-in app; it does not create the sign-in. Phase 5 implements the token resolver assuming something upstream provides a user assertion. That is the sign-in from Exercise 3. Complete Exercise 3, Step 5 before running this.

The rest of this exercise walks through the changes. **If you ran the skill, you do not need to perform these steps.** Read them as an explanation and as a checklist if something is not working.

### Step 2: Install the distro

The Agent 365 telemetry support ships as an OpenTelemetry distro: a wrapper around standard OTel that adds the Agent 365 exporter and the span processing the service expects.

```bash
npm install @microsoft/opentelemetry
```

The Node package brings its own OpenTelemetry SDK, so you do not need to add `@opentelemetry/sdk-node` yourself.

### Step 3: Wire the exporter into the entry point

Initialize the distro when the app starts. The distro patches LangChain and the Azure OpenAI SDK as those libraries load. If LangChain loads first, the patching has nothing to attach to and `chat` spans are not produced.

Create `src/observability.ts`:

```typescript
import { shutdownMicrosoftOpenTelemetry, useMicrosoftOpenTelemetry } from "@microsoft/opentelemetry";

import { tokenStore } from "./token-store.js";

useMicrosoftOpenTelemetry({
    a365: {
        enabled: true,
        // Both flags are needed: `enabled` alone only registers the span processors.
        enableObservabilityExporter: true,
        tokenResolver: (agentId, tenantId) => tokenStore.get(agentId, tenantId),
        // OBO posts to /observability/, so useS2SEndpoint stays at its default of false.
    },
    instrumentationOptions: {
        langchain: {},
    },
    // Writes prompts and completions onto the spans. Useful while you're learning to read
    // the telemetry, worth reconsidering before this reaches production.
    enableSensitiveData: true,
    // Also print the spans to the terminal while developing.
    enableConsoleExporters: true,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
        void shutdownMicrosoftOpenTelemetry().finally(() => process.exit(0));
    });
}
```

`enabled` and `enableObservabilityExporter` are both needed: the first registers span processors, the second ships spans. `tokenResolver` is the hook the exporter calls when it needs a token; it reads from a store that stays empty until Step 5 fills it.

`enableSensitiveData` and `enableConsoleExporters` are top-level options (they apply to the whole distro, not only the Agent 365 exporter). The console exporter is useful during development because you can see spans in the terminal before Defender indexes them. `enableSensitiveData` writes prompts and completions onto spans; reconsider it before production use.

The signal handler calls `shutdownMicrosoftOpenTelemetry()` to flush the exporter's queue before the process exits. Without it, spans from the last turn can be lost.

Then make this the very first import in `src/main.ts`, above every other import:

```typescript
import "./observability.js";

import { fileURLToPath } from "node:url";
import path from "node:path";
// ... the rest of the existing imports
```

A call to `useMicrosoftOpenTelemetry()` in the body of `main.ts` is too late. ES module imports are hoisted: every `import` is resolved and executed before any statements in the module body run. If `main.ts` imports `./agent.js`, LangChain has already loaded before a body-level call executes. Putting the call in its own module and importing that module first guarantees patching happens before LangChain loads.

LangChain auto-instrumentation is on by default on Node, so `chat` spans appear once the load order is correct. Do not also register the LangChain instrumentation manually; doing both produces every span twice.

### Step 4: Implement the two-hop token chain

The exporter needs a token to call the Agent 365 Observability API. It must be a token issued to the agent identity, acting on behalf of the signed-in user. A plain delegated user token is rejected because its principal is the human, not the agent. The correct token requires two hops.

**Hop 1**: the blueprint proves that it owns the agent identity, and gets back an assertion.

```typescript
const form = {
    client_id: blueprintClientId,
    client_secret: blueprintClientSecret,
    scope: "api://AzureADTokenExchange/.default",
    fmi_path: agentIdentityClientId,
    grant_type: "client_credentials",
};
// POST to https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
```

The `fmi_path` parameter turns this from an ordinary client-credentials call into an agent flow: it requests an assertion the blueprint can use to act as the child identity. The result is not an access token and cannot be used as one; it is only usable as a client assertion in the second hop.

**Hop 2**: the agent identity exchanges the user's token for the one you actually want.

```typescript
const form = {
    client_id: agentIdentityClientId,
    scope: resourceScope,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: t1Token,         // proves which agent
    assertion: userAccessToken,        // proves for whom
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    requested_token_use: "on_behalf_of",
};
```

The two assertions work together: `client_assertion` identifies which agent is asking, and `assertion` identifies the user it is asking for. The `assertion` value is the user token addressed to the blueprint (from Exercise 3), obtained on every turn through `acquireUserAssertion(req)`. The result is a token that represents the agent acting for a specific person.

`@azure/msal-node` version 5 has both halves: `fmiPath` on the client-credential request for hop 1, and `acquireTokenOnBehalfOf` for hop 2. MSAL is already in the project from Exercise 2, so reusing it avoids an additional HTTP client and provides token caching. The raw form posts above show the underlying request shape.

**Cache both hops and refresh a few minutes before expiry.** A token that expires mid-turn silently disables the export with no error. The agent continues answering but telemetry stops.

### Step 5: Bridge the token across to the exporter

The exporter does not flush spans on the request thread. It runs on a background loop where there is no HTTP request and no signed-in user. Acquire the token while you still have a user, store it where both threads can see it, and let the exporter read it from there.

The starting point already calls `acquireUserAssertion(req)` in the `/api/chat` handler to reject anonymous callers with a 401. It discards the token. Now keep it:

```typescript
const userAssertion = await authService.acquireUserAssertion(req);
const agentToken = await oboTokens.getAgentToken(userAssertion, OBSERVABILITY_SCOPE);
tokenStore.set(agentIdentityClientId, tenantId, agentToken);
```

The `tokenStore` is the same module `src/observability.ts` imports. It must be a standalone `src/token-store.ts` exporting a single shared instance, because `src/observability.ts` must import it without pulling in `main.ts`. Building the store inside `main.ts` reintroduces the import-ordering problem from Step 3.

> Do not acquire the token inside the resolver itself. By the time the resolver runs, there is no user to act on behalf of.

### Step 6: Open a baggage scope around every turn

Baggage is OpenTelemetry's mechanism for carrying contextual values alongside the execution context. Agent 365 uses it for the identity dimensions it partitions telemetry by: tenant, agent, user, and conversation.

Spans emitted outside an active baggage scope are dropped. The exporter reports `Partitioned into 0 identity groups`.

Node's builder uses fluent camelCase methods. `.build()` returns a scope you `run()` a callback inside:

```typescript
import { BaggageBuilder } from "@microsoft/opentelemetry";

const scope = new BaggageBuilder()
    .tenantId(tenantId)
    .agentId(agentIdentityClientId)
    .agentName(agentName)
    .agentBlueprintId(blueprintClientId)
    .conversationId(sessionId)
    .sessionId(sessionId)
    .userId(userId)
    .userName(userName)
    .userEmail(userEmail)
    .channelName("web")
    .build();

const reply = await scope.run(() => agent.ask(sessionId, message));
```

The callback defines the region where baggage is active. A common mistake is writing `scope.run(() => { ... })` without returning the promise from the callback. Then `run()` returns before the agent finishes and baggage is gone by the time spans are created. Return the promise and `await` the result of `run()`.

`.agentBlueprintId()` populates `TargetAgentBlueprintId` in reporting, tying activity back to the blueprint from Exercise 3.

### Step 7: Resolve the caller correctly

The **Microsoft 365 admin center** needs the caller's **directory object id** to resolve activity to a person. Any other value is accepted (`HTTP 200`) but never resolves, producing activity attributed to nobody.

The object id is the `oid` claim from Exercise 3, Step 5. Other claims sit nearby and look like plausible identifiers: `sub` is a pairwise identifier that differs per application, and the `nameidentifier` claim some frameworks map `oid` onto can be a base64 hash.

Read the claims from the session object that `AuthService` keeps. The `profile()` helper only exposes `name` and `username`; add `oid` alongside them:

```typescript
const claims = session.claims ?? {};
const userId = asString(claims["oid"]) ?? "unknown";
const userName = asString(claims["name"]) ?? "unknown";
const userEmail = asString(claims["preferred_username"]) ?? "";
```

Use the ID token claims stored on the session. In this scenario they agree with the access token claims, but relying on a decoded access token means the caller identity changes if you later request a different resource.

### Step 8: Wrap the turn in the semantic scopes

Agent 365 only ingests spans whose `gen_ai.operation.name` is one of `invoke_agent`, `chat`, `execute_tool` or `output_messages`. Other spans are dropped.

The most important is `invoke_agent`. Open an `InvokeAgentScope` at the start of every turn. It becomes the root span for that turn and is the only span the **Microsoft 365 admin center** ingests. **Defender** accepts all span types.

```typescript
import { InvokeAgentScope, type A365Request } from "@microsoft/opentelemetry";

const request: A365Request = {
    content: message,
    sessionId,
    conversationId: sessionId,
    channel: { name: "web" },
};

const invokeScope = InvokeAgentScope.start(
    request,
    { endpoint: { host: settings.host, port: settings.port, protocol: "http" } },
    agentDetails,
    callerDetails,
);

try {
    const reply = await invokeScope.withActiveSpanAsync(() => agent.ask(sessionId, message));
    invokeScope.recordOutputMessages(reply);
    return reply;
} catch (error) {
    invokeScope.recordError(error as Error);
    throw error;
} finally {
    invokeScope.dispose();
}
```

The request type is exported as `A365Request` (not `Request`, which conflicts with DOM and Node globals). The scope becomes the active span through `withActiveSpanAsync`, and the `try`/`catch`/`finally` block records output, records failures, and always disposes the scope.

> The `finally` block is required. A scope that is never disposed is a span that is never ended and never exported.

> The session, conversation and channel must be on the request object, not only in baggage. Baggage values do appear on span tags, but the exported `invoke_agent` payload is built from the request object. Omitting them exports a span that is accepted but shows no run context.

You do not need to add `chat` spans manually on Node.js. LangChain auto-instrumentation is on by default in the Node distro, and the Microsoft Learn MCP calls the sample makes are covered by that instrumentation. If spans are missing, check the load order from Step 3 before adding manual scopes.

### Step 9: Verify that the telemetry is actually leaving

Before checking Defender, confirm from the app's logs that spans are being exported. Set these environment variables:

```powershell
$env:OTEL_LOG_LEVEL="INFO"
$env:A365_OBSERVABILITY_LOG_LEVEL="debug"
```

Both variables are needed. `OTEL_LOG_LEVEL` controls the OpenTelemetry SDK diagnostics; `A365_OBSERVABILITY_LOG_LEVEL` enables logging from the Agent 365 components.

Ask the agent a question and check the output for four things:

- `Partitioned into 1 identity groups`, **not 0**. Zero means the baggage scope is not active around the turn, so go back to Step 6.
- An `invoke_agent` span, and it must be a **root** span.
- `HTTP 200` on the export itself.
- The caller id in the payload is a **GUID**, not a long base64-looking hash. If it is the latter you are reading the wrong claim, so go back to Step 7.

> ✅ **Checkpoint.** The agent is registered and observable.

---

## Exercise 5: Give the agent access to Microsoft 365 data

With observability in place, give the agent access to Microsoft 365 data (Mail, Calendar and more) through the **Work IQ** MCP servers. The agent reaches that data using the signed-in user's own permissions.

Work IQ is available for Node.js with LangChain.

### Step 1: Run the Work IQ skill

**What you type**

```text
Add Work IQ tools to this agent. I want Mail and Calendar.
```

**What the skill does**

`add-workiq-tools` shows the catalog of available servers, adds the ones you select, writes a `ToolingManifest.json`, wires a registration service into your agent code, and walks you through the permissions each server needs.

**Behind the scenes**

```bash
a365 develop list-available                          # see what's in the catalog
a365 develop add-mcp-servers --servers mail,calendar # add the ones you want
```

**How to verify**

Open `ToolingManifest.json` and confirm the servers you selected are listed, each appearing **exactly once** (duplicate registrations are a known failure mode). Then test:

```text
What's on my calendar tomorrow?
```

> ✅ **Checkpoint.** The agent can now reach Microsoft 365 data as the signed-in user.

---

## Exercise 6: Verify it end to end

The previous exercises confirm the agent *emits* telemetry. This exercise confirms it *arrives*.

### Step 1: Produce some activity

Ask the agent three or four questions. [Sample prompts](./99-sample-prompts.md) are available. Make sure at least one causes a tool call.

### Step 2: Check Microsoft Defender

Go to [Advanced hunting](https://security.microsoft.com) in the **Defender** portal and query the `CloudAppEvents` table. Defender accepts all operation types:

```kusto
CloudAppEvents
| where ActionType in ("InvokeAgent", "InferenceCall", "ExecuteToolBySDK", "ExecuteToolByGateway", "ExecuteToolByMCPServer")
| where RawEventData.TargetAgentName == "your-agent-name" or RawEventData.AgentName == "your-agent-name"
| order by Timestamp desc
```

Allow around five minutes for Defender indexing before investigating.

### Step 3: Check the Microsoft 365 admin center

Go to [admin.cloud.microsoft](https://admin.cloud.microsoft), find your agent in the inventory, and open its activity.

The admin center ingests `invoke_agent` rows only and reads the caller identity from that span. The combination of what each portal shows identifies the problem:

| What you see | Where the problem is |
| --- | --- |
| Nothing anywhere | Export, token, or baggage scope. Go back to Exercise 4, Step 9 |
| Defender ✅, admin center ❌ | Your `invoke_agent` span. Nine times out of ten it is the caller id, so Exercise 4, Step 7 |
| Both ✅, but no user shown | The caller resolved to something that is not a directory object id |
| Both ✅, but no run context | Session, conversation or channel missing from the request object, so Exercise 4, Step 8 |

### Step 4: Optional, let a skill check the code for you

A skill can review the instrumentation and report issues without changing anything:

```text
Validate the Agent 365 observability code in this project.
```

`a365-code-validator` checks that the exporter is activated, the runtime agent identity is bound correctly, the required spans are present, and the token has the right shape. It is read-only by default.

> ✅ **Checkpoint.** Telemetry is produced, visible in Defender, and confirmed in the Microsoft 365 admin center.

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
| The app starts in anonymous mode with a filled-in `.env` | The settings are read once at startup, so restart the process. Exercise 3, Step 4 |
| Sign-in loops back to the sign-in page | The browser is on `127.0.0.1` and the app set its cookie on `localhost`, or the other way round. Exercise 2, Step 1 |
| No `chat` spans | `./observability.js` is not the first import in `src/main.ts`, so LangChain loaded before the distro could patch it. Exercise 4, Step 3 |
| Every span appears twice | The LangChain instrumentation was registered by hand as well as by the distro, which enables it by default. Exercise 4, Step 3 |
| Everyone is signed out after a restart | Sessions live in an in-process `Map`, which is fine for a sample and the first thing to replace for real. Exercise 2, Step 5 |
| The last turn's spans never arrive | The process exited before the exporter flushed. Add the `shutdownMicrosoftOpenTelemetry()` handler from Exercise 4, Step 3 |
| Breakpoints land in the wrong file | You are debugging compiled output from `npm run build`. Run through `npm run dev`, which executes the TypeScript directly. Exercise 3, Step 5 |

## Completion

You have completed **Lab A365-02C**. You started with an ordinary web agent and added:

- ✅ **Identity separation**: three identities (sign-in client, blueprint, agent identity) and why a blueprint cannot sign users in.

- ✅ **Registration**: `a365 setup all` creates the blueprint and agent identity, and generates the configuration file.

- ✅ **The right token**: the sign-in requests `api://<blueprint-id>/access_agent_as_user`, and the claims confirm the audience.

- ✅ **The two-hop chain**: `fmi_path` turns a client-credentials call into an agent flow, and pairing a client assertion with a user assertion produces a token meaning "this agent, for this person".

- ✅ **Observability**: the A365 exporter wired into Node.js with correct LangChain load order, a per-request token bridged to the background flush thread, and a baggage scope that prevents silent span drops.

- ✅ **Semantic spans**: the four operation names Agent 365 accepts, why `invoke_agent` is the one the admin center requires, and why the caller must be a directory object id.

- ✅ **Microsoft 365 data**: Work IQ MCP servers for mail and calendar under the signed-in user's permissions.

- ✅ **Verification**: reading the exporter's logs, and using the difference between Defender and admin center results to locate problems.

### Related resources

| Resource | Link |
| --- | --- |
| Prerequisites | [00-prerequisites.md](./00-prerequisites.md) |
| Sample prompts | [99-sample-prompts.md](./99-sample-prompts.md) |
| The same lab in .NET | [02a-web-obo-dotnet.md](./02a-web-obo-dotnet.md) |
| The same lab in Python | [02b-web-obo-python.md](./02b-web-obo-python.md) |
| Agent on-behalf-of OAuth flow | https://learn.microsoft.com/entra/agent-id/agent-on-behalf-of-oauth-flow |
| Agent 365 observability concepts | https://learn.microsoft.com/microsoft-agent-365/developer/observability-concepts |
| Agent 365 Skills | https://github.com/microsoft/agent365-skills |
