// Aide et mentions légales : chacune dans sa fenêtre (et non plus dans le panneau de commande). Contrôle de la structure des sources, comme
// licensing.test.ts : les composants Vue ne sont pas montés dans ces tests.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const read = (p: string): string => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n')

describe('fenêtre « À propos et licences »', () => {
  it('a sa propre fenêtre, qui contient l’écran des mentions légales et des crédits', () => {
    const dialog = read('src/components/AboutDialog.vue')
    expect(dialog).toContain('<q-dialog')
    expect(dialog).toContain('À propos et licences')
    expect(dialog).toContain('<AboutPanel />')
  })

  it('le panneau de commande ne l’embarque plus : un bouton ouvre la fenêtre', () => {
    const panel = read('src/components/ControlPanel.vue')
    expect(panel).not.toContain('<AboutPanel')
    expect(panel).not.toContain('q-expansion-item')
    expect(panel).toContain('<AboutDialog v-model="showAbout" />')
    expect(panel).toContain('À propos et licences…')
  })
})

describe('fenêtre d’aide', () => {
  const help = read('src/components/HelpDialog.vue')

  it('a deux onglets : la légende des symboles, puis les raccourcis clavier', () => {
    const tabs = [...help.matchAll(/<q-tab\s[^>]*name="(\w+)"[^>]*label="([^"]+)"/g)].map((m) => [m[1], m[2]])
    expect(tabs).toEqual([
      ['symbols', 'Légende des symboles'],
      ['keys', 'Raccourcis clavier'],
    ])
    expect(help.match(/<q-tab-panel\s/g)).toHaveLength(2)
    expect(help).toContain('<SymbolLegendPanel />')
    expect(help).toContain('<KeyboardShortcuts />')
  })

  it('le panneau de commande n’a plus ni « Légende des symboles… » ni « Raccourcis clavier » : un seul bouton « Aide… »', () => {
    const panel = read('src/components/ControlPanel.vue')
    expect(panel).not.toContain('Légende des symboles')
    expect(panel).not.toContain('Raccourcis clavier')
    expect(panel).not.toContain('SymbolLegend')
    expect(panel).toContain('<HelpDialog v-model="showHelp" />')
    expect(panel).toContain('Aide…')
  })

  it('les raccourcis listés sont ceux de la façade (touches du clavier gérées par GP39Device)', () => {
    const shortcuts = read('src/components/KeyboardShortcuts.vue')
    const device = read('src/components/GP39Device.vue')
    for (const [label, key] of [
      ['ENT/CNTR', 'Enter'],
      ['MENU', 'Escape'],
      ['DISP', 'd'],
      ['GO TO', 'g'],
      ['MARK', ' '],
      ['BRILL', 'b'],
    ] as const) {
      expect(shortcuts, label).toContain(label)
      expect(device, `${label} (${key})`).toMatch(new RegExp(`['"]?${key === ' ' ? "' '" : key}['"]?:\\s*'`))
    }
  })
})
