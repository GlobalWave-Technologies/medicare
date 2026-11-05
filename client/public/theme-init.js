// Applies the saved or system theme before the first paint, so a dark-mode visit never
// flashes white. Reads only the non-sensitive "medicare-theme" preference.
// Keep in step with src/app/theme.ts.
(function () {
  var preference = 'system', theme = 'light', root = document.documentElement
  try {
    var stored = window.localStorage.getItem('medicare-theme')
    if (stored === 'light' || stored === 'dark' || stored === 'system') preference = stored
  } catch (error) { /* Storage can be unavailable; fall back to the system setting. */ }
  try {
    theme = preference === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference
  } catch (error) { theme = preference === 'dark' ? 'dark' : 'light' }
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#191c20' : '#c2410c')
})()
