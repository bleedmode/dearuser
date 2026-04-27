---
title: "Why we built Dear User"
description: "This year you'll spend more hours with an AI agent than with most people in your life. We wanted to know what that relationship actually looked like — so we built a mirror."
pubDate: 2026-04-29
author: "Jarl Rosenlykke"
---

A little over a year ago, I started noticing something odd about my own calendar. I was spending more hours with Claude than with most people in my life. Not in a sad way — in a _what is this, exactly?_ way. It's a new kind of relationship, and nobody has taught us how to think about it yet.

We measure everything else that matters. Sleep. Steps. Focus time. Time-to-first-response in a Slack channel. Whether our partner felt heard this week. Whether a meeting was a good use of everyone's time.

But the thing I spend the most hours on — the thing that writes code with me, drafts my emails, runs my scheduled jobs, remembers what I asked it last week — I had no mirror for. No sense of whether it was going well. No way to tell if the friction I was feeling was _my_ setup or just how this stuff is.

So we built one.

## The problem with asking Claude about itself

The obvious thing to try first is just asking the agent. _"How am I doing at this?"_ It's not a bad answer. Claude will happily scan your files and tell you things it notices.

But a conversation forgets. You can ask once, get a thoughtful paragraph back, and by the time you've made the fix and the conversation has compacted, there's no record. You can't compare this week to last week. You can't tell if the score is moving.

And Claude, being polite, is not the toughest auditor in the room. It will not, unprompted, tell you that the API key you pasted into a memory file three months ago is still sitting there in plaintext. It will not flag that two of your skills are fighting each other. It will not notice that the scheduled task you set up in January hasn't fired since February.

We wanted something that _did_.

## What Dear User actually does

Dear User is an MCP server you install into Claude Code (or Claude Desktop, or Cursor, or any client that speaks MCP). Once it's there, your agent has five new tools — and the only one you'll use on day one is `collab`.

You ask your agent: _"How's my setup going?"_ And it runs the scan, reads the result, and writes you a letter back. In your agent's voice. About your setup.

> **Dear Sam,**
>
> I read through your configuration tonight. Three things — one that makes me glad, one I'm puzzled by, and one concrete change for tomorrow.
>
> You've been correcting me about response length four or five times this week — always _"keep it shorter"_. Want me to remember that for you, so you don't have to say it again?

That's the tone. Not a checklist. Not a severity matrix. A letter.

Under the hood, there are three scans:

- **Collab** looks at how you and your agent actually work together. It scores seven categories — role clarity, communication, autonomy balance, quality standards, memory health, system maturity, coverage — and surfaces the patterns you keep repeating by hand that could just be a rule.
- **Security** looks for twelve kinds of leaked secrets across your config, memory and skills. It also pulls real warnings from GitHub, Supabase, npm and Vercel if you've set up the tokens for those — so you see actual CVE advisories, not pattern-matching in prose.
- **Health** looks at structural drift: skills nothing calls, scheduled jobs writing to files nothing reads, rules that contradict each other even when they don't share keywords.

Three scores at the top. A handful of findings underneath. Recommendations you can act on tomorrow morning. Run it again next week and watch the score move.

## A couple of principles we didn't compromise on

**Local-first.** Your agent contract, your memory, your skills, your session metadata — all of it is read, none of it is uploaded. The only things that leave your machine are the ones you explicitly click: your Wrapped card (anonymized before upload, if you want a shareable link) and any feedback you type into the feedback tool. No telemetry, no background sync, no "we promise we won't look at it."

**The score is you vs. you.** We calibrated against two studies: 988 public Claude Code setups with full substrate committed (median 32/100, max 63) and 2,895 standalone `CLAUDE.md` files (median 18, max 60). Most setups have a lot of room to move up. Your first scan will likely be lower than you expect — that's normal. The point is the trend, not the absolute number.

**The agent asks before it changes anything.** Every recommendation sits as "pending" until you say yes via `implement_recommendation`. Dear User cannot edit your files, make commits, or push anything on its own. You always see a reviewable change first.

**MIT, and staying MIT.** Everything in the repo is MIT-licensed, and the core will remain MIT-licensed. If we ever build team or hosted features, they'll live in a separate repo — never by pulling pieces out of this one.

## What happens next

If you want to try it:

```bash
claude mcp add dearuser -- npx @poisedhq/dearuser-mcp
```

Then, in any Claude Code session, just ask:

> _Run Dear User on my setup._

You'll get a letter back. Read it. Fix one thing. Run it again next week.

If the letter is wrong, or the score feels off, or a recommendation is misguided — send us feedback straight from inside the tool. We read every one personally. At launch there is no support queue; there's just us.

Dear User is free. It's open source. It runs on your machine. We built it because we wanted to know how we were doing.

Now we're curious about you.

---

_[Install guide](/#install) · [Example letter](/example) · [GitHub](https://github.com/bleedmode/dearuser) · [Send feedback](/feedback)_
