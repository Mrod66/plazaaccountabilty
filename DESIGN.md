# DESIGN.md: Plaza Auto Mall (v1.0)
file: Plaza-Design-System-v1.0.md

This is the design system for internal Plaza Auto Mall tools, starting with the Plaza Accountability Hub. It is drawn from the group's own website (plazaautomall.com): the colors, font and logo it uses today. It is tuned for a working app that managers use all day, not for a marketing page.

Plaza is one group with six stores on Nostrand Avenue in Brooklyn: Acura of Brooklyn, Plaza Honda, Plaza Hyundai, Plaza Kia, Plaza Toyota and Plaza Used Cars. Every screen uses the GROUP look, never a manufacturer's look, because one screen often shows all six stores together.

---

## 1. Personality

- Confident, plainspoken, local. Plaza describes itself as Brooklyn's car destination, "all on one block."
- Clean and businesslike. Flat surfaces, crisp lines, generous white space.
- No gradients, no glossy effects, no decorative photos inside the app.
- Numbers and names are the heroes. Decoration never competes with data.

## 2. Theme

- **ONE light theme only.** White and light-gray surfaces with dark text.
- Do NOT create a dark mode, and do NOT follow the device's dark-mode setting. Staff open these pages on phones set to dark mode, and switching themes makes text unreadable.
- Hard-set every color. Never leave text color to the browser default.

## 3. Colors

### Brand
| Name | Hex | Use |
|---|---|---|
| Plaza Blue | `#3871B6` | Primary buttons, links, active tab, selected filter, key figures. Plaza's own primary color. |
| Plaza Blue Dark | `#2B5A92` | Hover and pressed state for blue buttons and links. |
| Plaza Blue Tint | `#EAF1F9` | Very light background for a selected row or an info note. |
| Plaza Black | `#111111` | The top header bar only (it holds the white logo). Plaza's own header and footer color. |

