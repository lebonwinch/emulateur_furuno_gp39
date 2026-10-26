// Sélection de waypoints : ajout (Ctrl, Maj ou bouton « Multi »), rectangle, tolérance du toucher.
import { describe, expect, it } from 'vitest'
import { afterBox, afterTap, DRAG_THRESHOLD_PX, pickTolerance, startsBox } from '../selection'

const set = (...ids: number[]): Set<number> => new Set(ids)

describe('toucher ou clic sur la carte', () => {
  it('sans mode additif : le waypoint touché remplace la sélection, la mer la vide', () => {
    expect(afterTap(set(1, 2), 3, false)).toEqual(set(3))
    expect(afterTap(set(1, 2), null, false)).toEqual(set())
  })

  it('en mode additif (Ctrl, Maj ou « Multi ») : un waypoint s’ajoute, un second toucher le retire', () => {
    let s = set()
    s = afterTap(s, 1, true)
    s = afterTap(s, 2, true)
    s = afterTap(s, 3, true)
    expect(s).toEqual(set(1, 2, 3))
    s = afterTap(s, 2, true)
    expect(s).toEqual(set(1, 3))
  })

  it('en mode additif, toucher la mer ne vide pas la sélection', () => {
    expect(afterTap(set(1, 2), null, true)).toEqual(set(1, 2))
  })

  it('ne modifie jamais l’ensemble reçu', () => {
    const cur = set(1)
    afterTap(cur, 2, true)
    afterTap(cur, null, false)
    afterBox(cur, [5], true)
    expect(cur).toEqual(set(1))
  })
})

describe('rectangle de sélection', () => {
  it('remplace la sélection, ou s’y ajoute en mode additif', () => {
    expect(afterBox(set(1, 2), [3, 4], false)).toEqual(set(3, 4))
    expect(afterBox(set(1, 2), [2, 3], true)).toEqual(set(1, 2, 3))
  })

  it('un rectangle vide vide la sélection, sauf en mode additif', () => {
    expect(afterBox(set(1), [], false)).toEqual(set())
    expect(afterBox(set(1), [], true)).toEqual(set(1))
  })
})

describe('début d’un rectangle', () => {
  it('mode Sélection : au doigt comme à la souris', () => {
    expect(startsBox('select', 'touch', false)).toBe(true)
    expect(startsBox('select', 'mouse', false)).toBe(true)
    expect(startsBox('select', 'pen', false)).toBe(true)
  })

  it('mode Déplacer : Maj + glisser à la souris seulement ; au doigt le glisser déplace la carte', () => {
    expect(startsBox('pan', 'mouse', true)).toBe(true)
    expect(startsBox('pan', 'mouse', false)).toBe(false)
    expect(startsBox('pan', 'touch', true)).toBe(false)
    expect(startsBox('pan', 'touch', false)).toBe(false)
  })

  it('mode Ajouter : jamais', () => {
    expect(startsBox('add', 'mouse', true)).toBe(false)
    expect(startsBox('add', 'touch', false)).toBe(false)
  })
})

describe('précision du pointeur', () => {
  it('un doigt a une tolérance plus grande qu’une souris', () => {
    expect(pickTolerance('touch')).toBeGreaterThan(pickTolerance('pen'))
    expect(pickTolerance('pen')).toBeGreaterThan(pickTolerance('mouse'))
    expect(pickTolerance('mouse')).toBe(10)
    expect(pickTolerance('inconnu')).toBe(10)
  })

  it('un appui qui bouge de moins de quelques pixels reste un toucher', () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(4)
  })
})
