// Génère THIRD_PARTY_NOTICES.md (avis et textes de licence des composants embarqués dans l'application) et en dépose une copie, avec LICENSE,
// dans public/legal/ pour qu'elles soient servies avec l'application. À relancer après toute mise à jour des dépendances : `npm run notices`.
//
// Les composants listés sont ceux qui sont réellement livrés (bibliothèques d'exécution, polices, service worker), pas les outils de build.

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const about = await import(pathToFileURL(join(root, 'src/gp39/about.ts')).href)

/** [nom du paquet, dossier où le chercher] */
const SHIPPED = [
  ['vue', '.'],
  ['@vue/runtime-dom', '.'],
  ['@vue/runtime-core', '.'],
  ['@vue/reactivity', '.'],
  ['@vue/shared', '.'],
  ['@vue/devtools-api', '.'],
  ['quasar', '.'],
  ['@quasar/extras', '.'],
  ['pinia', '.'],
  ['vue-router', '.'],
  ['leaflet', '.'],
  ['geomagnetism', '.'],
  ['@fontsource/roboto-condensed', '.'],
  ['@fontsource/vt323', '.'],
  ['register-service-worker', 'src-pwa'],
  ['workbox-core', 'src-pwa'],
  ['workbox-routing', 'src-pwa'],
  ['workbox-precaching', 'src-pwa'],
  ['workbox-strategies', 'src-pwa'],
]

/** Polices fournies par @quasar/extras avec leur propre licence : [nom affiché, dossier de la police dans le paquet] */
const EXTRAS_FONTS = [
  ['Roboto (police)', 'roboto-font'],
  ['Material Icons (police d’icônes)', 'material-icons'],
]

const findLicenseFile = (dir) => {
  if (!existsSync(dir)) return null
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n))
  return f ? join(dir, f) : null
}

const normalise = (t) => t.replace(/\r\n/g, '\n').replace(/\s+$/g, '') + '\n'

const entries = []
const missing = []
for (const [name, base] of SHIPPED) {
  const dir = join(root, base, 'node_modules', name)
  const pj = join(dir, 'package.json')
  if (!existsSync(pj)) {
    missing.push(`${name} (${base}/node_modules)`)
    continue
  }
  const j = JSON.parse(readFileSync(pj, 'utf8'))
  const file = findLicenseFile(dir)
  const lic = typeof j.license === 'string' ? j.license : (j.license?.type ?? j.licenses?.[0]?.type ?? '?')
  const repo = typeof j.repository === 'string' ? j.repository : (j.repository?.url ?? j.homepage ?? '')
  entries.push({
    name: j.name,
    version: j.version,
    license: lic,
    url: repo.replace(/^git\+/, '').replace(/\.git$/, ''),
    text: file ? normalise(readFileSync(file, 'utf8')) : null,
  })
}
for (const [label, folder] of EXTRAS_FONTS) {
  const dir = join(root, 'node_modules/@quasar/extras/exports', folder)
  const file = findLicenseFile(dir)
  if (!file) {
    missing.push(`${label} (licence)`)
    continue
  }
  const text = normalise(readFileSync(file, 'utf8'))
  entries.push({
    name: label,
    version: `via @quasar/extras`,
    license: /apache license/i.test(text) ? 'Apache-2.0' : /open font license/i.test(text) ? 'OFL-1.1' : '?',
    url: '',
    text,
  })
}
if (missing.length) {
  console.error('Composants introuvables (npm ci dans le dossier concerné ?) :\n - ' + missing.join('\n - '))
  process.exit(1)
}
const noText = entries.filter((e) => !e.text)
if (noText.length) console.warn('Sans fichier de licence (l’identifiant SPDX seul est indiqué) : ' + noText.map((e) => e.name).join(', '))

// textes uniques
const texts = new Map()
for (const e of entries) {
  if (!e.text) continue
  const key = createHash('sha256').update(e.text).digest('hex').slice(0, 12)
  e.textId = key
  if (!texts.has(key)) texts.set(key, { text: e.text, users: [] })
  texts.get(key).users.push(`${e.name}@${e.version}`)
}
const textNumber = new Map([...texts.keys()].map((k, i) => [k, i + 1]))

const credit = (c) =>
  `- **${c.name}** — ${c.what}\n  Licence : ${c.licence}${c.url ? ` — <${c.url}>` : ''}${c.citation ? `\n  Citation à reproduire : « ${c.citation} »` : ''}`

const md = []
md.push(`# Avis sur les composants tiers

${about.APP_NAME} est distribué sous licence **${about.LICENSE_NAME}** (\`${about.LICENSE_ID}\`, fichier \`LICENSE\`).
Ce fichier rassemble les avis de droits d'auteur et les textes de licence des composants tiers qu'il embarque, ainsi que les crédits des
données et des services qu'il utilise. Il est généré par \`npm run notices\` : ne pas le modifier à la main.

${about.TRADEMARK_NOTICE}

## Composants embarqués

| Composant | Version | Licence |
|---|---|---|
${entries.map((e) => `| ${e.name} | ${e.version} | ${e.license}${e.textId ? ` (texte n° ${textNumber.get(e.textId)})` : ''} |`).join('\n')}

Aucun de ces composants n'est sous licence à copyleft plus fort que la GPL-3.0-or-later du projet : MIT, BSD, Apache-2.0 (compatible avec la
GPL version 3) et SIL OFL 1.1 (polices, distribuées comme fichiers séparés avec leur licence) sont compatibles avec sa redistribution.

## Données et services en ligne

${about.DATA_CREDITS.map(credit).join('\n')}

## Travaux de référence

${about.REFERENCE_CREDITS.map(credit).join('\n')}

## Textes de licence
`)
for (const [key, t] of texts) {
  md.push(`### Texte n° ${textNumber.get(key)}

Utilisé par : ${t.users.join(', ')}

\`\`\`text
${t.text.trimEnd()}
\`\`\`
`)
}
const out = md.join('\n')

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out)
mkdirSync(join(root, 'public/legal'), { recursive: true })
writeFileSync(join(root, 'public/legal/THIRD_PARTY_NOTICES.md'), out)
copyFileSync(join(root, 'LICENSE'), join(root, 'public/legal/LICENSE'))
console.log(`THIRD_PARTY_NOTICES.md : ${entries.length} composants, ${texts.size} textes de licence → racine et public/legal/`)
