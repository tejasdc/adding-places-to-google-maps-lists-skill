#!/usr/bin/env node
// The one way to build Tejas's native Google Maps Saved Lists from a manifest.
//
//   node maps-list.mjs lists                         every list with its emoji, visibility, count
//   node maps-list.mjs check <manifest.json>         validate only (fills product facts, checks emoji)
//   node maps-list.mjs build <manifest.json>         create/reuse the list, set its emoji and
//                                                    description, save every place, write notes,
//                                                    mirror product lists to thnkr.ing, verify
//
// Runs on the server against the always-running signed-in ChatGPT Chrome (CDP 127.0.0.1:9333) in a
// tab of its own, opened and closed by this run, so two agents never steer each other's tab.
// Never unsaves, never deletes, never touches another list. Manifest shape and kinds: ../SKILL.md
// and list-kinds.json beside this file.
import {readFileSync} from 'node:fs';
import http from 'node:http';
import {chromium} from '/srv/thinkering/current/node_modules/playwright/index.mjs';

const KINDS = JSON.parse(readFileSync(new URL('./list-kinds.json', import.meta.url), 'utf8'));
const CDP = 'http://127.0.0.1:9333';
const THINKERING_SOCKET = process.env.THINKERING_SOCKET ?? '/run/thinkering/session-capabilities.sock';
const AGENT = process.env.CONCIERGE_SESSION_ID ?? process.env.CONCIERGE_AGENT_SOURCE ?? 'maps-list-script';
const ANY_PLACE = 'https://www.google.com/maps/search/?api=1&query=Bryant+Park+New+York';
const NOTE_WARN_LENGTH = 1500;

const log = (event) => console.log(JSON.stringify(event));
const sameEmoji = (a, b) => a && b && a.replace(/️/g, '') === b.replace(/️/g, '');
class Refused extends Error {}
// Throws so the run's own Maps tab is still closed by withMapsTab.
const fail = (message) => { throw new Refused(message); };

// ---------- manifest ----------

