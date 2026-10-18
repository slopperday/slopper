import type { PathsQuery } from "./queries";
import type { EventRow } from "./rows";

export interface PathNode {
  /** `${step}:${path}`: the same page at another step is another node. */
  id: string;
  step: number;
  path: string;
  sessions: number;
  /** Sessions whose journey (as far as it's followed) ended here. */
  dropoffs: number;
}

export interface PathLink {
  source: string;
  target: string;
  sessions: number;
}

export interface PathsResult {
  kind: "paths";
  nodes: PathNode[];
  links: PathLink[];
  /** The most common whole journeys. */
  journeys: { pages: string[]; sessions: number }[];
}

/** Links shown, busiest first, so the diagram stays readable. */
export const PATH_LINK_LIMIT = 60;
export const JOURNEY_LIMIT = 20;

/**
 * User journeys: the pages each session viewed, in order, with repeats of
 * the same page in a row collapsed. Feed page views with `add`, in any
 * order.
 */
export class PathsAggregator {
  private readonly views = new Map<string, { at: number; path: string }[]>();

  constructor(private readonly query: PathsQuery) {}

  add(event: EventRow): void {
    if (!event.sessionId || !event.path) return;
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    let list = this.views.get(event.sessionId);
    if (!list) {
      list = [];
      this.views.set(event.sessionId, list);
    }
    list.push({ at: event.timestamp, path: event.path });
  }

  /** One session's journey, cut to the query's start and end pages and its length. */
  private journey(views: { at: number; path: string }[]): string[] | null {
    const steps = Math.max(1, Math.floor(this.query.steps));
    const pages: string[] = [];
    for (const view of [...views].sort((a, b) => a.at - b.at)) {
      if (pages.at(-1) !== view.path) pages.push(view.path);
    }
    let from = 0;
    if (this.query.startPath !== undefined) {
      from = pages.indexOf(this.query.startPath);
      if (from < 0) return null;
    }
    let journey = pages.slice(from);
    if (this.query.endPath !== undefined) {
      const end = journey.indexOf(this.query.endPath);
      if (end < 0) return null;
      journey = journey.slice(0, end + 1);
      return journey.slice(-steps);
    }
    return journey.slice(0, steps);
  }

  result(): PathsResult {
    const nodes = new Map<string, PathNode>();
    const links = new Map<string, PathLink>();
    const journeys = new Map<string, { pages: string[]; sessions: number }>();
    for (const views of this.views.values()) {
      const pages = this.journey(views);
      if (!pages || pages.length === 0) continue;
      const key = pages.join("\u0000");
      const known = journeys.get(key);
      if (known) known.sessions += 1;
      else journeys.set(key, { pages, sessions: 1 });
      pages.forEach((path, step) => {
        const id = `${step}:${path}`;
        const node = nodes.get(id) ?? { id, step, path, sessions: 0, dropoffs: 0 };
        node.sessions += 1;
        if (step === pages.length - 1) node.dropoffs += 1;
        nodes.set(id, node);
        if (step === 0) return;
        const source = `${step - 1}:${pages[step - 1]}`;
        const linkId = `${source}\u0000${id}`;
        const link = links.get(linkId) ?? { source, target: id, sessions: 0 };
        link.sessions += 1;
        links.set(linkId, link);
      });
    }
    // Busiest first; ties in a fixed order, so the same data always draws the same picture.
    const shownLinks = [...links.values()]
      .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
      .slice(0, PATH_LINK_LIMIT);
    const linked = new Set(shownLinks.flatMap((link) => [link.source, link.target]));
    const shownNodes = [...nodes.values()]
      // A journey of one page has no links, but its page still belongs in the picture.
      .filter((node) => linked.has(node.id) || node.step === 0)
      .sort((a, b) => a.step - b.step || b.sessions - a.sessions || a.path.localeCompare(b.path));
    return {
      kind: "paths",
      nodes: shownNodes,
      links: shownLinks,
      journeys: [...journeys.entries()]
        .sort(([keyA, a], [keyB, b]) => b.sessions - a.sessions || keyA.localeCompare(keyB))
        .slice(0, JOURNEY_LIMIT)
        .map(([, journey]) => journey),
    };
  }
}
