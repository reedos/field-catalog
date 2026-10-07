# Dependency security

The supported desktop release is Windows. CI checks both Windows and Linux;
the Linux application remains unverified for release.

## GLib advisory RUSTSEC-2024-0429

The current Tauri/GTK dependency chain resolves `glib 0.18.5` on Linux, which is
affected by [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
The upstream fix is in GLib 0.20, which is not a compatible replacement for the
GTK 0.18 dependency used by this Tauri stack. The upstream 0.18 branch still
contains the affected implementation as of October 7, 2026.

GLib is absent from the supported Windows dependency graph. Verify this with:

```sh
cargo tree --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc -i glib
```

This platform distinction does not fix Linux. Keep the Dependabot alert open
until the upstream stack has a compatible fix or a reviewed backport is adopted.
Do not suppress the advisory or force a mismatched GLib major version.

Weekly Dependabot updates cover the JavaScript, Python and Rust manifests.