async function productFacts(url) {
  const headers = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US'};
  try { // Shopify stores answer <product>.json
    const response = await fetch(url.split('?')[0] + '.json', {headers});
    if (response.ok) {
      const {product} = await response.json();
      return {price: product.variants?.[0]?.price && `$${product.variants[0].price}`, image: product.image?.src ?? product.images?.[0]?.src};
    }
  } catch {}
  try {
    const page = await (await fetch(url, {headers})).text();
    const tag = (name) => page.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)`))?.[1];
    const amount = tag('product:price:amount') ?? tag('og:price:amount');
    return {price: amount && `$${amount}`, image: tag('og:image')};
  } catch { return {}; }
}

async function loadManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const problems = [];
  if (!manifest.list) problems.push('list (the exact Google Maps list name) is required');
  if (!manifest.emoji) problems.push('emoji is required: every list gets one so it never blends in with his other lists on the map');
  const kind = KINDS[manifest.kind];
  if (!kind) problems.push(`kind must be one of ${Object.keys(KINDS).filter((k) => !k.startsWith('_')).join(', ')}`);
  if (!manifest.places?.length) problems.push('places must list at least one place');
  if (problems.length) fail(problems.join('; '));
  for (const place of manifest.places) {
    const label = place.name ?? place.query ?? '(unnamed place)';
    if (!place.name) problems.push(`${label}: name is required`);
    if (!place.maps_url && !place.query) problems.push(`${label}: maps_url or query (name + street address) is required`);
    for (const field of kind.place_requires) if (!place[field] || (Array.isArray(place[field]) && !place[field].length)) problems.push(`${label}: ${field} is required for a ${manifest.kind} list`);
    for (const product of place.products ?? []) {
      if (product.url && (!product.price || !product.image)) Object.assign(product, Object.fromEntries(Object.entries(await productFacts(product.url)).filter(([key, value]) => value && !product[key])));
      for (const field of kind.product_requires ?? []) if (!product[field]) problems.push(`${label} / ${product.name ?? product.url ?? 'product'}: ${field} is required${field === 'url' ? '' : ' (not found on the product page; supply it)'}`);
    }
  }
  if (problems.length) fail(problems.join('; '));
  return {manifest, kind};
}

function noteFor(place, kind, researchUrl) {
  const lines = [];
  for (const field of kind.note_lines) {
    const value = place[field];
    if (!value) continue;
    if (field === 'products') for (const product of value) lines.push(`• ${product.name} — ${product.price} — ${product.url}`);
    else if (field === 'why') lines.push(value);
    else lines.push(`${field === 'price_range' ? 'Price' : field[0].toUpperCase() + field.slice(1)}: ${value}`);
  }
  if (researchUrl) lines.push(`Photos and details: ${researchUrl}`);
  return lines.join('\n');
}

// ---------- thnkr.ing research list (products: link, price, image shown with a picture) ----------

function thinkering(method, path, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({socketPath: THINKERING_SOCKET, path, method, headers: {'Content-Type': 'application/json', 'X-Concierge-Agent-Source': AGENT, 'X-Agent-Why': 'Google Maps list build (adding-places-to-google-maps-lists skill)'}}, (response) => {
      let text = ''; response.on('data', (chunk) => text += chunk);
      response.on('end', () => response.statusCode < 300 ? resolve(text ? JSON.parse(text) : {}) : reject(new Error(`${method} ${path} ${response.statusCode}: ${text.slice(0, 300)}`)));
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function mirrorToResearchList(manifest) {
  const name = manifest.research_list_name ?? manifest.list;
  const created = await thinkering('POST', '/lists/research', {name, mapsList: manifest.list, emoji: manifest.emoji});
  const listId = created.listId ?? created.id;
  const placeIds = new Map();
  for (const place of manifest.places) for (const product of place.products ?? []) {
    const result = await thinkering('POST', '/lists/research/options', {
      list: listId, title: product.name, link: product.url, price: product.price, image: product.image, kind: 'product',
      why: [product.price, product.why ?? place.why].filter(Boolean).join('. '),
      places: [{name: place.name, link: place.maps_url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.query)}`}],
    });
    placeIds.set(place, [...(placeIds.get(place) ?? []), ...(result.placeIds ?? [])]);
  }
  log({step: 'research-list', listId, url: `https://thnkr.ing/lists?list=${encodeURIComponent(listId)}`});
  return {listId, url: `https://thnkr.ing/lists?list=${encodeURIComponent(listId)}`, placeIds};
}

// ---------- Google Maps ----------

