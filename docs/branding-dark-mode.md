# Branding and dark mode

Medicare uses the hospital's orange-and-white identity in a light theme and a matching
dark theme. Both themes come from one set of colour tokens in
`client/src/styles/App.css`, and every screen uses those tokens. This page records:

- where the orange came from;
- what was adjusted for accessibility;
- how the theme preference works;
- how the themes were checked.

## Original palette recovered

Medicare's first frontend is in commit `1e93826` ("Initialize Medicare client and server"),
in `client/src/styles/App.css`. Its brand colour sat in a token named `--blue`, but the value
was orange. The palette below was read from that file with read-only Git (`git show
1e93826:client/src/styles/App.css`). Nothing was guessed.

| Role in the original | Value | Where it was used |
| --- | --- | --- |
| Primary orange | `#f97316` | `--blue`: links, active navigation marker, password toggle, checkbox accent, start of the primary button |
| Darker orange | `#ea580c` | Middle of the primary button |
| Deepest orange | `#c2410c` | Secondary-button text on hover |
| Light orange | `#fdba74` | `--blue-glow`, hover borders |
| Orange border | `#fed7aa` | Sign-out chip border |
| Orange tint | `#fff1e6` | `--blue-soft` |
| Pale tints | `#fff7f2`, `#fff4eb`, `#fffaf7`, `#fff7ed` | Hover backgrounds, active navigation, sidebar |
| Ink | `#111827` | `--ink`, `--deep` |
| Muted text | `#6b7280` | `--muted` |
| Line | `#e5e7eb` | `--line` |
| Page background | `#f9fafb` | `--bg` |
| Surface | `#ffffff` | Panels and the sign-in form |

The original values come from standard orange and gray scales (orange 50–700, gray 50–900).
Where a missing step was needed, it came from the same scales, for example `#9a3412`,
`#7c2d12`, `#4b5563` and `#d1d5db`.

The original used gradients and glows on the primary button, the brand mark and the sign-in
panel. The final UI/UX pass removed those for a calmer clinical look. The colours are restored,
but the gradients and glows are not.

## Accessibility adjustments

The original primary orange is a strong brand colour, but it is too light to carry white text,
and on white it is too faint for meaningful marks:

| Use | `#f97316` result | Requirement |
| --- | --- | --- |
| White text on an orange button | 2.80:1 | 4.5:1 for normal text |
| Orange text or chart bar on white | 2.80:1 | 4.5:1 for text, 3:1 for graphics |

The light theme therefore uses the original family by job:

| Job | Light value | Contrast |
| --- | --- | --- |
| Primary buttons, links, brand text, unread badge | `#c2410c` (original deepest orange) | 5.18:1 with white |
| Primary hover / pressed | `#9a3412` / `#7c2d12` | 7.31:1 / 9.37:1 with white |
| Marks: active-navigation bar, unread marker, report tab, chart bars | `#ea580c` (original darker orange) | 3.56:1 on white |
| Logo mark and browser icon | `#f97316` (original primary, unchanged) | Logos are exempt |

Two neutrals also changed:

- **Muted text** went from `#6b7280` to `#4b5563`. The original gives 4.39:1 on the light gray
  behind segmented controls, which is below 4.5:1. The new value gives 6.87:1.
- **Field borders** went from `#e5e7eb` (1.24:1) to `#7c8592` (3.73:1), so input boundaries
  meet 3:1.

The dark theme can use the original primary orange directly. `#f97316` holds dark text at
6.33:1 and sits on dark surfaces at 6.10:1.

## Light palette

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f9fafb` | Page background |
| `--surface` / `--surface-raised` | `#ffffff` | Panels, sidebar, header, dialogs |
| `--surface-muted` / `--surface-sunken` | `#f9fafb` / `#f3f4f6` | Inset panels, table headers / segment tracks |
| `--deep` / `--ink` / `--muted` | `#111827` / `#1f2937` / `#4b5563` | Headings / body text / secondary text |
| `--line` / `--line-strong` / `--field-border` | `#e5e7eb` / `#d1d5db` / `#7c8592` | Dividers / control outlines / field boundaries |
| `--brand` / `--brand-strong` / `--brand-pressed` | `#c2410c` / `#9a3412` / `#7c2d12` | Primary fill and links / hover / pressed |
| `--brand-accent` / `--brand-mark` | `#ea580c` / `#f97316` | Marks and charts / logo |
| `--brand-soft` / `--brand-line` | `#fff1e6` / `#fed7aa` | Active navigation, selected choices / their borders |
| `--focus` | `#9a3412` | Focus ring |

