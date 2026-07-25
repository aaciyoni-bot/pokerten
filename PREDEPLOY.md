# POKERTEN — mandatory pre-deploy routine

A syntax check is NOT enough. It passes even when basic behaviour breaks
(e.g. a card source silently emptied). Follow this EVERY deploy. No exceptions.

## 1. Automated gate (must pass, exit 0)
```
node predeploy-check.js
```
Blocks the deploy on the known regression classes:
- engine flag hard-coded instead of derived (this blanked all Spin cards),
- hero/table card source not covering both engine modes,
- actions missing the server or client branch,
- pkTick gated on a lagging ref (this froze hands),
- SW cache version not bumped (stale deploy).

If it fails: **do not push.** Fix, re-run.

## 2. Bump the SW cache version
`sw.js` → `pokerten-shell-vNN` must be higher than the live deploy, or clients
keep the old bundle.

## 3. Behavioural smoke — REQUIRED for any change touching the poker table,
engine, cards, tables, or spin. Automation can't log in, so verify live after
deploy (hard-refresh first):
- [ ] Cash **NLH**: sit, hand deals, **cards visible**, one action advances the hand.
- [ ] **Omaha**: 4/6 hole cards visible.
- [ ] **Spin & Cash**: cards visible, wheel resolves, winner paid.
- [ ] Open a **new table** → it appears and stays.
- [ ] Leave a table → no freeze, no lost hand.

## 4. Rules for engine / gameplay changes (the ones that hurt)
- Never flip a global engine flag (`srvEngine`, `serverEngine`) without tracing
  EVERY consumer (cards, actions, ticks, private-card subscription).
- Never guard a server tick on a value maintained by a separate async effect
  (`tableRef.current`) — it lags and can skip the tick that advances the hand.
- Prefer testing on a throwaway table, not the live club at peak.
- One behavioural change per deploy, so a regression is easy to bisect.
