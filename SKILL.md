---
name: adding-places-to-google-maps-lists
description: The one way to create or update Tejas's native Google Maps Saved Lists — a manifest (list name, emoji, kind, places with the content that kind needs) run through one server script that creates the list with its own emoji icon, saves every place, writes notes with links and prices, mirrors product lists into a thnkr.ing research list with photos, and verifies. Use when asked to make a Maps list, save recommended places, turn Maps links, HTML place lists, videos, transcripts or roundups into a list in the regular Google Maps app, when he asks "who made this list", says a list has no links, images or prices, says lists blend together on his map or need an icon or emoji, or asks why an agent is using his Chrome on the Mac for Maps.
---

# Adding Places To Google Maps Lists

Tejas, 2026-11-05 [decision: maps-lists-one-formal-path-emoji-rich-content]: "make sure the whole process is formalized … an easy script that people can run
to quickly create these things and add them to my Google Maps list. And when they are creating new
lists, make sure you add an appropriate icon or emoji for it, so it doesn't … get confused with other
lists … You literally recommend me bags and don't give me a link to find out how it looks … Lists
should show dynamic content … a good image … price … different kinds of lists will have different
kinds of content."

So: **one manifest, one script, on the server.** Do not drive the Maps page by hand, do not write
your own Playwright, and do not use Google My Maps, private Maps endpoints, copied cookies or
Takeout. If the script cannot do something you need, fix the script here and commit it.

## Quick start

```bash
S=~/workspace/skills/adding-places-to-google-maps-lists-skill/scripts
node $S/maps-list.mjs lists                       # his lists with their emoji; pick an unused one
node $S/maps-list.mjs check manifest.json         # validates; fills product price/image; prints each note
node $S/maps-list.mjs build manifest.json         # does everything below and prints a verified report
```

Set `CONCIERGE_AGENT_SOURCE=<your session id>` so the thnkr.ing list records who built it. Keep the
manifest in your project's `tmp/` (or commit it beside the research it came from).

`build` runs on the server against the always-running ChatGPT Chrome (CDP `127.0.0.1:9333`), which
has Chrome's own Google sign-in to the account that owns his lists. Every run opens **a tab of its
own** and closes only that tab, so two agents never steer each other (2026-11-05: the old scripts
shared the first Maps tab and two sessions navigated each other's runs). It:

1. Refuses a manifest without an emoji, without the fields its kind needs, or whose emoji is already
   another list's icon (it prints every emoji in use).
2. For a `products` list, creates or reuses a thnkr.ing research list of the same name (linked to the
   Maps list), one option per product with its link, price and image.
3. Saves each place, after checking the Maps title matches. A new list is created from the first
   place through Maps' New list dialog with its **emoji icon and name set at creation**, Private.
   Later places wait for the new list to appear in Maps' Save menu (it lags writes by seconds) and
   never create a second list.
4. Sets the list's emoji if it has none (keeps an existing one unless `"replace_emoji": true`) and
   its description.
5. Writes each place's note from its kind (below), types it with real keystrokes, and checks it.
6. Marks the thnkr.ing places saved, reloads the list and reports count, emoji, description,
   duplicates, failures and `noteVerified` per place. Exit code 1 means something did not verify.

Never unsaves, never deletes, never touches another list. Rerunning the same manifest is safe:
saved places are left alone and unchanged notes are skipped.

## The manifest

```json
{
  "list": "Japanese stationery NYC",
  "emoji": "✒️",
  "kind": "products",
  "description": "Japanese notebooks and pens to pick up in Midtown.",
  "places": [
    {
      "name": "Kinokuniya New York",
      "query": "Kinokuniya 1073 6th Ave New York",
      "why": "Stationery is in the basement: the widest Japanese notebook and pen wall in the city.",
      "products": [
        {"name": "Hobonichi Techo 2027 (English, A6 daily)", "url": "https://usa.kinokuniya.com/products/4580812710381"}
      ]
    }
  ]
}
```

- `list`: exact name. An existing list with that name is reused; two lists with the name is refused.
- `emoji`: required, one that fits the subject and no other list uses (🍜 not 📍; ✒️ for stationery,
  👜 bags). Run `lists` first. It shows on his map in place of the default pin, which is the point.
- `kind`: one of the kinds in `scripts/list-kinds.json`. Add a kind there when a new sort of list
  needs different content; don't special-case it in the script.
- Each place: `name`, and `maps_url` (authoritative when the source supplied one) or `query`
  (name + street address). Add `match` (a regex) when Maps' title differs from `name`.

### What each kind carries

| Kind | Use for | Each place needs | Note on the place |
| --- | --- | --- | --- |
| `products` | shops you go to for specific things: bags, stationery, clothes, gear | `why`, `products[]` each with `name`, `url`, `price`, `image` | why, then one line per product: name — price — link, then a link to the thnkr.ing list with photos |
| `food` | restaurants, cafes, bakeries, bars | `why`, `order` (what to get); optional `price_range`, `book`, `link` | why, Order:, Price:, Book:, Link: |
| `places` | anything else: sights, parks, galleries, shops browsed for themselves | `why`; optional `tip`, `link` | why, Tip:, Link: |

For products, `check`/`build` fill a missing `price` and `image` from the product page (Shopify
`<url>.json`, else the page's `og:` tags) and refuse when they still can't be found; supply them by
hand then. **A product recommendation without a link to the item is not done.**

Why the photos live in thnkr.ing: Maps notes are plain text. Verified 2026-11-05 on Maps web: URLs in
a note are not links, and a place page's "Saved in" preview shows only about the first 30
characters, so the most important words go first. Whether the iPhone Maps app makes them tappable
is unchecked. Images cannot go in a Maps note at all, so a product list's thnkr.ing research list
(thinkering `docs/architecture/research-lists.md`) holds the picture, price and link, and every Maps
note ends with that list's link.

## Matching rules

Save only when the match is clear: same or near-identical business name, same street address or
storefront, same city. The script returns `mismatch` (title didn't match), `ambiguous` (Maps showed
results, not one place) or `error`; then find the right place URL, put it in `maps_url`, and rerun.
Don't force it. Stop and report instead when the address differs materially, Maps redirects to a
different business, several plausible locations exist, or the place is permanently closed and the
source didn't expect that. A wrong saved place is worse than a reported failure.

## Inputs

HTML files with Maps links, plain Maps URLs, recommendation videos or transcripts (transcribe and
extract first), articles. When the source has Maps URLs, they are authoritative: use them as
`maps_url` instead of searching. Preserve the source's dishes, items, "look for" details and
creator recommendations in `why`/`order`/`tip`.

## When the script breaks

Google changes the Maps page. Look at what it shows with
`node $S/maps-probe.mjs '<maps-url>' '<async JS body using page>'` (its own tab; returns JSON), fix
`maps-list.mjs`, rerun on a real list, commit here and record the pitfall in the Google Maps site
runbook (`website-runbooks` skill, `sites/google.com.md`).

Stop and report (don't work around) when Google asks for a login, two-factor code, CAPTCHA or new
permission in that Chrome: he signs in once over the server desktop (remote-box
`docs/chatgpt-browser.md`). Never attach to his Mac Chrome, copy its profile or cookies between
machines, or take desktop focus. If the server genuinely cannot do the job, record the server
attempt and observed failure in the site runbook and request an isolated background Mac browser
(`sessions ask --peer mac --machine-need browser-fallback:…`); that needs no per-use approval.

## Final report

Give him the list name with its emoji, how many places, the thnkr.ing list link for product lists,
and anything that failed or didn't verify, in plain words.
