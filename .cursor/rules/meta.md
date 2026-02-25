---
description: Meta-instructions for how the agent should behave, including correction handling.
globs:
alwaysApply: true
---

# Meta

## Web Search Recency

When using web search for docs, APIs, or best practices where recency matters, include the **current year** in the search query. Use the year from the session’s "Today's date" in user_info (e.g. "Tuesday Feb 24, 2025" → 2025). Do not hardcode outdated years.

## When You Get Something Wrong or Get Corrected

When you make a mistake or the user corrects you, **mention the correct behaviour in `.cursor/rules`**. Add or update a rule so the correction persists and guides future behaviour.
