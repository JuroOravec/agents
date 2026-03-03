# self-improving code

_Exported on 25/02/2026 at 23:55:59 CET from Cursor (2.5.20)_

---

**User**

Read up on @TODO_automated_agent_generation.md

---

**Cursor**

I've read through the `TODO_automated_agent_generation.md` file. Here is a summary of the key architectural concepts, decisions, and implementations covered in your conversation:

### 1. Multi-Agent Pattern Library Implementation

The first part of the document details the creation of a comprehensive pattern library for Mastra workflows, mirroring and expanding upon what you had in KaibanJS.

- **Patterns Built:** Fan-Out (Basic, Adversarial, Weighted), Sequential Conference, Round Robin (Threaded, Scarce), Evaluator-Optimizer, Orchestrator (formerly Supervisor), Reflection/Self-Correction, MoE Router, Broadcast + Selective Merge, Branching, Recursive Subtree, Human-in-the-Loop Gate, Map-Then-Reduce, Tournament Bracket, and Sidecar.
- **Iterative Refinement:** The chat logs extensive debugging and fixing of workflow inputs/outputs (e.g., swapping `.map()` for proper `initStep`s), schema matching, and handling edge cases (like empty reviewer arrays or missing branches).
- **The Orchestrator Refactor:** The "Supervisor" pattern was renamed to "Orchestrator." It was also enhanced to support `{directive}` routing (allowing the orchestrator to pass targeted sub-tasks to generic workers) and optional `synthesizerStep`s for structured final outputs.

### 2. Ephemeral vs. Persistent Dynamic Agents

The conversation shifts to handling open-ended tasks (like "build a browser") versus bounded tasks. It explores the SOTA (State of the Art) for dynamically spawning agents:

- **Ephemeral Agents (The Sandbox):** For one-off, highly specific contexts, the system spawns temporary agents in-memory via tool calls (`spawn_agent(role, instructions)`).
- **Telemetry-Driven Promotion (The Inbox):** Instead of an LLM writing `.ts` files on the fly (which is brittle), successful ephemeral prompts/agents are logged to a registry. A background process analyzes these logs, and if a dynamic agent is frequently used and successful, it is promoted into hardcoded code.

### 3. Workflows as Data (Declarative vs. Imperative)

The final segment defines a brilliant SOTA architecture for scaling systems (like building 50 different web scrapers) without writing bespoke code for each:

- **The Golden Rule:** Workflows should be represented as Data (JSON/YAML DAGs or State Machines), not dynamically generated TypeScript files.
- **The Outer Loop (Discovery & Repair):** An expensive, slow AI Orchestrator navigates a new website/problem, figures out the required steps, and generates a strict, domain-specific JSON schema (e.g., a ScraperConfig or an XState machine definition).
- **The Inner Loop (Execution):** A fast, cheap, static TypeScript Engine reads that JSON and executes it deterministically.
- **Persistence:** Once the AI successfully generates a working JSON workflow for a specific task, it is saved to a database. The next time the task is requested, the system skips the AI loop entirely and feeds the saved JSON straight into the deterministic engine.

This file serves as both a record of building out the Mastra workflow primitives and a high-level design document for a **Self-Writing, Self-Optimizing System** based on "State Machines all the way down."

Is there a specific part of this architecture (like the `orchestratorDynamic`, the JSON DAG engine, or the Telemetry/Discovery loop) that you'd like to start building next focus on implementing next?

---

**User**

ok, now, so in that convo I explored the process of how I can use AI to capture processes as data, and how that can be used to e.g. build "AI web builder" or "AI web scraper" or similar "AI xxx doer" tools. (in this case the "proceses" are EXTERNAL - AKA processes of other systems, not the codebase itself).

I also explored how to set up orchestrator tasks to (in theory) be able to build a browser from scratch by dynamically invoking agents, managing queue of tasks, and allowing agents to take/add tasks from the queue.

And how while doing that, we can capture what agents get created dynamically, and through telemetry set up processes to introduce those agents formally into our code or DB.

But I think there is (at least) one area that's missing, and I want to explore that in this thread. AI companies claim that most of their code is being written by AI. Also, we talked about how to handle processes of other systems, but not of the system itslf. How do companies build self-improving codebases? E.g. like mentioned in https://www.strongdm.com/blog/the-strongdm-software-factory-building-software-with-ai . What am I missing?

---

**Cursor**

What you are missing is the paradigm shift from **"AI as a Process Executor"** to **"AI as an Optimizer Against Reality"** (or Test-Driven AI Development on steroids).

