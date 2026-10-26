<template>
  <div class="keys text-body2">
    <div><kbd>↑ ↓ ← →</kbd> CursorPad <kbd>Home PgUp End PgDn</kbd> diagonales</div>
    <div><kbd>Entrée</kbd> ENT/CNTR (maintenu : centrer le bateau)</div>
    <div><kbd>M</kbd> / <kbd>Échap</kbd> MENU</div>
    <div><kbd>D</kbd> DISP (maintenu : sens inverse)</div>
    <div><kbd>G</kbd> GO TO</div>
    <div><kbd>Espace</kbd> MARK (maintenu : MOB)</div>
    <div><kbd>B</kbd> BRILL (maintenu 3 s : arrêt)</div>
    <div><kbd>+</kbd> <kbd>−</kbd> zoom du plotter · molette sur l’écran</div>
    <div>Dans un champ de saisie : taper directement les caractères.</div>
  </div>
</template>

<style scoped lang="scss">
// Raccourcis clavier de la façade : contenu de l'onglet du même nom de la fenêtre d'aide.
kbd {
  display: inline-block;
  padding: 0 5px;
  margin: 0 1px;
  border: 1px solid rgba(128, 128, 128, 0.6);
  border-radius: 3px;
  font-size: 12px;
  background: rgba(128, 128, 128, 0.12);
}
.keys > div {
  margin-bottom: 8px;
}
</style>
