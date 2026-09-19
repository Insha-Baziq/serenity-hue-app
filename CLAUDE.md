@AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

## Vercel deployment

Use this exact command whenever deploying this project to Vercel:

```powershell
npx vercel --prod --yes --global-config "C:\Users\baziq\AppData\Local\vercel-profile-shabina-khan"
```

Run it from the repository root after the validation gate and verify the resulting production URL.
