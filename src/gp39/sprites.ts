// Cache de pictogrammes pré-rendus (un petit canvas par symbole/couleur/taille) : dessiner 10 000 waypoints
// avec drawImage est bien plus rapide que de remplir leurs tracés vectoriels à chaque image.

import { drawMark } from './symbols'

const PAD = 2
const cache = new Map<string, HTMLCanvasElement>()

/**
 * Sprite d'un symbole : `devicePx` = taille du pictogramme en pixels écran (pas en pixels LCD).
 * `halo` ajoute un liseré blanc (lisibilité sur un fond de carte).
 */
export function markSprite(symbol: number, color: number, devicePx: number, halo = false): HTMLCanvasElement {
  const px = Math.max(4, Math.round(devicePx))
  const key = `${symbol}/${color}/${px}/${halo ? 1 : 0}`
  let c = cache.get(key)
  if (!c) {
    const pad = halo ? PAD + 2 : PAD
    c = document.createElement('canvas')
    c.width = c.height = px + pad * 2
    const g = c.getContext('2d')
    if (g) {
      if (halo) {
        // silhouette blanche du pictogramme, décalée dans 8 directions, sous le pictogramme coloré
        const sil = document.createElement('canvas')
        sil.width = sil.height = c.width
        const sg = sil.getContext('2d')
        if (sg) {
          drawMark(sg, symbol, color, sil.width / 2, sil.height / 2, px)
          sg.globalCompositeOperation = 'source-in'
          sg.fillStyle = '#fff'
          sg.fillRect(0, 0, sil.width, sil.height)
          const d = Math.max(1, Math.round(px / 10))
          for (let a = 0; a < 8; a++)
            g.drawImage(sil, Math.round(Math.cos((a * Math.PI) / 4) * d), Math.round(Math.sin((a * Math.PI) / 4) * d))
        }
      }
      drawMark(g, symbol, color, c.width / 2, c.height / 2, px)
    }
    cache.set(key, c)
    if (cache.size > 800) cache.delete(cache.keys().next().value as string)
  }
  return c
}

/**
 * Dessine le sprite centré en (x, y) exprimés dans le repère LCD ; `s` = pixels écran par pixel LCD.
 * La position est alignée sur la grille de pixels écran pour rester nette.
 */
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, s: number): void {
  const px = Math.round(x * s - sprite.width / 2)
  const py = Math.round(y * s - sprite.height / 2)
  ctx.drawImage(sprite, px / s, py / s, sprite.width / s, sprite.height / s)
}
