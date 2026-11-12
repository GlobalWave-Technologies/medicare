# Installing Medicare on a device (progressive web app)

Audience: the product owner, the hospital's IT owner and the deployment operator.

Medicare can be added to a computer, tablet or phone and opened in its own window like an app.
**Installation is optional:** declining never limits access, and the browser version works exactly
as before. The installed app is the same website. It uses the same sign-in, session cookie and
server, and keeps no hospital records on the device.

## What is installed

| Part | Detail |
| --- | --- |
| Manifest | `/manifest.webmanifest`. Name "Medicare – Hospital Records", short name "Medicare", `start_url` and `scope` `/`, `display: standalone`, `theme_color` `#c2410c` (brand orange), `background_color` `#f9fafb` (the light page surface) |
| Icons | `/icons/icon-192.png` and `/icons/icon-512.png` (the rounded Medicare mark), `/icons/icon-maskable-512.png` (full-bleed orange, mark inside the safe zone, for Android), `/icons/apple-touch-icon.png` (180 px, for iPhone and iPad) and the existing `favicon.svg`. All use the existing orange-and-white mark; no generic icons |
| Page tags | `index.html` links the manifest and Apple touch icon and names the app "Medicare" for home screens. There is still no inline script or style |
| Service worker | `/sw.js` at scope `/`, generated at build time (below) |

## What the service worker caches, and what it never touches

This is a hospital records system, so the worker is deliberately conservative.

**It caches** one release's static application files:

- the page shell (`index.html`);
- the fingerprinted JavaScript and CSS;
- `theme-init.js`, the favicon, the manifest and the install icons.

The build writes the exact list and a release version into `sw.js`. The version is a digest of
every cached file, so a new release produces a new worker.

**It never caches, stores or replays:**

- anything under `/api/`: patients, admissions, encounters and clinical records, medications,
  notifications, staff, dashboard and reports;
- authentication responses, CSRF tokens, or any authenticated JSON.

Those requests always go to the network, and the worker does not even inspect them.

**It holds no session:** no token, cookie or password. The session cookie stays HttpOnly and is
handled by the browser alone.

**It does not add:**

- background sync (there is no offline queue of writes);
- push notifications or push subscriptions;
- periodic sync.

Notifications remain in-app only.

**Release caches:** each release gets its own cache, `medicare-static-<version>`. When a new release
activates, the worker deletes only Medicare's earlier `medicare-static-*` caches, never any other
cache on the origin.

## Offline behaviour

Online, every page load fetches the live page from the server.

**When the server can't be reached:**

- **Shell only:** the worker serves the cached shell. It contains no data, so the app opens.
- **Connection-required screen:** because every record request still needs the server, Medicare
  shows "Medicare needs a network connection to access hospital records. Reconnect to continue."
  with a **Retry** button.
- **No stale records:** no patient or clinical record can appear, because none was ever stored.

**If the connection drops while someone is working:**

- **Covered workspace:** the same screen covers the workspace and any open dialog. The workspace
  stays loaded underneath, so unsaved text in an open form is not lost, but it is hidden and cannot
  be used.
- **Reconnecting:** Medicare checks the server when the browser reports the connection is back,
  quietly every 15 seconds while the screen is shown (browsers do not always report it), and
  whenever Retry is selected. Each check uses only the public health endpoint, without
  credentials. The screen is then removed and the session continues without signing in again.

## Updates

When a new release is deployed, open copies of Medicare download it in the background. They show a
small notice: "An update to Medicare is available.", with **Refresh when safe**.

- **Nothing reloads automatically,** in any tab.
- **Open dialogs:** Medicare's forms open in dialogs, and while a dialog is open the notice sits
  beneath it and cannot be used. The update waits until the form is saved or closed.
- **Unsaved work blocks the refresh:** if any other form may hold unsaved work, Refresh when safe
  explains "Save or close the open form first, then refresh." and does nothing else.
- **Activation:** otherwise the new release activates and that one tab reloads. Other tabs keep
  running until their own user refreshes.
- **Update checks:** a tab left open checks for a new release hourly and when it comes back into
  view.

## Installation flow

**Timing:** security comes first.

1. An administrator creates or resets the account with a temporary password.
2. The staff member signs in and must replace it (see
   [first-login security](first-login-security.md)). No install offer appears before or during
   that change.
3. They sign in again with their own password.
4. Only now, on that device, Medicare offers installation once, in a small "Welcome to Medicare"
   dialog: "Add Medicare to this device for faster access.", with **Install Medicare** and
   **Not now**.
5. Either choice, or closing the dialog, leads straight to the workspace.

**Not now** is remembered on the device as `medicare-install-dismissed` = `1`. The offer pending
after the password change is `medicare-install-offer` = `1`. Neither stores a staff ID, email, role
or any patient information. The offer is not repeated at later sign-ins.

**Manual install:** even after Not now, an **Install Medicare** action stays in the menu, under
Change password (desktop sidebar and mobile menu). It appears only where installation is possible
and Medicare is not already running as an installed app.

**Already installed:** when Medicare runs in its own window (`display-mode: standalone`, or iOS
home-screen mode), no install control or offer is shown.

## Browser differences

