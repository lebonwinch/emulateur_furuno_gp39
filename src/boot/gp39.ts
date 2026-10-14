import { defineBoot } from '#q-app'
import { model as magModel } from 'geomagnetism'
import '@fontsource/roboto-condensed/600.css'
import '@fontsource/roboto-condensed/700.css'
import '@fontsource/vt323/400.css'
import { setDeclinationProvider } from '@/gp39/geo'
import { useDevice } from '@/stores/device'
import { centerOnShip } from '@/gp39/ui/plotter'

export default defineBoot(async ({ store }) => {
  // déclinaison magnétique : modèle WMM (fourni par le paquet geomagnetism)
  try {
    let model = magModel(new Date(), { allowOutOfBoundsModel: true })
    let modelYear = new Date().getFullYear()
    setDeclinationProvider((lat, lon, date = new Date()) => {
      if (date.getFullYear() !== modelYear) {
        model = magModel(date, { allowOutOfBoundsModel: true })
        modelYear = date.getFullYear()
      }
      return model.point([lat, lon]).decl
    })
  } catch (e) {
    console.warn('[gp39] modèle magnétique indisponible', e)
  }

  const device = useDevice(store)
  await device.hydrate()
  device.startPersistence()
  centerOnShip()
  device.start()
})
