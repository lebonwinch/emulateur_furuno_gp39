// Bips des touches et avertisseur d'alarme (WebAudio). Le contexte n'est créé qu'après un geste utilisateur.

let ctx: AudioContext | null = null
let alarmTimer: ReturnType<typeof setTimeout> | undefined
let alarmStop = false

function context(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

/** Réveille le contexte audio (à appeler depuis un événement utilisateur). */
export function unlockAudio(): void {
  const c = context()
  if (c && c.state === 'suspended') void c.resume()
}

export function beep(freq = 2400, ms = 45, volume = 0.08): void {
  const c = context()
  if (!c) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  gain.gain.value = volume
  osc.connect(gain)
  gain.connect(c.destination)
  const t = c.currentTime
  osc.start(t)
  osc.stop(t + ms / 1000)
}

export type BuzzerType = 'Short' | 'Long' | 'Cont.'

/** Démarre l'avertisseur selon le type choisi dans Alarms > Buzzer (manuel §6.2). */
export function startAlarmBuzzer(type: BuzzerType): void {
  stopAlarmBuzzer()
  alarmStop = false
  let n = 0
  const step = (): void => {
    if (alarmStop) return
    if (type === 'Short') {
      // bip court 1 s, silence 1 s, en boucle
      beep(2000, 1000, 0.07)
      alarmTimer = setTimeout(step, 2000)
    } else if (type === 'Long') {
      // trois bips longs d'environ 3 s
      beep(1500, 3000, 0.07)
      n++
      alarmTimer = n < 3 ? setTimeout(step, 3500) : undefined
    } else {
      beep(1500, 3000, 0.07)
      alarmTimer = setTimeout(step, 3000)
    }
  }
  step()
}

export function stopAlarmBuzzer(): void {
  alarmStop = true
  if (alarmTimer) clearTimeout(alarmTimer)
  alarmTimer = undefined
}
