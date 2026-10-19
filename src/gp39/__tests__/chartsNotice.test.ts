// Message sur la carte quand le dossier de cartes n'est pas lisible : un texte et une action pour chaque état.
import { describe, expect, it, vi } from 'vitest'
import { noticeFor, type NoticeState } from '../chartsNotice'

const state = (s: Partial<NoticeState>): NoticeState => ({
  phase: 'empty',
  step: '',
  dirName: '',
  files: 0,
  scanned: 0,
  total: 0,
  error: '',
  ...s,
})

describe('message sur la carte (cartes marines)', () => {
  const grant = vi.fn()
  const choose = vi.fn()

  it('rien à dire quand les cartes sont prêtes', () => {
    expect(noticeFor(state({ phase: 'ready' }), { grant, choose })).toBeNull()
  })

  it('accès à confirmer : le dit, avec le dossier, et propose de l’autoriser ou d’en choisir un autre', () => {
    const n = noticeFor(state({ phase: 'needs-permission', dirName: 'MBTiles_NOAA' }), { grant, choose })!
    expect(n.text).toContain('« MBTiles_NOAA »')
    expect(n.text).toContain('confirmer l’accès')
    expect(n.action!.label).toBe('Autoriser l’accès')
    n.action!.run()
    expect(grant).toHaveBeenCalledTimes(1)
    expect(n.other!.label).toBe('Autre dossier…')
    n.other!.run()
    expect(choose).toHaveBeenCalledTimes(1)
  })

  it('analyse en cours : l’avancement, sans bouton', () => {
    const l = noticeFor(state({ phase: 'scanning', step: 'listing', dirName: 'Cartes', files: 12345 }), { grant, choose })!
    expect(l.text).toContain('12')
    expect(l.text).toContain('345 fichiers')
    expect(l.action).toBeUndefined()
    const b = noticeFor(state({ phase: 'scanning', step: 'bsb', dirName: 'Cartes', scanned: 7, total: 40 }), { grant, choose })!
    expect(b.text).toContain('7 / 40')
  })

  it('erreur : la raison, et de quoi choisir un autre dossier', () => {
    const n = noticeFor(state({ phase: 'error', error: 'Aucune carte exploitable.' }), { grant, choose })!
    expect(n.text).toContain('Aucune carte exploitable.')
    expect(n.action!.label).toBe('Choisir le dossier…')
  })

  it('aucun dossier : propose de le choisir', () => {
    const n = noticeFor(state({ phase: 'empty' }), { grant, choose })!
    expect(n.text).toContain('aucun dossier choisi')
    n.action!.run()
    expect(choose).toHaveBeenCalled()
  })

  it('navigateur sans sélecteur de dossier (Firefox, Safari) : pas de bouton, on renvoie au panneau', () => {
    const empty = noticeFor(state({ phase: 'empty' }), { grant })!
    expect(empty.action).toBeUndefined()
    expect(empty.text).toContain('panneau')
    expect(noticeFor(state({ phase: 'needs-permission', dirName: 'x' }), { grant })!.other).toBeUndefined()
    expect(noticeFor(state({ phase: 'error', error: 'Oups' }), { grant })!.action).toBeUndefined()
  })
})
