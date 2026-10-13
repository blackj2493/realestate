# Insight queue

One file per post. The content routine (see `../ROUTINE.md`) drafts the file whose
`post_on:` date is the day after it runs. Posts go out Wednesday and Friday, 9–11 a.m.
Toronto time.

Each file starts with these fields:

```
post_on: YYYY-MM-DD
subreddit: r/...
callback_url: https://www.pureproperty.ca/...?utm_source=reddit&utm_medium=social&utm_campaign=<slug>
status: ready
```

Then the figures (verbatim, aggregate only, each with its sample), the method, the
caveats, the prior art, and a draft if one exists.

**How a file gets here:** a person or an analysis session computes the figures from
the sold and lease data (read-only), checks them, and commits the file. The routine
cannot query the database, so it uses only the figures written here.

**No file for a post day?** The routine falls back to `../data/latest.json` and skips
any angle it drafted in the last four runs.
