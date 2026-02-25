# Headless Multi-Agent Workflow Coordination

Reference guide for orchestrating headless multi-agent workflows: patterns, frameworks, model routing, cost tracking, and production deployment. Derived from design discussions on CrewAI, LangGraph, and KaibanJS.

---

## What's SOTA for coordinating headless multi-agent workflows?

In 2026, the state-of-the-art for headless multi-agent orchestration has firmly shifted away from the unpredictable, open-ended "let the agents chat and figure it out" models of the early generative AI days. Today, production-grade systems rely on **deterministic, graph-based workflows** and **strictly typed state management**.

When you are running headless (meaning the system is triggered via API, event bus, or cron job, operating entirely in the backend without a real-time user interface), reliability, observability, and structured data passing are your top priorities.

### SOTA Coordination Patterns

Depending on whether you need a file reviewed, outputs checked, or perspectives pooled, you should adopt one of these three architectural patterns.

**A. The Evaluator-Optimizer (Actor-Critic) Pattern**

* **Best for:** One agent reviewing the output of another.
* **How it works:** This is an iterative loop. A "Generator" agent creates the initial draft or code. The output is passed to an "Evaluator" agent, which is prompted with a strict rubric or set of constraints. If the Evaluator finds flaws, it returns structured feedback to the Generator. This loop continues until the Evaluator passes it or a `max_retries` limit is hit.
* **Why it's SOTA:** It separates concerns. A single LLM struggles to generate content and critique its own blind spots simultaneously.

**B. The Parallel Panel (Map-Reduce)**

* **Best for:** Multiple agents reviewing a file or pooling perspectives.
* **How it works:** A router agent receives the source file and "fans out" the task simultaneously to several highly specialized agents. For example, a codebase is sent concurrently to a Security Agent, a Performance Agent, and an Accessibility Agent. Once all three return their findings, a "Synthesizer" agent merges the perspectives, resolves conflicts, and outputs the final JSON report.
* **Why it's SOTA:** It dramatically reduces latency by running reviews in parallel rather than sequentially, and prevents specialized agents from biasing one another during the initial review.

**C. The Supervisor (Hierarchical) Pattern**

* **Best for:** Dynamic, complex tasks where the steps aren't perfectly known in advance.
* **How it works:** A Supervisor agent acts as the orchestrator. It breaks down the incoming request, selects the appropriate worker agents from its "tool belt," and delegates tasks. Workers report back to the Supervisor, who decides if the overall objective is met or if more work is needed.

### The 2026 Framework Landscape

* **LangGraph (The Enterprise Standard):** SOTA for headless, complex workflows. Treats your multi-agent system as a Directed Acyclic Graph (DAG) or state machine. Explicit nodes and edges, highly deterministic, supports persistent memory and human-in-the-loop pauses.
* **CrewAI (The Role-Based Approach):** Best for pooling perspectives. Declarative "Personas" with backstories, goals, and tools grouped into "Crews." Fast to prototype, excels at structured sequential task handoffs.
* **AutoGen (The Conversational approach):** SOTA for event-driven, conversational collaboration where agents debate until consensus. Relies on auto-reply functions and dynamic message routing.

### Best Practices for Headless Execution

* **Asynchronous Execution & Webhooks:** Accept the request, return a `job_id`, process via background workers (Celery, Temporal), fire a webhook when done.
* **Strictly Typed State (Contracts):** Use Pydantic or Zod to define shared state; agents append to typed arrays, not raw text.
* **Defensive Engineering (Max Loops & Timeouts):** Enforce `max_iterations` and hard timeouts for external tool calls.
* **Mandatory Observability:** Use Langfuse, LangSmith, or OpenTelemetry to trace agent executions.

---

## LangGraph vs CrewAI: When to use which?

**Mental model:** LangGraph is for "model A creates artifact, model B validates it" (control flow, loops). CrewAI is for "model A (as role C) and model B (as role D) review the proposal from their perspectives" (personas, task delegation).

### LangGraph: The Factory Floor (Control Flow & Loops)

When you need **"Model A creates, Model B validates,"** you're talking about a process that often requires a **loop** (e.g., if Model B rejects, route back to Model A for revisions). LangGraph is fundamentally a state machine. You explicitly wire edges: `If Validator outputs "REJECTED", route back to Generator. If "APPROVED", route to End.`

### CrewAI: The Conference Room (Personas & Perspectives)

When you need **role-playing and task delegation**, CrewAI shines. Its core abstractions are `Agents` (backstories, goals, personalities) and `Tasks`. You create a "Legal Agent" and "Marketing Agent," define a task, assign to a Crew. The framework handles the dynamics.

### The Nuance (Where they overlap)

* **Can LangGraph pool perspectives?** Yes—build a fan-out graph. You manually orchestrate.
* **Can CrewAI do validation?** Yes—sequential tasks where Agent 2 reviews Agent 1. Less deterministic than LangGraph for strict API outputs.

**TL;DR:** Strict reliability, API-like contracts, retry/feedback loops → **LangGraph**. Rich qualitative insights by combining expert personas → **CrewAI**.

---

## Can I get CrewAI agents to output structured findings?

Yes. Let agents debate in natural language internally, but force the final output into strictly typed data (JSON, Pydantic, or Zod).

