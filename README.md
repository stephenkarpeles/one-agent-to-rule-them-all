# One Agent to Rule Them All

One local Cursor agent takes a marketing brief through five steps. It designs a landing page, writes the page, deploys it to Vercel, reads the traffic, and files a report for you.

The agent is not a script that only writes code. Design, deploy, stats, and the report are tools. Each tool returns a `next` step, and the same campaign slug is the thread between them. A later check-in resumes that same agent, so the report sits on top of the launch instead of starting from zero.

| Step | Who does it | What you get |
| --- | --- | --- |
| Design | `record_design` | `campaigns/<slug>/design.md` |
| Build | the agent's file tools | `campaigns/<slug>/site` |
| Deploy | `deploy_site` | a production URL on Vercel |
| Monitor | `fetch_traffic` | page views, visitors, and breakdowns |
| Report | `write_marketing_report` | `campaigns/<slug>/reports/*.md` |

Shell and subagents are turned off, so the only way to deploy or read stats is those tools.

## Setup

The Cursor SDK needs Node 22.13 or newer. If this shell is older and a newer Node is already installed, `npm run agent` uses that one.

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `CURSOR_API_KEY` from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations)
- `VERCEL_TOKEN` from [Vercel account tokens](https://vercel.com/account/tokens). The token needs permission to create deployments and read Web Analytics.
- `VERCEL_TEAM_ID` or `VERCEL_TEAM_SLUG` when the project belongs to a team. Leave both empty for a personal account.
- `MARKETING_WEBHOOK_URL` is optional. When set, the report is also POSTed as `{"text": "..."}` (Slack incoming webhooks use that shape).

## Launch

```bash
npm run agent -- launch "Landing page for a coffee subscription called Beanline. Dark, editorial, one page, email signup."
```

The run prints the agent id and the run id, then the agent's own text. When it finishes, the reply includes the live URL and the report path. The first report often shows zeros: the page just went live. That is a real measurement.

Turn on Web Analytics for the new project in the Vercel dashboard once. The deploy step already adds the analytics script. Until analytics is on, the report says so and still includes the live URL.

## Check in later

```bash
npm run agent -- report beanline
npm run agent -- list
```

`report` resumes the agent that launched the campaign, pulls a fresh window (from the deploy day through today), and writes a new markdown file. Set `MARKETING_WEBHOOK_URL` if that file should also land in Slack.

## What lives where

```
campaigns/<slug>/design.md
campaigns/<slug>/site/index.html
campaigns/<slug>/campaign.json    # slug, agent id, deployment URL, project id
campaigns/<slug>/latest-stats.json
campaigns/<slug>/reports/
```

`campaign.json` is how a later run finds the project to measure. Generated campaigns stay on your machine (they are gitignored).
