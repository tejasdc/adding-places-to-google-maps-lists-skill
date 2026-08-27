---
name: adding-places-to-google-maps-lists
description: Adds places to native Google Maps Saved Lists with notes using local browser automation. Use when the user asks to create or update a Google Maps list, save recommended places, process Maps links, HTML place lists, videos, transcripts, or recommendation roundups into a list that appears in the regular Google Maps app.
---

# Adding Places To Google Maps Lists

## Quick Start

Use the user's local signed-in browser to add places to a native Google Maps Saved List. Do not use Google My Maps unless the user explicitly asks for a custom map instead of a Saved List.

Default flow:

1. Build or identify the source list of places.
2. Open each supplied Google Maps link, or resolve a link only when none is supplied.
3. Verify the Maps place matches the intended business.
4. Save the place into the exact target Saved List.
5. Add the user-provided note for that place.
6. Verify the final list count, duplicates, notes, and failures.

## Core Rule

Native Google Maps Saved Lists are a UI-only write path for this workflow. Do not use private Google Maps endpoints, copied cookies, Google My Maps, or Google Takeout imports as substitutes for saving to the user's actual Maps list.

## Inputs

Accept any of these as source material:

- HTML files containing Google Maps links or buttons.
- A plain list of Google Maps URLs.
- A manifest JSON file with places and notes.
- Video/audio/transcript recommendations that must first be transcribed and extracted.
- Articles or pages containing place recommendations.

When the source already contains Google Maps URLs, treat those URLs as authoritative. Do not search Google for the places unless a link is missing, broken, or clearly points to the wrong location.

For messy inputs, normalize into a working manifest before opening Google Maps:

```json
{
  "list_name": "Japanese Fashion NYC",
  "description": "Japanese menswear, technical outerwear, denim specialists, material-focused studios, and design-forward boutiques in New York City.",
  "places": [
    {
      "name": "Blue in Green",
      "address_hint": "New York, NY",
      "maps_url": "https://maps.google.com/...",
      "note": "Japanese denim specialist. Look for raw denim and Kapital."
    }
  ]
}
```

The manifest is an audit checklist, not a Google Maps import format. If a clean HTML file already contains every Maps URL and note, the HTML can function as the manifest.

## Browser Requirements

Use the local laptop browser flow by default.

- Prefer the user's current signed-in Chrome browser automation tools when available.
- Do not set up a remote-box browser profile unless the user explicitly asks.
- Do not copy Google account cookies between machines.
- Stop if Google asks for login, two-factor authentication, CAPTCHA, or new permissions.
- Let the user complete security prompts manually; never attempt to bypass them.

## Saved List Rules

- Use a native Google Maps Saved List, not Google My Maps.
- Reuse an existing list when the exact list name already exists.
- Create the list only if the exact name does not exist.
- Make new lists Private unless the user specifies another visibility.
- Set the list description when provided.
- Do not delete places.
- Do not modify any list other than the target list.
- Do not unsave a place from other lists.

If the Save dialog does not expose description editing during creation, create the list first, then open the list page and set the description there.

## Per-Place Workflow

For each place:

1. Open the supplied Google Maps URL.
2. Wait until the Maps place page fully loads.
3. Verify the displayed business name and street address against the source.
4. If Maps shows a search results page, choose the result only when name and address clearly match.
5. Click `Save`.
6. Select or create the exact target list.
7. Confirm the place is saved in the target list.
8. Open the saved-place list/details UI for that place.
9. Add the note exactly as intended, lightly cleaned only for clarity.
10. Wait for the note to persist before moving on.
11. Mark the place completed in your working checklist.

## Matching Rules

Save only when the match is clear.

Clear match signals:

- Same or near-identical business name.
- Same street address or same storefront shown in Maps.
- Same city/neighborhood when the source is city-specific.
- Known harmless display-name variants, such as punctuation, legal suffixes, or alternate-language brand names.

Stop and report instead of saving when:

- The address differs materially.
- Maps redirects to a different business.
- Multiple plausible locations exist.
- The source name is generic and no address hint exists.
- The place appears permanently closed and the source did not expect that.

## Notes

If the user provides notes, dishes, shopping targets, reasons to go, or "look for" details, add them to the Google Maps saved-place note field.

Good note shape:

```text
Technical outerwear and Japanese menswear boutique. Look for: rainwear, bags, and material-focused accessories.
```

Rules:

- Do not drop notes unless the user explicitly says notes are unnecessary.
- Preserve specific dishes, items, creator recommendations, and "look for" details.
- Keep notes concise enough to be useful inside Google Maps.
- If a note field cannot be found, stop and report rather than pretending notes were added.

## Verification

After all places are processed:

1. Open the target Google Maps Saved List.
2. Confirm the list name is exact.
3. Confirm visibility is Private unless otherwise requested.
4. Confirm the description is present when provided.
5. Count the saved places.
6. Check for duplicate visible entries.
7. Confirm every source place appears exactly once.
8. Spot-check notes, and fully verify notes when the list is small enough.

Final report:

```text
Total saved: N
Duplicates: none / list them
Failures: none / list them
Unmatched: none / list them
Notes: verified / partially verified with reason
```

## Failure Policy

Stop and ask the user when encountering:

- Login, two-factor authentication, CAPTCHA, or permission prompts.
- Ambiguous place matches.
- Missing note fields when notes are required.
- Google Maps UI changes that make the save/list/note state uncertain.
- Any action that would delete, unsave, merge, or modify unrelated list data.

Do not continue with "best effort" saves if correctness is uncertain. A wrong saved place is worse than a reported failure.
