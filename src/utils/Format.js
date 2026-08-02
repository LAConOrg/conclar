export class Format {
  /**
   * If tag contains a ":", capitalise the part before the colon, and add a space after the colon.
   * @param {string} raw
   * @returns string
   */
  static formatTag(raw) {
    let matches = raw.match(/^(.+):(.+)$/);
    if (matches && matches.length >= 3)
      return (
        matches[1].charAt(0).toUpperCase() +
        matches[1].substr(1).toLowerCase() +
        ": " +
        matches[2]
      );
    return raw;
  }

  /**
   * A timestamp as a clock time, with the weekday added once it's no longer
   * today - "3 days ago" on the Sunday of a convention is too vague to act on.
   *
   * @param {number} timestamp Milliseconds since the epoch.
   * @param {number} now Milliseconds since the epoch.
   * @param {boolean} hour12 Whether to use a 12-hour clock.
   * @returns {string}
   */
  static formatClockTime(timestamp, now, hour12) {
    const date = new Date(timestamp);
    const isToday = date.toDateString() === new Date(now).toDateString();
    return date.toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: hour12,
      ...(isToday ? {} : { weekday: "short" }),
    });
  }
}
