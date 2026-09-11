# Better Price Finder

A Chrome extension that watches the page you're on, figures out if it's a
product, and gives you one-click links to check the price elsewhere.

## Install it (unpacked)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension from this folder).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `price-checker` folder.
5. Visit any product page (Amazon, a shop's product detail page, etc.). A
   small card will appear in the bottom-right corner within a few seconds.

## How it works

- `content.js` looks for structured product data on the page (schema.org
  JSON-LD `Product`/`Offer`, Open Graph/meta price tags, and common price
  selectors like Amazon's price block) to pull out a title and price. It
  deliberately skips header/nav/footer content so it doesn't grab the site
  name instead of the actual product, and retries a few times since some
  storefronts render the product client-side after the initial page load.
- It sends the extracted title to the background service worker, which
  builds ready-made search links for it — no external API or network
  request involved.
- The links show up both as a floating card on the page and in the popup
  you get from clicking the toolbar icon.

## What you get

For any detected product, one click each on:

- Google Shopping
- Amazon
- Walmart
- eBay
- Target

...all pre-filled with the product name, so you can compare prices in a
couple of clicks.

## Files

- `manifest.json` — extension configuration (Manifest V3)
- `content.js` / `content.css` — runs on every page, extracts product data,
  renders the on-page card
- `background.js` — service worker: builds the search links, caches the
  result per tab
- `popup.html` / `popup.js` / `popup.css` — toolbar popup UI
- `icons/` — toolbar/extension icons

## Limitations

- Price extraction is heuristic. Sites without structured data or standard
  meta tags may not be detected, or may extract the wrong price on complex
  pages (e.g. pages listing many products/prices at once).
- This doesn't automatically tell you *whether* the item is actually
  cheaper elsewhere — it gives you fast, pre-filled links so you can check
  yourself. There's no free, key-less API for real-time cross-retailer
  price data; anything that promises fully automatic comparison without any
  setup is either scraping search results (fragile, and against most
  sites' terms of service) or relying on a paid API behind the scenes.
