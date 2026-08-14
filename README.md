# Agent 365 Labs

Hands-on labs that take a working agent and onboard it into **Microsoft Agent 365**, so the
organization it runs in can see it, govern it, and hold it accountable.

Every lab is written to be followed in a single sitting, with a terminal on one side and a browser
on the other. You start from code that already works and finish with an agent that has an identity
in your tenant, reports its activity to Microsoft Defender and the Microsoft 365 admin center, and
can reach Microsoft 365 data on behalf of the person using it.

## Labs

### Path 1: Web app agent with user on-behalf-of

A user opens a web page, signs in, and drives the agent. Everything the agent does is attributed
back to that person. The same lab is available in three stacks, and you only need to complete one
of them.

| Lab | Stack | Framework and host |
| --- | --- | --- |
| [A365-01A](./docs/01a-web-obo-dotnet.md) | .NET | Agent Framework on Blazor Server |
| [A365-01B](./docs/01b-web-obo-python.md) | Python | LangChain on FastAPI |
| [A365-01C](./docs/01c-web-obo-nodejs.md) | Node.js | LangChain on Express, in TypeScript |

Pick the stack you are most comfortable debugging in. The three labs reach the same destination and
the Agent 365 concepts are identical, so nothing later depends on which one you chose.

## Before you start

Every lab shares the same tooling, licensing, and permission requirements, and they are collected
in one place so you can check them once:

- [Prerequisites](./docs/00-prerequisites.md)

Work through that page before you open a lab. Two of the requirements, an Agent 365 licence in the
tenant and admin consent on the agent's permissions, involve other people, and finding that out
halfway through an exercise is the most common way to lose an afternoon.

## Extras

- [Sample prompts](./docs/99-sample-prompts.md), a set of questions chosen to produce specific,
  checkable telemetry once your agent is instrumented.

## How the labs are written

Each lab is a sequence of **exercises**, and each exercise is a sequence of **steps**. Exercises end
with a checkpoint that tells you what should be true before you move on, so you can stop between
them and pick the lab up later.

Most of the Agent 365 work is done by asking an AI coding assistant to do it for you, using the
[Agent 365 Skills](https://github.com/microsoft/agent365-skills). Each step that uses a skill shows
you four things: the prompt you type, what the skill is about to change, the CLI command or code it
comes down to underneath, and how to verify it worked. If you would rather not use a coding
assistant, read the third and fourth parts and ignore the rest. The labs work that way too.

## Where the sample agents come from

The starting points for these labs are the three sample agents in the
[Agent 365 runbook repository](https://github.com/qmatteoq/agent365-runbook), under
`01-scenarios/Web-App-Agent-User-OBO/0.Resources/Starting-point/`. They are the same agent three
times over: a research assistant that answers questions about Microsoft products by searching the
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) and citing what it found. None of
them contains a single line of Agent 365 code, which is the point.

> This is a first draft. The sample agents are still referenced from the runbook repository rather
> than vendored into this one, so cloning them is currently a manual step described in each lab.

## Feedback

These labs are under active development. Open an issue if a step does not work, if a portal has
moved, or if a warning would have saved you time.
