# Available Research Tools

Reference for Mekkatorque and Brann operatives on available research tools.

## Code Search

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `grep_app_searchGitHub` | GitHub code search | Find real-world examples, patterns in OSS |
| `warcraft_skill("ast-grep")` | AST search workflow | Generate/test ast-grep rules for structural code queries |

### grep_app Examples
```
grep_app_searchGitHub({ query: "useEffect cleanup", language: ["TypeScript"] })
grep_app_searchGitHub({ query: "(?s)try {.*await", useRegexp: true })
```

### ast-grep Skill Flow
```
warcraft_skill({ name: "ast-grep" })
bash("ast-grep scan --rule rule.yml src")
```

## Documentation

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `context7_resolve-library-id` | Find library ID | Before querying docs |
| `context7_query-docs` | Query library docs | API usage, best practices |

### context7 Flow
1. `context7_resolve-library-id({ query: "how to use X", libraryName: "react" })`
2. Get libraryId from result (e.g., `/facebook/react`)
3. `context7_query-docs({ libraryId: "/facebook/react", query: "useEffect cleanup" })`

## Web Search

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `websearch_web_search_exa` | Exa AI search | Current info, recent developments |

### websearch Examples
```
websearch_web_search_exa({ query: "Next.js 15 new features 2026", numResults: 5 })
```

## Delegation

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `task()` | Spawn subagent call | Parallel exploration and delegated execution |

### Parallel Exploration (Preferred)

Use `task()` for research fan-out and delegated worker execution.

For exploratory research, load `warcraft_skill("parallel-exploration")` for the full playbook.

Quick pattern:
```
task({
  agent: "brann", 
  prompt: "Find all API routes in src/ and summarize patterns",
  description: "Explore API patterns",
  subagent_type: "explore"
})
```

For broad fan-out, run multiple `task()` calls in one message.

---

## Tool Selection Guide

| Need | Best Tool |
|------|-----------|
| Find code in THIS repo | `grep`, `glob`, `warcraft_skill("ast-grep")` |
| Find code in OTHER repos | `grep_app_searchGitHub` |
| Understand a library | `context7_query-docs` |
| Current events/info | `websearch_web_search_exa` |
| Structural refactoring | `warcraft_skill("ast-grep")` + `bash` |
| Multi-domain exploration | `warcraft_skill("parallel-exploration")` + `task()` |
