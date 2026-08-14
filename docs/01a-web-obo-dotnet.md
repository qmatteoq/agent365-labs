# Lab A365-01A - Web App Agent with User OBO (.NET)

> **Stack**: .NET 8, Microsoft Agent Framework, Blazor Server
> **Duration**: around 3 hours
> **Level**: Intermediate

## Scenario

You have a working agent: a user opens a web page, asks a question, and the agent reasons over it,
calls tools, and answers. The agent has no identity in the tenant, reports no activity, and does not
appear in the tenant inventory.

**Microsoft Agent 365** gives the agent:

- An identity visible in the tenant inventory
- Activity reporting to **Microsoft Defender**, **Microsoft Purview**, and the **Microsoft 365 admin center**
- A governed path to Microsoft 365 data

In this lab you take a plain .NET agent running in a Blazor Server app, with no Agent 365 code, and
onboard it step by step. The auth path is **User On-Behalf-Of (OBO)**: the user signs in, and
everything the agent does is attributed to that person using that person's permissions.

## Lab objectives

After completing this lab, you will be able to:

- Register an agent blueprint and an agent identity in Microsoft Entra with the Agent 365 CLI
- Explain why a blueprint cannot sign users in, and register the separate application that can
- Acquire a user token addressed to the blueprint and verify its claims
- Build the two-hop agent on-behalf-of token chain that lets an agent act for a signed-in user
- Instrument a .NET agent with OpenTelemetry and the Agent 365 exporter
- Emit the semantic spans Agent 365 accepts, attributed to the correct caller
- Give the agent access to Microsoft 365 data through the Work IQ MCP servers
- Verify that activity arrives in Defender and in the Microsoft 365 admin center

## Prerequisites

Work through the [prerequisites page](./00-prerequisites.md) before you start. In short, you need
the .NET 8 SDK, the Agent 365 CLI, an Azure OpenAI resource, a tenant with Agent 365 enabled and at
least one Agent 365 licence in it, and access to an administrator who can grant consent twice.

The starting point for this lab is the .NET sample agent:

```bash
git clone https://github.com/qmatteoq/agent365-runbook
cd agent365-runbook/01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point/dotnet
```

It is a research assistant that answers questions about Microsoft products by searching the
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) and citing what it found. It
already contains the Microsoft Entra sign-in that the OBO path depends on, but that sign-in stays
dormant until you fill in the settings in Exercise 2.

## How the exercises work

From Exercise 3 onwards, most steps follow the same structure:

1. **What you type**, the prompt you give your coding assistant.
2. **What the skill does**, the changes it makes.
3. **Behind the scenes**, the CLI command or code involved.
4. **How to verify**, how to confirm it worked before moving on.

To do everything by hand, read parts 3 and 4 and skip the rest. Exercise 2 is the exception: signing
users in with Entra is ordinary web app work, so no skill covers it.

---

## Exercise 1: Run the agent as it is

Confirm that the agent works before adding anything. Start from a known-good baseline so that any
failure after this point is something you introduced.

### Step 1: Configure the Azure OpenAI connection

Open `appsettings.json` and fill in the three values you collected in the prerequisites:

```json
{
  "AzureOpenAI": {
    "Endpoint": "https://<your-resource>.openai.azure.com/",
    "Deployment": "<your-deployment-name>",
    "TenantId": "<tenant that owns the Azure OpenAI resource>"
  },
  "LearnMcp": { "Endpoint": "https://learn.microsoft.com/api/mcp" }
}
```

> The tenant id is required when you work across more than one tenant. Without it, the credential
> returns a token from whichever tenant you last signed in to, and the service responds with
> `HTTP 400` and `Tenant provided in token does not match resource token`.

### Step 2: Decide how the agent authenticates to Azure OpenAI

The sample supports two authentication methods. If an API key is configured, it uses key auth;
otherwise it uses Entra credentials. The presence or absence of the key is the switch.

|  | **Path A: Entra credentials** *(recommended)* | **Path B: API key** |
| --- | --- | --- |
| What it uses | `DefaultAzureCredential`, so your `az login` session locally and a managed identity once hosted on Azure | A resource key, sent as a bearer secret |
| What you configure | Nothing beyond Step 1, you just need to be signed in | The key itself, kept in a secret store |
| What you need access to | The **Cognitive Services OpenAI User** role on the resource | The resource keys |
| Why you would pick it | No long-lived secret to leak or rotate; carries a real identity; the only option in tenants where key auth is disabled by policy | Environments that still depend on keys |

For **Path A**, there is nothing to add to the configuration. Sign in to the tenant that owns the
Azure OpenAI resource:

