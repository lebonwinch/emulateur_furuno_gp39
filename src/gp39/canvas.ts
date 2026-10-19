// Types de canevas 2D communs aux moteurs de tuiles dessinées (CM93, MBTiles) : OffscreenCanvas dans un Worker, canevas ordinaire sinon.

export type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export interface Canvas2D {
  width: number
  height: number
  getContext(type: '2d'): Ctx | null
}

export type MakeCanvas = (w: number, h: number) => Canvas2D