const emojiFromImage = (src) => src?.match(/notoemoji\/[^/]+\/([0-9a-f_]+)\//)?.[1].split('_').map((hex) => String.fromCodePoint(parseInt(hex, 16))).join('');

async function openPlace(page, url) {
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.locator('[role=main] h1').first().waitFor({timeout: 30000}).catch(() => {});
  await page.waitForTimeout(2500);
}

async function readSaveMenu(page) {
  await page.locator('[aria-label^="Actions for"] button[aria-label^="Save"]').first().click();
  const menu = page.getByRole('menu', {name: 'Save in your lists'});
  await menu.waitFor({timeout: 10000});
  return menu.getByRole('menuitemradio').evaluateAll((items) => items.map((item) => ({
    name: item.querySelector('.mLuXec')?.innerText.trim() ?? item.innerText.split('\n').map((line) => line.trim()).filter(Boolean)[0],
    detail: item.querySelector('.fontBodySmall')?.innerText.trim(),
    emojiImage: item.querySelector('img')?.src ?? null,
    checked: item.getAttribute('aria-checked') === 'true',
  })));
}

async function listsWithEmoji(page) {
  const items = await readSaveMenu(page);
  await page.keyboard.press('Escape');
  return items.map(({name, detail, emojiImage}) => ({name, emoji: emojiFromImage(emojiImage) ?? null, detail}));
}

async function pickEmoji(page, emoji) {
  const palette = page.getByRole('dialog', {name: 'Emoji characters palette'});
  await palette.waitFor({timeout: 10000});
  // The palette fills its ~1,750 options in after it opens.
  for (let i = 0; i < 20 && await palette.getByRole('option').count() < 1000; i++) await page.waitForTimeout(500);
  const index = await palette.getByRole('option').evaluateAll((options, wanted) => options.findIndex((option) => (option.getAttribute('aria-label') ?? option.innerText).replace(/️/g, '') === wanted), emoji.replace(/️/g, ''));
  if (index < 0) throw new Error(`Maps' emoji palette has no ${emoji}; pick another`);
  const option = palette.getByRole('option').nth(index);
  await option.scrollIntoViewIfNeeded();
  await option.click();
  await page.waitForTimeout(1500);
}

// mayCreate is true only for the first save into a list that did not exist when the run began:
// Maps' Save menu lags its own writes by seconds, so "not in the menu" right after a create does not
// mean "missing" (2026-11-05: that made a second list with the same name). Later saves wait for it.
async function savePlace(page, place, listName, emoji, mayCreate) {
  const url = place.maps_url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.query)}`;
  await openPlace(page, url);
  if (!await page.locator('[aria-label^="Actions for"]').count()) return {status: 'ambiguous', url: page.url(), note: 'Maps showed results, not one place: supply maps_url'};
  const title = (await page.locator('[role=main] h1').first().innerText()).trim();
  const address = (await page.locator('button[aria-label^="Address:"]').first().getAttribute('aria-label').catch(() => null))?.replace(/^Address:\s*/, '');
  const expected = place.match ?? place.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(expected, 'i').test(title)) return {status: 'mismatch', title, address};
  const savedIn = () => page.getByRole('group', {name: `Saved in ${listName}`, exact: true}).count();
  if (await savedIn()) return {status: 'already', title, address, placeUrl: page.url()};
  let items = await readSaveMenu(page);
  let index = items.findIndex((item) => item.name === listName);
  for (let attempt = 0; index < 0 && !mayCreate && attempt < 12; attempt++) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(5000); await openPlace(page, url);
    items = await readSaveMenu(page); index = items.findIndex((item) => item.name === listName);
  }
  if (index < 0 && !mayCreate) { await page.keyboard.press('Escape'); return {status: 'error', title, address, note: `"${listName}" not in the Save menu after a minute; not creating a second list`}; }
  if (items.filter((item) => item.name === listName).length > 1) { await page.keyboard.press('Escape'); return {status: 'error', title, address, note: `more than one list is named "${listName}"`}; }
  let created = false;
  if (index >= 0) {
    if (items[index].checked) { await page.keyboard.press('Escape'); return {status: 'already', title, address, placeUrl: page.url()}; }
    await page.getByRole('menu', {name: 'Save in your lists'}).getByRole('menuitemradio').nth(index).click();
  } else {
    // 2026-11-05: "New list" opens a dialog with Choose icon, List name and Create.
    await page.getByRole('menu', {name: 'Save in your lists'}).getByRole('button', {name: 'New list'}).click();
    const dialog = page.getByRole('dialog', {name: 'New list'});
    await dialog.waitFor({timeout: 10000});
    await dialog.getByRole('button', {name: 'Choose icon'}).click();
    await pickEmoji(page, emoji);
    const nameBox = dialog.getByRole('textbox', {name: 'List name'});
    await nameBox.click(); await page.keyboard.press('Control+A'); await page.keyboard.type(listName, {delay: 25});
    await dialog.getByRole('button', {name: 'Create'}).click();
    created = true;
  }
  for (let i = 0; i < 30 && !await savedIn(); i++) await page.waitForTimeout(500);
  return {status: await savedIn() ? 'saved' : 'error', title, address, created, placeUrl: page.url()};
}

async function openList(page, listName, knownUrl) {
  if (knownUrl) { await page.goto(knownUrl, {waitUntil: 'domcontentloaded'}); }
  else {
    // Saved (left rail) → Lists → the list.
    await page.goto('https://www.google.com/maps', {waitUntil: 'domcontentloaded'});
    await page.getByRole('list').getByRole('button', {name: 'Saved', exact: true}).click({timeout: 20000});
    await page.waitForTimeout(3000);
    await page.getByRole('button', {name: new RegExp(`^${listName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)}).first().click({timeout: 15000});
  }
  await page.getByRole('textbox', {name: 'List description'}).waitFor({timeout: 30000});
  await page.waitForTimeout(3000);
  const heading = (await page.locator('[role=main] h1').first().innerText()).trim();
  if (heading !== listName) throw new Error(`opened list "${heading}", expected "${listName}"`);
  return page.url();
}

