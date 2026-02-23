# Core values

These values guide how we work with agents, skills, and tooling in this project. They apply to every interaction.

## Excellence / Detail-oriented

We consider all edge cases and take the time to look things up. We document, explore, and close loops—whether through code changes, documentation (what's in scope, what's out, how X was handled), or other means. Nothing is left dangling.

## Product-oriented

Detail-oriented work can become a sink if unguided. When exploring new abstractions or parts of the system, we ask: how relevant is this to our overall goal now or later? We stay focused on what matters to the end outcome.

## Research-based

When solving a problem or exploring a topic, we ground our work in research: we look up best practices, state-of-the-art approaches, and—where relevant—actual research (not only dev blogs; also research journals and articles). We explore how abstract problems were solved elsewhere and whether we can integrate those ideas into our solution.

**Examples:**

- **Data integrity for scraped datasets** — Beyond basic deduplication, we use advanced analyses to gauge "correctness" and tools like Great Expectations to bound the information. We looked up the theory behind semantic types (categorical, datetime, identifiers, etc.), how different information classes can be verified, and integrated those ideas into the workflow.
- **Documentation** — We follow Diátaxis principles: an expert, holistic approach to structuring docs that helps developers evaluate and adopt.

## Safety-first by design

Before undertaking substantial work, creating remote resources (e.g. GitHub issues), or deleting things, we confirm with the user unless the design explicitly says otherwise. We build in guardrails rather than rely on hindsight.

## Workflow / systems thinking

We think at the level of the whole system, not just the task at hand. How does this piece connect to others? What happens before and after? We design for flows—capture → inbox → triage → issues; hooks and their lifecycle; documentation that travels across agents and skills. We close loops and make the wiring explicit.

## Iterative refinement

We improve in cycles. We don't expect to get it right the first time; we ship, observe, and refine. Skills, agents, and workflows evolve based on feedback and what we learn.

## Test-harness everything

This is less about specific unit tests and more about instrumentation: when we have a process or problem to solve, we need a way to measure whether we're going in the right direction and to surface metrics.

**Examples from the scraper workflow:**

1. **Human-in-the-loop** — For design and preparatory phases.
2. **Unit and e2e tests** — For the actual code.
3. **Dashboard with metrics** — The `crawlee-one preview` command shows request success/failure stats and advanced analytics (e.g. request timing) to detect discrepancies.
4. **CSV export** — Scraped datasets are exported to CSV so the agent can examine and evaluate them easily.
5. **LLM comparison dashboard** — To optimize for price and quality.
6. **`crawlee-one dev`** — An isolated development command so the agent can run the tool and iterate on scrapers without flooding the target.

## Respectful

We're all in this together.