### 1. Define the "Contract" (Pydantic)

```python
from pydantic import BaseModel, Field
from typing import List

class ReviewFindings(BaseModel):
    approval_status: str = Field(description="Either APPROVED or REJECTED")
    critical_issues: List[str] = Field(description="List of blocking issues found by the agents")
    summary: str = Field(description="A short summary of the combined perspectives")
```

### 2. Bind the Contract to the Final Task

```python
from crewai import Task

final_review_task = Task(
    description="Synthesize the findings from the Legal and Tech agents into a final report.",
    expected_output="A structured final review.",
    agent=synthesizer_agent,
    output_pydantic=ReviewFindings
)
```

### 3. Processing the Output

```python
result = my_crew.kickoff(inputs={'file_content': '...'})
if result.pydantic.approval_status == "REJECTED":
    db.save_issues(result.pydantic.critical_issues)
    trigger_slack_alert(f"Failed review. Summary: {result.pydantic.summary}")
```

### 4. Findings During the Process

Use **Callbacks**. Pass a `callback` function to any `Task`; CrewAI fires it when that task completes, passing `TaskOutput`, so you can stream to a UI or fire a webhook while the crew continues.

**In short:** Agents converse with each other; you build rigid walls at the exit points so your application only deals with predictable data.

---

## PRD Review Committee: Code Example

Pass a PRD to a committee of Architect, PM, Security Analyst, End User Advocate; output a refined PRD with outstanding questions at the end.

### 1. The Pydantic Contract

```python
from pydantic import BaseModel, Field
from typing import List

class RefinedPRD(BaseModel):
    updated_prd_content: str = Field(
        description="The complete, fully rewritten PRD incorporating all accepted feedback and improvements."
    )
    outstanding_questions: List[str] = Field(
        description="A list of critical questions or unresolved debates raised by the agents that require human input."
    )
```

### 2. The CrewAI Implementation

```python
from crewai import Agent, Task, Crew, Process
from textwrap import dedent

architect = Agent(
    role="Principal Software Architect",
    goal="Identify technical bottlenecks, scalability issues, and systemic flaws in product proposals.",
    backstory="You are a veteran engineer who has seen too many projects fail due to poor early architectural planning.",
    verbose=True
)
pm = Agent(role="Senior Project Manager", goal="Ensure scope is realistic...", backstory="You are ruthlessly pragmatic...", verbose=True)
security = Agent(role="Lead Security Analyst", goal="Identify threat vectors...", backstory="You are a paranoid security expert...", verbose=True)
user_advocate = Agent(role="End User Advocate", goal="Ensure the product is intuitive...", backstory="You represent the customer...", verbose=True)
synthesizer = Agent(role="Lead Technical Writer", goal="Merge diverse feedback...", backstory="You are a master at taking messy feedback...", verbose=True)

review_task = Task(
    description=dedent("""\
        Review the following PRD draft:
        {prd_document}
        1. Architect: Analyze for technical feasibility.
        2. PM: Analyze for scope and business logic.
        3. Security: Analyze for vulnerabilities.
        4. User Advocate: Analyze for UX and value.
        Debate the flaws. Do not rewrite yet; generate a list of critiques and unresolved questions."""),
    expected_output="A detailed markdown list of critiques, grouped by agent perspective.",
    agent=pm
)

rewrite_task = Task(
    description=dedent("""\
        Take the original PRD and the critiques. Rewrite the PRD to address resolvable flaws.
        Extract questions that cannot be solved without external input."""),
    expected_output="A fully refined PRD and a list of outstanding questions.",
    agent=synthesizer,
    output_pydantic=RefinedPRD
)

prd_crew = Crew(
    agents=[architect, pm, security, user_advocate, synthesizer],
    tasks=[review_task, rewrite_task],
    process=Process.sequential,
    verbose=True
)

result = prd_crew.kickoff(inputs={'prd_document': draft_prd})
```

### 3. Handling the Output

```python
print(result.pydantic.updated_prd_content)
for q in result.pydantic.outstanding_questions:
    print(f"- {q}")
```

---

## At what point do I plug in the LLM models?

Plug models in when you define **Agents**. Best practice: set them **per agent**, not globally. Use heavy models for complex reasoning, fast models for formatting and routing.

### Assigning Models per Agent

```python
architect = Agent(..., llm="gpt-5", verbose=True)
synthesizer = Agent(..., llm="anthropic/claude-3-5-sonnet-latest", verbose=True)
pm = Agent(..., llm="gpt-5-mini", verbose=True)
```

If you omit `llm`, CrewAI falls back to a global default (e.g. `OPENAI_API_KEY` + `gpt-5` for every agent). Fine for prototyping, rarely for production.

### Local Models (Privacy First)

```python
security_agent = Agent(..., llm="ollama/llama3.3", verbose=True)
```

### Best Practices

* **Architects/Security (High Logic):** `gpt-5`, `claude-3.5-sonnet`, or reasoning models.
* **Synthesizers/Writers (High Context):** `claude-3.5-sonnet`, `gemini-1.5-pro`.
* **Routers/Formatters (Low Logic):** `gpt-5-mini`, `claude-3-haiku`, `gemini-1.5-flash`.

---

## Tracking costs when mixing models

