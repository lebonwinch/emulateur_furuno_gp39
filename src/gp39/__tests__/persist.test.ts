import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '../persist'
import { bearing, destinationPoint, distance, gcDestination } from '../geo'

describe('debounce avec maxWait', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sans maxWait : attend le silence', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    for (let i = 0; i < 10; i++) {
      d()
      vi.advanceTimersByTime(50)
    }
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('avec maxWait : une valeur modifiée en continu est quand même enregistrée', () => {
    const fn = vi.fn()
    const d = debounce(fn, 2000, 5000)
    for (let i = 0; i < 12; i++) {
      d()
      vi.advanceTimersByTime(1000) // modification chaque seconde pendant 12 s
    }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('flush exécute immédiatement l’appel en attente, une seule fois', () => {
    const fn = vi.fn()
    const d = debounce(fn, 2000)
    d()
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(1)
    d.flush() // rien en attente
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('destinations', () => {
  const a = { lat: 47.5, lon: -3.2 }
  it('grand cercle : aller-retour distance / cap', () => {
    const p = gcDestination(a, 123, 250)
    expect(distance(a, p, 'Great Circle')).toBeCloseTo(250, 1)
    expect(bearing(a, p, 'Great Circle')).toBeCloseTo(123, 1)
  })
  it('destinationPoint suit la méthode de navigation', () => {
    const r = destinationPoint(a, 90, 100, 'Rhumb Line')
    const g = destinationPoint(a, 90, 100, 'Great Circle')
    expect(r.lat).toBeCloseTo(a.lat, 6) // plein Est en loxodromie : latitude constante
    expect(g.lat).toBeLessThan(a.lat) // l'orthodromie s'incurve vers l'équateur
  })
})
