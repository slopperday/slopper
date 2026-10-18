import type { CSSProperties } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Font,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";
import { type DigestItem, digestHeadline, digestLine, type SlopSummary, summariseDigest } from "../lib/digest";
import { formatMoney } from "../lib/money";

/**
 * The daily digest, on brand: a departures board of the slops that moved,
 * with split-flap tiles for the numbers. Preview it with `vp run email`.
 * Relative imports only: Convex bundles this for `convex/digestSend.ts`.
 */

export interface DigestEmailProps {
  username: string;
  items: readonly DigestItem[];
  /** The site's origin: emails have no base URL, so every link is absolute. */
  appUrl: string;
  unsubscribeUrl: string;
}

// From DESIGN.md.
const color = {
  ground: "#f4f5f0",
  raised: "#ffffff",
  ink: "#161a13",
  muted: "#575d50",
  line: "#dfe2d8",
  board: "#161a13",
  boardInk: "#eef0e8",
  boardMuted: "#9aa18f",
  tile: "#262b22",
  slop: "#9be22d",
  slopInk: "#10140b",
  gold: "#ffc21a",
} as const;

const display = "'Big Shoulders', 'Arial Narrow', Arial, sans-serif";
const body = "'Schibsted Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function tiles(slop: SlopSummary): { value: string; label: string }[] {
  return [
    slop.upvotes ? { value: `▲ ${slop.upvotes}`, label: slop.upvotes === 1 ? "upvote" : "upvotes" } : null,
    slop.pledges
      ? { value: formatMoney(slop.pledged, "USD"), label: slop.pledges === 1 ? "pledged" : `${slop.pledges} pledges` }
      : null,
    slop.feedback ? { value: String(slop.feedback), label: "feedback" } : null,
    slop.kudos ? { value: String(slop.kudos), label: "kudos" } : null,
    slop.reviews ? { value: String(slop.reviews), label: slop.reviews === 1 ? "review" : "reviews" } : null,
  ].filter((tile) => tile !== null);
}