| Platform | What happens |
| --- | --- |
| Chrome and Edge (Windows, macOS, ChromeOS, Android) | The browser's own install prompt is used. Medicare holds it (it never appears by itself) and opens it only from Install Medicare. Medicare respects the person's answer: after a dismissal it is not shown again until the browser offers installation afresh |
| iPhone and iPad (Safari, and other browsers using Safari's engine) | There is no install prompt to trigger. Medicare shows short instructions instead: 1. Tap **Share**. 2. Choose **Add to Home Screen**. 3. Tap **Add**. It does not pretend to open a native dialog |
| Firefox | Firefox offers no install prompt, so Medicare shows no install control. The service worker and connection-required screen still work |

## Themes in the installed app

- **Themes:** Light, Dark and System behave exactly as in the browser and use the same stored
  preference. `theme-init.js` applies the theme before the first paint, and the window's title-bar
  colour follows it (`#c2410c` light, `#191c20` dark).
- **Startup screen:** Android and some desktops draw a short splash from the manifest's
  `background_color`, which cannot depend on the theme. Dark-mode users may see a light splash for
  a moment before Medicare's own dark page appears.

## Hosting requirements

**Headers:** serve `/sw.js`, `/manifest.webmanifest` and `/icons/*` with `Cache-Control: no-cache`,
like the other unfingerprinted files. The full table is in the
[release operations runbook](release-operations.md#static-cache-policy).

**Content type:** serve the manifest as `application/manifest+json`.

**HTTPS:** service workers and installation need HTTPS (or `localhost` for development).

**Content-Security-Policy:** the frontend policy is unchanged. The worker and manifest are
same-origin files:

- `worker-src` falls back to `script-src 'self'`;
- `manifest-src` falls back to `default-src 'self'`;
- the icons are covered by `img-src 'self'`.

No `unsafe-inline`, `unsafe-eval` or new source was added.

**Rollback:** republishing the previous `client/dist` also republishes its `sw.js`. Open copies
then see an update notice and move to it when refreshed. To remove the worker entirely, publish a
`sw.js` that deletes the `medicare-static-*` caches and unregisters itself.

## Verification

**Automated tests:**

- **`client/tests/service-worker.test.ts`** runs the generated worker against fake Cache Storage
  and network. It checks:
  - exactly the static precache;
  - no answer or storage for any API path, method or navigation to `/api`;
  - live page online, data-free shell offline;
  - old-cache cleanup that spares other caches;
  - waiting until a deliberate refresh;
  - only the install, activate, message and fetch handlers (no sync or push);
  - the version changing with any cached file;
  - the build plugin, including absolute output paths;
  - manifest fields and icon sizes;
  - the page tags;
  - an unchanged strict policy;
  - the stacking of the offline screen above dialogs.
- **`client/tests/pwa.test.tsx`** covers:
  - install-prompt capture, use and dismissal;
  - standalone and iOS detection;
  - onboarding and its device-only storage;
  - the manual action and iOS steps;
  - update registration and no reload over an open form;
  - the offline screen with inert workspace, Retry, reconnection and quiet re-checks.

**Live, on the production build:**

- **Installability:**
  - Chrome 157 and Edge 157 reported Medicare installable in a normal profile, with no
    installability errors and a valid manifest.
  - Headless browsers do not fire `beforeinstallprompt`, so the onboarding was driven with a
    simulated prompt event.
- **Service worker:**
  - it controlled the page at scope `/` with a single `medicare-static-*` cache;
  - after working in Patients, Appointments, Notifications and Reports, that cache held only
    static release files and no `/api` entry;
  - there was no push subscription or sync registration.
- **Offline:**
  - the screen covered the workspace and an open dialog;
  - an offline reload showed the shell's connection-required screen with no record content;
  - an API request was not answered from any cache;
  - after reconnecting, the session and the open dialog's unsaved text returned without signing
    in again.
- **Installed window (simulated):**
  - display-mode was simulated, because no OS installation was performed on the test workstation;
  - a new launch restored the session;
  - no install controls showed;
  - theme switching (with the dark title-bar colour), navigation and sign-out worked.
- **Update:**
  - a second release produced a new worker;
  - the notice appeared without reloading an open form and could not be used while the dialog was
    open;
  - after the dialog closed, Refresh when safe moved the tab to the new release, still signed in,
    and the old cache was removed.
- **Firefox engine:** the service worker and manifest work; no install control is shown.
- **Responsive and accessibility:**
  - no horizontal overflow at 320, 375, 768, 1024 and 1440 px, in Light and Dark, for the change
    screen, the install offer, the connection-required screen and the update notice;
  - the automated accessibility scan (not a screen reader) found no serious or critical issue on
    the change screen, the install offer, the connection-required screen or sign-in with the
    forgot-password note;
  - keyboard Tab reaches every field and both actions, and Escape on the offer means Not now.

## Limitations

- **Not tested on real devices:** installing through a browser's own UI, opening from a real home
  screen or Start menu, and Safari on iPhone or iPad all need checking on hospital devices.
- **Headless test browsers:** they don't fire `beforeinstallprompt`. The install flow was exercised
  with a simulated prompt event; Chrome and Edge confirmed installability directly.
- **Light splash:** the startup splash is light even in dark mode (above).
- **No offline use:** offline means no access to records, by design. There is no offline reading or
  writing.
