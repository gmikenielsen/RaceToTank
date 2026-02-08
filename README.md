# Race to the Tank

`Race to the Tank` is a free-to-host static site that tracks the current bottom 12 NBA teams and shows a mobile-friendly two-column view:

1. Teams 1-12
2. Remaining opponents as a comma-delimited list with game counts in parentheses

It also shows the current day schedule (Eastern Time) for any of those 12 teams directly under the page title.

## Stack

- Static site (`public/index.html`, `public/app.js`)
- Data builder script (`scripts/build-data.mjs`)
- Daily refresh via GitHub Actions (`.github/workflows/refresh-data.yml`)
- Free hosting via GitHub Pages (`.github/workflows/deploy-pages.yml`)

## Local usage

```bash
npm run build:data
```

This updates `public/data/latest.json`.

## Deploy for free

1. Create a GitHub repo and push this folder.
2. Set the default branch to `main`.
3. In repo settings, enable GitHub Pages with GitHub Actions.
4. The `Deploy Pages` workflow publishes the `public/` folder.
5. The `Refresh Data` workflow runs daily and pushes updated data.

## Notes

- Data sources are NBA CDN feeds referenced in `scripts/build-data.mjs`.
- The UI always renders the two-column format for desktop and mobile.
- The title area includes a basketball/tank illustration at `public/assets/tank-ball.svg`.
- If a data refresh fails, the previously generated `latest.json` remains in place.
# race-to-the-tank