## Dark palette

The dark theme is a separate set of values, not an inversion. Depth comes from four surface
steps, each with its own border and shadow.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#111316` | Page background and sign-in panel |
| `--surface` | `#191c20` | Panels, sidebar, header, table rows |
| `--surface-muted` / `--surface-hover` | `#1e2226` / `#20242a` | Inset panels, table headers / row hover |
| `--surface-raised` | `#23272d` | Dialogs |
| `--surface-sunken` | `#141619` | Segment tracks, disabled fields |
| `--deep` / `--ink` / `--muted` | `#f3f4f6` / `#d6dae0` / `#a0a7b1` | Headings / body text (12.18:1) / secondary text (7.05:1) |
| `--line` / `--line-strong` / `--field-border` | `#2c3137` / `#3a4047` / `#79818d` | Dividers / control outlines / field boundaries (3.81:1 or more) |
| `--brand` / `--brand-strong` | `#f97316` / `#fb923c` | Primary fill with `#111827` text / hover and active navigation text |
| `--link` | `#fb923c` | Links (7.55:1) |
| `--brand-soft` / `--brand-line` | `#33231a` / `#6b3a1c` | Active navigation and selected choices: a restrained orange tint |
| `--focus` | `#fdba74` | Focus ring (10.14:1 on panels) |

Orange text is kept to links, active navigation and small brand marks, so the dark theme
does not glow.

## Semantic colour policy

Orange means the brand: primary actions, active navigation, links, focus, brand marks and
single-series charts. Status colours are never orange, and each keeps its meaning in both
themes:

| Meaning | Family | Examples |
| --- | --- | --- |
| Success | Green | Active staff, Completed, Finalized, saved confirmations |
| Warning | Amber | Draft, No-show, Suspended, warning callouts, caution buttons |
| Danger | Rose-crimson | Cancelled, Disabled, errors, destructive buttons |
| Information | Blue | Scheduled, Pending, Unread, information callouts |
| Neutral | Gray | Archived, Read, Voided |
| Status accents | Teal and violet | Confirmed, Checked in |

Statuses always show their word and a marker, so colour is never the only signal.

**Danger colour.** Destructive buttons moved from wine red (`#9b3038`) to rose-crimson
(`#be123c` fill with white text at 6.29:1; text `#9f1239`). Wine red sat too close to the
burnt-orange primary, and a destructive action must not look like an ordinary one.

**Appointment status tones.** The previous tones were close for Scheduled and Confirmed. The
new tones were checked with a colour-vision-deficiency validator against each theme's surface.
Badges and report markers share the same tone token.

| Status | Light | Dark |
| --- | --- | --- |
| Scheduled | `#2563eb` | `#4c8ef7` |
| Confirmed | `#0f8a7a` | `#0f9a8c` |
| Checked in | `#7c3aed` | `#9b7cf0` |
| Completed | `#1f7a3f` | `#2a7f44` |
| No-show | `#b8820e` | `#bd8a26` |
| Cancelled | `#c22f4a` | `#c93a4a` |

**Clinical chart.** The three series are orange, blue and teal: light `#ea580c`, `#2563eb`,
`#0f8a7a`; dark `#ea580c`, `#4c8ef7`, `#0f9a8c`. Every pair was validated for colour-vision
separation. The amber third series was replaced because it sat next to orange. Charts keep
their legend, text summary and data table.

## Theme preference

| Setting | Behaviour |
| --- | --- |
| **System** (default) | Follows the device's light or dark setting, and switches if that setting changes while Medicare is open |
| **Light** / **Dark** | Applies at once and is remembered in this browser. Device changes are ignored until System is chosen again |

Changing the theme does not reload the page, re-request any data or close an open menu.

