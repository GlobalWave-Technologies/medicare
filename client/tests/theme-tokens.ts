import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type ThemeName = 'light' | 'dark'
export const themeNames: ThemeName[] = ['light', 'dark']
export const sharedCss = () => readFileSync(resolve('src/styles/App.css'), 'utf8')

// The light tokens live in the first `:root {` block and the dark overrides in `:root[data-theme="dark"] {`.
export function tokenBlocks(css = sharedCss()): Record<ThemeName, Record<string, string>> {
  const block = (opener: string) => {
    const start = css.indexOf(opener)
    if (start < 0) throw new Error(`missing ${opener}`)
    const body = css.slice(start + opener.length, css.indexOf('}', start))
    return Object.fromEntries(Array.from(body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g), ([, name, value]) => [name!, value!.trim()]))
  }
  return { light: block(':root {'), dark: block(':root[data-theme="dark"] {') }
}
export const hex = (value: string) => {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) throw new Error(`not an opaque hex colour: ${value}`)
  return value.length === 4 ? `#${value.slice(1).replace(/./g, '$&$&')}` : value.toLowerCase()
}
const channel = (value: string, at: number) => parseInt(hex(value).slice(at, at + 2), 16) / 255
export function luminance(value: string) {
  const [r, g, b] = [1, 3, 5].map((at) => channel(value, at)).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x! + 0.05) / (y! + 0.05)
}
export function hue(value: string) {
  const [r, g, b] = [1, 3, 5].map((at) => channel(value, at)) as [number, number, number]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  if (delta === 0) return 0
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (raw * 60 + 360) % 360
}
