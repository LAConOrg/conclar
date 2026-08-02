/**
 * The Cache Storage prefix used for this convention's precache.
 *
 * @param {string} appId config.json's APP_ID.
 * @returns {string}
 */
export function cacheIdPrefix(appId) {
  return `conclar-${appId}`;
}
