# Multi-Agent Collaboration Pattern Library

A taxonomy of reusable patterns for composing multi-agent Mastra workflows. Each pattern is a building block — they compose and nest freely.

Reference implementations live in `src/mastra/patterns/` — one file per pattern; variants (e.g. fan-out basic vs adversarial vs weighted) have separate files.

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
**Implementation:** [`fanOut.ts`](../../../src/mastra/patterns/fanOut.ts)
**Members interact:** No — each reviewer sees only the original artifact, not each other's output.

```
Input ──┬── AgentA ──┐
       ├── AgentB ──┤── Merge map ── Synthesizer ── Output
       └── AgentC ──┘
```

**Variants:**

- _Weighted panel_ — [`fanOutWeightedPanel.ts`](../../../src/mastra/patterns/fanOutWeightedPanel.ts)
- _Adversarial panel_ — [`fanOutAdversarial.ts`](../../../src/mastra/patterns/fanOutAdversarial.ts)

---

### 2. Pipe (Sequential Conference / Pipeline)

**What:** Agents review one after another; each sees the previous agent's output appended to context.
**Mastra:** `.then(agentAStep).then(agentBStep).then(agentCStep)`
**Implementation:** [`pipe.ts`](../../../src/mastra/patterns/pipe.ts)
**Members interact:** Indirectly — B reads A's output, C reads B's, but no back-channel.
**Best for:** Iterative refinement (draft → critique → polish), assembly-line transformations.

```
Input ── AgentA ── AgentB ── AgentC ── Output
```

**Variants:**

- _Baton pass_ — strict: each agent transforms the artifact
- _Running commentary_ — each agent appends notes and passes the full growing doc forward

---

### 3. Evaluator-Optimizer (Actor-Critic Loop)

**What:** Generator produces a draft; Evaluator scores it. If rejected, generator retries with feedback. Loop exits on pass or `maxRetries`.
**Mastra:** `.dountil` with evaluator in the condition, or `.then(generate).then(evaluate).branch` with counter.
**Implementation:** [`evaluatorOptimizer.ts`](../../../src/mastra/patterns/evaluatorOptimizer.ts)
**Members interact:** Yes — evaluator writes structured feedback that the generator reads.
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

**What:** N agents each review in turn; each sees all previous agents' responses before writing.
**Mastra:** Chained `.then()` steps threading a growing `messages` array through shared state.
**Implementation:** [`roundRobin.ts`](../../../src/mastra/patterns/roundRobin.ts)
**Members interact:** Yes — each agent reads all prior agents' outputs.
**Best for:** Structured debates, code review committees, board deliberation.

```
Round 1:
Input ── AgentA(sees: input) ── AgentB(sees: input+A) ── AgentC(sees: input+A+B) ── ...

Round 2 (optional):
... ── AgentA(sees: full round 1) ── AgentB ── AgentC ── Synthesizer ── Output
```

---

### 5. Round Robin With Replies (Mention-Driven)

**What:** Alternates full rounds (all agents) and reply rounds (only @mentioned agents). Stops when a full round produces no new @mentions. Round context, team roster, and mention instructions are injected automatically into every prompt.
**Mastra:** `.dowhile` loop; a single `roundStep` decides full vs. reply based on `pendingMentionIds` in state.
**Implementation:** [`roundRobinWithReplies.ts`](../../../src/mastra/patterns/roundRobinWithReplies.ts)
**Members interact:** Yes — mentions are explicit signals.
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

**What:** Orchestrator decides which workers to invoke next based on task + accumulated history; loops until done.
**Mastra:** `.dowhile` state machine; orchestrator agent produces `{ nextWorker, done }` on each iteration.
**Implementation:** [`orchestrator.ts`](../../../src/mastra/patterns/orchestrator.ts)
**Members interact:** Yes — orchestrator coordinates; workers report back.
**Best for:** Tasks where the steps aren't fully known upfront (e.g. research + write + verify).

```
         ┌───────────────────────────────────────────┐
         ↓                                           │
Orchestrator ── branch ──┬── WorkerA ───────────────┤
                         ├── WorkerB ───────────────┤
                         └── done? ── Output        │
```

---

### 7. Fan-Out Selective

**What:** Broadcast to experts in parallel; merge step filters/ranks by dynamic criteria (e.g. relevance).
**Mastra:** `.parallel(expertSteps).map(filterAndRank).then(synthesizer)`
**Implementation:** [`fanOutSelective.ts`](../../../src/mastra/patterns/fanOutSelective.ts)

```
Input ──┬── Expert1 ──┐
       ├── Expert2 ──┤── filterAndRank ── Synthesizer ── Output
       └── ExpertN ──┘
```

---

### 8. Branching (Conditional Routing)

**What:** Workflow follows different paths based on prior step output.
**Mastra:** `.branch([[cond, stepA], [cond2, stepB]])` — native.
**Implementation:** [`branching.ts`](../../../src/mastra/patterns/branching.ts)

```
         ┌── (complex) ── CommitteeWorkflow ──┐
Input ───┤                                    ├── Output
         └── (simple) ── SingleAgent ─────────┘
```

---

### 9. Retry

**What:** Re-invoke a sub-workflow until `passCriteria(output)` returns true or maxIterations is reached.
**Mastra:** `.dountil` around nested workflow; caller supplies pass/fail logic.
**Implementation:** [`retry.ts`](../../../src/mastra/patterns/retry.ts)