```bash
az login --tenant <tenant of the Azure OpenAI resource>
```

When deployed to Azure, `DefaultAzureCredential` picks up the managed identity assigned to the App
Service automatically, so no code change is needed.

For **Path B**, keep the key out of `appsettings.json` (which is committed). User secrets are stored
outside the project folder:

```bash
dotnet user-secrets set "AzureOpenAI:ApiKey" "<your-key>"
```

You can also set the `AzureOpenAI__ApiKey` environment variable, which is the approach for hosting
environments where user secrets are not available.

### Step 3: Run the agent and ask it something

```bash
dotnet run
```

The default `http` launch profile binds to `http://localhost:5140`. This is the address you register
as a redirect URI in the next exercise. Open it in a browser and ask a question:

```text
What is Microsoft Entra Conditional Access?
```

You should get an answer with links to Microsoft Learn, because this agent grounds its answers in
the Learn MCP server.

> ✅ **Checkpoint.** The agent answers questions and cites its sources. There is still no trace of
> Agent 365 anywhere.

---

## Exercise 2: Sign users in with Microsoft Entra

Nothing in this exercise is specific to Agent 365. You register an ordinary Entra application, point
the agent at it, and read through the sign-in code that ships in the sample.

The OBO path attributes everything the agent does to the signed-in user. One piece will be missing
at the end: the token this sign-in produces must be addressed to the agent's blueprint, which does
not exist until Exercise 3. This exercise registers the sign-in client and fills in the settings.
Exercise 3 supplies the last value.

### Step 1: Create the app registration that signs users in

