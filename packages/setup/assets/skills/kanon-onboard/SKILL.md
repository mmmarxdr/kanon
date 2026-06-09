---
name: kanon-onboard
description: Team onboarding — invite teammates to a workspace, walk a new dev through `kanon-setup <kanon://link>`, and troubleshoot the resulting MCP wrapper config across Claude Code, Cursor, and Antigravity.
version: 1.0.0
tags: [kanon, onboarding, team, invite, mcp, wrapper, setup]
---

# Kanon Onboarding — Team Invites & Per-Machine Setup

Onboarding turns a fresh teammate into a working contributor: they receive a one-shot `kanon://` link from a workspace admin, run `kanon-setup`, and end up with credentials saved + a wrapper-mode MCP entry registered in every AI tool installed on their machine. The agent's job is to **guide both sides of that flow without inventing steps, recognize the small set of failure modes, and explain wrapper mode when the user is confused about where their key lives.**

This skill does NOT cover initial project bootstrap (use `kanon-init` for that) or static-key MCP setup for solo developers (covered in `kanon-mcp` install docs).

---

## Trigger

`kanon-setup`, `kanon://` link, "invite a teammate", "join the workspace", "onboard the new dev", "set up Kanon on this machine", "the wrapper isn't authenticating", `TOKEN_EXPIRED`, `TOKEN_CONSUMED`.

---

## Two Sides of the Flow

| Role | What they do | What they need from us |
|------|--------------|------------------------|
| **Workspace admin** | Sends an invite from the Kanon UI; receives a `kanon://` link to forward | Confirm the workspace, surface the link, remind them links are single-use and time-bound |
| **New teammate** | Receives the link; runs `kanon-setup <link>` on each machine they want connected | Walk them through one command, verify success output, restart hint |

**Single-use, time-bound.** Each invite token can be redeemed exactly once and expires. If the teammate has more than one machine, the admin must send a separate invite per machine — there is no "redeem on every machine" mode. Make this explicit; do NOT suggest copy-pasting the same link twice.

---

## Wrapper Mode in One Paragraph

After onboarding, the MCP entry written to the AI tool's config does NOT bake in `KANON_API_KEY`. Instead it points at `kanon-mcp-wrapper`, which on every spawn (a) reads a refresh token from `~/.kanon/credentials` keyed by the full apiUrl (`https://server:port`), (b) exchanges it against the server for a short-lived access token, then (c) spawns the real MCP server with the access token in env. This is why a teammate's MCP entry has `--server <apiUrl>` instead of an env block. Several Kanon servers can coexist in the same credentials file because the key is the full URL, not the bare host.

If the user asks "where is my API key?" the correct answer is: there isn't one — onboarding uses a refresh token at `~/.kanon/credentials`, exchanged transparently by the wrapper.

---

## The Happy Path (teammate side)

1. **Receive the link.** Format: `kanon://<host>[:port]/onboard?token=<jwt>`. Localhost resolves to `http://`; everything else resolves to `https://`.
2. **Run** `kanon-setup <kanon://link>` on a machine where any of Claude Code, Cursor, or Antigravity is installed.
3. **Read the success output** — three blocks in order:
   - `✓ Onboarded as <email>` + server URL + credentials path
   - `✓ Configured N tool(s):` + a per-tool line with the config file that was updated
   - `Restart your AI coding tool(s) to pick up the new configuration.`
4. **Restart the AI tool.** MCP servers are loaded at process start; without a restart, `kanon_*` tools won't appear.

If any of those blocks is missing, the flow partially failed — see Troubleshooting.

---

## The Happy Path (admin side)

1. Open the workspace in the Kanon UI → Members → Invite.
2. Pick the role (member by default).
3. Forward the generated `kanon://` link via whatever channel is appropriate (Slack DM, 1Password share, etc.). Do NOT post it in a public channel — it is an auth credential until consumed.
4. If the teammate reports `TOKEN_EXPIRED` or `TOKEN_CONSUMED`, generate a new invite. Old links cannot be revived.

---

## Troubleshooting

The setup CLI exits non-zero with a specific message for each failure. Map the message to the cause; do NOT guess.

