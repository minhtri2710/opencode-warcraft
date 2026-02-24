## Summary

- 

## Plan + Feature Evidence

- Feature name:
- Plan path: `/.beads/artifacts/<feature>/plan.md`

## Plan Review Checklist

- [ ] Discovery is complete and current
- [ ] Scope and non-goals are explicit
- [ ] Risks, rollout, and verification are defined
- [ ] Tasks and dependencies are actionable

## Task Evidence

- [ ] `/.beads/artifacts/<feature>/tasks/<task-1>/report.md`
- [ ] `/.beads/artifacts/<feature>/tasks/<task-2>/report.md` (remove if not used)

## Verification Commands

```bash
bun run build
bun run test
bun run lint
```

## Beads Sync

- [ ] Ran `br sync --flush-only`
- [ ] Committed `.beads/artifacts` updates (if changed)
