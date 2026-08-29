# Contributing

This is a personal tool, shared because it might be useful to someone else who
culls wildlife photography. That shapes what happens to contributions.

## Feature requests: yes, conditionally

Open an issue. Requests get taken seriously when they fit the way the app
already works and don't compromise what it guarantees. Two questions decide it:

**Does it suit the workflow this app is for?** Culling a card of RAW files
fast, deciding what to keep, and getting the keepers out — for one photographer,
on one machine, with no cloud. Features that serve that get real consideration.
Features that pull toward a general-purpose photo manager, a cloud service, or a
multi-user product don't, however good they are in isolation.

**Does it preserve the safety model?** These are not negotiable, because the
whole point is that the app can be trusted with originals:

1. Reject never deletes. A verdict marks a shot; it never removes a file.
2. Nothing is removed without a dry run first, an exact confirmation string, and
   a catalog backup.
3. Coordinates come from file EXIF only. A typed place is a label and never
   overwrites what the camera recorded.
4. Previews always survive; the worker refuses to unlink one.
5. Import copies nothing but a preview. Originals stay where they are.

A change that weakens any of those will be declined even if it is otherwise a
good idea. Say so in the issue if you think one of them is wrong — that is a
conversation worth having, it just isn't a patch.

## Bug reports: always welcome

Include what you did, what happened, what you expected, and:

- Your OS (it is developed and tested on Windows)
- Whether you are running the installer or from source
- The output of `fieldcatalog --library <your library> doctor`, which reports
  catalog integrity without disclosing your photographs

Fixes may be slow. This is maintained around a day job and a camera.

## Pull requests

Talk about it in an issue first if it is more than a small fix — it saves you
writing something that doesn't fit. When you do send one:

```bash
pytest -q                                    # worker tests must pass
npm --prefix ui run build                    # typecheck and build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml
```

CI runs the same checks. New behaviour in the worker wants a test; the safety
rules above each have one already, and those tests are the specification.

Match the surrounding style rather than introducing a new one. Comments explain
*why* — the code already shows what.

## What this project is not looking for

- Cloud sync, accounts, or sharing features
- Auto-identification on import (identify is user-initiated, always)
- Anything that moves or copies originals into the library
- A rewrite in a different stack

## Privacy

Never include real photograph paths, GPS coordinates, or catalog contents in an
issue. `doctor` output and a screenshot of a scratch library are enough for
almost any bug.

## Cutting a release

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Version 0.2.0
```

That bumps the version in all four files that carry it, checks they agree, runs
the tests and typecheck, builds the worker and the installer, commits, tags,
pushes, and creates the GitHub release with the installer attached.

It refuses rather than half-finishing: if the app is running (Windows cannot
replace a running executable), if the tree is dirty, if the version is not
higher than the current one, or if the tag already exists.

`-DryRun` reports what it would do. `-SkipPublish` builds and tags without
pushing.

Never change `identifier` in `src-tauri/tauri.conf.json` — it is the key
Windows uses to recognise an installed copy, and changing it turns an upgrade
into a second parallel install.
