/**
 * reset-flow.ts — Décision du RESET (décision 28).
 *
 * Deux voies :
 *   - « Exporter l'archive puis effacer » : l'export DOIT réussir avant que
 *     quoi que ce soit soit effacé. Un échec d'export (`false`) n'efface RIEN
 *     et laisse l'appelant annoncer l'erreur.
 *   - « Effacer sans archive » : effacement direct, sans export.
 *
 * La logique est isolée du DOM pour être testée : `main.ts` fournit `exportZip`
 * (`Archive.exportZip`) et `performReset` (le nettoyage réel).
 */
export async function resetWithArchive(
  exportZip: () => Promise<boolean>,
  performReset: () => void | Promise<void>,
): Promise<boolean> {
  const exported = await exportZip();
  if (!exported) return false;
  await performReset();
  return true;
}
