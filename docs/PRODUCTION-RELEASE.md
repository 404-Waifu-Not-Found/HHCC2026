# ClipQuest production release

ClipQuest deploys the Worker and its hashed static assets as one version. A
release must never use a direct `wrangler deploy`, because a one-step deploy
cannot smoke-test a new shell and its bundles on the production domain before
traffic moves.

## One-time Cloudflare version affinity

Create a zone-level Request Header Transform Rule for `clipquest.ccwu.cc` in
the `http_request_late_transform` phase:

- Expression: `http.host eq "clipquest.ccwu.cc"`
- Operation: Set dynamic request header
- Header: `Cloudflare-Workers-Version-Key`
- Value: `ip.src`

The release runner verifies this rule through `/health` while the new Worker is
at 0% and aborts with an automatic rollback if the header is absent. This
prevents an HTML shell from one version from requesting a content-hashed asset
from another version during a split deployment.

References:

- [Cloudflare version affinity](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/)
- [Cloudflare version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)

## Release

The branch must be clean and its exact HEAD must already be pushed upstream.
Then run from the workspace root:

```sh
npm run cf:deploy
```

The runner uses the workspace-pinned Wrangler through `npx` and performs these
gates in order:

1. Build contracts, the extension ZIP, the web app, and the Worker.
2. Verify every generated HTML shell references files present in the final
   asset directory.
3. Run `npx wrangler deploy --dry-run`.
4. Record the single version currently receiving 100% of production traffic.
5. Upload the pushed git SHA with `npx wrangler versions upload` and smoke-test
   its preview URL.
6. Deploy the old version at 100% and the new version at 0%.
7. Probe every production shell and entry bundle using
   `Cloudflare-Workers-Version-Overrides` on every request, while also verifying
   the version-affinity transform rule.
8. Promote the verified version directly to 100%.
9. Repeat shell/bundle probes at 0, 2, 5, and 10 minutes.

Any failure after the 0% deployment automatically runs
`npx wrangler rollback <previous-version-id>`. Evidence is retained under the
ignored `apps/api/.wrangler/release-evidence/` directory. A Worker rollback does
not roll back D1; therefore releases that include a migration need a separate,
explicit database compatibility plan.

The matching unpacked extension and ZIP are generated at:

- `apps/extension/dist/clipquest-captions-extension/`
- `apps/extension/dist/clipquest-captions-extension.zip`
