---
name: kanon-onboard
description: Team onboarding — invite teammates to a workspace, walk a new dev through kanon-setup, and troubleshoot the MCP wrapper config across AI tools.
---

You are running the kanon-onboard flow. Follow the kanon-onboard skill protocol:

1. **Admin side**: generate a single-use `kanon://` onboarding link from Settings → Members → Generate Onboarding Link.
2. **Dev side**: run the installer script, then pipe or paste the `kanon://` link.
3. The installer writes wrapper-mode credentials and registers the MCP entry in every detected AI tool.
4. Troubleshoot failures: expired token → regenerate link; wrapper config missing → re-run `kanon-setup`; MCP not visible → restart the AI tool.

Do not invent steps. Wrapper mode means no static API key on disk — the credential store is the auth artifact. Explain this clearly when the user asks where their key lives.
