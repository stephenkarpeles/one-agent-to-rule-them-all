# One Agent to Rule Them All

You write a short brief. One worker on your computer designs a landing page, builds it, puts it on the internet, and then tells you whether anyone visited.

That matters because the page, the address, and the visit counts stay with the same campaign. The report is about the site that actually went live. If nobody has visited, the report says zero.

## The site

Beanline is the page this project already published. It is a one-page waitlist for a coffee subscription: dark, like a magazine, with one job for the visitor, which is to leave an email address.

It is live at https://beanline-phi.vercel.app.

The page is a real site. Someone can open it. Vercel can count the visits. The reports in `campaigns/beanline/reports/` are about that address.

## The agent

The agent is the worker. You give it a brief, and it stays with that campaign.

It does five things, in order:

1. Writes the design: who the page is for, the colors, and the sections.
2. Builds a simple page, one HTML file and one stylesheet, in `campaigns/<name>/site`.
3. Publishes that folder to Vercel and saves the live address.
4. Asks Vercel how many people viewed the page, and from where.
5. Writes a short report: what went live, what the numbers say, and one next step.

A later check-in uses the same campaign. It measures the page that is already up. It does not redesign the page or publish it again.

The visit counts come from Vercel. Turn on Web Analytics for the project once in the Vercel dashboard. Until that is on, the report says the numbers are missing and still includes the live address.

A job on this computer runs that check-in every day at 9:00 local time, for every campaign. The Mac has to be awake. Each run adds a new report file. The log is `logs/daily-report.log`.

## Setup

This needs Node 22.13 or newer. If the shell is older and a newer Node is already installed, `npm run agent` uses that one.

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `CURSOR_API_KEY` from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations)
- `VERCEL_TOKEN` from [Vercel account tokens](https://vercel.com/account/tokens). The token needs permission to create deployments and read Web Analytics.
- `VERCEL_TEAM_ID` or `VERCEL_TEAM_SLUG` when the project belongs to a team. Leave both empty for a personal account.
- `MARKETING_WEBHOOK_URL` is optional. When set, the report is also sent to that address as `{"text": "..."}`. A Slack incoming webhook uses that shape.

## Launch

```bash
npm run agent -- launch "Landing page for a coffee subscription called Beanline. Dark, editorial, one page, email signup."
```

When it finishes, the reply includes the live address and the path of the report. The first report often shows zeros, because the page just went live. That count is real.

## Check in later

```bash
npm run agent -- report beanline
npm run agent -- list
```

`report` reads traffic from the day the page was published through today, and writes a new markdown file. `list` shows the campaigns on this machine.

The daily job runs `scripts/daily-reports.sh`, which does this for every campaign.

## Where the files are

```
campaigns/<name>/design.md
campaigns/<name>/site/index.html
campaigns/<name>/campaign.json    # name, live address, and the id of the worker
campaigns/<name>/latest-stats.json
campaigns/<name>/reports/
```

`campaign.json` is how a later run finds the right site to measure. Generated campaigns stay on your machine.
