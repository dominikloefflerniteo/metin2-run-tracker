/* Version der App — EINZIGE Stelle, an der sie steht.
 *
 * REGEL: bei jeder Änderung (Fehlerbehebung oder Funktion) hier hochzählen
 * UND denselben Eintrag oben in CHANGELOG.md ergänzen. Der Smoketest
 * vergleicht beide; weichen sie ab, schlägt er fehl.
 *
 *   dritte Stelle  -> Fehlerbehebung, Kleinigkeit
 *   zweite Stelle  -> neue Funktion
 *   erste Stelle   -> wenn es sich rund anfühlt (1.0 = im täglichen Einsatz)
 */
window.APP_VERSION = {
  number: '0.10.0',
  date: '2026-08-21',
  note: 'Watchlist mit Boni-Filter und Treffer-Alarm'
};
