import { describe, expect, it } from 'vitest'
import { Mercator, bearing, crossTrack, distance, gcDistance, gridStepMin, norm180, norm360, normLon, rhumbDestination } from '../geo'

describe('angles', () => {
  it('normalise', () => {
    expect(norm360(-10)).toBe(350)
    expect(norm360(370)).toBe(10)
    expect(norm180(190)).toBe(-170)
    expect(normLon(181)).toBe(-179)
    expect(normLon(-181)).toBe(179)
  })
})

describe('distances', () => {
  it('1 minute de latitude = 1 NM', () => {
    const d = distance({ lat: 47, lon: -3 }, { lat: 47 + 1 / 60, lon: -3 })
    expect(d).toBeGreaterThan(0.995)
    expect(d).toBeLessThan(1.005)
  })
  it('loxodromie vs orthodromie proches sur courte distance', () => {
    const a = { lat: 48.38, lon: -4.49 }
    const b = { lat: 47.73, lon: -3.36 }
    expect(Math.abs(distance(a, b, 'Rhumb Line') - gcDistance(a, b))).toBeLessThan(0.2)
  })
  it('cap plein Est le long d’un parallèle', () => {
    expect(Math.round(bearing({ lat: 47, lon: -4 }, { lat: 47, lon: -3 }))).toBe(90)
    expect(Math.round(bearing({ lat: 47, lon: -4 }, { lat: 48, lon: -4 }))).toBe(0)
  })
  it('rhumbDestination est l’inverse de distance/bearing', () => {
    const a = { lat: 47.5, lon: -3.2 }
    const b = rhumbDestination(a, 57, 12.3)
    expect(distance(a, b)).toBeCloseTo(12.3, 2)
    expect(bearing(a, b)).toBeCloseTo(57, 1)
  })
})

describe('Mercator', () => {
  it('aller-retour px ↔ lat/lon', () => {
    const m = new Mercator({ lat: 47.7, lon: -3.4 }, 700, 240, 130)
    const [x, y] = m.toPx(47.71, -3.39)
    const p = m.fromPx(x, y)
    expect(p.lat).toBeCloseTo(47.71, 6)
    expect(p.lon).toBeCloseTo(-3.39, 6)
  })
  it('le centre est au point d’origine', () => {
    const m = new Mercator({ lat: 47.7, lon: -3.4 }, 700, 240, 130)
    expect(m.toPx(47.7, -3.4)).toEqual([240, 130])
  })
  it('1 NM vers l’Est au centre = pxPerNm pixels', () => {
    const m = new Mercator({ lat: 47.7, lon: -3.4 }, 700, 240, 130)
    const east = rhumbDestination({ lat: 47.7, lon: -3.4 }, 90, 1)
    const [x] = m.toPx(east.lat, east.lon)
    expect(x - 240).toBeCloseTo(700, 0)
  })
})

describe('crossTrack', () => {
  it('positif quand le bateau est à droite de la route', () => {
    const from = { lat: 47, lon: -3 }
    const to = { lat: 47.1, lon: -3 }
    expect(crossTrack(from, to, { lat: 47.05, lon: -3 + 0.01 })).toBeGreaterThan(0)
    expect(crossTrack(from, to, { lat: 47.05, lon: -3 - 0.01 })).toBeLessThan(0)
  })
  it('valeur ≈ 0.4 NM pour 0.01° de longitude à 47°N', () => {
    const from = { lat: 47, lon: -3 }
    const to = { lat: 47.1, lon: -3 }
    expect(crossTrack(from, to, { lat: 47.05, lon: -2.99 })).toBeCloseTo(0.41, 1)
  })
})

describe('grille', () => {
  it('choisit un pas croissant avec le zoom arrière', () => {
    expect(gridStepMin(0.001, 60)).toBeLessThan(gridStepMin(0.1, 60))
  })
})
