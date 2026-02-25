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

---

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