CrewAI's `result.token_usage` aggregates all tokens; useless when agents use different priced models. Track at the **Task level**.

### 1. Task Callbacks

Attach a `callback` to each task. CrewAI fires it with `TaskOutput` (token usage for that task). Cross-reference with a pricing sheet:

```python
PRICING_SHEET = {"gpt-5": (5.00, 15.00), "gpt-5-mini": (0.15, 0.60)}

def calculate_task_cost(task_output):
    model_name = task_output.agent.llm
    rates = PRICING_SHEET.get(model_name, PRICING_SHEET["gpt-5"])
    prompt_cost = (task_output.token_usage.prompt_tokens / 1_000_000) * rates[0]
    completion_cost = (task_output.token_usage.completion_tokens / 1_000_000) * rates[1]
    invoice["total_cost"] += prompt_cost + completion_cost

review_task = Task(..., callback=calculate_task_cost)
```

### 2. Observability Platforms

Use **Langfuse**, **Opik**, or **CrewAI AMP** with `CREWAI_TRACING_ENABLED=true`. They maintain live pricing DBs and provide dashboards.

---

## Error handling: fallbacks and gateways

**Do not** write manual `try/except` fallback loops in code. Use **AI Gateways** (Portkey, LiteLLM Proxy). Your agent talks to the Gateway; the Gateway handles fallbacks, retries, and load balancing.

### Portkey / LiteLLM

```python
resilient_llm = LLM(
    model="gpt-5",
    base_url=PORTKEY_GATEWAY_URL,
    extra_headers=createHeaders(api_key=..., config=fallback_config)
)
architect = Agent(..., llm=resilient_llm)
```

If `gpt-5` times out or 500s, the Gateway reroutes to `gpt-5-mini` transparently.

### API Failure vs. Output Failure

1. **Provider Errors (500s, timeouts):** Handled by the Gateway.
2. **Validation Errors (bad JSON, schema drift):** Handled by CrewAI's `guardrail_max_retries` on tasks.

---

## What is a virtual_key (Portkey)?

A `virtual_key` is a secure alias for your real API key. You store the real key in Portkey's vault; your code uses the virtual key. Benefits: security (revoke without redeploy), budget limits per key, key rotation without code changes.

---

## Deploying headless workflows to production

Multi-agent runs take minutes. Do **not** run synchronously on a web server. Use **asynchronous background processing**.

### Pattern A: Celery + Redis

1. API receives PRD, enqueues job, returns `job_id`.
2. Celery worker picks up job, runs CrewAI, saves result to DB.
3. Frontend polls or receives webhook when done.

### Pattern B: AWS Step Functions / Temporal

Package CrewAI in Docker; trigger via S3 upload or workflow orchestrator. Fargate runs the crew, saves result, shuts down. Temporal supports long human-in-the-loop pauses.

---

## Can CrewAI workflows be implemented in TypeScript?

Yes. **KaibanJS** is the direct CrewAI equivalent for JS/TS. Pydantic → **Zod**. Same Agent, Task, Team mental model.

### TS Framework Options

* **KaibanJS:** Declarative crews, Kanban UI, Zod schemas.
* **Vercel AI SDK / Mastra:** Code-first, `generateObject()` with Zod.
* **LangGraph.js:** Enterprise graph/state machine.

### KaibanJS Example

```typescript
const RefinedPRDSchema = z.object({
  updated_prd_content: z.string(),
  outstanding_questions: z.array(z.string())
});

const architect = new Agent({ name: "Architect", role: "...", goal: "...", background: "..." });
const pm = new Agent({ ... });
const synthesizer = new Agent({ ... });

const reviewTask = new Task({ description: "Review PRD: {prd_document}...", agent: pm });
const rewriteTask = new Task({ description: "Rewrite...", agent: synthesizer, outputSchema: RefinedPRDSchema });

const prdTeam = new Team({ name: "PRD Review Committee", agents: [architect, pm, synthesizer], tasks: [reviewTask, rewriteTask] });
const result = await prdTeam.start({ prd_document: draftPrd });
```

TS excels at async, streaming, and serverless; often smoother than Python + Celery for web apps.

---

## CrewAI vs KaibanJS: Capabilities, drift, performance

| Feature | CrewAI (Python) | KaibanJS (TS/JS) |
| --- | --- | --- |
| **Best For** | Backend data processing, complex hierarchical teams. | Web apps, dashboards, serverless AI. |
| **State Management** | Context window & memory modules. | Redux-inspired, predictable. |
| **Combating Drift** | `guardrail_max_retries`, Replay. | Zod schemas, WorkflowDrivenAgent (deterministic control flow). |
| **Observability** | LangSmith, OpenLit. | Built-in Kanban UI. |

* **API Concurrency:** KaibanJS (Node.js event loop) handles fan-out LLM calls with lower overhead.
* **Local Compute:** CrewAI (Python/Pandas) wins for heavy data prep before LLM.
* **Cold Starts:** KaibanJS optimized for Lambda/Vercel; CrewAI typically Docker/Celery.

## Managing which models for which agents

**Best practice:** Define **placeholders** (logical tiers) and map them globally. Do **not** hardcode `provider+model` on each agent.

### Level 1: Registry Pattern (Code & Env)

