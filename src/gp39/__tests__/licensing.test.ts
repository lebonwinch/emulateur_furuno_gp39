// Conformité des licences : le projet est sous GPL-3.0-or-later, ses composants tiers sont listés avec leur texte, les données et les
// services en ligne sont crédités, la marque du constructeur n'est pas utilisée comme nom ni comme logo.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  APP_NAME,
  COPYRIGHT,
  COPYRIGHT_HOLDER,
  DATA_CREDITS,
  ETALAB_URL,
  GPX_METADATA,
  LIBRARIES,
  LICENSE_ID,
  REFERENCE_CREDITS,
  REPO_URL,
  SHOM_CITATION,
  TRADEMARK_NOTICE,
} from '../about'
import { parseGpx } from '../gpx'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const read = (p: string): string => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n')

/** tous les fichiers .ts / .vue sous un dossier, hors tests */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`
    if (name === '__tests__') continue
    if (statSync(join(root, rel)).isDirectory()) out.push(...sources(rel))
    else if (/\.(ts|vue)$/.test(name)) out.push(rel)
  }
  return out
}

describe('licence du projet : GNU GPL v3 ou ultérieure', () => {
  it('le fichier LICENSE est le texte officiel de la GPL version 3', () => {
    const t = read('LICENSE')
    expect(t).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(t).toContain('Version 3, 29 June 2007')
    expect(t).toContain('END OF TERMS AND CONDITIONS')
    expect(t).toContain('How to Apply These Terms to Your New Programs')
    expect(t.length).toBeGreaterThan(30000)
  })

  it('package.json déclare la même licence, le même titulaire et le dépôt du code source', () => {
    const pkg = JSON.parse(read('package.json')) as { license: string; author: string; repository: { url: string } }
    expect(pkg.license).toBe(LICENSE_ID)
    expect(LICENSE_ID).toBe('GPL-3.0-or-later')
    expect(pkg.author).toBe(COPYRIGHT_HOLDER)
    expect(pkg.repository.url).toBe(`${REPO_URL}.git`)
  })

  it('le titulaire des droits est le même partout : écran « À propos », README, package.json', () => {
    expect(COPYRIGHT_HOLDER).toBe('Vincent Aizier')
    expect(COPYRIGHT).toBe('Copyright © 2026 Vincent Aizier')
    expect(read('README.md')).toContain(`${COPYRIGHT}.`)
  })

  it('le README annonce la licence, la citation du Shom et la mention sur les marques', () => {
    const r = read('README.md')
    expect(r).toContain('## Licence')
    expect(r).toContain('GPL-3.0-or-later')
    expect(r).toContain(SHOM_CITATION)
    expect(r).toContain('Etalab 2.0')
    expect(r).toContain('Furuno Electric Co., Ltd.')
    expect(r).toContain('ni affilié à Furuno')
  })

  it('les copies servies avec l’application (public/legal) sont identiques aux fichiers de la racine', () => {
    expect(read('public/legal/LICENSE')).toBe(read('LICENSE'))
    expect(read('public/legal/THIRD_PARTY_NOTICES.md')).toBe(read('THIRD_PARTY_NOTICES.md'))
  })
})

describe('composants tiers', () => {
  const notices = read('THIRD_PARTY_NOTICES.md')

  it('chaque dépendance d’exécution (application et service worker) figure dans THIRD_PARTY_NOTICES.md', () => {
    const app = (JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies
    const sw = (JSON.parse(read('src-pwa/package.json')) as { dependencies: Record<string, string> }).dependencies
    for (const name of [...Object.keys(app), ...Object.keys(sw)]) expect(notices, name).toContain(`| ${name} |`)
  })

  it('les textes MIT, BSD, Apache-2.0 et SIL OFL sont joints, avec les polices Roboto et Material Icons de Quasar', () => {
    expect(notices).toContain('MIT License')
    expect(notices).toContain('Apache License')
    expect(notices).toContain('SIL OPEN FONT LICENSE')
    expect(notices).toContain('Redistribution and use in source and binary forms')
    expect(notices).toContain('| Roboto (police) |')
    expect(notices).toContain('| Material Icons (police d’icônes) |')
  })

  it('aucun composant embarqué n’est sous une licence incompatible avec la GPL-3.0 (GPL-2.0 seule, CC BY-NC, propriétaire…)', () => {
    const rows = notices
      .split('\n')
      .filter((l) => /^\| .+ \| .+ \| .+ \|$/.test(l) && !l.startsWith('| Composant') && !l.startsWith('|---'))
    expect(rows.length).toBeGreaterThan(15)
    for (const row of rows) {
      const lic = row.split('|')[3]!.trim()
      expect(lic, row).toMatch(/^(MIT|BSD-2-Clause|BSD-3-Clause|ISC|0BSD|Apache-2\.0|OFL-1\.1)\b/)
    }
  })

  it('les composants cités dans l’écran « À propos » sont ceux de la liste générée', () => {
    const hay = notices.toLowerCase()
    for (const lib of LIBRARIES) {
      const first = lib.name.split(' et ')[0]!.toLowerCase()
      // « Roboto Condensed » s'écrit roboto-condensed dans le nom du paquet
      expect(hay.includes(first) || hay.includes(first.replace(/ /g, '-')), lib.name).toBe(true)
    }
  })
})

describe('données et services en ligne', () => {
  it('chaque domaine autorisé pour des images par la CSP de index.html est crédité', () => {
    const csp = /img-src([^;]*);/.exec(read('index.html'))![1]!
    const hosts = [...csp.matchAll(/https:\/\/([^\s;]+)/g)].map((m) => m[1]!)
    expect(hosts.length).toBeGreaterThanOrEqual(5)
    const credited = new Set(DATA_CREDITS.flatMap((c) => c.hosts ?? []))
    for (const h of hosts) expect(credited.has(h), `${h} n’a pas de crédit dans DATA_CREDITS`).toBe(true)
  })

  it('chaque crédit a une licence ; celui du Shom porte la citation exacte et la licence Etalab', () => {
    for (const c of [...DATA_CREDITS, ...REFERENCE_CREDITS, ...LIBRARIES]) {
      expect(c.licence.length, c.name).toBeGreaterThan(2)
    }
    const shom = DATA_CREDITS.find((c) => c.citation)!
    expect(shom.citation).toBe('Shom, 2026. https://dx.doi.org/10.17183/DOI_BALISAGE_MARITIME')
    expect(shom.licence).toContain('Etalab 2.0')
    expect(shom.url).toBe(ETALAB_URL)
  })

  it('le fichier de waypoints livré porte la citation du Shom dans ses métadonnées GPX, et se lit toujours', () => {
    const gpx = read('public/data/waypoints_GP39.gpx')
    expect(gpx).toContain(SHOM_CITATION)
    expect(gpx).toContain(ETALAB_URL)
    expect(gpx).toContain('<copyright author="Shom">')
    expect(gpx.indexOf('<metadata>')).toBeLessThan(gpx.indexOf('<wpt'))
    expect(GPX_METADATA).toContain(SHOM_CITATION)
    expect(parseGpx(gpx).waypoints).toHaveLength(2252)
  })

  it('OpenCPN est cité comme référence du format CM93, avec sa licence', () => {
    const o = REFERENCE_CREDITS.find((c) => c.name.startsWith('OpenCPN'))!
    expect(o.licence).toContain('GNU GPL version 2 ou ultérieure')
    expect(read('src/gp39/cm93/decode.ts')).toContain('GNU GPL version 2 ou ultérieure')
  })
})

describe('marque du constructeur', () => {
  it('le nom de l’application est neutre partout : titre, manifeste PWA, package.json', () => {
    expect(APP_NAME).toBe('Émulateur compatible GP-39')
    expect(JSON.parse(read('src-pwa/manifest.json')).name).toBe(APP_NAME)
    expect((JSON.parse(read('package.json')) as { productName: string }).productName).toBe(APP_NAME)
    expect(read('src/layouts/MainLayout.vue')).toContain(APP_NAME)
    expect(JSON.parse(read('src-pwa/manifest.json')).description).not.toMatch(/furuno/i)
    expect((JSON.parse(read('package.json')) as { description: string; keywords: string[] }).keywords).not.toContain('furuno')
  })

  it('le mot « FURUNO » n’est affiché nulle part dans l’interface (seule la mention de non-affiliation le cite)', () => {
    const offenders = sources('src').filter((f) => f !== 'src/gp39/about.ts' && /furuno/i.test(read(f)))
    expect(offenders).toEqual([])
    expect(TRADEMARK_NOTICE).toContain('ni affilié à Furuno')
    expect(read('src/components/AboutPanel.vue')).toContain('TRADEMARK_NOTICE')
  })
})
