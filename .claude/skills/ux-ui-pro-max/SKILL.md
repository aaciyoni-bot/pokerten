---
name: ux-ui-pro-max
description: Senior-product-designer standard for every UI change in this repo — design tokens before screens, full Hebrew RTL, layered dark mode, subtle motion, responsive from 375px, accessibility, and a self-review checklist before delivery. Load before ANY visual/UI work.
---

# ux-ui-pro-max — design like a senior product designer

## Non-negotiables (in order)
1. **System before screens** — use the design tokens in `:root` (surfaces, text tiers,
   gold/accent/success/danger, radius, spacing, shadows, motion). Never hardcode a new
   color/radius/shadow when a token fits; extend the tokens if one is missing.
2. **Hebrew RTL first-class** — fonts: Heebo (UI), Rubik (numerics/chips), Frank Ruhl
   Libre (display moments). Hebrew text flows RTL; numbers/cards/amounts pinned LTR
   with `dir="ltr"`. Mixed lines must be tested both ways.
3. **Layered dark mode** — depth via elevation surfaces (--surface-0..3), never flat
   black; glass panels + soft shadows for hierarchy.
4. **Motion is seasoning** — 140ms fast / 320ms slow with the standard easing; nothing
   bounces unless it's a win moment. Honor `prefers-reduced-motion`.
5. **Responsive from 375px** — every new element checked at 375px width first, then up.
   Wide content scrolls inside its own container, never the page.
6. **Accessibility** — tap targets ≥44px, focus-visible ring (gold), text contrast
   ≥4.5:1 for body text, state never conveyed by color alone.
7. **Components** — prefer refined primitives already in the file (glass-panel, pills,
   btn-*); pull 21st.dev components when a richer primitive is warranted (code word: ראובן).

## Self-review checklist — run BEFORE every delivery
- [ ] Uses tokens only (no stray hex/px where a token exists)
- [ ] Verified at 375px, 428px, tablet
- [ ] RTL: Hebrew strings render right-to-left; numbers/cards forced LTR
- [ ] Dark layers read correctly (elevation visible, no flat black slabs)
- [ ] Motion subtle, reduced-motion respected
- [ ] Tap targets ≥44px, focus-visible works, contrast checked
- [ ] Nothing overlaps cards, chips, or names on ANY seat layout (2-9 players)
- [ ] Compiled build loads in a browser without console errors (smoke test)
