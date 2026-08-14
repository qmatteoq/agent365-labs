# Prerequisites

Every lab in this repository needs the same three things: tools on your machine, licences in your
tenant, and permissions on your account. Missing any one of them stops you somewhere in the middle
of an exercise, so it is worth checking all three now rather than discovering the gap later.

## The tools you need on your machine

| Requirement | Minimum | Check it with | What needs it |
| --- | --- | --- | --- |
| .NET SDK | 8.0 | `dotnet --version` | The Agent 365 CLI itself, and .NET agents |
| Agent 365 CLI | latest | `a365 --version` | Every exercise |
| PowerShell | 7.0 | `pwsh --version` | The consent scripts |
| Azure CLI | latest | `az version` | Signing in to the tenant |
| Az PowerShell module | latest | `Get-Module -ListAvailable Az.Accounts` | Granting permissions |
| Git | any | `git --version` | Cloning the sample agents |
| Python | 3.12 | `python --version` | The Python lab only |
| uv | latest | `uv --version` | The Python lab only |
| Node.js | 20.10 | `node --version` | The Node.js lab only |

> You need the .NET 8 SDK even if your agent is written in Python or TypeScript. This surprises
> people. The Agent 365 CLI is distributed as a .NET global tool, so .NET has to be there to run
> it. It has nothing to do with the language your agent is written in.

The CLI is the one tool you almost certainly do not have yet, so install it now:

```bash
dotnet tool install --global Microsoft.Agents365.CLI
a365 --version
```

If the second command prints a version number, you are set.

## Installing the Agent 365 Skills

Most of the Agent 365 work in these labs is done by asking an AI coding assistant to do it, using
the [Agent 365 Skills](https://github.com/microsoft/agent365-skills). The skills work with every
major assistant, but each one installs them differently. Pick the row that matches the tool you use:

| Your assistant | How to install |
| --- | --- |
| Claude Code (app, web or CLI) | Run `/plugin marketplace add https://github.com/microsoft/agent365-skills` inside a session, then `/plugin install agent365@agent365-skills` |
| GitHub Copilot CLI, VS Code agent mode | `gh skill add microsoft/agent365-skills` |
| Cursor, Windsurf, Codex CLI, Gemini CLI, or anything else that reads `.agents/skills/` | `node /path/to/agent365-skills/scripts/install.js`, run from your agent project directory |

Whichever route you take, run the install from **your agent's project folder**, so the skills can
see the code they are meant to change.

## The licences your tenant needs

| Requirement | What to know |
| --- | --- |
| Microsoft 365 tenant | With Agent 365 enabled |
| Agent 365 licence | **At least one user in the tenant must hold one** |
| Azure subscription | For the Azure OpenAI resource the agent reasons with |

That middle row deserves a warning, because it produces the most confusing failure in any of these
labs. If nobody in the tenant holds an Agent 365 licence, your telemetry is accepted with
`HTTP 200` and then silently thrown away. Your logs say the export succeeded, Defender shows
nothing, and no error message anywhere tells you why. Check the licence now, not in the last
exercise.

## The permissions you need on your account

| Permission | Who needs it | What it is for |
| --- | --- | --- |
| Application Developer (or higher) | You | Creating app registrations |
| Global Administrator | You *or* a colleague | Granting admin consent to the blueprint |
| Azure OpenAI access | You | The model the agent uses. For the Entra credential path you need the **Cognitive Services OpenAI User** role on the resource; for key auth, access to the resource keys |

> You do not have to be a Global Administrator yourself. The CLI does everything it is allowed to
> do and then prints a PowerShell snippet for an admin to run for the rest. Just be aware that this
> handoff exists, and line up the person who will run it before you start. Otherwise you will be
> blocked in the middle of the lab with a consent error that looks like a bug in your code.

There are two of these handoffs in the web on-behalf-of labs: one when the agent is registered, and
one when the sign-in app is given permission to call the agent's blueprint. Neither takes an
administrator more than a minute, but both take a lot longer than that if you have to go and find
one first.

## Getting the sample agent

The labs start from a research assistant that answers questions about Microsoft products by
searching the Microsoft Learn MCP server. Clone the runbook repository and work in the folder that
matches your stack:

```bash
git clone https://github.com/qmatteoq/agent365-runbook
cd agent365-runbook/01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point
```

| Lab | Folder |
| --- | --- |
| A365-01A (.NET) | `dotnet/` |
| A365-01B (Python) | `python/` |
| A365-01C (Node.js) | `nodejs/` |

You can bring your own agent instead. The labs assume two things about it: it runs as a web app
with one HTTP request per turn, and there is a single place in the code where a turn begins and
ends, because that is where the instrumentation goes.

## An Azure OpenAI resource

The agent reasons with a model deployed in Azure OpenAI, so you need a resource with a chat
deployment on it. Note down two values from the Azure portal, on the resource:

1. The **endpoint**, under **Resource Management** and then **Keys and Endpoint**.
2. The **deployment name**, under **Model deployments**.

You also want the id of the tenant that owns that resource, which matters more than it looks if you
work across more than one tenant. Leave it out and the credential hands back a token from whichever
tenant you last signed in to, and Azure OpenAI answers with `HTTP 400` and
`Tenant provided in token does not match resource token`, an error that reads like a code problem
and is not.

## Ready?

Once all four sections check out, open the lab for your stack:

- [Lab A365-01A: .NET](./01a-web-obo-dotnet.md)
- [Lab A365-01B: Python](./01b-web-obo-python.md)
- [Lab A365-01C: Node.js](./01c-web-obo-nodejs.md)
