import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildGpx, parseGpx } from '../gpx'
import { formatCoord, formatRange, formatTtg, gridLabel } from '../format'
import type { Route, Waypoint } from '../types'

const real = readFileSync(fileURLToPath(new URL('../../../public/data/waypoints_GP39.gpx', import.meta.url)), 'utf8')

describe('parseGpx (fichier réel waypoints_GP39.gpx)', () => {
  const r = parseGpx(real)
  it('lit les 2252 waypoints', () => {
    expect(r.waypoints).toHaveLength(2252)
  })
  it('lit symboles et couleurs', () => {
    const symbols = new Set(r.waypoints.map((w) => w.symbol))
    expect([...symbols].sort((a, b) => a - b)).toEqual([0, 2, 8, 9])
    const colors = new Set(r.waypoints.map((w) => w.color))
    expect([...colors].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
  it('lit un waypoint complet (nom, commentaire)', () => {
    const w = r.waypoints.find((x) => x.name === '29A00181')!
    expect(w).toBeDefined()
    expect(w.comment).toBe('malvoch')
    expect(w.symbol).toBe(2)
    expect(w.color).toBe(1)
    expect(w.lat).toBeCloseTo(48.7376863, 6)
    expect(w.lon).toBeCloseTo(-4.0109944, 6)
  })
  it('signale les waypoints sans nom', () => {
    expect(r.waypoints.filter((w) => !w.name)).toHaveLength(902)
    expect(r.warnings.join(' ')).toContain('sans <name>')
  })
})

describe('buildGpx', () => {
  const wpts: Waypoint[] = [
    { id: 1, name: 'WP0001', lat: 47.5, lon: -3.25, symbol: 0, color: 2, comment: 'A&B', display: true },
    { id: 2, name: 'WP0002', lat: 47.6, lon: -3.35, symbol: 8, color: 0, comment: '', display: false },
  ]
  const routes: Route[] = [
    {
      no: 1,
      name: 'R1',
      comment: 'cmt',
      points: [
        { wptId: 1, skip: false },
        { wptId: 2, skip: true },
      ],
    },
  ]
  it('round-trip waypoints + routes', () => {
    const back = parseGpx(buildGpx(wpts, routes))
    expect(back.waypoints).toHaveLength(2)
    expect(back.waypoints[0]).toMatchObject({ name: 'WP0001', comment: 'A&B', symbol: 0, color: 2, display: true })
    expect(back.waypoints[1]).toMatchObject({ symbol: 8, color: 0, display: false })
    expect(back.routes).toHaveLength(1)
    expect(back.routes[0]!.points.map((p) => p.skip)).toEqual([false, true])
    expect(back.routes[0]!.name).toBe('R1')
  })
})

describe('format', () => {
  it('position degrés/minutes', () => {
    expect(formatCoord(34.1387666, true)).toBe("34°08.326'N")
    expect(formatCoord(-135.1637666, false)).toBe("135°09.826'W")
  })
  it('position degrés/minutes/secondes', () => {
    expect(formatCoord(47.5, true, `xx'xx.x"`)).toBe('47°30\'00.0"N')
  })
  it('étiquettes de grille', () => {
    expect(gridLabel(34.139583, true, 3)).toBe('N 34 08.375')
    expect(gridLabel(135.158333, false, 3)).toBe('E 135 09.500')
  })
  it('distance : 2 décimales < 10, plafonnée à *999', () => {
    expect(formatRange(0.46)).toBe('0.46')
    expect(formatRange(14.6)).toBe('14.6')
    expect(formatRange(1500)).toBe('*999')
  })
  it('TTG', () => {
    expect(formatTtg(0.25)).toEqual({ h: '00', m: '15' })
    expect(formatTtg(120)).toEqual({ h: '*9', m: '*9' })
  })
})
