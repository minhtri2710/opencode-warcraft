# Setup

## ctx7 setup

Configure Context7 CLI + Skills mode for your AI coding agent.

```bash
ctx7 setup --cli                      # Use CLI + Skills mode

# Target a specific install location
ctx7 setup --cli --claude             # Claude Code (~/.claude/skills)
ctx7 setup --cli --cursor             # Cursor (~/.cursor/skills)
ctx7 setup --cli --universal          # Universal (~/.config/agents/skills)
ctx7 setup --cli --antigravity        # Antigravity (~/.config/agent/skills)

ctx7 setup --project                  # Configure current project instead of globally
ctx7 setup --yes                      # Skip confirmation prompts
```

**Authentication options:**
```bash
ctx7 setup --api-key YOUR_KEY         # Use an existing API key
```

Without `--api-key`, setup opens a browser for OAuth login.

**What gets written — CLI + Skills mode:**
- A `find-docs` skill in the chosen agent's skills directory, guiding the agent to use `ctx7 library` and `ctx7 docs` commands