```python
MODEL_REGISTRY = {
    "tier_1_reasoning": os.getenv("MODEL_REASONING", "openai/gpt-5"),
    "tier_2_fast": os.getenv("MODEL_FAST", "openai/gpt-5-mini"),
}
smart_llm = LLM(model=MODEL_REGISTRY["tier_1_reasoning"])
fast_llm = LLM(model=MODEL_REGISTRY["tier_2_fast"])
architect = Agent(..., llm=smart_llm)
pm = Agent(..., llm=fast_llm)
```

Swap models by changing `.env`; code stays the same.

### Level 2: AI Gateway Routing

Your code asks for `model="fast-tier"`. The Gateway (LiteLLM Proxy, Portkey) maps it to the underlying provider. DevOps can hot-swap models in the Gateway dashboard without deployments.

### Summary of Tiers

* **Smart/Reasoning:** Planning, synthesis, critical coding.
* **Fast/Executor:** Formatting, summarization, routing.
* **Extraction/JSON:** Zero temperature, schema enforcement at graph exit.

---

## Does Kaiban (or others) offer a sidecar agent?

The "sidecar agent" is the pattern where all code search, file reads, and edits go through a dedicated coding agent (e.g. Composer 1.5). A heavier model plans changes and delegates execution; the sidecar fetches code, changes code, and searches.

In the AI engineering space, this is formally called **Agent-as-a-Tool** or **Sub-Agent Delegation**.

Instead of giving your expensive, heavy-thinking model raw tools (like `read_file_from_disk` or `grep_search_codebase`), you give it exactly *one* tool: `ask_the_coding_sidecar`.

Here is how frameworks like KaibanJS, CrewAI, and LangGraph handle this sidecar pattern, and why it is so powerful.

### The Architectural Concept

If you give a reasoning model (like Gemini 3.1 Pro or Claude 3.5 Sonnet) raw file-search tools, it has to waste expensive tokens figuring out the exact syntax to search the codebase, parsing the messy raw text that comes back, and deciding what is relevant.

By using a sidecar (your "Composer 1.5" or a fast model like Gemini Flash), the architecture looks like this:

1. **The Thinker:** "I need to know how the authentication middleware works to plan this feature."
2. **The Tool Call:** The Thinker calls the `ask_composer_agent` tool with a natural language query: *"Find the auth middleware and explain how it handles JWTs."*
3. **The Sidecar (Composer):** The fast model wakes up. It uses the raw `grep` and `file_read` tools. It navigates the repo, reads the files, and synthesizes a clean, concise summary of the auth logic.
4. **The Return:** The sidecar returns just the synthesized summary back to the Thinker's context window.

### How to Implement the Sidecar Pattern

Different frameworks handle this in different ways.

#### 1. The Vercel AI SDK / Mastra Approach (Agent-as-a-Tool)

If you are writing code-first TypeScript, the most literal way to build a sidecar is to wrap an entire agent inside a standard tool execution function.

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { runComposerAgent } from './sidecar'; // Your fast coding agent

// We define a tool that the Thinker can use.
// But instead of standard code, the tool triggers another LLM!
const askComposerTool = tool({
  description: 'Ask the dedicated coding sidecar to search, read, or write code in the repository.',
  parameters: z.object({
    intent: z.string().describe('What you need the sidecar to do (e.g., "Find the auth function").'),
  }),
  execute: async ({ intent }) => {
    console.log(`🚀 Thinker delegated to Sidecar: ${intent}`);
    
    // Wake up the fast model to do the dirty work
    const sidecarResult = await runComposerAgent(intent); 
    
    // Return the clean result back to the Thinker
    return sidecarResult.summary; 
  },
});