```
Outer loop:
  ├── Committee(full doc)
  ├── ConfidenceScorer → { confidence, uncertainSections[] }
  └── if confidence < threshold: Committee(uncertainSections) → merge → retry
```

---

### 10. Pipeline with Human-in-the-Loop Gate

**What:** Suspend at a step; wait for human approval before continuing.
**Mastra:** Step calls `suspend()`; on resume, human response is injected.
**Implementation:** [`humanInTheLoopGate.ts`](../../../src/mastra/patterns/humanInTheLoopGate.ts)

```
Input ── AgentStep ── suspend() ── [Human approves/modifies] ── resume() ── NextStep ── Output
```

---

### 11. Map-Then-Reduce (Batch Processing)

**What:** Same agent pipeline applied to many artifacts; aggregate results.
**Mastra:** `.foreach(agentStep).then(aggregateStep)` — native.
**Implementation:** [`mapThenReduce.ts`](../../../src/mastra/patterns/mapThenReduce.ts)

```
Artifacts ──┬── Agent(art1) ──┐
            ├── Agent(art2) ──┤── Aggregate ── Output
            └── Agent(artN) ──┘
```

---

### 12. Compete Tournament Bracket

**What:** Pair candidates; judge picks winners; repeat until one winner. One of several competition layouts.
**Mastra:** Orchestration code with `.foreach` over pairs.
**Implementation:** [`competeTournamentBracket.ts`](../../../src/mastra/patterns/competeTournamentBracket.ts)

```
Round 1:  (A vs B) ── Judge ── winner   (C vs D) ── Judge ── winner
Round 2:  (winner1 vs winner2) ── Judge ── Final Winner ── Output
```

---

### 13. Sidecar (Agent-as-a-Tool)

**What:** Thinker agent delegates execution to an executor agent via a tool.
**Mastra:** Executor wrapped in `tool()`; thinker only has that tool.
**Implementation:** [`sidecar.ts`](../../../src/mastra/patterns/sidecar.ts)
**Documentation:** [crew_ai.md](crew_ai.md) — "Agent-as-a-Tool" section.

```
Input ── ThinkerAgent ── [tool: executorAgent] ── Output
                │
                └── Executor (file reads, API calls, code edits)
```

---

### 14. Reflection / Self-Correction (Single Agent)

**What:** Agent generates, then critiques its own output, then revises.
**Mastra:** `.then(generate).then(critique).then(revise)` or `.dountil`.
**Implementation:** [`selfCorrection.ts`](../../../src/mastra/patterns/selfCorrection.ts)

```
Input ── Generate ── Draft ── Critique (same agent) ── Revise ── Output
```

---

### 15. Router

**What:** Router analyzes input and routes to the best single specialist.
**Mastra:** `.then(routerStep).branch([[isTypeA, agentA], [isTypeB, agentB]])`
**Implementation:** [`router.ts`](../../../src/mastra/patterns/router.ts)

```
         ┌── isTypeA ── AgentA ──┐
Input ─── Router ───┤           ├── Output
         └── isTypeB ── AgentB ──┘
```

---

### 16. DoWhile (Loop + Synthesizer)

**What:** Run sub-workflow repeatedly until `condition` passes or maxIterations; collects all outputs and passes to synthesizer. Always runs at least once. Unlike mapThenReduce, the iteration count is not known upfront.
**Mastra:** `.dountil` around sub-workflow step; synthesizer step consumes `{ inputData, outputs }`.
**Implementation:** [`doWhile.ts`](../../../src/mastra/patterns/doWhile.ts)

```
     ┌─────────────────────────────────┐
     ↓                                 │ condition fails
Input ── SubWorkflow ── condition? ─────┤
                                       │ condition passes
                                       └── Synthesizer ── Output
```

---

### 17. While (Loop + Synthesizer)

**What:** Run sub-workflow while `condition` is true; may run zero times. Collects outputs and passes to synthesizer. Unlike doWhile, condition is checked before each run.
**Mastra:** `.dowhile` with step that may skip sub-workflow; synthesizer receives `{ inputData, outputs }`.
**Implementation:** [`while.ts`](../../../src/mastra/patterns/while.ts)

```
     ┌─────────────────────────────────┐
     ↓                                 │ condition true
Input ── condition? ── SubWorkflow ─────┤
     │ condition false                  │
     └── Synthesizer ── Output         ┘
```

---

## Pattern Comparison Summary

| Interaction type     | Patterns                                                                            |
| -------------------- | ----------------------------------------------------------------------------------- |
| No inter-agent       | Fan-Out (1), Fan-Out Selective (7), Map-Reduce (11)                                 |
| Indirect (B reads A) | Pipe (2)                                                                            |
| Direct               | Round Robin (4), Round Robin W/Replies (5), Evaluator-Opt (3)                       |
| Hierarchical         | Orchestrator (6), Sidecar (13)                                                      |
| Human in the loop    | Human-in-the-Loop Gate (10)                                                         |
| Control-flow         | Branching (8), Retry (9), Compete Tournament Bracket (12), DoWhile (16), While (17) |

## Mastra: Native vs. Scaffolding

**Native:** Fan-Out, Sequential Conference, Branching, Map-Reduce, Loops, Nested workflows, `suspend()`.

**Needs scaffolding:** Round Robin (thread passing), Round Robin With Replies (mention parser), Orchestrator (state machine), Tournament Bracket (orchestration).