| Symptom / message | Cause | Fix |
|-------------------|-------|-----|
| `Invalid onboarding link format` | URL doesn't start with `kanon://` or has no `token` param | Ask admin to resend; do not hand-edit |
| `Onboarding link has expired` (`TOKEN_EXPIRED`) | Past the invite TTL | Admin generates a new invite |
| `This onboarding link has already been used` (`TOKEN_CONSUMED`) | Single-use token already redeemed | Admin generates a new invite — same one cannot be reused on a second machine |
| `Network request failed — server unreachable` | Wrong server URL, server down, or VPN required | Verify the link's host, ping the server, check VPN |
| `Unexpected response from server: …` | Server version mismatch (CLI expects a schema the server doesn't return) | Update `@kanon/setup` (`pnpm dlx @kanon/setup@latest …`) |
| `Failed to save credentials` | Permission issue on `~/.kanon/credentials` | `chmod` the file, or `rm` it and re-run |
| `No supported AI tools detected on this machine.` | None of Claude Code / Cursor / Antigravity have config dirs | Install at least one tool, then re-run `kanon-setup --tool <name>` |
| `⚠  Failed to register MCP entry: …` | Credentials saved but config write failed (permissions, malformed JSON) | Investigate the specific path printed; credentials are kept so we don't redo the network call |
| MCP tools don't appear after restart | Tool wasn't restarted, or the wrapper can't find creds | Verify `~/.kanon/credentials` has a key matching the `--server <url>` value in the tool's MCP config; both must be identical |

**Credentials key drift** is the single most common silent failure. The credential store keys entries by the full `apiUrl` (scheme + host + port). The wrapper looks up by the same string. If they disagree (e.g., one has `:443`, the other doesn't), the wrapper fails to authenticate and tools stay missing. When in doubt, dump the credentials file and the tool's MCP config and compare the strings character-for-character.

---

## Re-running on a Second Machine

Onboarding is per-machine because credentials live in `~/.kanon/credentials` and MCP configs live in each tool's user-level config. To onboard a second machine:

1. Admin generates a **new** invite link.
2. Teammate runs `kanon-setup <new-link>` on the second machine.

Re-running with the same `kanon://` link will fail with `TOKEN_CONSUMED`. There is no shared credential sync — the credentials file is intentionally local and never copied across machines.

---

## Re-running on the Same Machine (re-onboarding)

Allowed and idempotent for the configs/credentials side, but you still need a fresh invite:

- **Credentials**: `writeCredentials` is merge-safe — re-onboarding updates the entry for that apiUrl without disturbing other servers in the same file.
- **MCP entries**: `mergeConfig` overwrites only the `kanon-mcp` key in each tool's config; other MCP servers are untouched.
- **Token side**: still single-use. Need a new invite.

---

## Multi-Server Coexistence

The credential store and wrapper are designed so a single user can be onboarded to several Kanon servers (e.g., personal cloud + work self-hosted) on the same machine. Each `kanon-setup` run writes its credential entry under its own apiUrl key, and each tool's MCP config can in theory hold one `kanon-mcp` entry — but only one. **The most recently onboarded server wins** in the AI tool config; the others remain in credentials but are not wired in until the user re-runs `kanon-setup` against them. Mention this if the user is juggling multiple servers.

---

## Common Recipes

### "I just got a link from my workspace admin — what do I do?"

1. Confirm the link starts with `kanon://`. If not, ask the admin to resend (it's not the `https://` invite-page URL).
2. Run `kanon-setup <full-link>` from a terminal. Quote the URL if your shell complains about the `?` or `&`.
3. Read the three success blocks. If any is missing, jump to Troubleshooting.
4. Restart Claude Code / Cursor / Antigravity (whichever you use).
5. Verify by asking your AI tool to run a Kanon command (e.g., "list my workspaces") — it should return your assigned workspace.

### "I'm a workspace admin — invite Maya to the workspace"

1. Open Kanon UI → workspace settings → Members → Invite.
2. Enter Maya's email + role.
3. Copy the generated `kanon://` link.
4. Forward to Maya privately. Tell her: it's single-use, expires in (whatever the UI says), and to run `kanon-setup <link>` after pasting.
5. If Maya works on multiple machines, send a fresh link per machine.

### "Maya says `kanon-setup` finished but Claude Code doesn't show kanon tools"

1. Confirm she restarted Claude Code (not just reloaded a window — full quit and reopen).
2. Open `~/.claude.json` (or `%APPDATA%\Claude\claude_desktop_config.json` on Windows-native), look for the `kanon-mcp` entry. It should have `command: node ...wrapper-cli.js` (or the npx form) and `--server <apiUrl>` in args.
3. Open `~/.kanon/credentials`. Check there's a top-level key whose value is exactly the `--server` value from step 2 (full URL, scheme + host + port).
4. If those two strings differ, that is the bug — re-run `kanon-setup` to repair, or fix the credentials key by hand if the user knows what they're doing.
5. If both look right, run the wrapper directly: `node <wrapper-cli.js> --server <apiUrl>` and inspect stderr — it logs the refresh→exchange step.

### "The token expired before Maya could redeem it"

1. Admin generates a new invite. Old token cannot be revived.
2. Send the new link.
3. (Optional) If this happens often, mention to the admin that invite TTL is configurable workspace-wide — they may want to extend it.

### "Maya is on Windows and the wrapper doesn't start"

WSL bridge mode applies when the AI tool is Windows-native but Node lives in WSL. In that case the registered command is `wsl node <wrapper-path> --server <apiUrl>`. If the user reports the wrapper not starting:

1. From a WSL shell, run `which node` — record the path.
2. From CMD/PowerShell, run `wsl node --version` — confirms WSL can invoke Node.
3. Compare the path in the registered MCP entry's `args[0]` to `which node`. If they differ, re-run `kanon-setup` from inside WSL so it picks up the right node binary.

---

## Best Practices

1. **Never leak the `kanon://` link in a transcript or shared note** — it is an auth credential until consumed. If a user pastes one to you, treat it like a password: do not echo, do not log, do not save to engram.
2. **Don't suggest hand-editing credentials** as a first step. Re-running `kanon-setup` is almost always cleaner.
3. **Always remind about the restart.** It is the most common reason "the setup worked but tools are missing".
4. **Match expectations to roles.** Admins ask about invites and policy; teammates ask about their machine. Don't mix the two.
5. **One invite, one machine.** If the user wants Kanon on N machines, that's N invites — push back politely on attempts to reuse.
6. **Surface only what the CLI actually printed.** Do not invent steps not present in `onboard.ts`. If the user pastes output that doesn't match the documented blocks, they may have an outdated `@kanon/setup` — suggest upgrading.