async function listState(page) {
  return page.evaluate(() => {
    const main = document.querySelector('[role=main]');
    const iconButton = main.querySelector('button[aria-label="Choose icon"], button[aria-label="Edit icon"]');
    const rows = [...main.querySelectorAll('textarea[aria-label="Note"]')].map((box) => {
      let row = box; for (let i = 0; i < 8 && row; i++) { row = row.parentElement; if (row.querySelector('button[aria-label="Delete"]') && row.innerText.length < 2000) break; }
      return {name: row.innerText.split('\n')[0].trim(), note: box.value};
    });
    return {
      summary: main.querySelector('h2')?.innerText.trim(),
      iconLabel: iconButton?.getAttribute('aria-label'),
      iconImage: iconButton?.querySelector('img')?.src ?? null,
      iconText: iconButton?.innerText.trim() ?? null,
      description: main.querySelector('textarea[aria-label="List description"], [aria-label="List description"]')?.value ?? null,
      rows,
    };
  });
}

async function typeInto(page, locator, text) {
  await locator.scrollIntoViewIfNeeded(); await locator.click();
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
  await page.keyboard.type(text, {delay: 12});
  await page.keyboard.press('Tab'); await page.waitForTimeout(7000); // notes set with fill() did not persist (2026-07-19)
}

async function writeNote(page, rowName, note) {
  const state = await listState(page);
  const matches = state.rows.map((row, index) => ({...row, index})).filter((row) => row.name === rowName);
  if (matches.length !== 1) return {name: rowName, error: `expected one row, found ${matches.length}`};
  if (matches[0].note === note) return {name: rowName, status: 'unchanged'};
  const box = page.locator('[role=main] textarea[aria-label="Note"]').nth(matches[0].index);
  if (!await box.isVisible()) await page.evaluate((i) => {
    let row = document.querySelectorAll('[role=main] textarea[aria-label="Note"]')[i];
    for (let k = 0; k < 8 && row; k++) { row = row.parentElement; if (row.querySelector('button[aria-label="Delete"]') && row.innerText.length < 2000) break; }
    row.scrollIntoView(); row.querySelector('button[aria-label="Add note"]')?.click();
  }, matches[0].index);
  await box.waitFor({state: 'visible', timeout: 10000});
  await typeInto(page, box, note);
  const typed = await box.inputValue();
  return typed === note ? {name: rowName, status: 'typed'} : {name: rowName, error: 'the note box held something else after typing', typed};
}

// ---------- commands ----------

async function withMapsTab(work) {
  const browser = await chromium.connectOverCDP(CDP);
  const page = await browser.contexts()[0].newPage();
  try { return await work(page); }
  finally { await page.close().catch(() => {}); await browser.close().catch(() => {}); }
}