1. Go to the [Entra admin center](https://entra.microsoft.com) and navigate to **Identity**, then
   **Applications**, then **App registrations**.
2. Select **New registration**.
3. Give it a descriptive name, for example `my-agent-web-signin`. Exercise 3 adds two more identities
   for this agent.
4. For **Supported account types**, choose **Accounts in this organizational directory only (Single
   tenant)**.
5. Under **Redirect URI**, select the **Web** platform and enter `http://localhost:5140/signin-oidc`,
   which is the callback address the default `http` profile in `Properties/launchSettings.json`
   uses.
6. Select **Register**.

You will land on the **Overview** blade. Copy the **Application (client) ID** and the **Directory
(tenant) ID** for Step 3.

> The redirect URI must match what the browser sees, including the scheme. Registering `https` and
> running over `http` causes `AADSTS50011`. To run over TLS, launch with
> `dotnet run --launch-profile https` and register `https://localhost:7199/signin-oidc`. A
> registration can hold several redirect URIs.

> `localhost` and `127.0.0.1` are not interchangeable. The browser treats them as different origins
> and scopes the session cookie accordingly. If you register the callback on `localhost` and browse
> on `127.0.0.1`, the cookie set before the redirect is not sent back, and the sign-in fails.

If you prefer the command line, the registration is one command:

```bash
az ad app create --display-name "my-agent-web-signin" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "http://localhost:5140/signin-oidc"
```

### Step 2: Create a client secret

1. In the same registration, go to **Certificates & secrets**.
2. On the **Client secrets** tab, select **New client secret**.
3. Give it a description and pick an expiry.
4. Select **Add**, then **copy the Value immediately**. It is shown once.

Store it in `dotnet user-secrets`, not `appsettings.json`.

While you are in the registration, check **API permissions**. A new registration arrives with
**Microsoft Graph** `User.Read`, which is sufficient. The identity libraries add the OIDC scopes
automatically. You will come back to this blade in Exercise 3 to point this registration at the
agent's blueprint.

### Step 3: Fill in the sign-in settings

The `AzureAd` and `Agent365Observability` sections are already in `appsettings.json`, with the
tenant-specific values left blank:

```json
{
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "",
    "ClientId": "",
    "ClientSecret": "",
    "CallbackPath": "/signin-oidc"
  },
  "Agent365Observability": {
    "AgentBlueprintId": ""
  }
}
```

Fill in `TenantId` and `ClientId` from the **Overview** blade in Step 1. Leave `AgentBlueprintId`
blank for now; it gets its value in Exercise 3. Leave `ClientSecret` empty in the file (it is
committed) and store the secret separately:

```bash
dotnet user-secrets set "AzureAd:ClientSecret" "<sign-in client secret>"
```

`CallbackPath` must match the redirect URI you registered. `Microsoft.Identity.Web` builds the
callback address from the app's base URL plus this path. A mismatch produces the `AADSTS50011`
described above.

The `Agent365Observability` section is where the Agent 365 tooling and instrumentation look for the
blueprint id. Exercise 3 fills it in.

The scope `api://<blueprint-id>/access_agent_as_user` is built from the blueprint id. It must be
identical in the sign-in request, the token acquisition, and any debugging tool. The sample derives
it in one place from the blueprint id to avoid mismatches.

### Step 4: See how the app decides whether to sign anybody in

The app reads its configuration at startup and checks whether every required sign-in value is
present. If anything is missing, it skips the authentication pipeline and behaves as it did in
Exercise 1. This is the same pattern as the Azure OpenAI key switch from Exercise 1, Step 2:
presence of configuration is the switch.

The decision lives in `Agent365SignInOptions.FromConfiguration`, which treats obvious placeholders
as not configured (anything with angle brackets, anything starting `your-`, an all-zeroes guid).
`Program.cs` then branches on the result:

```csharp
var entraSignIn = Agent365SignInOptions.FromConfiguration(builder.Configuration);
builder.Services.AddSingleton(entraSignIn);

if (entraSignIn.IsEnabled)
{
    builder.Services.AddAuthentication(OpenIdConnectDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApp(builder.Configuration.GetSection(Agent365SignInOptions.AzureAdSectionName))
        .EnableTokenAcquisitionToCallDownstreamApi([entraSignIn.AgentUserScope])
        .AddInMemoryTokenCaches();

    builder.Services.AddAuthorization();
    builder.Services.AddCascadingAuthenticationState();
    builder.Services.AddMicrosoftIdentityConsentHandler();
    builder.Services.AddControllersWithViews()
        .AddMicrosoftIdentityUI();
}
```

If you restart the app now it still reports anonymous mode, because the blueprint id is one of the
required values and it is still empty. Exercise 3, Step 4 fills it in.

### Step 5: Read the sign-in code

Read the code that performs the sign-in. Exercise 4 calls into it once per turn.

The key method is `AcquireUserAssertionAsync`, which returns an access token for the blueprint's
scope belonging to the signed-in user. That token is the *user assertion*, the input to hop 2 of the
token chain.

In the `AddAuthentication` block:

- `AddMicrosoftIdentityWebApp` signs the user in and produces an id token.
- `EnableTokenAcquisitionToCallDownstreamApi` turns the sign-in into an authorization-code flow that
  also acquires an *access* token for the blueprint's scope.
- `AddInMemoryTokenCaches` stores the token for reuse on each turn.

`AddMicrosoftIdentityUI`, together with `app.MapControllers()` further down, contributes the
`/MicrosoftIdentity/Account/SignIn` and `SignOut` endpoints. Without `MapControllers()`, the
redirect to the sign-in endpoint returns a 404.

The middleware is registered under the same condition, in the order the pipeline needs:

```csharp
if (entraSignIn.IsEnabled)
{
    app.UseAuthentication();
    app.UseAuthorization();
}
```

Requiring a user is then two changes. `Components/Routes.razor` switches to an `AuthorizeRouteView`
when sign-in is on, falling back to the plain `RouteView` when it is not. An `AuthorizeRouteView`
in an app with no authentication services throws about a missing `AuthenticationStateProvider`:

```razor
@if (SignInOptions.IsEnabled)
{
    <AuthorizeRouteView RouteData="routeData" DefaultLayout="typeof(Layout.MainLayout)">
        <NotAuthorized>
            <RedirectToLogin />
        </NotAuthorized>
    </AuthorizeRouteView>
}
else
{
    <RouteView RouteData="routeData" DefaultLayout="typeof(Layout.MainLayout)" />
}
```

And `Components/RedirectToLogin.razor` sends an unauthenticated visitor to the sign-in endpoint.
`forceLoad: true` forces a full browser round trip to Entra; without it, Blazor's client-side router
tries to handle the navigation itself:

```csharp
protected override void OnInitialized()
{
    var returnUrl = Uri.EscapeDataString(Navigation.Uri);
    Navigation.NavigateTo($"MicrosoftIdentity/Account/SignIn?redirectUri={returnUrl}", forceLoad: true);
}
```

Finally, `Components/Pages/Home.razor` exposes the assertion through `AcquireUserAssertionAsync`:

```csharp
public async Task<string> AcquireUserAssertionAsync()
{
    if (!SignInOptions.IsEnabled)
    {
        throw new InvalidOperationException("Entra sign-in is not configured.");
    }

    try
    {
        var tokenAcquisition = Services.GetRequiredService<ITokenAcquisition>();
        return await tokenAcquisition.GetAccessTokenForUserAsync([SignInOptions.AgentUserScope]);
    }
    catch (MsalUiRequiredException ex)
    {
        Services.GetRequiredService<MicrosoftIdentityConsentAndConditionalAccessHandler>()
            .HandleException(ex);
        return string.Empty;
    }
    catch (MicrosoftIdentityWebChallengeUserException ex)
    {
        Services.GetRequiredService<MicrosoftIdentityConsentAndConditionalAccessHandler>()
            .HandleException(ex);
        return string.Empty;
    }
}
```

The token comes from the cache that `AddInMemoryTokenCaches` set up during sign-in, so this call is
normally silent. The two `catch` blocks handle:

- `MsalUiRequiredException`: no usable cached token.
- `MicrosoftIdentityWebChallengeUserException`: Entra requires interactive input (for example, a
  conditional access policy or an unanswered consent prompt).

Both are handed to the consent handler, which turns them into a redirect the user can complete.

The services are resolved from `IServiceProvider` (not injected with `@inject`) because
`ITokenAcquisition` only exists in the container when sign-in is enabled. An `@inject` directive
would fail at render time in anonymous mode.

> ✅ **Checkpoint.** The sign-in client is registered, the app is pointed at it, and you have read
> the code that will use it. The sign-in is still dormant, because the scope it asks for is built
> from a blueprint id that does not exist yet.

---

## Exercise 3: Register the agent with Agent 365

This exercise creates two objects in your tenant:

- The **blueprint**: the parent app registration. It holds the permissions and defines the agent.
- The **agent identity**: a child principal of the blueprint. It is the principal that acts, and that
  telemetry is attributed to.

The exercise ends by giving the sign-in from Exercise 2 the blueprint id it was missing.

### Step 1: Run the setup skill

**What you type**

```text
Set up Agent 365 for this agent. It's a web app where users sign in,
not a Teams agent and not an AI Teammate. Use the OBO auth mode.
```

**What the skill does**

The `a365-setup` skill runs first. It checks the prerequisites, offers to install anything missing,
and confirms which Azure identity you are signed in as. It asks two questions:

| Question | Your answer for this lab | Why |
| --- | --- | --- |
| Agent kind? | **Agent (Non AI Teammate)** | A human drives this agent, it has no mailbox or presence in Teams |
| Auth mode? | **`obo`** | Everything the agent does is attributed to the signed-in user |

Once you have answered, `a365-setup` hands off to `make-a365-agent`, which performs the actual
registration.

**Behind the scenes**

```bash
a365 setup all --agent-name "my-agent" --dry-run    # preview what will happen
a365 setup all --agent-name "my-agent"              # actually do it
```

Run the dry run first and read the output. `a365 setup all` is idempotent and safe to re-run.

It creates:

- An **agent blueprint** app registration with a client secret
- An **agent identity** as a child of that blueprint
- The API permissions the agent needs, including `Agent365.Observability.OtelWrite`
- A file called `a365.generated.config.json` holding all the generated identifiers

**How to verify**

Open `a365.generated.config.json` and confirm there is an `agentBlueprintId` and an agent identity
id in it. Then go to the [Entra admin center](https://entra.microsoft.com), open **App
registrations**, and confirm the blueprint is listed.

> ⚠️ If you are not a Global Administrator, read the summary the CLI printed. It contains a consent
> snippet for an administrator to run. Until consent is granted, the permissions exist but are not
> effective, and Exercise 4 fails with a consent error. This is the first of two admin handoffs.

### Step 2: Store the blueprint secret somewhere safe

`a365 setup all` generated a client secret for the blueprint. This secret proves, in the token chain
(Exercise 4), that your code is allowed to act as this agent. Do not commit it to source control.

```bash
dotnet user-secrets set "Agent365:BlueprintClientSecret" "<secret>"
```

If you lose it, you can read it back on the same machine, signed in as the same user:

```bash
a365 setup blueprint --agent-name "my-agent" --show-secret
```

### Step 3: Give the sign-in app permission to call the blueprint

Exercise 2 gave you an app that can authenticate a user. Step 1 gave you a blueprint. The missing
piece is a token that links them.

A blueprint is an **agentic application**, and Microsoft Entra bars agentic applications from
interactive `/authorize` flows. A blueprint cannot present a sign-in page, which is why Exercise 2
registered a separate, ordinary application.

This lab has three identities:

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

That last step requires an administrator, because `access_agent_as_user` is not a permission users
can consent to themselves. If the button is greyed out, this is the second admin handoff. A
permission that is recorded but not consented to has no effect.

> If the blueprint does not appear in the search, search by its app id. The CLI appends `" Blueprint"`
> to the name you chose, so the display name may not match. If you find the API but it exposes no
> scopes, open the **blueprint's** registration, go to **Expose an API**, select **Add a scope**,
> create a scope named exactly `access_agent_as_user`, set **Who can consent?** to **Admins and
> users**, leave the state **Enabled**, and return here.

From the command line, the same two operations are:

```bash
# The scope id is on the blueprint's "Expose an API" blade
az ad app permission add --id <sign-in client app id> \
  --api <blueprint-app-id> --api-permissions <scope-id>=Scope

az ad app permission admin-consent --id <sign-in client app id>
```

`az ad app permission add` only records the permission. The consent grant on the second line is what
makes it usable.

> Do not mix up the two secrets. The blueprint secret authenticates hop 1 of the token chain; the
> sign-in client secret authenticates the web sign-in. Swapping them produces authentication errors
> that are difficult to diagnose.

### Step 4: Give the app the blueprint id

Take `agentBlueprintId` from `a365.generated.config.json` and put it in `appsettings.json`:

```json
"Agent365Observability": {
  "AgentBlueprintId": "<blueprint app id>"
}
```

This value does two things:

- It completes the set of settings the startup check requires, so the authentication pipeline from
  Exercise 2 is registered.
- It supplies the resource portion of the scope `api://<blueprint-id>/access_agent_as_user`.

The scope determines who the token is *addressed to*. Hop 2 of the token chain only accepts an
assertion addressed to the blueprint (not `User.Read` and not the blueprint's `.default`).

Restart the app afterwards.

### Step 5: Verify the token you get back

Open the app. You should be redirected to Entra before the chat page renders, because
`AuthorizeRouteView` blocks anonymous visitors. On first use in a tenant without prior admin consent,
you will be prompted to approve the permissions.

Once signed in, verify the token. Set a breakpoint on the
`return await tokenAcquisition.GetAccessTokenForUserAsync(...)` line in `Components/Pages/Home.razor`
and reload the page. The first render probes for the token, so the breakpoint hits without sending a
message. Copy the return value.

Paste it into [jwt.ms](https://jwt.ms) (decodes in the browser, sends nothing externally) and check
four claims:

| Claim | What it should say |
| --- | --- |
| `aud` | The **blueprint's** app id, or `api://<blueprint-id>`, **not** the sign-in client's id |
| `scp` | It should contain `access_agent_as_user` |
| `oid` | The signed-in user's object id |
| `tid` | Your tenant id |

If `aud` is the sign-in client or Microsoft Graph, the scope was not requested correctly. The usual
cause is a stale or incorrect blueprint id that builds a scope pointing at a different resource.

Note the `oid` value. Exercise 4, Step 7 uses it.

> ✅ **Checkpoint.** This is a good place to stop if you need to. The agent is registered and
> governed, it shows up in your tenant, and users sign in to it with a token addressed to the
> blueprint. It does not emit any telemetry yet.

---

## Exercise 4: Instrument the agent for observability

This exercise adds telemetry to every turn, attributed to the signed-in user, and visible in
Defender, Purview, and the Microsoft 365 admin center.

The steps: install the telemetry distro, wire it into startup, obtain a token the exporter can use,
attach identity baggage to every turn, and wrap the turn in the semantic span types Agent 365
accepts.

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
| 0.5 | Confirms the agent kind and the auth mode. **Check that it says `obo`** |
| 1 | Detects your stack and loads the matching reference patterns |
| 2 | Installs the A365 OpenTelemetry distro |
| 3 | Wires the distro into your entry point |
| 4 | Adds a baggage scope to your message handler |
| 5 | Implements the token resolver |
| 5.5 | Adds the manual instrumentation scopes |
| 6 to 8 | Updates configuration, builds, and smoke-tests the result |

> Verify the auth mode before continuing. For this lab `obo` is correct. It is *not* correct for a
> Teams-hosted agent, and the skill has been known to choose it there anyway.

> The skill instruments a signed-in app; it does not create the sign-in. Phase 5 implements the
> token resolver on the assumption that something upstream already provides a user assertion.
> Complete Exercise 3, Step 5 before running this.

The rest of this exercise walks through the changes. **If you ran the skill, you do not need to
perform these steps.** Read them as a reference and as a checklist if something is not working.

### Step 2: Install the distro

```bash
dotnet add package Microsoft.OpenTelemetry
```

### Step 3: Wire the exporter into the entry point

Initialise the distro in `Program.cs`. This hangs off `builder` (not `builder.Services`), because
the distro configures the whole OpenTelemetry pipeline:

```csharp
using Microsoft.OpenTelemetry;

var observabilityTokenStore = new ObservabilityTokenStore();
builder.Services.AddSingleton(observabilityTokenStore);

builder.UseMicrosoftOpenTelemetry(o =>
{
    o.Exporters = builder.Environment.IsDevelopment()
        ? ExportTarget.Agent365 | ExportTarget.Console
        : ExportTarget.Agent365;

    // The console metric exporter prints every histogram bucket on a timer, which buries the
    // spans we actually want to read. Traces and logs still reach Agent 365.
    o.Instrumentation.EnableMetrics = false;

    // OBO posts to /observability/, so UseS2SEndpoint stays at its default of false.
    o.Agent365.TokenResolver = (agentId, tenantId) =>
        Task.FromResult(observabilityTokenStore.Get(agentId, tenantId));
});
```

`o.Exporters` is a flags enum. During development, set it to `Agent365 | Console` so spans also
appear in the terminal. `TokenResolver` is the hook the exporter calls when it needs a token; it
reads from a store that stays empty until Step 5 fills it.

LLM calls only emit spans if the chat client is instrumented. The sample builds the agent from the
Azure OpenAI chat client, so add the instrumentation between the two:

```csharp
var instrumentedChatClient = azureClient.GetChatClient(aoaiDeployment)
    .AsIChatClient()
    .AsBuilder()
    .UseFunctionInvocation()
    .UseOpenTelemetry(configure: cfg => cfg.EnableSensitiveData = true)
    .Build();

return instrumentedChatClient.AsAIAgent(
    instructions: "...",        // unchanged from the starting point
    name: "LearnMcpAgent",
    tools: learnMcpTools.Cast<AITool>().ToList());
```

- `UseFunctionInvocation()` intercepts tool calls so they surface as tool spans.
- `UseOpenTelemetry()` emits the `chat` spans that `InvokeAgentScope` anchors as children in Step 8.
- `EnableSensitiveData` writes prompts and completions into span attributes.

### Step 4: Implement the two-hop token chain

The exporter needs a token to post to the Agent 365 Observability API. It must be a token issued to
the agent identity, acting on behalf of the signed-in user. A plain delegated user token is rejected
because its principal is the human, not the agent. Getting the right token takes two hops.

**Hop 1**: the blueprint proves that it owns the agent identity, and gets back an assertion.

```csharp
var form = new Dictionary<string, string>
{
    ["client_id"]     = blueprintClientId,
    ["client_secret"] = blueprintClientSecret,
    ["scope"]         = "api://AzureADTokenExchange/.default",
    ["fmi_path"]      = agentIdentityClientId,
    ["grant_type"]    = "client_credentials",
};
// POST to https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
```

The `fmi_path` parameter turns this from an ordinary client-credentials call into an agent flow: it
requests an assertion for the specified child identity. The result is not an access token; it is only
usable as a client assertion in the second hop.

**Hop 2**: the agent identity exchanges the user's token for the one you actually want.

```csharp
var form = new Dictionary<string, string>
{
    ["client_id"]             = agentIdentityClientId,
    ["scope"]                 = resourceScope,
    ["client_assertion_type"] = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    ["client_assertion"]      = t1Token,          // proves which agent
    ["assertion"]             = userAccessToken,  // proves for whom
    ["grant_type"]            = "urn:ietf:params:oauth:grant-type:jwt-bearer",
    ["requested_token_use"]   = "on_behalf_of",
};
```

The two assertions work together: `client_assertion` identifies which agent is asking, and
`assertion` identifies the user it is asking for. That second value is the user token addressed to
the blueprint (from Exercise 3), obtained on every turn through `AcquireUserAssertionAsync()`. The
result is a token that represents the agent acting for that specific person.

On .NET, the two form posts use `HttpClient` with a `FormUrlEncodedContent` body. Read the JSON
response for `access_token` and `expires_in` to cache the result.

**Cache both hops, and refresh a few minutes before expiry.** A token that expires mid-turn disables
the export silently. The agent keeps answering but telemetry stops.

### Step 5: Bridge the token across to the exporter

The exporter flushes spans on a background loop, not on the request thread. There is no HTTP
request, no signed-in user, and nothing to exchange on behalf of. Acquire the token while you still
have a user, store it where both threads can see it, and let the exporter read it from the store.
The store's read method is the one you handed to the distro in Step 3.

```csharp
// On the request thread, once per turn:
var userAssertion = await AcquireUserAssertionAsync();   // the blueprint-scoped token verified in Exercise 3
var agentToken = await oboTokens.GetAgentTokenAsync(userAssertion, ObservabilityScope);
observabilityTokenStore.Set(agentIdentityClientId, tenantId, agentToken);
```

> Do not acquire the token inside the resolver itself. By the time the resolver runs, there is no
> user context to act on behalf of.

### Step 6: Open a baggage scope around every turn

Baggage is OpenTelemetry's mechanism for carrying contextual values alongside the current execution
context. Agent 365 uses it to carry the identity dimensions it partitions telemetry by: tenant,
agent, user, and conversation.

Spans emitted outside an active baggage scope are dropped. The exporter reports
`Partitioned into 0 identity groups`.

```csharp
using var scope = new BaggageBuilder()
    .TenantId(tenantId)
    .AgentId(agentIdentityClientId)
    .AgentName(agentName)
    .AgentBlueprintId(blueprintClientId)
    .ConversationId(conversationId)
    .SessionId(conversationId)
    .UserId(userId)
    .UserName(userName)
    .UserEmail(userEmail)
    .ChannelName("web")   // this isn't Teams, so use a logical channel name
    .Build();
```

The `using` keeps the scope open until the end of the enclosing block. The agent invocation must
happen inside that block.

`.AgentBlueprintId()` populates `TargetAgentBlueprintId` in reporting, tying the activity to the
blueprint registered in Exercise 3.

### Step 7: Resolve the caller correctly

The Microsoft 365 admin center requires the caller's **directory object id** to display the user.
Any other identifier still returns `HTTP 200` and the row still arrives, but it never resolves to a
person.

The object id is the `oid` claim noted in Exercise 3, Step 5. Other claims (`sub`, `nameidentifier`)
look similar but are not the same: `sub` is pairwise per application, and `nameidentifier` can map
to a base64 hash.

Use the helper from `Microsoft.Identity.Web`:

```csharp
using Microsoft.Identity.Web;

var userId    = user?.GetObjectId()    ?? "unknown";
var userName  = user?.GetDisplayName() ?? "unknown";
```

### Step 8: Wrap the turn in the semantic scopes

Agent 365 only ingests spans whose `gen_ai.operation.name` is one of `invoke_agent`, `chat`,
`execute_tool`, or `output_messages`. Other spans are dropped.

Open an `InvokeAgentScope` at the start of every turn. It becomes the root span for that turn. The
Microsoft 365 admin center only ingests `invoke_agent` spans; Defender ingests all accepted types.

```csharp
var request = new Request(
    content: userText,
    sessionId: conversationId,
    conversationId: conversationId,
    channel: new Channel("web"));

using var invokeScope = InvokeAgentScope.Start(
    request,
    new InvokeAgentScopeDetails(endpoint),
    agentDetails,
    callerDetails);
```

> The session, conversation, and channel must be on the request object, not only in baggage.
> Baggage values land on span tags, so the data appears to be present. However, the exported
> `invoke_agent` payload is built from the request object. Omitting them from it produces a span
> that is accepted but shows no run context.

You do not need to add `chat` spans manually on .NET. They come from the `UseOpenTelemetry()` call
in Step 3, and tool calls surface from `UseFunctionInvocation()`. If either is missing, check that
both calls are still in the chat client builder chain.

### Step 9: Verify that the telemetry is actually leaving

Confirm from the app's own logs that spans are being exported. Turn on exporter logging:

```powershell
$env:OTEL_LOG_LEVEL="INFO"
$env:A365_OBSERVABILITY_LOG_LEVEL="debug"
```

Both variables matter. `OTEL_LOG_LEVEL` controls the OpenTelemetry SDK diagnostics;
`A365_OBSERVABILITY_LOG_LEVEL` enables logging from the Agent 365 components.

Ask the agent a question and check the output for:

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

With observability in place, give the agent access to Microsoft 365 data (Mail, Calendar, and more)
through the Work IQ MCP servers. The agent reaches this data using the signed-in user's own
permissions.

### Step 1: Run the Work IQ skill

**What you type**

```text
Add Work IQ tools to this agent. I want Mail and Calendar.
```

**What the skill does**

`add-workiq-tools` shows the catalog of available servers, adds the selected ones, writes a
`ToolingManifest.json`, wires a registration service into your agent code, and walks you through
the permissions each server needs.

**Behind the scenes**

```bash
a365 develop list-available                          # see what's in the catalog
a365 develop add-mcp-servers --servers mail,calendar # add the ones you want
```

**How to verify**

Open `ToolingManifest.json` and verify that each requested server appears **exactly once** (duplicate
registrations are a known failure mode). Then test:

```text
What's on my calendar tomorrow?
```

> ✅ **Checkpoint.** The agent can now reach Microsoft 365 data as the signed-in user.

---

## Exercise 6: Verify it end to end

This exercise confirms that telemetry arrives in the portals. The export returning `HTTP 200` does
not guarantee delivery; there are several ways for a span to be accepted and then discarded.

### Step 1: Produce some activity

Ask the agent three or four questions. Use the [sample prompts](./99-sample-prompts.md) if needed.
Include at least one question that causes a tool call.

### Step 2: Check Microsoft Defender

Go to [Advanced hunting](https://security.microsoft.com) in the Defender portal and query the
`CloudAppEvents` table. Allow about five minutes for indexing.

```kusto
CloudAppEvents
| where ActionType in ("InvokeAgent", "InferenceCall", "ExecuteToolBySDK", "ExecuteToolByGateway", "ExecuteToolByMCPServer")
| where RawEventData.TargetAgentName == "your-agent-name" or RawEventData.AgentName == "your-agent-name"
| order by Timestamp desc
```

### Step 3: Check the Microsoft 365 admin center

Go to [admin.cloud.microsoft](https://admin.cloud.microsoft), find your agent in the inventory,
and open its activity.

The admin center ingests `invoke_agent` rows only and reads the caller identity from that span. The
combination of what each portal shows tells you where a problem is:

| What you see | Where the problem is |
| --- | --- |
| Nothing anywhere | Export, token, or baggage scope. Go back to Exercise 4, Step 9 |
| Defender ✅, admin center ❌ | Your `invoke_agent` span. Nine times out of ten it is the caller id, so Exercise 4, Step 7 |
| Both ✅, but no user shown | The caller resolved to something that is not a directory object id |
| Both ✅, but no run context | Session, conversation or channel missing from the request object, so Exercise 4, Step 8 |

### Step 4: Optional, let a skill check the code for you

```text
Validate the Agent 365 observability code in this project.
```

`a365-code-validator` checks that the exporter is activated, the runtime agent identity is bound
correctly, the required spans are present, and the token has the right shape for the endpoint. It is
read-only and safe to run at any point.

> ✅ **Checkpoint.** You have produced activity, found it in both portals, and confirmed how the
> two portals differ when something is missing.

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
| The app starts in anonymous mode with a filled-in `appsettings.json` | A required value is still blank or still a placeholder, and the blueprint id is the usual one. Exercise 3, Step 4 |
| Sign-in loops back to the sign-in page | The browser is on `127.0.0.1` and the cookie was set on `localhost`, or vice versa. Exercise 2, Step 1 |
| `MsalUiRequiredException` on the first turn after a restart | The auth cookie survives the restart but the in-memory token cache does not. Sign out and back in, or handle it as in Exercise 2, Step 5 |
| No `chat` spans | The `UseOpenTelemetry()` call is missing from the chat client builder chain. Exercise 4, Step 3 |

## Completion

You have completed **Lab A365-01A**. You started with an ordinary web agent and onboarded it to
Agent 365. Along the way you covered:

✅ **Identity separation**: three identities (sign-in client, blueprint, agent identity) and why a
blueprint cannot sign users in.

✅ **Registration**: `a365 setup all` creates the blueprint and agent identity.

✅ **The right token**: the sign-in requests `api://<blueprint-id>/access_agent_as_user` and the
claims confirm the audience.

✅ **The two-hop chain**: `fmi_path` turns a client-credentials call into an agent flow; pairing a
client assertion with a user assertion produces a token meaning "this agent, for this person".

✅ **Observability**: the A365 exporter wired into a Blazor Server app, a per-request token bridged
to a background flush thread, and a baggage scope that keeps spans from being dropped.

✅ **Semantic spans**: the four accepted operation names, why `invoke_agent` is required for the
admin center, and why the caller must be a directory object id.

✅ **Microsoft 365 data**: Work IQ MCP servers providing mail and calendar access under the
signed-in user's permissions.

✅ **Verification**: reading the exporter's logs, and interpreting the difference between Defender
and admin center results.

### Related resources

| Resource | Link |
| --- | --- |
| Sample prompts | [99-sample-prompts.md](./99-sample-prompts.md) |
| The same lab in Python | [01b-web-obo-python.md](./01b-web-obo-python.md) |
| The same lab in Node.js | [01c-web-obo-nodejs.md](./01c-web-obo-nodejs.md) |
| Agent on-behalf-of OAuth flow | https://learn.microsoft.com/entra/agent-id/agent-on-behalf-of-oauth-flow |
| Agent 365 observability concepts | https://learn.microsoft.com/microsoft-agent-365/developer/observability-concepts |
| Agent 365 Skills | https://github.com/microsoft/agent365-skills |
