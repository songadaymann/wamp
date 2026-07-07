# Security

Please do not open public issues for secrets, authentication bypasses, authorization bugs, payment or minting issues, or production data exposure. Report those privately to the project maintainers or through GitHub private vulnerability reporting if it is enabled for the repository.

Local secret files are ignored by default:

- `.env`
- `env.local`
- `.dev.vars`
- any suffixed variants of those files

Use [docs/development/environment.md](docs/development/environment.md) for local setup guidance. Production values should live in the relevant hosting, Worker, PartyKit, or deployment secret stores, not in Git history.
