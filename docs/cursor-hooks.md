# Cursor Hooks

Cursor lifecycle hooks let you run scripts when certain events occur (e.g. before a prompt is submitted, before a file is read, when a task stops).

## Reload required after changes

**Cursor reads `hooks.json` and hook scripts only at startup.** After editing `.cursor/hooks.json` or any hook script:

- Use **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P** (Windows/Linux)
- Run **"Developer: Reload Window"**

New and modified hooks will not run until you reload.

## Reference

- Project hooks: `.cursor/hooks.json`
- Scripts: `.cursor/hooks/*.sh` (or `.ts`, `.js`)
- Example: see `.cursor/hooks/` — `capture-prompts.sh` and `README.md`
- [Cursor docs: Third Party Hooks](https://cursor.com/docs/agent/third-party-hooks)
