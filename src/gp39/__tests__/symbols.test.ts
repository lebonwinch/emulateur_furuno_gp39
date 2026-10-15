import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseGpx } from '../gpx'
import { COLORS, COLOR_NAMES, COLOR_NAMES_FR, SYMBOL_COUNT, SYMBOL_NAMES_FR, markSvg, symbolPaths, waypointTooltip } from '../symbols'

const real = readFileSync(fileURLToPath(new URL('../../../public/data/waypoints_GP39.gpx', import.meta.url)), 'utf8')

describe('règles GP39Symbol / FECColor', () => {
  it('GP39Symbol = rang dans la liste Symbol du GP-39 (codes confirmés par symbols.pdf)', () => {
    expect(SYMBOL_COUNT).toBe(10)
    expect(SYMBOL_NAMES_FR[0]).toBe('Rond')
    expect(SYMBOL_NAMES_FR[2]).toBe('Losange')
    expect(SYMBOL_NAMES_FR[8]).toBe('Tête de mort')
    expect(SYMBOL_NAMES_FR[9]).toBe('Drapeau')
  })

  it('FECColor = rang dans la liste Color du GP-39 (Red, Yellow, Green, Blue, Purple, Black, Brown)', () => {
    expect(COLOR_NAMES).toEqual(['Red', 'Yellow', 'Green', 'Blue', 'Purple', 'Black', 'Brown'])
    expect(COLOR_NAMES_FR).toHaveLength(7)
    expect(COLORS).toHaveLength(7)
  })

  it('le pictogramme du symbole 2 est un losange (4 sommets, pas de courbe)', () => {
    const svg = markSvg(2, 3, 20)
    expect(svg).toContain('M50 0L100 50L50 100L0 50Z')
    expect(svg).not.toContain('a45 45') // pas un rond
    expect(markSvg(0, 3, 20)).toContain('a45 45') // le symbole 0 est bien un rond
  })

  it('dans le fichier réel, tous les GP39Symbol=2 sont lus comme losanges colorés par FECColor', () => {
    const diamonds = parseGpx(real).waypoints.filter((w) => w.symbol === 2)
    expect(diamonds).toHaveLength(330)
    const byColor = new Map<number, number>()
    for (const w of diamonds) byColor.set(w.color, (byColor.get(w.color) ?? 0) + 1)
    // cardinales : Nord noir, Est vert, Sud jaune, Ouest bleu
    expect(Object.fromEntries(byColor)).toEqual({ 1: 114, 2: 66, 3: 76, 5: 74 })
  })

  it('orientation : le drapeau a son fanion en HAUT de la hampe, la tête de mort son crâne en haut', () => {
    // coordonnées y (y vers le bas) des points d'un tracé absolu M/L/C/Z
    const ys = (d: string): number[] => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]))
    const avg = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length

    // drapeau : [fanion, hampe] — le fanion occupe le haut de la hampe, qui descend jusqu'en bas
    const [pennant, pole] = symbolPaths(9)
    // (points de contrôle des courbes inclus : le fanion reste dans la moitié haute, l'ancienne version montait jusqu'à y = 99,6)
    expect(Math.max(...ys(pennant!))).toBeLessThan(60)
    expect(Math.min(...ys(pennant!))).toBeLessThan(5)
    expect(pole).toBe('M0 0H8.6V100H0Z') // hampe : du haut (y = 0) au bas (y = 100) de la boîte

    // tête de mort : boîte de 62,7 de haut ; les deux orbites (sous-tracés circulaires) sont dans la moitié haute
    const skull = symbolPaths(8)[0]!
    const eyes = skull.split('M').filter((p) => p.startsWith('39.6') || p.startsWith('60.4'))
    expect(eyes).toHaveLength(2)
    for (const e of eyes) expect(avg(ys('M' + e))).toBeLessThan(62.7 / 2)
  })

  it('l’info-bulle de la carte indique symbole et couleur, et échappe le HTML du GPX', () => {
    const html = waypointTooltip({ name: '<b>X</b>', symbol: 2, color: 3, comment: 'a&b' })
    expect(html).toContain('GP39Symbol=2 (Losange)')
    expect(html).toContain('FECColor=3 (Bleu)')
    expect(html).not.toContain('<b>X</b>')
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;')
    expect(html).toContain('a&amp;b')
  })
})