The choice is in three places:

- the bottom of the desktop sidebar, above the signed-in name;
- the bottom of the mobile menu;
- the sign-in screen, below the form.

It uses the same pressed-button segments as the report period and notification filters. Each
segment is at least 44px tall and is announced as a "Theme" group.

## Persistence

The preference is a display setting with no personal or clinical meaning:

- It is stored in this browser's `localStorage` under the single key `medicare-theme`.
- The stored value is only `light`, `dark` or `system`. Any other value is ignored.
- Nothing is stored until someone makes a choice.
- Nothing about the signed-in person or their session is stored with it.
- If browser storage is blocked, the theme still works for the open page and falls back to
  the system setting on the next visit.

Signing out keeps the preference, because it belongs to the device, not to a staff account.

## No-flash strategy

`client/public/theme-init.js` is a small same-origin script loaded in the page `<head>`. It
runs before the stylesheet applies and before the application starts, and it:

1. reads the stored preference, or the system setting;
2. sets `data-theme` and `color-scheme` on the page root;
3. updates the browser `theme-color`: `#c2410c` in light, `#191c20` in dark.

A dark-mode visitor therefore never sees a white page first. A separate file rather than an
inline script means it also works under a Content-Security-Policy of `script-src 'self'`. The
file is not fingerprinted, so serve it like `index.html` and do not give it long-lived
immutable caching. `client/src/app/theme.ts` applies the same rules after start-up, and a
test keeps the two in step.

`color-scheme` makes native controls follow the theme: date and time pickers, select menus
and scrollbars. Browser autofill keeps the theme's text colour through a dedicated rule.
Placeholders use the muted text colour.

## Accessibility verification

- **Automated contrast tests** run on both token sets:
  - every text token on every surface, including dialogs and row hover, at 4.5:1;
  - every status colour on its own background at 4.5:1;
  - orange and rose buttons with their text at 4.5:1, including hover and pressed;
  - links at 4.5:1;
  - focus rings, field borders, marks and chart series at 3:1.
- **Hue tests** keep orange for the brand only, and keep success green, warning amber, danger
  rose-crimson and information blue in both themes.
- **Browser checks** in Chrome, in both themes:
  - 112 automated WCAG 2.1 AA scans (56 per theme) found no violations at any level;
  - keyboard focus rings were measured against what is behind them. The light ring `#9a3412`
    gave 6.64–7.31:1 and the dark ring `#fdba74` gave 10.14–10.75:1.

## Responsive verification

The live walkthrough used synthetic data only. It covered every major screen for Admin, Records
Officer and Doctor at 320, 375, 768, 1024 and 1440 pixels in both themes, including:

- sign-in;
- Overview;
- the patient directory and patient record;
- appointments and appointment detail;
- Medical Records, the clinical editor and a finalized record with amendments;
- notifications, the broadcast form, Staff & Access, staff detail and Reports;
- the archive, cancellation, finalization and staff dialogs;
- the mobile menu.

Each screen was checked for:

- horizontal overflow;
- controls under 44px;
- dialog fit;
- previous-brand colours;
- light panels left in dark mode;
- the theme being in place before the first paint.

The walkthrough passed 1,117 of 1,117 checks. Further checks covered:

- **Switching:** choosing Dark applied in 28 ms with no reload and no data request; a reload
  painted dark from the first frame.
- **System mode:** a first visit from a dark-mode device painted dark from the first frame and
  stored nothing. System followed operating-system changes live, and a manual Light choice
  ignored them.
- **Storage:** the only stored item was `medicare-theme`.
- **Dark controls:** sign-in fields, selects and date and time inputs used the dark colour
  scheme with readable text.

## Remaining limitations

- **Autofill.** Password-manager autofill is covered by a style rule but could not be
  triggered by automation. Check it once by hand in each hospital browser.
- **Browsers.** Live checks ran in Chrome. Firefox, Safari and Edge should be checked on
  hospital devices.
- **Forced colours.** Windows high-contrast mode is left to the operating system and has no
  dedicated styling.
- **Per device.** The preference belongs to the browser, not the staff account, so it does
  not follow a person between devices.
