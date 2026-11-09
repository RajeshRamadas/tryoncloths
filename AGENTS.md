# Notes for coding agents

- Cloud tasks already have an isolated checkout. Work in the existing repository; do not create a worktree unless explicitly requested.
- In the Codex cloud environment, use the existing `/workspace/tryoncloths` checkout and run `npm ci --cache /workspace/.npm-cache` instead of cloning again.
- Before committing, run `npm run format`, `npm test` and `npm run build`.
