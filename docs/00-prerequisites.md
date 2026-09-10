# Prerequisites

This page is for **Path 2**, the Agent 365 SDK and custom web-app labs:

- [Lab A365-02A: .NET](./02a-web-obo-dotnet.md)
- [Lab A365-02B: Python](./02b-web-obo-python.md)
- [Lab A365-02C: Node.js](./02c-web-obo-nodejs.md)

If you are taking the browser-first Copilot Studio runtime-harness path, use the self-contained prerequisites in [Lab A365-01](./01-copilot-studio.md#prerequisites) instead.

Every **Path 2** lab in this repository requires the same three things: tools on your machine, licences in your tenant, and permissions on your account.

## The tools you need on your machine

| Requirement | Minimum | Check it with | What needs it |
| --- | --- | --- | --- |
| .NET SDK | 8.0 | `dotnet --version` | The Agent 365 CLI itself, and .NET agents |
| Agent 365 CLI | latest | `a365 --version` | Every Path 2 lab |
| PowerShell | 7.0 | `pwsh --version` | The consent scripts |
| Azure CLI | latest | `az version` | Signing in to the tenant |
| Az PowerShell module | latest | `Get-Module -ListAvailable Az.Accounts` | Granting permissions |
| Git | any | `git --version` | Cloning the sample agents |
| Python | 3.12 | `python --version` | The Python lab only |
| uv | latest | `uv --version` | The Python lab only |
| Node.js | 20.10 | `node --version` | The Node.js lab only |

> The .NET 8 SDK is required even if your agent is written in Python or TypeScript. The Agent 365 CLI is distributed as a .NET global tool, so .NET must be installed to run it. This is unrelated to the language your agent is written in. This requirement is for **Path 2** only; Lab A365-01 does not use the CLI.

A key requirement for the labs is the Agent 365 CLI, which you can install with the following command:

```bash
dotnet tool install --global Microsoft.Agents365.CLI
a365 --version
```

The second command prints the installed version.

## Installing the Agent 365 Skills for Path 2

Most of the Agent 365 work in the **Path 2** labs is done by asking an AI coding assistant to do it, using the [Agent 365 Skills](https://github.com/microsoft/agent365-skills). The skills work with every major assistant, and each one installs them differently. Pick the row that matches the tool you use:

| Your assistant | How to install |
| --- | --- |
| Claude Code (app, web or CLI) | Run `/plugin marketplace add https://github.com/microsoft/agent365-skills` inside a session, then `/plugin install agent365@agent365-skills` |
| GitHub Copilot CLI, VS Code agent mode | `gh skill add microsoft/agent365-skills` |
| Cursor, Windsurf, Codex CLI, Gemini CLI, or anything else that reads `.agents/skills/` | `node /path/to/agent365-skills/scripts/install.js`, run from your agent project directory |

Run the install from **your agent's project folder**, so the skills can see the code they are meant to change.

> Lab A365-01 does not use these coding-assistant skills. It uses a native skill created inside the Copilot Studio browser authoring experience.

## The licences your tenant needs for Path 2

| Requirement | What to know |
| --- | --- |
| Microsoft 365 tenant | With Agent 365 enabled |
| Agent 365 licence | **At least one user in the tenant must hold one** |
| Azure subscription | For the Azure OpenAI resource the agent reasons with |

> If nobody in the tenant holds an Agent 365 licence, telemetry is accepted with `HTTP 200` and then discarded. The logs report a successful export, Defender shows no data, and no error is raised. Verify the licence before you start.

## The permissions you need on your account for Path 2

| Permission | Who needs it | What it is for |
| --- | --- | --- |
| Application Developer (or higher) | You | Creating app registrations |
| Global Administrator | You *or* a colleague | Granting admin consent to the blueprint |
| Azure OpenAI access | You | The model the agent uses. For the Entra credential path you need the **Cognitive Services OpenAI User** role on the resource; for key auth, access to the resource keys |

> You do not need to be a Global Administrator yourself. The CLI performs every action it is permitted to perform, then prints a PowerShell snippet for an administrator to run for the rest. Identify the person who will run it before you start.

The web on-behalf-of labs contain two of these handoffs: one when the agent is registered, and one when the sign-in app is given permission to call the agent's blueprint. Each takes an administrator about a minute.

## Getting the sample agent for Path 2

The Path 2 labs start from a research assistant that answers questions about Microsoft products by searching the Microsoft Learn MCP server. Clone the runbook repository and work in the folder that matches your stack:

```bash
git clone https://github.com/qmatteoq/agent365-runbook
cd agent365-runbook/01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point
```

| Lab | Folder |
| --- | --- |
| A365-02A (.NET) | `dotnet/` |
| A365-02B (Python) | `python/` |
| A365-02C (Node.js) | `nodejs/` |

You can bring your own agent instead. The Path 2 labs assume two things about it: it runs as a web app with one HTTP request per turn, and there is a single place in the code where a turn begins and ends, which is where the instrumentation goes.

## An Azure OpenAI resource for Path 2

The agent reasons with a model deployed in Azure OpenAI, so you need a resource with a chat deployment on it. Note down two values from the Azure portal, on the resource:

1. The **endpoint**, under **Resource Management** and then **Keys and Endpoint**.
2. The **deployment name**, under **Model deployments**.

Also note the id of the tenant that owns that resource. Without it, the credential returns a token from whichever tenant you last signed in to, and Azure OpenAI responds with `HTTP 400` and `Tenant provided in token does not match resource token`.

## Next steps

Once all four sections check out, open the lab for your stack:

- [Lab A365-02A: .NET](./02a-web-obo-dotnet.md)
- [Lab A365-02B: Python](./02b-web-obo-python.md)
- [Lab A365-02C: Node.js](./02c-web-obo-nodejs.md)

If you are taking the browser-first Copilot Studio runtime-harness path instead, open [Lab A365-01](./01-copilot-studio.md).