async function build(path, {dryRun}) {
  const {manifest, kind} = await loadManifest(path);
  return withMapsTab(async (page) => {
    await openPlace(page, ANY_PLACE);
    const lists = await listsWithEmoji(page);
    const target = lists.find((list) => list.name === manifest.list);
    const clash = lists.find((list) => list.name !== manifest.list && sameEmoji(list.emoji, manifest.emoji));
    if (clash) fail(`${manifest.emoji} is already the icon of "${clash.name}"; choose an emoji no other list uses. In use: ${lists.filter((l) => l.emoji).map((l) => `${l.emoji} ${l.name}`).join(', ')}`);
    log({step: 'plan', list: manifest.list, exists: Boolean(target), currentEmoji: target?.emoji ?? null, emoji: manifest.emoji, kind: manifest.kind, places: manifest.places.length});
    if (dryRun) { for (const place of manifest.places) log({place: place.name, note: noteFor(place, kind, kind.research_list ? '<thnkr.ing list link>' : null)}); return; }

    const research = kind.research_list && manifest.research_list !== false ? await mirrorToResearchList(manifest) : null;

    if (lists.filter((list) => list.name === manifest.list).length > 1) fail(`more than one list is named "${manifest.list}"; tell Tejas which to keep before adding to either`);
    const results = [];
    let createdThisRun = false;
    for (const place of manifest.places) {
      const result = await savePlace(page, place, manifest.list, manifest.emoji, !target && !createdThisRun);
      createdThisRun ||= Boolean(result.created);
      log({place: place.name, ...result});
      results.push({place, result});
    }
    const saved = results.filter(({result}) => ['saved', 'already'].includes(result.status));

    const listUrl = await openList(page, manifest.list, manifest.list_url);
    log({step: 'list', url: listUrl});
    let state = await listState(page);
    const listEmoji = emojiFromImage(state.iconImage) ?? (state.iconText || null);
    if (state.iconLabel === 'Choose icon' || (manifest.replace_emoji && !sameEmoji(listEmoji, manifest.emoji))) {
      await page.locator('[role=main]').getByRole('button', {name: /^(Choose|Edit) icon$/}).first().click();
      await pickEmoji(page, manifest.emoji);
      log({step: 'emoji', set: manifest.emoji});
    } else if (!sameEmoji(listEmoji, manifest.emoji)) log({step: 'emoji', kept: listEmoji, note: 'list already had an icon; pass replace_emoji: true to change it'});
    if (manifest.description && state.description !== manifest.description) {
      await typeInto(page, page.getByRole('textbox', {name: 'List description'}), manifest.description);
      log({step: 'description', set: true});
    }

    // Saving the description re-renders the list; start the notes from a fresh load.
    await openList(page, manifest.list, listUrl);
    for (const {place, result} of saved) {
      const note = noteFor(place, kind, research?.url);
      if (note.length > NOTE_WARN_LENGTH) log({place: place.name, warning: `note is ${note.length} characters; Maps notes this long are hard to read`});
      log(await writeNote(page, result.title, note));
    }

    if (research) {
      const ids = saved.flatMap(({place}) => research.placeIds.get(place) ?? []);
      if (ids.length) await thinkering('POST', '/lists/research/maps-saved', {places: ids, mapsList: manifest.list}).catch((error) => log({step: 'research-maps-saved', error: error.message}));
    }

    await openList(page, manifest.list, listUrl);
    state = await listState(page);
    const finalEmoji = emojiFromImage(state.iconImage) ?? (state.iconText || null);
    const notes = saved.map(({place, result}) => {
      const row = state.rows.filter((r) => r.name === result.title);
      return {name: result.title, rows: row.length, noteVerified: row[0]?.note === noteFor(place, kind, research?.url)};
    });
    const report = {
      status: 'done', list: manifest.list, url: listUrl, summary: state.summary, emoji: finalEmoji,
      emojiVerified: sameEmoji(finalEmoji, manifest.emoji) || undefined,
      descriptionVerified: manifest.description ? state.description === manifest.description : undefined,
      saved: saved.length, failures: results.filter(({result}) => !['saved', 'already'].includes(result.status)).map(({place, result}) => ({place: place.name, ...result})),
      duplicates: notes.filter((n) => n.rows > 1).map((n) => n.name), notes, research: research?.url,
    };
    log(report);
    if (report.failures.length || notes.some((n) => !n.noteVerified) || !report.emojiVerified) process.exitCode = 1;
  });
}

const [command, path] = process.argv.slice(2);
try {
  if (command === 'lists') await withMapsTab(async (page) => { await openPlace(page, ANY_PLACE); for (const list of await listsWithEmoji(page)) log(list); });
  else if (command === 'check' && path) { const {manifest, kind} = await loadManifest(path); log({status: 'valid', list: manifest.list, emoji: manifest.emoji, kind: manifest.kind}); for (const place of manifest.places) log({place: place.name, note: noteFor(place, kind, kind.research_list ? '<thnkr.ing list link>' : null)}); }
  else if (command === 'build' && path) await build(path, {dryRun: process.argv.includes('--dry-run')});
  else { console.error('usage: maps-list.mjs lists | check <manifest.json> | build <manifest.json> [--dry-run]'); process.exitCode = 2; }
} catch (error) {
  if (!(error instanceof Refused)) throw error;
  log({status: 'refused', message: error.message}); process.exitCode = 2;
}
