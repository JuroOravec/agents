# Example output: CBC Website

This document showcases the output produced when running `meta-create-skills-from-project` on the [cbc-website](https://github.com/codebridgecollege/cbc-website) project. It demonstrates what "good" looks like: the Phase 2 analysis, Phase 3 skill candidates, and Phase 4 artifacts.

---

## Phase 2: Discovered patterns

### Development

| Area | Pattern |
| ---- | ------- |
| **Feature structure** | `content/` for JSON, `src/types/` for types, `src/lib/content.ts` for getters. One type per content kind. Components in `src/components/landing/`, UI primitives from shadcn in `src/components/ui/`. |
| **Tests** | None. No test framework in package.json. |
| **Commands** | `npm run dev`, `build`, `start`, `lint`. Images: `./scripts/download-images.sh` for Google Drive fetch. |
| **Data flow** | JSON → `getX()` in `lib/content.ts` → page → components as props. No API; all static at build. |

### Other areas

| Area | Pattern |
| ---- | ------- |
| **Content** | JSON under `content/`. Each type: `content/{name}/index.json`, `src/types/{name}.ts`, `get{Name}()` in `content.ts`. |
| **Styling** | Tailwind v4, shadcn (new-york, neutral). Course themes in `content/course-themes/index.json` (amber, blue, emerald). |
| **Pages** | Next.js 15 App Router. Route = folder path; `page.tsx` per route. |

### Content types

- Courses, tutors, testimonials, FAQ, contact, ticker logos, reviews, course-themes.

---

## Phase 3: Skill candidates

| Skill name | Trigger | Purpose |
| ---------- | ------- | ------- |
| `project-cbc-website--content-add` | Adding a new content type (e.g. mentors, sponsors) | Create JSON + type + getter — three-part pattern |
| `project-cbc-website--content-edit` | Editing courses, tutors, FAQ, contact, etc. | File map and editing workflow |
| `project-cbc-website--course-add` | Adding a new course | Schema, themes (amber/blue/emerald), workflow |
| `project-cbc-website--page-add` | Adding a new route | App Router, static vs dynamic routes |

---

## Phase 4: Output structure

```
cbc-website/skills/                          # User chose test placement; normally .cursor/skills/
├── README.md                                # Catalog + patterns summary
├── project-cbc-website--content-add/
│   └── SKILL.md
├── project-cbc-website--content-edit/
│   └── SKILL.md
├── project-cbc-website--course-add/
│   └── SKILL.md
└── project-cbc-website--page-add/
    └── SKILL.md
```

---

## Sample skill: project-cbc-website--content-add

Frontmatter and overview:

```markdown
---
name: project-cbc-website--content-add
description: Add a new content type to the CBC website. Use when creating a new kind of content (e.g. mentors, sponsors, partners) that needs its own JSON data, type, and getter.
---

# Add New Content Type (CBC Website)

The CBC site stores content as JSON files under `content/`. Each content type has three parts: a JSON file, a TypeScript type, and a getter in `content.ts`. This skill ensures all three are added consistently.
```

Workflow phases: Create content file → Define type → Add getter in content.ts → Wire into pages/components.

---

## Sample skill: project-cbc-website--content-edit

Key artifact: a **content file map** table:

| Content | File path | Shape / notes |
| ------- | ---------- | ------------- |
| Courses | `content/courses/index.json` | Array of `{ id, title, badgeText, duration, ... }` |
| Tutors | `content/tutors/index.json` | Array of `{ name, role, img, link, desc }` |
| Contact | `content/contact/index.json` | Single object: `{ emails[], phones[], linkedin?, instagram? }` |
| ... | ... | ... |

---

## Sample skill: project-cbc-website--course-add

Key artifact: **course schema** and theme constraint:

```json
{
  "id": "kebab-case-id",
  "title": "Course Title",
  "theme": "amber | blue | emerald",
  "features": [{"strong": "Feature:", "text": "Description"}],
  ...
}
```

---

## Sample skill: project-cbc-website--page-add

Key artifact: **route-to-file mapping** and code examples for static vs dynamic routes.

---

## Verification checklist (Phase 5)

- [x] Each new skill has correct frontmatter
- [x] Skills are discoverable (triggers in description)
- [x] Skills follow meta-skill-create conventions (Workflow, Verification, Out of scope)
- [x] Catalog updated (README in output dir)
