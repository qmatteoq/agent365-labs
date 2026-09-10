# Agent 365 Labs

Hands-on labs for [**Microsoft Agent 365**](https://learn.microsoft.com/microsoft-agent-365/). Register and instrument a custom web agent, or build a Copilot Studio agent and use its built-in observability.

Both paths use a Microsoft documentation research assistant. You follow its tool calls and inspect the resulting activity in Microsoft Defender and the Microsoft 365 admin center.

Each lab is designed to be completed in a single sitting. Path 1 uses a terminal and a browser; Path 2 stays in browser surfaces.

## Start here

<div class="cc-cards">
<cc-card-grid>
  <cc-card
    title="Prerequisites"
    description="Shared prerequisites for Path 1, the custom web-app labs. Lab A365-02 has its own self-contained prerequisite section."
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
  <cc-card
    title="Lab A365-02 — Copilot Studio"
    description="GitHub Copilot runtime harness in the Copilot Studio new experience. ~60-90 minutes, beginner to intermediate."
    href="02-copilot-studio/"
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

### Path 2: Copilot Studio agent with the GitHub Copilot runtime harness

Create an agent in Copilot Studio using the GitHub Copilot harness. Add the Microsoft Learn MCP server and a native skill, then publish to Teams and inspect its activity. Copilot Studio emits the telemetry automatically; you do not add instrumentation.

This lab has its own tenant and Defender prerequisites. It also explains the current uncertainty about Copilot Studio coverage in the admin-center Activity view.

| Lab | Runtime and authoring surface | Duration | Level |
| --- | --- | --- | --- |
| [A365-02](02-copilot-studio.md) | Copilot Studio new experience with the GitHub Copilot runtime harness | ~60-90 minutes, plus admin prework and indexing | Beginner to intermediate |

## What the labs cover

Path 1, the custom web-app path, follows the same six exercises:

| # | Exercise | What you have at the end |
| --- | --- | --- |
| 1 | Run the agent as it is | A working agent that answers questions and cites its sources, with no Agent 365 in it |
| 2 | Sign users in with Microsoft Entra | A registered sign-in application, and the code that acquires a user token |
| 3 | Register the agent with Agent 365 | An agent blueprint and identity in the tenant, and a user token addressed to the blueprint |
| 4 | Instrument the agent for observability | OpenTelemetry and the Agent 365 exporter emitting semantic spans per turn |
| 5 | Give the agent access to Microsoft 365 data | Mail, Calendar and more through the Work IQ MCP servers, as the signed-in user |
| 6 | Verify it end to end | Activity confirmed in Microsoft Defender and the Microsoft 365 admin center |

Path 2, the Copilot Studio runtime-harness path, follows its own six browser exercises:

| # | Exercise | What you have at the end |
| --- | --- | --- |
| 1 | Create the agent in the new experience | A Copilot Studio agent in the runtime harness, with recorded environment and bot identifiers |
| 2 | Add a real MCP tool and a native runtime skill | A Microsoft Learn tool connection and an uploaded `learn-research` skill |
| 3 | Prove tool use in Preview | An activity trace with a real `microsoft_docs_search` call |
| 4 | Publish and test in Teams | Authenticated runs in a published channel in the same tenant |
| 5 | Check activity in the Microsoft 365 admin center | Activity for the test period, or an incomplete checkpoint with the missing evidence recorded |
| 6 | Hunt the traces in Defender | Matching invocation and Microsoft Learn tool events for the published conversation |

## Before you start

The prerequisites are path-specific:

| Path | Start here |
| --- | --- |
| **Path 1 - custom web app** | [Prerequisites](00-prerequisites.md) |
| **Path 2 - Copilot Studio runtime harness** | [Lab A365-02 prerequisites](02-copilot-studio.md#prerequisites) |

Path 1 needs the CLI, a language SDK, Azure OpenAI, and a sample agent checkout. Path 2 needs Copilot Studio access and the tenant setup described in its prerequisites.

## How the labs are written

Each lab is a sequence of **exercises**, and each exercise is a sequence of **steps**. Every exercise ends with a checkpoint stating what should be true before you move on, so you can stop between exercises and pick the lab up later.

Path 1 does most of the Agent 365 work by asking an AI coding assistant to do it for you, using the [Agent 365 Skills](https://github.com/microsoft/agent365-skills). Those steps show four things:

1. **What you type**, the prompt you give your coding assistant
2. **What the skill does**, the changes it makes
3. **Behind the scenes**, the CLI command or code underneath
4. **How to verify**, how to confirm it worked before moving on

Path 2 provides text to paste into Copilot Studio, a complete `SKILL.md` to upload, and Defender queries. Its skill runs inside the agent; it is not a coding-assistant plugin. Browser steps use the same exercise, step, and checkpoint structure.

## Where the Path 1 sample agents come from

The starting points for these labs are the three sample agents in the [Agent 365 runbook repository](https://github.com/qmatteoq/agent365-runbook), under `01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point/`. They are the same agent in three stacks: a research assistant that answers questions about Microsoft products by searching the [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) and citing what it found. None of them contains any Agent 365 code.

You can bring your own agent instead. The labs assume it runs as a web app with one HTTP request per turn, and that there is a single place in the code where a turn begins and ends, which is where the instrumentation goes.

!!! info "First draft"
    The sample agents are still referenced from the runbook repository instead of being vendored into this one, so cloning them is currently a manual step described in each lab.

Path 2 starts with a new Copilot Studio agent. The lab includes its instructions and skill file.

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