export function DigestEmail({ username, items, appUrl, unsubscribeUrl }: DigestEmailProps) {
  const slops = summariseDigest(username, items);
  const headline = digestHeadline(slops);
  const url = (path: string) => new URL(path, appUrl).href;

  return (
    <Html lang="en">
      <Head>
        <Font
          fontFamily="Big Shoulders"
          fallbackFontFamily="Arial"
          webFont={{
            url: "https://fonts.gstatic.com/s/bigshoulders/v4/qFdk35CPh40oITJ69S3GFqy5-BQAcbz7z7beObrv_PytqyTi33thrko9yOTNB9k0DFNQtaIf.woff2",
            format: "woff2",
          }}
          fontWeight={800}
        />
        {/* Last, so it's the default for everything not set in Big Shoulders. */}
        <Font
          fontFamily="Schibsted Grotesk"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.gstatic.com/s/schibstedgrotesk/v7/Jqz55SSPQuCQF3t8uOwiUL-taUTtap9GayojdSFO.woff2",
            format: "woff2",
          }}
          fontWeight="400 700"
        />
      </Head>
      <Preview>{`${headline}. ${slops.map(digestLine).join(" · ")}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.masthead}>
            <Row>
              <Column style={{ width: 44 }}>
                <Img src={url("/icon-192.png")} width={36} height={36} alt="" style={styles.logo} />
              </Column>
              <Column>
                <Text style={styles.wordmark}>SLOPPER</Text>
              </Column>
              <Column align="right">
                <Text style={styles.edition}>DAILY DIGEST</Text>
              </Column>
            </Row>
          </Section>

          <Section style={styles.content}>
            <Heading as="h1" style={styles.headline}>
              {headline}
            </Heading>
            <Text style={styles.lede}>Here's what hit the wall since your last digest, @{username}.</Text>

            {slops.map((slop) => (
              <Section key={slop.path} style={styles.board}>
                {slop.won && <Text style={styles.won}>🏆 SLOP OF THE DAY</Text>}
                <Link href={url(slop.path)} style={styles.slopName}>
                  {slop.title}
                </Link>
                <Row style={styles.tiles}>
                  {tiles(slop).map((tile) => (
                    <Column key={tile.label} style={styles.tileCell}>
                      <Text style={styles.tile}>{tile.value}</Text>
                      <Text style={styles.tileLabel}>{tile.label.toUpperCase()}</Text>
                    </Column>
                  ))}
                  {/* Takes the rest of the row, so the tiles keep to their size. */}
                  <Column />
                </Row>
              </Section>
            ))}

            <Section style={styles.cta}>
              <Button href={url("/notifications")} style={styles.button}>
                See it on Slopper
              </Button>
            </Section>
          </Section>

          <Section style={styles.footer}>
            <Text style={styles.footnote}>Sent at 9am your time, only on days something happened. Keep slopping.</Text>
            <Text style={styles.footnote}>
              <Link href={unsubscribeUrl} style={styles.footerLink}>
                Stop these emails
              </Link>
              {" · "}
              <Link href={url("/settings#email-digest")} style={styles.footerLink}>
                Settings
              </Link>
              {" · "}
              <Link href={url("/")} style={styles.footerLink}>
                slopper.day
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: { backgroundColor: color.ground, margin: 0, padding: "24px 0", fontFamily: body, color: color.ink },
  container: { maxWidth: 560, margin: "0 auto", padding: "0 12px" },
  masthead: { backgroundColor: color.board, borderRadius: "16px 16px 0 0", padding: "14px 20px" },
  logo: { borderRadius: 8, display: "block" },
  wordmark: {
    margin: 0,
    fontFamily: display,
    fontWeight: 800,
    fontSize: 26,
    lineHeight: "36px",
    letterSpacing: "0.04em",
    color: color.boardInk,
  },
  edition: {
    margin: 0,
    fontFamily: display,
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: "0.12em",
    color: color.slop,
  },
  content: {
    backgroundColor: color.raised,
    padding: "28px 24px 8px",
    border: `1px solid ${color.line}`,
    borderTop: "none",
    borderRadius: "0 0 16px 16px",
  },
  headline: {
    margin: "0 0 8px",
    fontFamily: display,
    fontWeight: 800,
    fontSize: 38,
    lineHeight: "40px",
    color: color.ink,
  },
  lede: { margin: "0 0 22px", fontSize: 17, lineHeight: "26px", color: color.muted },
  board: { backgroundColor: color.board, borderRadius: 14, padding: "16px 18px", marginBottom: 12 },
  won: {
    margin: "0 0 6px",
    fontFamily: display,
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: "0.12em",
    color: color.gold,
  },
  slopName: {
    fontFamily: display,
    fontWeight: 800,
    fontSize: 26,
    lineHeight: "28px",
    color: color.boardInk,
    textDecoration: "none",
  },
  tiles: { marginTop: 12 },
  tileCell: { width: "1%", paddingRight: 8, verticalAlign: "top", whiteSpace: "nowrap" },
  tile: {
    margin: 0,
    backgroundColor: color.tile,
    borderRadius: 6,
    padding: "6px 10px",
    fontFamily: display,
    fontWeight: 800,
    fontSize: 24,
    lineHeight: "28px",
    color: color.boardInk,
    whiteSpace: "nowrap",
  },
  tileLabel: {
    margin: "4px 0 0",
    fontSize: 11,
    letterSpacing: "0.1em",
    color: color.boardMuted,
  },
  cta: { padding: "14px 0 26px" },
  button: {
    backgroundColor: color.slop,
    color: color.slopInk,
    borderRadius: 12,
    padding: "14px 22px",
    fontWeight: 700,
    fontSize: 16,
    textDecoration: "none",
  },
  footer: { padding: "18px 24px" },
  footnote: { margin: "0 0 8px", fontSize: 13, lineHeight: "20px", color: color.muted },
  footerLink: { color: color.muted, textDecoration: "underline" },
} satisfies Record<string, CSSProperties>;

/** What `vp run email` shows. */
DigestEmail.PreviewProps = {
  username: "maker",
  appUrl: "https://slopper.day",
  unsubscribeUrl: "https://slopper.day/unsubscribe/preview",
  items: [
    { kind: "slop_of_the_day", slop: { id: "1", name: "TiltMaze", launchLabel: null, slug: "tiltmaze" }, amount: null },
    { kind: "upvote", slop: { id: "1", name: "TiltMaze", launchLabel: null, slug: "tiltmaze" }, amount: null },
    { kind: "upvote", slop: { id: "1", name: "TiltMaze", launchLabel: null, slug: "tiltmaze" }, amount: null },
    { kind: "pledge", slop: { id: "1", name: "TiltMaze", launchLabel: null, slug: "tiltmaze" }, amount: 2500 },
    { kind: "upvote", slop: { id: "2", name: "Slop Radio", launchLabel: "iOS app", slug: "slop-radio" }, amount: null },
    {
      kind: "feedback",
      slop: { id: "2", name: "Slop Radio", launchLabel: "iOS app", slug: "slop-radio" },
      amount: null,
    },
  ],
} satisfies DigestEmailProps;

export default DigestEmail;
