# ZADALOG

Marketing site for **ZADALOG** — an Israeli logistics company specialising in
international freight forwarding and container unloading. Target domain: `zadalog.com`.

Zero dependencies, zero build step: plain HTML, CSS and ES5-safe JavaScript.
Deploy the contents of this folder to any static host.

## Layout

```
index.html          single page, all sections
styles/main.css     design system + every component
scripts/data.js     ports, trade lanes, container specs, cargo presets, copy data
scripts/i18n.js     Hebrew/English dictionary + direction switching (RTL ⇄ LTR)
scripts/worldmap.js dot-matrix world map with animated trade lanes
scripts/planner.js  container load planner + isometric load renderer
scripts/tracking.js track & trace demo (deterministic sample data)
scripts/main.js     navigation, scroll scenes, ticker, carousel, forms
assets/             favicon + Open Graph image
vercel.json         security + cache headers, clean URLs
```

## What is real and what is demo

| Feature | Status |
| --- | --- |
| Container load planner | Real maths. Standard pallet counts follow accepted industry loading figures; everything else uses a two-strip guillotine packing estimate. Presented as an estimate. |
| Track & trace | **Demo.** Generates deterministic sample data from the tracking number. Needs a real carrier/API integration before launch. |
| Ops ticker | **Demo.** Random sample events, labelled as such in the UI. |
| Stats, transit times, testimonials | **Placeholders.** Replace with real figures before launch. |
| Quote form | Opens the visitor's mail client. Swap for a real endpoint (Formspree, Vercel function, CRM) before launch. |

## Before going live — replace these placeholders

- Phone `+972 00-000-0000` — in `index.html` (two links), `scripts/main.js` (WhatsApp).
- Email `info@zadalog.com` — `index.html`, `scripts/main.js`.
- Office address, opening hours — `scripts/i18n.js` (`ctAddrV`, `ctHoursV`).
- Headline stats — `index.html`, the `data-count` attributes in `.hero__stats`.
- Testimonials — `scripts/data.js`, `QUOTES`.
- Transit times and sailing frequencies — `scripts/data.js`, `LANES`.

## Local preview

```bash
npx http-server -p 4321 .
```

## Language

Hebrew is the default (RTL); English is one click away in the header and is stored in
`localStorage`. Every string lives in `scripts/i18n.js` — add a key to both dictionaries
and reference it with `data-i18n="key"`.
