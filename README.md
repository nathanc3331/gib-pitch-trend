# GIB Pitch Trends

A small static site showing pitch-number habits in the GIB fake baseball league: league-wide trends, a scouting page for each pitcher with a read on their next pitch, and a swing map built from the rulebook's result ranges.

## How it works

- `index.html`, `app.js`, `core.js` are the whole site. No build step.
- `scripts/fetch_data.py` copies the public league sheets (Season 1 and Season 2 PA Logs, the Season 2 player list and parks) into `data/` as CSV.
- `.github/workflows/update-data.yml` runs that script every two hours and commits any change. A download that looks wrong is ignored and the previous copy is kept.

## Setup (once)

1. Repo **Settings → Pages → Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/ (root)`.
2. Repo **Actions** tab: run "Update league data" once (it also runs by itself on the first push).

The site is then at `https://<user>.github.io/<repo>/`.

## New season

Add the new sheet's ID and PA Log tab to `TARGETS` in `scripts/fetch_data.py`, and load the new file in `load()` in `app.js`.

## Limits

Result ranges use batter type + pitcher type + park factors. Fielder adjustments and infield-in are not included. The next-pitch read is a tendency, not a prediction: pitchers can throw any number from 1 to 1000.