// Now, you give this tool to your Thinker agent.
```

#### 2. The LangGraph Approach (Sub-Graphs / Supervisor)

LangGraph handles this incredibly well through a concept called **Sub-Graphs**.

You create a `Thinker` node in your state machine. Whenever the Thinker needs code context, it routes the state to the `Composer` node. The Composer node is actually its own mini-graph (the sidecar) with a fast model and file-system tools. It loops until it finds the right code, and then routes the final answer back up to the Thinker. This enforces strictly that *only* the Composer node is legally allowed to touch the codebase.

#### 3. The CrewAI & KaibanJS Approach (Delegation)

In role-playing frameworks, this is handled via **Managerial Delegation**.

You explicitly configure the Thinker agent with `allow_delegation=True` (or its JS equivalent). The framework automatically equips the Thinker with a tool that allows it to ask questions to the other agents in the Crew.

In your prompt, you would simply enforce the rule: *"You are not allowed to search the codebase yourself. You must delegate all code retrieval and editing tasks to the fast coding agent."*

### Why this is SOTA for Headless Coding

* **Context Window Protection:** Codebases are massive. If the Thinker agent pulls 5 raw files into its context window, it might consume 80,000 tokens (which gets very expensive, very fast). The sidecar agent does the reading, filters out the noise, and only sends back the exact 500 tokens of code the Thinker actually needs.
* **Separation of Concerns:** You can give the sidecar "Write" permissions to the file system, but keep the Thinker sandboxed. This ensures the Thinker can't accidentally overwrite files while brainstorming.

---

## Enforcing strict sidecar permissions in TypeScript

The secret to enforcing this doesn't rely on complex prompt engineering (telling the AI "please don't touch the files"). Instead, it relies on the **Tool Array Boundary**.

When you use a modern code-first framework like the Vercel AI SDK, an LLM physically cannot execute code unless you explicitly pass a JavaScript function into its `tools` array.

Here is exactly how you structure this in TypeScript.

### The TypeScript Implementation

```typescript
import { generateText, tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';

// --- 1. DEFINE THE DANGEROUS TOOLS (File System) ---
// These actually interact with the disk.
const readFileTool = tool({
  description: 'Read the contents of a file in the repository.',
  parameters: z.object({ filePath: z.string() }),
  execute: async ({ filePath }) => {
    return await fs.readFile(filePath, 'utf-8');
  },
});

const writeFileTool = tool({
  description: 'Write or overwrite a file in the repository.',
  parameters: z.object({ filePath: z.string(), content: z.string() }),
  execute: async ({ filePath, content }) => {
    await fs.writeFile(filePath, content, 'utf-8');
    return `Successfully wrote to ${filePath}`;
  },
});

// --- 2. THE SIDECAR AGENT (The Fast Executor) ---
// This function acts as our Composer 1.5 equivalent. 
// It is the ONLY entity allowed to hold the dangerous tools.
async function runCodingSidecar(intent: string) {
  console.log(`[Sidecar] Waking up to handle: "${intent}"`);
  
  const { text } = await generateText({
    model: yourProvider('fast-tier-model'), // e.g., Gemini Flash or Claude Haiku
    system: 'You are an elite coding assistant. Use your tools to read or write files to fulfill the user intent. Return a concise summary of what you did or found.',
    prompt: intent,
    tools: {
      readFile: readFileTool,
      writeFile: writeFileTool,
    },
    maxSteps: 5, // Allow it to read, then write, then verify in a loop
  });
  
  return text; // Return the summary back up the chain
}

// --- 3. THE SAFE TOOL (For the Thinker) ---
// We wrap the Sidecar agent inside a standard tool interface.
const askSidecarTool = tool({
  description: 'Ask your coding sidecar to explore the codebase, read files, or apply code changes. You cannot do this yourself.',
  parameters: z.object({
    directive: z.string().describe('Detailed instructions for the sidecar (e.g., "Read src/auth.ts and change the JWT expiry to 1h").')
  }),
  execute: async ({ directive }) => {
    // This triggers the other LLM
    const sidecarReport = await runCodingSidecar(directive);
    return sidecarReport;
  }
});

// --- 4. THE THINKER AGENT (The Architect) ---
// This is the heavy reasoning model. Notice its tools array!
async function runArchitect() {
  const { text } = await generateText({
    model: yourProvider('smart-tier-model'), // e.g., Gemini 3.1 Pro
    system: 'You are the Principal Architect. You are sandboxed. To interact with the codebase, you MUST delegate to your sidecar.',
    prompt: 'Review our authentication flow and update the token expiry logic to be more secure.',
    tools: {
      askSidecar: askSidecarTool, // <--- The ONLY tool it has!
    },
    maxSteps: 10,
  });

  console.log(`[Architect Final Report]:\n${text}`);
}

// Execute the workflow
runArchitect();

```

### Why this is foolproof:

1. **Strict Sandboxing:** Look at the `runArchitect()` function. Its `tools` object only contains `askSidecar`. If the Architect hallucinates and tries to call `writeFile`, the Vercel AI SDK will instantly throw an error and tell the LLM, *"Tool 'writeFile' does not exist."* It is mathematically blocked from the file system.
2. **Context Isolation:** When the Sidecar reads a 2,000-line file to find one variable, those 2,000 lines stay in the *Sidecar's* context window. The Sidecar then returns a 2-sentence summary to the Architect. You just saved massive amounts of tokens (and money) on your expensive `smart-tier-model`.
3. **Traceability:** Because the boundary is defined in standard TypeScript functions, it is incredibly easy to log. You can wrap `runCodingSidecar` in an observability tracer (like Langfuse) and immediately see exactly what directives the Architect is issuing.

---

## How do you implement a sidecar agent in KaibanJS?

It is not too complex for KaibanJS. Because KaibanJS is built on standard JavaScript and runs in Node.js (which natively excels at asynchronous event-driven tasks), creating a sidecar agent is straightforward.

In KaibanJS, you don't need to hack the framework to do this. Because Kaiban uses LangChain under the hood for its tool ecosystem, you can use a `DynamicTool` to literally wrap a secondary, lightweight Kaiban Agent inside a tool function.

Here is how you build the strict Agent-as-a-Tool sandbox in KaibanJS.

### The KaibanJS Sidecar Implementation

```javascript
import { Agent, Task, Team } from 'kaibanjs';
import { DynamicTool } from '@langchain/core/tools';

// --- 1. DANGEROUS TOOLS (For the Sidecar Only) ---
// We wrap our file system operations into tools. 
const readFileTool = new DynamicTool({
    name: "read_file",
    description: "Read the contents of a file.",
    func: async (filePath) => {
        // e.g., return await fs.readFile(filePath, 'utf-8');
        return `[Simulated content of ${filePath}]`;
    }
});

const writeFileTool = new DynamicTool({
    name: "write_file",
    description: "Write or overwrite a file.",
    func: async (input) => {
        // e.g., await fs.writeFile(...)
        return "File successfully updated.";
    }
});

// --- 2. THE SIDECAR TOOL (The Bridge) ---
// This is the custom tool we give to the Architect. 
// When the Architect calls this, it dynamically spins up the Fast Agent!
const askSidecarTool = new DynamicTool({
    name: "ask_coding_sidecar",
    description: "Ask your coding sidecar to explore the codebase, read files, or apply code changes. You cannot do this yourself. Pass detailed instructions.",
    func: async (directive) => {
        console.log(`\n🚀 [Sidecar Waking Up]: Received directive -> "${directive}"`);
        
        // We define the fast agent ON THE FLY inside the tool execution
        const composerSidecar = new Agent({
            name: 'Composer 1.5 Equivalent',
            role: 'Codebase Executor',
            goal: 'Safely read and write files to fulfill the directive. Return a summary of changes.',
            background: 'You are an ultra-fast coding assistant.',
            tools: [readFileTool, writeFileTool], // <--- Holds the dangerous tools
            llmConfig: { 
                provider: 'google', 
                model: 'gemini-1.5-flash' // The fast, cheap model
            }
        });

        const sidecarTask = new Task({
            description: `Execute this directive using your tools: ${directive}`,
            expectedOutput: "A concise summary of what was read and modified.",
            agent: composerSidecar
        });

        // Run the mini-team and return its output to the Architect
        const sidecarTeam = new Team({
            agents: [composerSidecar],
            tasks: [sidecarTask]
        });

        const result = await sidecarTeam.start();
        return result.output; 
    }
});

// --- 3. THE THINKER AGENT ---
const architect = new Agent({
    name: 'Architect',
    role: 'Principal Software Architect',
    goal: 'Design secure systems and review logic.',
    background: 'You are sandboxed. To interact with code, you MUST use your sidecar.',
    tools: [askSidecarTool], // <--- The ONLY tool it has!
    llmConfig: { 
        provider: 'google', 
        model: 'gemini-3.1-pro' // The heavy reasoning model
    }
});

const planningTask = new Task({
    description: 'Review the auth system and tell the sidecar to update the token expiry logic.',
    expectedOutput: 'A final report of the architectural changes made.',
    agent: architect
});

const mainTeam = new Team({
    name: 'Architecture Planning',
    agents: [architect],
    tasks: [planningTask]
});

// Execute the workflow
mainTeam.start().then(result => {
    console.log(`\n✅ [Architect Final Report]:\n${result.output}`);
});

```

### Why this is a brilliant pattern in KaibanJS

1. **Dynamic Instantiation:** Notice how `composerSidecar` is instantiated *inside* the `askSidecarTool.func`. This means the fast agent doesn't consume memory or API connections until the exact millisecond the Architect actually needs code.
2. **Infinite Nesting:** You can technically nest these as deep as you want. The Architect calls a Sidecar, the Sidecar calls a specialized "Database Read Agent," etc. It forms a tree of delegation that is highly observable.
3. **Frontend Streaming:** Because KaibanJS is inherently tied to React and Redux-like state management, you can easily hook up a UI component that listens to `mainTeam` events. The user will literally see a loading state that says *"Architect is thinking..."* which instantly updates to *"Sidecar is executing file changes..."* when the tool is triggered.

If you are setting up this kind of advanced orchestration in the JavaScript ecosystem, [this guide to mastering multi-agent Next.js systems](https://www.youtube.com/watch?v=JJIuw75kX54) walks through the entire process of wiring Kaiban into a modern React frontend with live monitoring.

---

## Does Kaiban support multi-stage processes?

Yes, KaibanJS supports multi-stage processes, but it handles "memory" in a very specific, workflow-driven way rather than acting like a standard ChatGPT interface.

Because KaibanJS is an orchestration framework, it doesn't just magically remember a never-ending chat history by default. Instead, it relies on **Task Chaining** and **State Management** to pass context exactly where it is needed.

If you want to give a single agent a prompt, get an output, and then give it a second prompt where it remembers the first, you achieve this by assigning multiple sequential **Tasks** to the **same Agent**.

Here is exactly how context flows in KaibanJS across a multi-stage process.

### 1. The Native Way: Sequential Task Passing

When you configure a `Team` to run sequentially (which is the default), KaibanJS automatically takes the `expectedOutput` of Task 1 and secretly appends it to the system prompt of Task 2.

If you assign both tasks to the same agent, the agent effectively "remembers" what it just did.

```javascript
import { Agent, Task, Team } from 'kaibanjs';

// 1. Define your Agent
const coder = new Agent({
    name: 'DevAgent',
    role: 'Senior Developer',
    goal: 'Write and refine code',
    // ... llmConfig here ...
});

// 2. Stage 1: The First Prompt
const draftTask = new Task({
    description: 'Write a basic JavaScript function to calculate the Fibonacci sequence.',
    expectedOutput: 'A raw JavaScript function.',
    agent: coder 
});

// 3. Stage 2: The Second Prompt (Needs context from Stage 1)
const refineTask = new Task({
    description: 'Take the function you just wrote and add JSDoc comments and error handling for negative numbers.',
    expectedOutput: 'A production-ready JavaScript function.',
    agent: coder // <-- Assigned to the SAME agent
});

// 4. Run the Multi-Stage Process
const codingTeam = new Team({
    agents: [coder],
    tasks: [draftTask, refineTask] // Runs sequentially by default
});

// When refineTask runs, KaibanJS automatically injects the output of draftTask into its context!
codingTeam.start().then(result => console.log(result.output));

```

### 2. The Explicit Way: Variable Interpolation

Sometimes, you don't want the agent to just vaguely remember the *last* thing it did; you might have a 5-stage process, and Stage 5 needs to explicitly remember what happened in Stage 1.

KaibanJS supports a syntax exactly for this called **Task Result Passing**. You can inject `{taskResult:N}` (where N is the 1-based index of the task) directly into your prompt.

```javascript
const finalReviewTask = new Task({
    description: `
        You are at Stage 3.
        Here was your original draft from Stage 1: {taskResult:1}
        Here was the QA feedback from Stage 2: {taskResult:2}
        
        Now, rewrite the draft addressing the QA feedback.
    `,
    expectedOutput: 'The final, corrected code.',
    agent: coder
});

```

---

## Memory and context window management

Task orchestrators like KaibanJS and CrewAI differ from continuous chat agents (Cursor, GitHub Copilot) in how they handle memory.

### Conversational memory across sessions

It is important to be candid about a current architectural limitation in the agentic space: **If you run `team.start()` today, and then run `team.start()` tomorrow, the agent starts with amnesia.** KaibanJS currently does not natively persist conversational history *between* isolated team executions out-of-the-box (this is actually a heavily requested feature in their GitHub pipeline right now).

If you are building an interactive chat UI where a user talks to the agent over and over dynamically, you have two SOTA options:

1. **The KaibanJS Team Store:** Under the hood, KaibanJS uses Zustand for state management. You can access the `teamStore.workflowLogs` to manually pull the history of what the agent has done and pass it into your next dynamically generated Task.
2. **LangChain Memory:** Because KaibanJS is built on top of LangChain.js, you can manually inject a LangChain `BufferMemory` or `RedisChatMessageHistory` object into the agent's underlying LLM config if you need persistent, database-backed memory across different user sessions.

**In short:** If you define your multi-stage process upfront as an array of `Tasks`, KaibanJS handles the context passing automatically and beautifully. If you want open-ended, continuous back-and-forth chatting, you will have to manually pass the previous outputs into the next `Task` description.

### Full internal memory (Cursor-like)

If you want that full, rich, Cursor-like internal memory where the agent remembers its own thoughts, mistakes, and tool outputs across multiple prompts, you are stepping outside of KaibanJS's default comfort zone. To answer the key questions: **Yes, you need to persist state outside the agent. And yes, you are responsible for managing the context window.** Here is the candid reality of what is happening under the hood.

#### State management (the "temp file")

By default, KaibanJS tasks only pass the **final output** to the next step. If your Architect agent spends 3 minutes thinking, failing a tool call, and retrying before outputting a summary, all of that internal "thought process" is wiped from memory as soon as the task finishes. Task 2 only sees the summary.

To get the Cursor experience, you don't necessarily need a physical `.txt` temp file on disk, but you **do** need a persistent state object (usually an array of JSON messages) that lives outside the agent.

If you are building this in TS/JS, you have to capture the raw LangChain `messages` array (which contains every `SystemMessage`, `HumanMessage`, `AIMessage`, and `ToolMessage`) and manually inject it into the next execution.

#### Context window management

Yes, if you string prompts together and pass the full internal memory every time, **you are entirely responsible for managing the context window.**

If you just keep appending every thought and tool result to an array and passing it back to Gemini 3.1 Pro or Claude, you will inevitably hit the token limit (or at the very least, rack up a massive API bill, because you are paying for those 100,000 tokens of history on *every single subsequent API call*).

To build a Cursor equivalent, you have to build a **Memory Manager**. Here is how SOTA systems handle it:

* **Sliding Window:** You write a function that drops the oldest messages (keeping the system prompt intact) when the token count exceeds 80% of the model's limit.
* **Context Summarization:** You run a background, cheap model (like `gpt-4o-mini`) to compress older interactions. "Summarize steps 1-5 into a single paragraph." You replace the raw logs with the summary to save space.
* **Semantic Search (RAG):** You dump the agent's older thoughts into a vector database (or local SQLite database). The agent doesn't keep them in its active context window, but it has a tool called `search_past_thoughts` to retrieve them if it forgets why it made a decision 10 steps ago.

If your goal is to build a continuous, open-ended conversational agent that maintains a massive, sliding context window of its own thoughts (exactly like Cursor), **KaibanJS and CrewAI are the wrong architectures**—they are designed to be finite assembly lines, not infinite chat loops. See [When to migrate from CrewAI / KaibanJS to LangGraph or Vercel AI SDK](#when-to-migrate-from-crewai--kaibanjs-to-langgraph-or-vercel-ai-sdk) for when to switch.

---

## Central Source of Truth for self-building pipelines

To prevent the "Telephone Game" effect in a linear pipeline (where nuanced PRD goals get abstracted away by Agent E), implement a **Central Source of Truth (CSoT)**. The SOTA approach is the **Hybrid Approach (Markdown + YAML Frontmatter)**—like static site generators (Next.js, Hugo). Chopping a nuanced PRD into JSON strings loses semantic context, tone, and implicit connections. LLMs natively "think" in Markdown; forcing long-form text into JSON degrades reasoning and consumes unnecessary tokens.

### Structure: Markdown with YAML Frontmatter


```markdown
---
project_name: "AutoAuth"
current_phase: "frontend_implementation"
api_contracts:
  - endpoint: "/api/auth/send-link"
    method: "POST"
    payload: "email"
pending_components:
  - "Frontend login form"
---

# Product Requirements Document: AutoAuth

## 1. The Vision
We want to let users log in by clicking a link sent to their email. This needs to feel like magic. The target audience is non-technical elderly users who get easily confused by password managers. 

## 2. Hard Constraints
* **No Passwords:** There must be absolutely zero mention of passwords anywhere in the UI. 
* **Link Expiry:** The link should stay active forever so they don't have to keep requesting it. (Security note: we accept the risk here for the sake of extreme UX simplicity).

## 3. User Journey (Nuance)
When Grandma opens the app, she should just see a giant, friendly text box asking for her email. When she hits submit, do not show a scary technical error if it fails; show a polite message...

```

### Why this structure works

**1. The Coding Agents get the Nuance natively**
When your `frontendCoder` agent needs to build the UI, you don't pass it a JSON object. You read this file, strip the YAML frontmatter, and pass it the raw Markdown body. The LLM reads the headings, the bullet points, and the tone ("Grandma", "feels like magic"). It understands *why* it is building the feature, which prevents it from writing cold, overly-technical UI copy.

**2. Your Application Logic gets the Strict State natively**
Your Node.js backend uses a simple parser (like `gray-matter` in npm) to parse this file.

```javascript
import matter from 'gray-matter';
import fs from 'fs';

const file = fs.readFileSync('csot.md', 'utf8');
const { data, content } = matter(file);

// 'data' is now a strict JavaScript object containing your API contracts
console.log(data.pending_components[0]); 

// 'content' is the pure Markdown PRD

```

Your backend (the Meta-Orchestrator) only looks at the `data` object to decide which KaibanJS Tasks to spin up next. The agents look at the `content` to actually do the work.

**Selective injection**  
Do not inject the entire file into every prompt. Use `data` (YAML) and `content` (Markdown) to build task-specific prompts—e.g. pass `data.pending_components[0]` and `data.api_contracts` plus the relevant Markdown section to the frontend agent.

**3. Human-in-the-Loop Friendly**
If your pipeline pauses because the Architect Agent is confused, you (the human) can open this `.md` file in Cursor or VS Code, read it naturally, tweak the Markdown to clarify the vision, and hit save. Editing a 200-line nested JSON object by hand is a nightmare; editing a Markdown file is effortless.

### The Best of Both Worlds

By splitting the CSoT into **Machine State (YAML)** and **Human/LLM Context (Markdown)**, your orchestration code stays deterministic, but your generative code remains highly nuanced and creative.


---

## When to migrate from CrewAI / KaibanJS to LangGraph or Vercel AI SDK

If your goal is to build a continuous, open-ended conversational agent that maintains a massive, sliding context window of its own thoughts (exactly like Cursor), **KaibanJS and CrewAI are the wrong architectures.** They are designed to be finite assembly lines, not infinite chat loops.

If you want the Cursor architecture, the SOTA standard in 2026 is **LangGraph.js** or the **Vercel AI SDK**—built around a `StateGraph` with an array of `messages`, built-in `MemorySaver` modules, and native **Message Reducers** for context window management.

For a "self-building app" pipeline (PRD → Architecture → Component Specs → Code), a linear, deterministic assembly line is exactly what you want. Sticking with KaibanJS or CrewAI is the right move until the wheels fall off.

### The 3 boundaries of task-based self-building systems

**1. The Context Funnel (The "Telephone Game")**  
In a sequential task system, Agent A passes its output to Agent B, who synthesizes it and passes it to Agent C. By the time you get to Agent E (QA), the original, nuanced business goals from the PRD might have been abstracted away. *Mitigation:* Implement a Central Source of Truth; every agent reads the *original* PRD alongside the previous agent's output.

**2. Meta-Orchestration (Agents building Workflows)**  
Frameworks like KaibanJS are declarative—you write `new Task()` and `new Agent()` before runtime. They don't self-modify mid-execution. *Mitigation:* Use a "Meta-Agent" whose output is an array of JSON objects representing new tasks; your Node backend maps them to KaibanJS `Task` classes on the fly.

**3. Long-Range Error Recovery (The "Rewind" Problem)**  
If your pipeline is 15 tasks long and the code fails at Task 14, task-based orchestrators struggle to rewind to Task 2. *Mitigation:* Keep workflows compartmentalized—Planning Team, Execution Team, QA Team. Application logic catches errors and decides whether to re-trigger Execution or kick back to Planning.

**Bottom line:** Move to LangGraph/Vercel AI only when you find yourself writing massive amounts of custom state-management code just to keep your agents from forgetting the big picture. Until then, the rigidity of KaibanJS/CrewAI is a feature, not a bug.
