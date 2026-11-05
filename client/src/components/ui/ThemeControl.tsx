import { useId } from 'react'
import { themeStore, useThemePreference, type ThemePreference } from '../../app/theme'

const options: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

// The same pressed-button segments as the report period and notification filters.
export function ThemeControl() {
  const preference = useThemePreference(), id = useId()
  return <div className="theme-control" role="group" aria-labelledby={id}>
    <p id={id}>Theme</p>
    <div className="theme-segments">
      {options.map(({ value, label }) => <button key={value} type="button" aria-pressed={preference === value} onClick={() => themeStore.setPreference(value)}>{label}</button>)}
    </div>
  </div>
}
