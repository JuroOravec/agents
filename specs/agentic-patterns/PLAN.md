---
name: Multi-Agent Pattern Library
overview: Define a canonical library of multi-agent collaboration patterns for use as building blocks when composing Mastra workflows, covering the full spectrum from simple fan-out to complex collaborative and recursive structures.
todos:
  - id: doc-patterns
    content: Write docs/features/ai-crews/patterns.md — the canonical pattern catalog
    status: completed
  - id: util-round-robin
    content: Implement scripts/crews/patterns/roundRobin.ts utility
    status: pending
  - id: util-round-robin-with-replies
    content: Implement scripts/crews/patterns/roundRobinWithReplies.ts utility
    status: pending
  - id: util-evaluator-optimizer
    content: Implement scripts/crews/patterns/evaluatorOptimizer.ts utility
    status: pending
  - id: update-skill
    content: Update act-ai-crew-create SKILL.md Phase 2 to reference the new pattern catalog
    status: completed
isProject: false
---

# Multi-Agent Collaboration Pattern Library

A taxonomy of reusable patterns for composing multi-agent Mastra workflows. Each pattern is a building block — they compose and nest freely.

---

## Mastra Primitive Recap

Before the patterns, the native Mastra primitives these are built on:

- `.then(step)` — sequential, one at a time
- `.parallel([steps])` — same input, different ops, all concurrent, wait for all
- `.foreach(step, { concurrency })` — same op applied to each item in an array
- `.branch([[cond, step], ...])` — conditional routing, one branch executes
- `.dountil(step, cond)` / `.dowhile(step, cond)` — loops
- `.map(fn)` — shape transformation between steps
- Nested workflows — a `createWorkflow` used as a step inside `.foreach()` or `.parallel()`

---

## Pattern Catalog

### 1. Fan-Out / Parallel Panel (Map-Reduce)

**What:** One artifact, N specialist agents review it in parallel, one synthesizer merges.  
**Mastra:** `.parallel([...reviewSteps]).map(...).then(synthesizerStep)`  
**Already implemented:** `prd-review.ts`  
**Members interact:** No — each reviewer sees only the original artifact, not each other's output.

```
Input ──┬── AgentA ──┐
        ├── AgentB ──┤── Merge map ── Synthesizer ── Output
        └── AgentC ──┘
```

**Variants:**