In the previous conversation, we discussed how to map a workflow to a JSON DAG, which a deterministic engine executes. But when a company like StrongDM says, _"This system runs real scenarios, validates real behavior, and corrects itself without humans in the loop,"_ they are not talking about JSON state machines. They are talking about an AI writing actual source code (TypeScript, Go, Rust) for the core product itself.

To let AI safely write and modify its own system’s codebase, you need an architecture that relies on **Validation replacing Code Review**. Here is the architecture of a "Software Factory" and the missing pillars you need to build a self-improving codebase.

---

### Pillar 1: Scenario-Based Specification (Human Intent)

In a traditional codebase, humans write code and humans review code.
In an AI Software Factory, humans do not write code, nor do they review the AI's code. **Humans write the Constraints and Scenarios.**

Instead of telling the AI, _"Write a function that connects to the database,"_ you write a rigorous, executable scenario:

- **Scenario:** _"When a user with Role A requests access to Database B, they are granted a 5-minute ephemeral credential. When 5 minutes pass, the credential is revoked."_
- You encode this as an automated integration test, a BDD (Behavior-Driven Development) file, or a custom DSL.
- **The Paradigm Shift:** The human's job is to define the boundaries of reality. The AI's job is to write whatever code is necessary to make that reality true.

### Pillar 2: The "Digital Twin" (The Ephemeral Sandbox)

An AI cannot safely write code for the core system if it risks dropping the production database or pushing broken builds. It needs a safe place to fail 500 times a minute.

As StrongDM noted, they built a _"Digital Twin Universe of systems like Okta and Slack."_

- When the AI Agent decides to modify a core file in the codebase, the Factory instantly spins up a lightweight, ephemeral container (a sandbox).
- This sandbox contains mocks of the entire universe: a fake Slack API, a fake PostgreSQL database, a fake Redis cache.
- The AI's proposed code change is compiled and deployed into this ephemeral sandbox.

### Pillar 3: The Convergence Loop (Validation Engine)

This is the core engine of the Software Factory. It is an adversarial loop between the **Coder Agent** and the **Verifier Engine**.

1. **Attempt:** The Coder Agent reads the Scenario and modifies `src/auth/permissions.ts`.
2. **Compile:** The Verifier Engine runs the TypeScript compiler and Linters. (If it fails, it pipes the compiler errors directly back to the Coder Agent).
3. **Simulate:** If it compiles, the Verifier Engine runs the Scenario against the Digital Twin.
4. **Feedback:** The test fails because the ephemeral credential wasn't revoked. The Verifier captures the test runner output, the stack trace, and the system logs, and feeds them back to the Coder Agent.
5. **Converge:** The Coder Agent tries again. It iterates 5, 10, or 50 times in a tight, closed loop.
6. **Success:** It only stops when all scenarios pass green. **Without human intervention.**

### Pillar 4: AST and Codebase as a Database

When building external workflows (like scrapers), the AI interacts with the DOM of a website. When the AI is modifying its _own_ codebase, the codebase is its "DOM".

To build a self-improving codebase, the AI cannot just use simple tools to read and write text files. That leads to syntax errors and broken brackets. SOTA companies equip their AI with **AST (Abstract Syntax Tree) manipulation tools**:

- Instead of `replace_text(file, old, new)`, the AI uses tools like:
  - `find_references(function_name: "revokeAccess")`
  - `get_interface_definition(interface: "IUser")`
  - `rename_symbol(old: "token", new: "ephemeralToken", scope: "workspace")`
- The AI navigates the codebase exactly like a language server (LSP) does.

---

### How This differs from the "Scraper" Workflow

In your web scraper example, the AI explores a website, figures out the path, outputs a JSON Workflow, and a deterministic engine runs it.

In the Software Factory, the AI explores a **failing test**, figures out the logic flaw, outputs **Source Code (Git Diff)**, and the deterministic engine (the Compiler/Test Runner) runs it.

If you want to build this into your own architecture, here is the roadmap:

1. **Test-Driven AI (TDAI):** Force yourself to achieve 100% integration test coverage for a specific module. The tests must be deterministic and run fast.
2. **The "Eval" Runner:** Build a script that takes an AI-generated patch (`git apply`), runs the test suite, and if it fails, captures the `stderr` and rolls back the patch (`git reset --hard`).
3. **The Agentic Loop:** Hook an orchestrator up to that script.
   - Give the Agent an issue: _"Feature request: Add support for PostgreSQL."_
   - Give the Agent the failing test: `test_postgres_connection.ts`.
   - Let the agent loop against the Eval Runner until the test passes.
4. **Merge to Main:** When the loop achieves a green build, the orchestrator automatically opens a Pull Request. You don't review the code line-by-line; you just review the test cases to ensure the AI didn't cheat the test.

