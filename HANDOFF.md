# Starting a new conversation

Paste this at the start of a new Claude Code session (or say "read HANDOFF.md first").
`CLAUDE.md` loads automatically and holds the full architecture and domain rules; this
file adds the current state, how we work together and what's open.

---

## Prompt to paste

> I'm continuing work on my personal dashboard app ("Panel", Spanish UI) in this folder.
> Read `CLAUDE.md` (architecture and rules) and `HANDOFF.md` (current state and working
> agreements) before doing anything. Then wait for my request.

---

## What the app is (as of version 1.16, 13 Nov 2026)

A personal "digital brain" PWA: vanilla ES modules, no build, no backend. It's live on GitHub Pages
at https://manuelpedrazab30.github.io/habitos/ and installed on my iPhone's home screen.
Four sections, switched with the top selector or by **swiping** left/right:

- **Inicio**: daily briefing. "Lo importante ahora" uses the short message versions, plus one tile per module.
- **Hábitos**: habits (check/count/target, daily/days/weekly), streaks, XP/levels, duration goals,
  workout routines split into per-day sessions with progressive-overload stats.
- **Finanzas**:
  - quick expense entry; accounts, categories and budgets
  - paydays on the 1st, 15th and 28th
  - fixed costs and recurring transfers
  - reserve accounts: savings I don't touch, whose transfers count as period money
  - a selectable headline (Mostrar: para gastar / one account / total). Recibido, Gastado and the ring follow that choice.
- **Correo**: Gmail summary (OAuth token flow, read-only), rule-based digest, optional Claude summary
  with my own API key. Bills found in mail can be added as expenses.

Themes: **Clásico** (default: light yellow, rings/grid background, line icons), HUD (A, cyan),
Dorado (B, gold). The app icon matches the dark Clásico look.

Data lives only in each device's localStorage. I keep encrypted backups (Ajustes → copia cifrada,
saved to iCloud Drive).

## Working agreements

- **Never commit or publish until I say so.** "Commit" = local commit only; "commit and publish" =
  commit + push to `main` (GitHub Pages deploys in 1–2 min).
- **On every commit, bump the version** in `src/version.js`: `1.N` with N = `git rev-list --count HEAD` + 1,
  and `APP_DATE` = today. It shows at the bottom of Ajustes.
- Before pushing, **scan the diff for secrets** (API keys, Google client IDs, emails, tokens). The repo is public.
- Never put my personal data in the repo or in any external request.
- When adding a file to `src/`, add it to `SHELL` in `sw.js` and bump `CACHE`.
- Verify changes before saying they're done:
  - run the tests at `http://localhost:5173/tests/index.html`
  - check the change in the preview at phone size (375×812)
  - after publishing, confirm the Pages build finished and the live file has the change
- Keep `CLAUDE.md` updated with any new rule or feature.
- Messages shown to me must quote concrete numbers (amounts, dates, distances), never generic motivation.
  Every new message needs a `short` version (≤ 60 chars) for Inicio.
- Keep the UI uncluttered: I asked to remove cards that only repeat information.

## Decisions worth remembering

- The 28th payday is a normal payday, not a special type.
- My savings account must be marked **Reserva**. Otherwise transfers from it to cash only move balances
  and don't add to "para gastar". The transfer sheet now offers to mark it.
- A manual "Mover dinero" transfer between the same accounts counts as the scheduled recurring
  transfer (±5 days), so money isn't counted twice.
- Weekdays use two letters (Lu Ma Mi Ju Vi Sa Do). The Spanish "X" for miércoles confused me.
- The iPhone keeps the old home-screen icon until the app is re-added. Back up before deleting it,
  because the installed app has its own storage.

## Open / ideas

- **Outlook** support for Correo (Gmail first was the plan; Outlook is still pending).
- Nothing else in progress. The working tree was clean at version 1.16, when this file was committed.

## Handy commands

```bash
python3 serve.py                 # app at http://localhost:5173 (preview config: "habitos")
python3 tools/make_icons.py      # regenerate icons from the script
git rev-list --count HEAD        # +1 = next version number
```
