# Forme design system

All studio screens share one set of design tokens, defined at the top of `src/styles.css` on `:root`. Use the tokens instead of raw colours or sizes so every screen stays consistent.

## Colour

| Token                                     | Use                                                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| `--brand-700`                             | Primary buttons, current step, selected states             |
| `--brand-800` / `--brand-900`             | Hover and pressed states of brand elements                 |
| `--brand-500`                             | Focus rings, completed steps, small accents                |
| `--brand-50` … `--brand-300`              | Tinted backgrounds, icon tiles, selected-card fills        |
| `--gray-900`                              | Headings and main text                                     |
| `--gray-600` / `--gray-700`               | Secondary text (meets WCAG AA on white and `--gray-50`)    |
| `--gray-500`                              | Hints and captions (lowest colour allowed for text)        |
| `--gray-300` / `--gray-200`               | Input borders / card and divider borders                   |
| `--gray-50`                               | App background                                             |
| `--danger-*`, `--warning-*`, `--info-600` | Errors, warnings and informational accents                 |

`--gray-400` and lighter are for borders, placeholders and icons only, never body text.

## Type

- Body: DM Sans (`--font-body`), 14px base, line height 1.5.
- Headings: Manrope (`--font-display`), weight 700.
- Smallest text is 11px (badges only); captions and hints are 12–13px; body and controls 14px.
- Uppercase labels use 12px, weight 600, letter spacing 0.1–0.12em.

## Shape and depth

- Radius: `--radius-sm` (8px) for buttons and inputs, `--radius-md` (10px) for tiles and inner panels, `--radius-lg` (14px) for cards and dialogs, `--radius-pill` for chips.
- Shadow: `--shadow-xs` on cards and secondary buttons, `--shadow-md` on popovers, `--shadow-lg` on dialogs.
- Controls are `--control-height` (40px) tall; touch targets in dialogs are at least 44px.

## Components

- `.button.primary` for the one main action per area, `.button.secondary` for other actions, `.back-button` for low-emphasis text actions.
- `.card` with a `.card-heading` (32px `.section-icon` tile + 17px heading) for each studio panel.
- Store tool tiles (`.store-tool-links a`) start with a `.tool-icon` (lucide icon, `aria-hidden`), then the name, then a one-line description.