**What you were missing is the concept of a closed-loop environment where the "Ground Truth" (the compiler and the tests) acts as the ultimate judge, allowing the AI to blindly iterate through thousands of permutations of code until it converges on the mathematically proves it perfectly satisfies the human's constraints.**

---

**User**

no, there's definitely more concept I'm missing :D

Pillar 1 - Yes, I alraedy get this one. Personally I'm i just don't know if whether I'm under-/overthinking it, but I'm mentioning the basics here @README.md (1-334) . AKA use a human-written spec as source of truth.

(actually, before I menttion more things, how does our design compare to SOTA for pillar 1?)

---

**Cursor**

Your design for Step 1-3 in `README.md` is an excellent, highly sophisticated **Agentic SDLC (Software Development Life Cycle)**. You are building a system that perfectly mirrors a high-functioning human engineering org: a PM writes a spec, a diff is generated, an architect plans the system changes, and workers execute.

However, if we are strictly comparing it to the **"Software Factory" SOTA** (like StrongDM's), there is a fundamental philosophical difference: **Your source of truth is Ambiguous Prose, while SOTA relies on Executable Constraints.**

Here is a breakdown of how your design compares, where it excels, and the specific SOTA concept you might be missing.

---

### The Gap: "Prose Validation" vs. "Deterministic Validation"

In your design:

1. Human writes `PRD.md` (Natural Language).
2. LLM creates `SemanticChangeReport` (Natural Language).
3. LLM Architect writes Design Doc (Natural Language).
4. LLM Worker writes Code.
5. (Presumably) LLM Reviewer checks if Code matches PRD.

**The SOTA Factory problem with this:** It creates a "Hallucination Cascade." You are using non-deterministic models to translate English into English into Code, and then using a non-deterministic model to grade if the code is correct. If the Worker hallucinates, the Reviewer might also hallucinate and approve it. You cannot run a 1,000-iteration "blind" loop on this because you lack a reliable, objective `True/False` signal.

In a SOTA Software Factory (Pillar 1):

1. Human writes **Executable Constraints** (e.g., BDD/Gherkin scenarios, OpenAPI schemas, or rigorous integration tests).
2. AI writes Code.
3. **Deterministic Test Runner** (TypeScript compiler, Vitest, Playwright) runs the constraints.
4. If `exit code 1`, loop. If `exit code 0`, done.

The SOTA rule is: **If the AI cannot autonomously test its work against a mathematical ground truth, it is an assistant, not a factory.**

---

### Where Your Design Actually Beats SOTA

With that said, your `draft-spec-first-prd-diff` design solves a massive problem that strict Software Factories ignore: **Product Velocity and Human UX**.

Writing 100% airtight integration tests before writing code (strict TDD) is exhausting for humans. Your pipeline allows humans to work the way they naturally work—writing a Markdown PRD—while using AI to rigorously extract the _Semantic Diff_ (e.g., "Previously X, now Y").

Your `TextualChangeReport` -> `SemanticChangeReport` pipeline is incredibly smart. By forcing the AI to look at the `git diff` of the PRD rather than just reading a static file, you anchor the LLM's attention to the exact delta of intent. This is SOTA for **AI Product Management**.

---

### How to Bridge Your Design to the "Software Factory" SOTA

You do not need to throw away your `PRD.md` approach. You just need to insert a **"TDD Bridge"** between your Architect (Step 4) and your Workers (Step 5+).

To upgrade your current design to SOTA Software Factory levels, you would add this:

**1. The Black Box Testing Agent**

- Right after the Architect receives the `SemanticChangeReport` and writes the Design Doc, a new agent steps in.
- Its ONLY job is to translate the `SemanticChangeReport` into **failing, executable tests** (e.g., a Vitest suite or a Playwright script).
- _Example:_ If the Semantic Diff says "Add caching with Redis," the Black Box Testing Agent writes a test that mocks a DB, calls the endpoint twice, and asserts that the second call hit the Redis mock.

**2. The Validation Loop**

- Now, when you hand the task to the "Workers" (Step 5), you don't just tell them "Implement this PRD."
- You tell them: "Here is the PRD, and here is the failing test suite `redis.spec.ts`. You have 20 attempts. Keep rewriting the code and running `npm test` until it turns green. Do not bother me until it is green."

### Summary

You aren't under-thinking it, you are just building the **top half** of the funnel (Human Intent -> Structured Architecture). The StrongDM Software Factory concept is entirely about the **bottom half** of the funnel (Executable Constraints -> Closed-loop Code Generation).

If you connect your `SemanticChangeReport` to a system that generates **deterministic tests**, and force your Worker agents to satisfy those tests, you will have built a complete, end-to-end AI Software Factory.
