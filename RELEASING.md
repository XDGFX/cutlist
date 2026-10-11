# Releasing

The version in the footer is the latest `v*` tag on `main`. Nothing else stores it, so there is nothing
to bump or keep in sync.

## Cut a release

From an up-to-date `main`:

```sh
gh release list --limit 1
gh release create v1.2.0 --generate-notes
```

Publishing the release runs `.github/workflows/release.yml`, which redeploys the page so the footer
shows the new version. A release drafted in the GitHub UI works the same way once it is published.

## Choose the number

- **Minor** (`v1.2.0` to `v1.3.0`) for anything a user sees or stores: a feature, a changed layout, a
  restyle.
- **Patch** (`v1.2.0` to `v1.2.1`) for a fix that changes nothing else.
- **Major** when a saved job or a shared link from the last version stops working.

## Between releases

Every push to `main` still deploys. The footer then shows the last release and the commits since, as
`v1.2.0+3`. With no tag at all it shows `dev`.