### Text and surfaces
| Name | Hex | Use |
|---|---|---|
| Ink | `#212529` | Headings, table text, numbers. |
| Body | `#444444` | Paragraphs and labels. Plaza's own body text color. |
| Muted | `#6B6F74` | Helper text, captions, "out of" counts. (Darker than Plaza's `#777777` so it stays readable on phones.) |
| Steel | `#4E5155` | Icons and secondary buttons. Plaza's "highlight" color. |
| Line | `#DDE1E6` | Borders, table dividers. |
| Page | `#F5F5F5` | Page background. Plaza's own background color. |
| Surface | `#FFFFFF` | Cards, tables, forms, panels. |

### Status (for clocks and outcomes only)
| Name | Hex | Use |
|---|---|---|
| On Time Green | `#1E8E3E` | Clock met, case recovered, appointment set, sold. |
| Warning Amber | `#B26A00` | Clock running low. Use dark amber text, not bright yellow. |
| Missed Red | `#C62828` | Clock missed, overdue. |

**Status rules:**
- Status color appears as text, a small dot, a thin left border (4px) or a small outlined chip.
- **Never use a filled red or pink box or background.** A warning box is white with a thin red border and dark text.
- Never use color alone to carry meaning. Always pair it with a word: "On time", "Due in 12 min", "Missed by 40 min".
- Red is reserved for missed clocks. Do not use red for anything decorative, including store or manufacturer badges.

### Charts
Use this order for multiple series: Plaza Blue `#3871B6`, Steel `#4E5155`, On Time Green `#1E8E3E`, Warning Amber `#B26A00`, Slate `#8A94A6`. Light gridlines in `#E9ECEF`. No 3D, no shadows.

## 4. Stores

Stores are shown with a neutral chip, NOT manufacturer colors. (Honda and Toyota both brand in red, which would clash with "missed clock" red.)
- Chip: white fill, 1px `#DDE1E6` border, Ink text, 600 weight, 999px rounded.
- Labels, always in this order: Acura · Honda · Hyundai · Kia · Toyota · Used Cars.
- When a screen is filtered to one store, show the store name in the page title ("Plaza Honda — Hot Prospects"), not a color change.

## 5. Typography

- **Font:** Roboto, the font on Plaza's website (load from Google Fonts: weights 400, 500, 700, 900). Fallback: system-ui, -apple-system, "Segoe UI", Arial, sans-serif.
- **Numbers:** use tabular figures (`font-variant-numeric: tabular-nums`) so columns line up.

| Role | Desktop | Phone | Weight | Color |
|---|---|---|---|---|
| Page title | 32px | 26px | 700 | Ink |
| Section heading | 22px | 20px | 700 | Ink |
| Card title | 18px | 18px | 500 | Ink |
| Big stat number | 40px | 32px | 900 | Ink or Plaza Blue |
| Body | 17px | 16px | 400 | Body |
| Table text | 16px | 16px | 400 | Ink |
| Labels, captions, "out of" | 14px | 14px | 400 | Muted |

- **Minimum text size is 14px anywhere, 16px for body text on phones.**
- On very large monitors, scale type up (use `clamp()`) so the page doesn't look tiny.
- Sentence case for headings. Uppercase only for short labels (e.g. "OVERDUE"), letter-spaced 0.04em.

## 6. Logo and header

- Logo: white "Plaza / AUTO MALL" wordmark with a blue car icon. Plaza's file: `https://static.overfuel.com/dealers/plaza-automall/image/plaza_auto_mall_logo.webp`
- The logo is white, so it only sits on the Plaza Black header bar.
- Header bar: Plaza Black `#111111`, 64px tall (56px on phones), logo on the left at 40px height, app name "Accountability Hub" in white 500 weight, and a 3px Plaza Blue line along the bottom edge (echoes Plaza's site).
- Below the header, everything is light. No other dark bands, no dark footer.
- Footer: Page background, Muted text, 14px. Shows the version chip.

## 7. Layout

- **Fill the screen.** Full width on every monitor, with 24px side padding (16px on phones). No narrow fixed column.
- Grid: 12 columns, 24px gaps. Stat cards in rows of 4 on desktop, 2 on tablet, 1 on phone.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48px.
- On phones: everything stacks to one column. Wide tables scroll sideways inside their own box. The page itself never scrolls sideways.

## 8. Components

**Buttons**
- Primary: Plaza Blue fill, white text, 12px radius (Plaza's own button shape), 44px tall, 16px text, 500 weight. Hover: Plaza Blue Dark.
- Secondary: white fill, 1px Steel border, Ink text.
- Destructive or "Close case": white fill, 1px Missed Red border, red text. Never a filled red button.
- Minimum tap target 44 × 44px.

**Cards**
- White, 1px Line border, 12px radius, 20px padding. Shadow at most `0 1px 2px rgba(24,28,33,0.06)`.
- A card that needs attention gets a 4px left border in its status color, not a colored fill.

**Stat cards**
- Big number, then the "out of" line directly under it in Muted: "31 of 50 cases".
- A one-line label above the number. A one-line "What to do with it" below, in Body.

**Tables**
- White, header row in Page gray `#F5F5F5` with Ink 600 text, rows 48px tall, 1px Line dividers.
- Right-align numbers. When the base number changes row to row, add an explicit "Out of" column.
- Selected or hovered row: Plaza Blue Tint.

**Forms**
- Labels above fields, 14px, Ink 500. Fields 44px tall, 1px Line border, 8px radius.
- Focus: 2px Plaza Blue outline.
- Required fields marked "Required" in Muted, not with a red asterisk.
- Error message: Missed Red text under the field, field border turns red. No red fill.

**Clocks**
- Each clock is a pill: white fill, 1px border in its status color, a dot, and plain words. Example: "● Contact the customer · due in 18 min".

**Status chips**
- Small outlined pills (white fill, colored 1px border and text): New, Accepted, Contacted, Working, Closed.

**Timeline (case history)**
- A thin vertical Line, a small dot per event, time on the left in Muted, the event in Ink.

## 9. Writing style

- Plain English, short sentences, talk to the reader as "you". This matches how Plaza writes on its own site.
- Name the action, not the system: "Accept this case", "Log a call", "Hand off to a manager".
- Every number says what it is out of: "62% answered on time (31 of 50 cases)".
- Every dashboard section carries one line on what it shows and one line on what to do with it.
- Process language, never blame: "3 cases missed the contact clock", not "Bad managers".
- Spell names exactly as entered. The Director of Operations is "Unice".

## 10. Version chip

- Shown in the footer of every page: `v1.0 · file: Plaza-Design-System-v1.0.md · Plaza Accountability Hub`
- The version number in the chip always matches the file name. Raise both together.

## 11. Do and don't

**Do:** white and light gray surfaces, Plaza Blue for action, black only in the header bar, Roboto, large readable type, outlined status colors, words next to every color.

**Don't:** dark mode, dark full-width bands below the header, gradients, filled red or pink boxes, manufacturer colors, text smaller than 14px, a narrow centered column, percentages without their "out of" count.