- _Weighted panel_ — synthesizer prompt weights certain reviewers' opinions more heavily
- _Adversarial panel_ — two agents are seeded with opposing priors (devil's advocate vs. advocate)

---

### 2. Sequential Conference (Pipeline)

**What:** Agents review one after another; each sees the previous agent's output appended to context.  
**Mastra:** `.then(agentAStep).then(agentBStep).then(agentCStep)`  
**Members interact:** Indirectly — B reads A's output, C reads B's, but no back-channel.  
**Best for:** Iterative refinement (draft → critique → polish), assembly-line transformations.

```
Input ── AgentA ── AgentB ── AgentC ── Output
```

**Variants:**

- _Baton pass_ — strict: each agent transforms the artifact, no raw input re-injected
- _Running commentary_ — each agent appends their notes and passes the full growing doc forward

---

### 3. Evaluator-Optimizer (Actor-Critic Loop)

**What:** Generator agent produces a draft; Evaluator agent scores it against a rubric. If rejected, the generator retries with the evaluator's feedback. Loop exits on pass or `maxRetries`.  
**Mastra:** `.dountil(generateStep, cond)` where condition calls the evaluator, or `.dowhile`. Can also be modeled as `.then(generate).then(evaluate).branch([[rejected, loopBack], [approved, output]])` using a counter in state.  
**Members interact:** Yes — evaluator writes structured feedback that the generator reads on the next iteration.  
**Best for:** Code generation, creative writing, compliance checking.

```
      ┌───────────────────────────────────┐
      ↓                                   │ rejected + feedback
Input ── Generator ── Draft ── Evaluator ──┤
                                           │ approved
                                           └── Output
```

---

### 4. Round Robin

**What:** N agents each review the artifact in turn, but each agent sees all previous agents' responses before writing their own. After one full round, optionally loop for additional rounds.  
**Mastra:** Model as `.foreach` over an ordered agent list, passing the growing `thread` as state, OR as chained `.then()` steps where the shared context is threaded through.  
**Members interact:** Yes — each agent reads all prior agents' outputs.  
**Best for:** Structured debates, code review committees, board deliberation.

```
Round 1:
Input ── AgentA(sees: input) ── AgentB(sees: input+A) ── AgentC(sees: input+A+B) ── ...

Round 2 (optional):
... ── AgentA(sees: full round 1) ── AgentB ── AgentC ── Synthesizer ── Output
```

**Implementation note:** Mastra has no native "pass growing thread" primitive. The pattern needs a `threadStep` factory that wraps each agent step and appends to a `messages: string[]` field in the shared state.

---

### 5. Round Robin With Replies (Mention-Driven)

**What:** Alternates full rounds (all agents) and reply rounds (only @mentioned agents). Stops when a full round produces no new @mentions, or maxRounds is reached. Round context, team roster with descriptions, and @mention instructions are injected automatically into every prompt.
**Mastra:** `.dowhile` with a single `roundStep` that decides full vs. reply based on `pendingMentionIds` in state. Mention parser extracts new mentions from each round's additions.
**Members interact:** Yes — mentions are explicit structured signals.
**Best for:** Large committees; reduces cost and latency by only pulling in relevant voices.

```
Full Round:   Input ── AgentA ── AgentB ── AgentC ── MentionParser
                                                            │ mentions?
                                                    yes ←──┘
Reply Round:  only @mentioned agents ── MentionParser
                          │ new mentions?   │ none
                 yes ─────┘                 ↓
                                       Full Round ──► (quiesced?) ── Synthesizer ── Output
```

---

### 6. Orchestrator

**What:** An orchestrator agent decides _which_ worker agents to invoke and in _what order_, dynamically. Workers report back; the orchestrator decides if the goal is met.
**Mastra:** `.dowhile` state machine; orchestrator agent produces `{ nextWorker, done }` JSON on each iteration; chosen worker runs and appends to history.
**Members interact:** Yes — orchestrator coordinates workers; workers report back to orchestrator only.
**Best for:** Tasks where the steps aren't fully known upfront (e.g. research + write + verify).

NOTE: Preferably, rather than having fully dynamic hierarchies, we should strive to instead create a file on the fly with the pattern we need, so that it becomes known and available to future agents.

```
         ┌───────────────────────────────────────────┐
         ↓                                           │
Orchestrator ── branch ──┬── WorkerA ───────────────┤
                         ├── WorkerB ───────────────┤
                         └── done? ── Output        │
```

---

### 14. Reflection / Self-Correction (Single Agent)

**What:** A single agent generates an output, then a separate step prompts the _same_ agent to critique its own output and revise it.
**Mastra:** `.then(generateStep).then(critiqueStep).then(reviseStep)` or modeled as a loop with `.dountil`.
**Members interact:** No — single agent.
**Best for:** Improving quality of complex outputs (code, essays) where a single pass is often flawed, but the model can spot its own errors if asked explicitly.

---

### 15. The "Mixture of Experts" (MoE) Router

**What:** A lightweight router agent analyzes the input and decides which single specialized agent is best suited to handle it. Only that one agent is invoked.
**Mastra:** `.then(routerStep).branch([[isTypeA, agentAStep], [isTypeB, agentBStep]])`
**Members interact:** No.
**Best for:** Triage systems (e.g., routing a customer support ticket to Billing, Tech Support, or Sales).

---

### 7. Broadcast + Selective Merge

**What:** Like Fan-Out, but instead of a fixed set of agents, the input is broadcast to a _dynamic_ list (e.g. all registered domain experts). The merge step filters or weights responses based on relevance scores returned by each agent.  
**Mastra:** `.foreach(expertStep, { concurrency: N }).map(filterAndRankFn).then(synthesizer)`  
**Members interact:** No — experts are independent; only the merge function is "aware" of all outputs.  
**Best for:** Large expert pools where only a subset will have relevant opinions (e.g. security and legal both receive a PRD, but only security has useful critique on a crypto feature).

---

### 8. Branching (Conditional Routing)

**What:** The workflow follows different agent paths based on a condition evaluated from prior step output.  
**Mastra:** `.branch([[cond, stepA], [cond2, stepB]])` — native.  
**Best for:** Triage (escalate vs. self-serve), complexity routing (fast path for simple tasks, heavy committee for complex ones).

```
         ┌── (complex) ── CommitteeWorkflow ──┐
Input ───┤                                    ├── Output
         └── (simple) ── SingleAgent ─────────┘
```

---

### 9. Recursive Subtree (Retry / Drill-Down)

**What:** A section of the workflow can re-invoke itself (or a sub-workflow) on a subset of the output. E.g. synthesizer produces output, confidence scorer evaluates it, if low → re-invoke the full committee on just the uncertain sections.  
**Mastra:** Model as a loop (`.dountil`) around a nested workflow. The loop condition checks a `confidence` or `needsRefinement` flag in the output schema.  
**Best for:** Iterative deepening, "zoom in" on the parts the committee disagreed on.

```
Outer loop:
  ├── Committee(full doc)
  ├── ConfidenceScorer → { confidence, uncertainSections[] }
  └── if confidence < threshold: Committee(uncertainSections) → merge → retry
```

---

### 10. Pipeline with Human-in-the-Loop Gate

**What:** The workflow suspends at a defined step, emits a notification, and waits for a human decision before continuing. The human can approve, reject, or provide additional context.  
**Mastra:** `.then(reviewStep)` where `reviewStep` calls `suspend()`. On resume, the human's response is injected into the next step's input.  
**Members interact:** Human + agents.  
**Best for:** High-stakes decisions, compliance sign-off, ambiguity that AI can't resolve alone.

---

### 11. Map-Then-Reduce (Batch Processing)

**What:** A list of N artifacts, each processed by the same agent pipeline, then all outputs aggregated by a reducer.  
**Mastra:** `.foreach(agentStep, { concurrency: N }).then(aggregateStep)` — native.  
**Different from Fan-Out:** Fan-Out applies _different_ agents to _one_ artifact; Map-Reduce applies _one_ agent pipeline to _many_ artifacts.  
**Best for:** Bulk document processing, scoring a list of candidates, running the same review crew across a batch of PRDs.

---

### 12. Tournament Bracket

**What:** Agents are paired; the "winner" of each pair advances based on a judge step's score. Continues until one winner remains (or a top-K is selected).  
**Mastra:** Implement as a series of `.parallel` rounds, each round using a judge step to pick winners, until the bracket is resolved. Not natively supported — requires orchestration code.  
**Best for:** Choosing the best solution from many candidate generators, content ranking.

---

### 13. Sidecar (Agent-as-a-Tool)

**What:** A reasoning agent delegates execution (file reads, API calls, code edits) to a fast "executor" agent exposed as a tool. The thinker never holds dangerous tools directly.  
**Mastra:** Executor agent is instantiated inside a `tool()` wrapper passed to the thinker's `Agent` definition.  
**Already documented:** `[crew_ai.md](docs/features/ai-crews/crew_ai.md)` — "Agent-as-a-Tool / Sub-Agent Delegation" section.

---

## Pattern Comparison Summary

- **No inter-agent interaction:** Fan-Out (1), Broadcast+Merge (7), Map-Reduce (11)
- **Indirect interaction** (B reads A's output, no reply): Sequential Conference (2)
- **Direct interaction** (agents read and respond to each other): Round Robin (4), Round Robin With Replies (5), Evaluator-Optimizer (3)
- **Hierarchical interaction** (one agent controls others): Orchestrator (6), Sidecar (13)
- **Human in the loop:** Human-in-the-Loop Gate (10)
- **Structural / control-flow patterns:** Branching (8), Recursive Subtree (9), Tournament (12)

## What Mastra Natively Supports vs. What Needs Scaffolding

**Native:**

- Fan-Out (`.parallel + .map`)
- Sequential Conference (`.then` chain)
- Branching (`.branch`)
- Map-Reduce (`.foreach + .then`)
- Loops for Evaluator-Optimizer (`.dountil`)
- Nested sub-workflows
- Human-in-the-loop (`.suspend()`)

**Needs scaffolding (not native):**

- Round Robin — need a `threadStep` utility that passes a growing message thread between sequential agent steps
- Round Robin With Replies — `.dowhile` loop; mention parser extracts from round additions; dynamic full/reply alternation
- Orchestrator — needs state machine loop wiring (`.dowhile` + `.branch`)
- Tournament Bracket — needs orchestration code to manage bracket state across rounds

---

## Proposed Next Steps

1. **Capture this as a reference doc** at `docs/features/ai-crews/patterns.md` — living catalog, one pattern per section
2. **Build shared utilities** in `scripts/crews/patterns/`:

- `roundRobin(agents[], rounds)` — returns a workflow segment
- `roundRobinWithReplies(agents[], maxRounds?)` — alternating full/reply rounds until quiescence or max
- `evaluatorOptimizer(generator, evaluator, maxRetries)` — returns a loop workflow segment

1. **Update the `act-ai-crew-create` skill** to reference this catalog when selecting a pattern in Phase 2

## NOTES

- place each pattern in a separate file. In case of consderate variants like basic fan-out vs Adversarial vs weighted panel, also create a separate file and implementation for each of these.
