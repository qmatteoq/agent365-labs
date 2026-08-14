# Agent 365 Labs

Hands-on labs that take a working agent and onboard it into [**Microsoft Agent 365**](https://learn.microsoft.com/microsoft-agent-365/), so the organization it runs in can see it, govern it, and hold it accountable.

You start from an agent that contains no Agent 365 code and finish with one that:

- Has an identity in your Microsoft Entra tenant and appears in the tenant inventory
- Reports every turn to **Microsoft Defender**, **Microsoft Purview**, and the **Microsoft 365 admin center**
- Attributes its activity to the signed-in user, with that user's permissions
- Reaches Microsoft 365 data through the Work IQ MCP servers, on the .NET and Node.js stacks

Each lab is designed to be completed in a single sitting, with a terminal on one side and a browser on the other.

## Start here

<div class="cc-cards">
<cc-card-grid>
  <cc-card
    title="Prerequisites"
    description="Tools, licences, and permissions shared by every lab. Work through this page before you open a lab."
    href="00-prerequisites/"
    target="_self">
  </cc-card>
  <cc-card
    title="Lab A365-01A — .NET"
    description="Agent Framework on Blazor Server. ~3 hours, intermediate."
    href="01a-web-obo-dotnet/"
    target="_self">
  </cc-card>
  <cc-card
    title="Lab A365-01B — Python"
    description="LangChain on FastAPI. ~3 hours, intermediate."
    href="01b-web-obo-python/"
    target="_self">
  </cc-card>
  <cc-card
    title="Lab A365-01C — Node.js"
    description="LangChain on Express, in TypeScript. ~3 hours, intermediate."
    href="01c-web-obo-nodejs/"
    target="_self">
  </cc-card>
</cc-card-grid>
</div>

## Labs

### Path 1: Web app agent with user on-behalf-of

A user opens a web page, signs in, and drives the agent. Everything the agent does is attributed back to that person. The same lab is available in three stacks, and you only need to complete one of them.

| Lab | Stack | Framework and host | Duration | Level |
| --- | --- | --- | --- | --- |
| [A365-01A](01a-web-obo-dotnet.md) | .NET 8 | Agent Framework on Blazor Server | ~3 hours | Intermediate |
| [A365-01B](01b-web-obo-python.md) | Python 3.12 | LangChain on FastAPI | ~3 hours | Intermediate |
| [A365-01C](01c-web-obo-nodejs.md) | Node.js 20.10 | LangChain on Express, in TypeScript | ~3 hours | Intermediate |

Pick the stack you are most comfortable debugging in. The three labs reach the same destination and the Agent 365 concepts are identical, so nothing later depends on which one you choose.

!!! warning "Work IQ availability"
    Work IQ is not yet available for Python with LangChain. Lab A365-01B covers Exercise 5 as an explanation of the gap instead of an implementation. Choose .NET or Node.js to build the Microsoft 365 data access end to end.

## What the labs cover

All three labs follow the same six exercises:

| # | Exercise | What you have at the end |
| --- | --- | --- |
| 1 | Run the agent as it is | A working agent that answers questions and cites its sources, with no Agent 365 in it |
| 2 | Sign users in with Microsoft Entra | A registered sign-in application, and the code that acquires a user token |
| 3 | Register the agent with Agent 365 | An agent blueprint and identity in the tenant, and a user token addressed to the blueprint |
| 4 | Instrument the agent for observability | OpenTelemetry and the Agent 365 exporter emitting semantic spans per turn |
| 5 | Give the agent access to Microsoft 365 data | Mail, Calendar and more through the Work IQ MCP servers, as the signed-in user |
| 6 | Verify it end to end | Activity confirmed in Microsoft Defender and the Microsoft 365 admin center |

## Before you start

Every lab shares the same tooling, licensing, and permission requirements, collected in one place:

**[Prerequisites](00-prerequisites.md)**

In summary, you need:

| | |
| --- | --- |
| **Tools** | .NET 8 SDK, Agent 365 CLI, PowerShell 7, Azure CLI, Az PowerShell module, Git, plus the runtime for your chosen stack |
| **Tenant** | A Microsoft 365 tenant with Agent 365 enabled, and at least one Agent 365 licence held by a user in it |
| **Azure** | A subscription with an Azure OpenAI resource and a chat deployment |
| **Permissions** | Application Developer or higher on your account, and a Global Administrator, either you or a colleague, to grant consent twice |

The .NET 8 SDK is required for every stack, because the Agent 365 CLI is distributed as a .NET global tool.

!!! note "Two requirements involve other people"
    The Agent 365 licence in the tenant, and admin consent on the agent's permissions. Work through the prerequisites page before you open a lab.

## How the labs are written

Each lab is a sequence of **exercises**, and each exercise is a sequence of **steps**. Every exercise ends with a checkpoint stating what should be true before you move on, so you can stop between exercises and pick the lab up later.

Most of the Agent 365 work is done by asking an AI coding assistant to do it for you, using the [Agent 365 Skills](https://github.com/microsoft/agent365-skills). Each step that uses a skill shows four things:

1. **What you type**, the prompt you give your coding assistant
2. **What the skill does**, the changes it makes
3. **Behind the scenes**, the CLI command or code underneath
4. **How to verify**, how to confirm it worked before moving on

To complete the labs by hand, read parts 3 and 4 and skip the rest. Exercise 2 is the exception: signing users in with Entra is ordinary web app work, so no skill covers it.

## Where the sample agents come from

The starting points for these labs are the three sample agents in the [Agent 365 runbook repository](https://github.com/qmatteoq/agent365-runbook), under `01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point/`. They are the same agent in three stacks: a research assistant that answers questions about Microsoft products by searching the [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) and citing what it found. None of them contains any Agent 365 code.

You can bring your own agent instead. The labs assume it runs as a web app with one HTTP request per turn, and that there is a single place in the code where a turn begins and ends, which is where the instrumentation goes.

!!! info "First draft"
    The sample agents are still referenced from the runbook repository instead of being vendored into this one, so cloning them is currently a manual step described in each lab.

## Related

| Resource | What it is for |
| --- | --- |
| [Agent 365 runbooks](https://github.com/qmatteoq/agent365-runbook) | Reference guidance for onboarding your own agent, organized by scenario and pattern |
| [Agent 365 Skills](https://github.com/microsoft/agent365-skills) | The six skills the labs drive from your coding assistant |
| [Agent 365 documentation](https://learn.microsoft.com/microsoft-agent-365/) | The official product documentation |

Use these labs to learn the onboarding path end to end on a known sample. Use the runbooks when you are applying it to an agent of your own.

## Feedback

These labs are under active development. [Open an issue](https://github.com/qmatteoq/agent365-labs/issues) if a step does not work, if a portal has moved, or if a warning would have saved you time.

## Disclaimer

This repository is a community resource and is not an official Microsoft product. Agent 365 is evolving, and commands, scopes and identifiers change. Verify against the [official Agent 365 documentation](https://learn.microsoft.com/microsoft-agent-365/) before relying on anything here in production.

<cc-next label="Start with the prerequisites" url="00-prerequisites/"></cc-next>
