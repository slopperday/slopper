/** A calendar feed (iCalendar) of scheduled studio posts, for Google Calendar, Apple Calendar or Outlook. */

function escape(text: string): string {
  return text.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\n");
}

function stamp(at: number): string {
  return new Date(at)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Lines over 75 octets fold with a space, as the format asks. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export function calendarFeed(
  events: readonly { id: string; at: number; text: string; networks: readonly string[]; url: string }[],
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Slopper//Studio//EN",
    "X-WR-CALNAME:Slopper studio",
    "CALSCALE:GREGORIAN",
  ];
  for (const event of events) {
    const summary = event.text.replace(/\s+/g, " ").slice(0, 80) || "Studio post";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@slopper.day`,
      `DTSTAMP:${stamp(Date.now())}`,
      `DTSTART:${stamp(event.at)}`,
      `DTEND:${stamp(event.at + 15 * 60_000)}`,
      fold(`SUMMARY:${escape(summary)}`),
      fold(`DESCRIPTION:${escape(`${event.networks.join(", ")}\n\n${event.text}`)}`),
      fold(`URL:${event.url}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
