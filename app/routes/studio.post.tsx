import { useEffect, useState } from "react";
import { Form, Link, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/studio.post";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { absoluteUrl } from "~/.server/config";
import { convex, convexMessage } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { notFound, redirectWithFlash } from "~/.server/http";
import {
  checkForPreview,
  commentsFor,
  deliver,
  removeDelivery,
  replyTo,
  syncMetrics,
  wordsFor,
} from "~/.server/social/studio";
import { formatName, NETWORKS, type SocialProvider, type StatName, statsOf, statsUnavailable } from "~/lib/networks";
import { seo } from "~/lib/seo";
import { Icon } from "~/components/Icon";
import { CopyButton } from "~/components/Shared";
import { formatCount, MetricRow, NetworkBadge, StatusPill, StudioNav, sumMetrics } from "~/components/Studio";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const [post, review, snippets] = await Promise.all([
    convex.query(api.social.get, { userId: user._id, postId: params.id }),
    convex.query(api.studio.reviewFor, { userId: user._id, postId: params.id }),
    convex.query(api.studio.snippets, { userId: user._id }),
  ]);
  if (!post) notFound();
  // What each account got, as it was sent.
  const words = Object.fromEntries([
    ...post.deliveries.map((row) => [row.provider, wordsFor(row.provider, post)]),
    ...post.deliveries.map((row) => [row.id, wordsFor(row.provider, post, { account: { _id: row.accountId } })]),
  ]) as Record<string, string>;
  return {
    post,
    words,
    timeZone: user.timeZone,
    review: {
      feedback: review?.feedback ?? [],
      url: review?.token ? absoluteUrl(`/review/${review.token}`) : null,
    },
    replies: snippets.filter((snippet) => snippet.kind === "reply"),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  const here = `/studio/posts/${params.id}`;
  try {
    switch (formText(form, "intent")) {
      case "retry": {
        const queued = await convex.mutation(api.social.retry, { userId: user._id, postId: params.id });
        if (queued > 0) await deliver(params.id, user._id);
        return redirectWithFlash(here, {
          tone: "info",
          message: queued ? "Trying the failed ones again." : "Nothing to retry.",
        });
      }
      case "refresh": {
        const read = await syncMetrics({ postId: params.id, userId: user._id });
        return redirectWithFlash(here, { tone: "success", message: read ? "Stats updated." : "No stats to read yet." });
      }
      case "cancel": {
        const cancelled = await convex.mutation(api.social.cancel, { userId: user._id, postId: params.id });
        return redirectWithFlash(here, {
          tone: cancelled ? "info" : "error",
          message: cancelled ? "Cancelled. Nothing went out." : "It's already gone out.",
        });
      }
      case "discard":
        await convex.mutation(api.social.discard, { userId: user._id, postId: params.id });
        return redirectWithFlash("/studio", { tone: "info", message: "Draft deleted." });
      case "remove": {
        const problem = await removeDelivery(user, formText(form, "deliveryId"));
        return redirectWithFlash(
          here,
          problem ? { tone: "error", message: problem } : { tone: "info", message: "Taken down." },
        );
      }
      case "comments": {
        const result = await commentsFor(user, formText(form, "deliveryId"));
        return { kind: "comments" as const, ...result };
      }
      case "reply": {
        const problem = await replyTo(
          user,
          formText(form, "deliveryId"),
          { commentId: formText(form, "commentId") || null, cid: formText(form, "cid") || undefined },
          formText(form, "text"),
        );
        return { kind: "reply" as const, error: problem, sent: !problem };
      }
      case "review-create": {
        const problem = await checkForPreview(user._id, params.id);
        if (problem) return redirectWithFlash(here, { tone: "error", message: problem });
        await convex.mutation(api.studio.createReview, { userId: user._id, postId: params.id });
        return redirectWithFlash(here, {
          tone: "success",
          message: "Preview link made. Anyone with it can see the post for 14 days.",
        });
      }
      case "review-revoke":
        await convex.mutation(api.studio.revokeReview, { userId: user._id, postId: params.id });
        return redirectWithFlash(here, { tone: "info", message: "That preview link no longer works." });
    }
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash(here, { tone: "error", message });
    throw error;
  }
  return redirectWithFlash(here);
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Studio post", noindex: true });

const COLUMNS: readonly StatName[] = ["views", "likes", "comments", "shares", "reposts", "saves"];

export default function StudioPost({ loaderData }: Route.ComponentProps) {
  const { post, words, review, replies, timeZone } = loaderData;
  const revalidator = useRevalidator();
  const scheduled = post.scheduledAt !== null && !post.released && !post.cancelled && !post.draft;
  const moving = post.deliveries.some(
    (row) =>
      ["sending", "processing"].includes(row.status) ||
      (row.status === "queued" && !scheduled && !post.cancelled && !post.draft),
  );
  const failed = post.deliveries.some((row) => row.status === "error");
  const totals = sumMetrics(post.deliveries.filter((row) => !row.repost).map((row) => row.metrics));
  const clicks = post.links.reduce((total, row) => total + row.clicks, 0);
  const shape = {
    images: post.media.filter((item) => item.kind === "image").length,
    video:
      post.media.find((item) => item.kind === "video")?.duration ??
      (post.media.some((item) => item.kind === "video") ? 0 : null),
    documents: post.media.filter((item) => item.kind === "document").length,
  };
  const lastRead = Math.max(0, ...post.deliveries.map((row) => row.metricsAt ?? 0));
  const when = (at: number) =>
    new Date(at).toLocaleString("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" });
  const commentable = post.deliveries.filter(
    (row) => row.status === "ok" && !row.repost && NETWORKS[row.provider].comments,
  );

  // Uploads that process (Instagram, TikTok, X video) finish on their own; keep the page current until they do.
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => revalidator.revalidate(), 4000);
    return () => clearInterval(timer);
  }, [moving, revalidator]);

  return (
    <section className="mx-auto max-w-5xl px-4 pt-10 pb-16">
      <Link to="/studio" className="inline-flex min-h-11 items-center gap-1 font-bold text-muted hover:text-ink">
        <Icon name="left" className="size-4" /> Studio
      </Link>
      <div className="mt-2">
        <StudioNav />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <p className="text-sm text-muted">
            {post.draft
              ? "Draft"
              : post.cancelled
                ? "Cancelled"
                : scheduled
                  ? `Scheduled for ${when(post.scheduledAt!)}`
                  : `Posted ${when(post.scheduledAt ?? post.createdAt)}`}
            {post.product && ` · for ${post.product.name}`}
            {post.repeat && ` · repeats every ${post.repeat.everyDays} days, ${post.repeat.remaining} more times`}
            {post.source !== "web" &&
              ` · from ${post.source === "rss" ? "an RSS feed" : post.source === "csv" ? "a spreadsheet" : "the API"}`}
          </p>
          {post.options.youtube?.title && <h1 className="title-3 mt-2">{post.options.youtube.title}</h1>}
          <p className="mt-2 text-[1.0625rem] whitespace-pre-wrap">{post.text}</p>
          {post.thread.length > 0 && (
            <ol className="mt-3 grid list-decimal gap-1 border-l-2 border-line pl-6 text-[0.9375rem]" start={2}>
              {post.thread.map((part, index) => (
                <li key={index} className="whitespace-pre-wrap">
                  {part}
                </li>
              ))}
            </ol>
          )}
          {post.firstComment && (
            <p className="mt-3 text-sm">
              <strong>First comment:</strong> {post.firstComment}
            </p>
          )}
          {post.link && (
            <a href={post.link} className="link mt-2 inline-block break-all" target="_blank" rel="noopener">
              {post.link}
            </a>
          )}
          {post.tags.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1">
              {post.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-sunk px-2 text-xs font-bold text-muted">
                  #{tag}
                </span>
              ))}
            </p>
          )}
          {post.note && (
            <p className="mt-3 rounded-xl bg-raised p-3 text-sm whitespace-pre-wrap">
              <strong>Note:</strong> {post.note}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {post.editable && (
              <Link to={`/studio?edit=${post.id}`} className="btn btn-ink btn-sm">
                Edit
              </Link>
            )}
            <Link to={`/studio?copy=${post.id}`} className="btn btn-quiet btn-sm">
              Use again
            </Link>
            {post.draft && (
              <Form method="post">
                <input type="hidden" name="intent" value="discard" />
                <button type="submit" className="btn btn-quiet btn-sm">
                  Delete draft
                </button>
              </Form>
            )}
          </div>
        </div>
        {post.media.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {post.media.map((item) =>
              item.url ? (
                item.kind === "video" ? (
                  <video key={item.id} src={item.url} controls className="col-span-2 w-full rounded-xl bg-sunk" />
                ) : item.kind === "document" ? (
                  <a
                    key={item.id}
                    href={item.url}
                    className="col-span-2 rounded-xl bg-raised p-3 font-bold underline"
                    target="_blank"
                    rel="noopener"
                  >
                    PDF document
                  </a>
                ) : (
                  <img
                    key={item.id}
                    src={item.url}
                    alt={item.alt}
                    className="aspect-square w-full rounded-xl object-cover"
                  />
                )
              ) : null,
            )}
          </div>
        )}
      </div>

      {(scheduled || post.draft) && (
        <div className="panel mt-8">
          <h2 className="title-3">Preview link</h2>
          <p className="mt-1 text-muted">
            Send it to a client or teammate: they see the post as each network will show it, and say if it’s good to go.
            No account needed. It lasts 14 days.
          </p>
          {review.url ? (
            <div className="mt-3 grid gap-2">
              <code className="block rounded-xl bg-sunk p-3 text-sm break-all">{review.url}</code>
              <div className="flex flex-wrap gap-2">
                <div className="w-40">
                  <CopyButton value={review.url} />
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="review-revoke" />
                  <button type="submit" className="btn btn-quiet btn-sm">
                    Turn it off
                  </button>
                </Form>
              </div>
            </div>
          ) : (
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="review-create" />
              <button type="submit" className="btn btn-ink btn-sm">
                Make a preview link
              </button>
            </Form>
          )}
        </div>
      )}
      {review.feedback.length > 0 && (
        <ul className="mt-4 grid gap-2 text-sm" aria-label="Feedback">
          {review.feedback.map((item) => (
            <li key={item.at} className={`rounded-xl p-3 ${item.verdict === "approve" ? "bg-slop/15" : "bg-hot/10"}`}>
              <strong>{item.name}</strong> · {item.verdict === "approve" ? "Looks good" : "Needs changes"} ·{" "}
              {when(item.at)}
              {item.note && <p className="mt-1 whitespace-pre-wrap">{item.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="title-2">Across {post.deliveries.length} accounts</h2>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4">
            <MetricRow metrics={totals} names={["views", "likes", "comments", "shares", "reposts"]} />
            {post.trackLinks && (
              <span className="text-sm">
                <span className="text-muted">Clicks</span>{" "}
                <strong className="tabular-nums">{formatCount(clicks)}</strong>
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {scheduled && (
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <button type="submit" className="btn btn-quiet btn-sm">
                Cancel
              </button>
            </Form>
          )}
          {failed && (
            <Form method="post">
              <input type="hidden" name="intent" value="retry" />
              <button type="submit" className="btn btn-ink btn-sm">
                <Icon name="sync" className="size-4" /> Retry failed
              </button>
            </Form>
          )}
          {!scheduled && !post.draft && (
            <Form method="post">
              <input type="hidden" name="intent" value="refresh" />
              <button type="submit" className="btn btn-ink btn-sm">
                <Icon name="sync" className="size-4" /> Refresh stats
              </button>
            </Form>
          )}
        </div>
      </div>
      {lastRead > 0 && (
        <p className="mt-2 text-sm text-muted">
          Stats from each network, last read {when(lastRead)}. They update on their own for a month.
        </p>
      )}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-2 pr-3 font-bold">
                Account
              </th>
              <th scope="col" className="py-2 pr-3 font-bold">
                Status
              </th>
              {COLUMNS.map((name) => (
                <th key={name} scope="col" className="py-2 pr-3 text-right font-bold capitalize">
                  {name}
                </th>
              ))}
              {post.trackLinks && (
                <th scope="col" className="py-2 pr-3 text-right font-bold">
                  Clicks
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {post.deliveries.map((row) => {
              const spec = NETWORKS[row.provider];
              const stats = row.repost ? [] : statsOf(row.provider);
              const link = post.links.find((item) => item.provider === row.provider);
              return (
                <tr key={row.id} className="border-b border-line align-top">
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <NetworkBadge provider={row.provider} />
                      <div className="min-w-0">
                        <p className="font-bold">{row.handle}</p>
                        <p className="text-xs text-muted">
                          {row.repost ? "Repost" : formatName(row.provider, shape, post.options.instagram?.format)} on{" "}
                          {spec.label}
                          {row.parts > 0 && ` · +${row.parts} replies`}
                          {row.url && (
                            <>
                              {" · "}
                              <a href={row.url} target="_blank" rel="noopener" className="underline">
                                view
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    {!row.repost && (
                      <details className="mt-1 text-xs text-muted">
                        <summary className="cursor-pointer">What it said</summary>
                        <p className="mt-1 max-w-sm whitespace-pre-wrap">{words[row.id] ?? words[row.provider]}</p>
                      </details>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <StatusPill status={row.status} scheduled={scheduled} draft={post.draft} />
                    {row.notBefore && row.status === "queued" && (
                      <p className="mt-1 text-xs text-muted">Its turn: {when(row.notBefore)}</p>
                    )}
                    {row.message && (
                      <p className={`mt-1 max-w-56 text-xs ${row.status === "error" ? "text-hot" : "text-muted"}`}>
                        {row.message}
                      </p>
                    )}
                    {row.warning && <p className="mt-1 max-w-56 text-xs text-hot">{row.warning}</p>}
                    {row.status === "ok" && !row.repost && spec.canRemove && (
                      <Form
                        method="post"
                        className="mt-1"
                        onSubmit={(event) => {
                          if (!confirm(`Take it down from ${spec.label}?`)) event.preventDefault();
                        }}
                      >
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="deliveryId" value={row.id} />
                        <button type="submit" className="text-xs font-bold text-muted underline">
                          Take down
                        </button>
                      </Form>
                    )}
                  </td>
                  {COLUMNS.map((name) => (
                    <td key={name} className="py-3 pr-3 text-right font-bold tabular-nums">
                      {stats.includes(name) ? formatCount(row.metrics?.[name]) : <span className="text-muted">·</span>}
                    </td>
                  ))}
                  {post.trackLinks && (
                    <td className="py-3 pr-3 text-right font-bold tabular-nums">
                      {link ? formatCount(link.clicks) : "·"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {post.deliveries.some((row) => row.provider === "linkedin") && (
        <p className="mt-3 text-sm text-muted">{statsUnavailable("linkedin")}</p>
      )}

      {commentable.length > 0 && (
        <div className="mt-12">
          <h2 className="title-2">Comments</h2>
          <p className="mt-1 text-muted">
            Read what people said on each network, and answer as the account that posted.
          </p>
          <div className="mt-4 grid gap-4">
            {commentable.map((row) => (
              <Comments
                key={row.id}
                deliveryId={row.id}
                provider={row.provider}
                handle={row.handle}
                replies={replies}
              />
            ))}
          </div>
        </div>
      )}

      {post.activity.length > 0 && (
        <div className="mt-12">
          <h2 className="title-3">Activity</h2>
          <ol className="mt-3 grid gap-1 border-l-2 border-line pl-4 text-sm">
            {post.activity
              .slice()
              .reverse()
              .map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <span className="text-muted tabular-nums">{when(entry.at)}</span> · {entry.detail}
                </li>
              ))}
          </ol>
        </div>
      )}
    </section>
  );
}

interface CommentsData {
  kind: "comments";
  comments: { id: string; cid?: string; author: string; text: string; at: string | null }[];
  error: string | null;
}
interface ReplyData {
  kind: "reply";
  error: string | null;
  sent: boolean;
}

function Comments({
  deliveryId,
  provider,
  handle,
  replies,
}: {
  deliveryId: string;
  provider: SocialProvider;
  handle: string;
  replies: readonly { id: string; name: string; text: string }[];
}) {
  const reader = useFetcher<CommentsData>();
  const sender = useFetcher<ReplyData>();
  const [answering, setAnswering] = useState<string | null>(null);
  const [text, setText] = useState("");
  const canReply = NETWORKS[provider].comments?.replies ?? false;
  useEffect(() => {
    if (sender.data?.sent) {
      setText("");
      setAnswering(null);
    }
  }, [sender.data]);
  return (
    <div className="panel">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-bold">
          <NetworkBadge provider={provider} size="sm" /> {handle}
        </p>
        <reader.Form method="post">
          <input type="hidden" name="intent" value="comments" />
          <input type="hidden" name="deliveryId" value={deliveryId} />
          <button type="submit" className="btn btn-quiet btn-sm" disabled={reader.state !== "idle"}>
            {reader.state !== "idle" ? "Reading…" : reader.data ? "Read again" : "Read comments"}
          </button>
        </reader.Form>
      </div>
      {reader.data?.error && <p className="mt-2 text-sm text-hot">{reader.data.error}</p>}
      {reader.data && !reader.data.error && reader.data.comments.length === 0 && (
        <p className="mt-2 text-sm text-muted">No comments yet.</p>
      )}
      {sender.data?.sent && <p className="mt-2 text-sm text-slop-text">Replied.</p>}
      <ul className="mt-3 grid gap-2">
        {reader.data?.comments.map((comment) => (
          <li key={comment.id} className="rounded-xl bg-raised p-3 text-sm">
            <p>
              <strong>{comment.author}</strong>
              {comment.at && <span className="text-muted"> · {new Date(comment.at).toLocaleDateString()}</span>}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{comment.text}</p>
            {canReply && (
              <button
                type="button"
                className="mt-1 text-xs font-bold underline"
                onClick={() => setAnswering(answering === comment.id ? null : comment.id)}
              >
                Reply
              </button>
            )}
            {answering === comment.id && (
              <sender.Form method="post" className="mt-2 grid gap-2">
                <input type="hidden" name="intent" value="reply" />
                <input type="hidden" name="deliveryId" value={deliveryId} />
                <input type="hidden" name="commentId" value={comment.id} />
                <input type="hidden" name="cid" value={comment.cid ?? ""} />
                {replies.length > 0 && (
                  <select
                    className="input min-h-9 py-1 text-sm"
                    value=""
                    aria-label="Saved reply"
                    onChange={(event) => setText(replies.find((item) => item.id === event.target.value)?.text ?? text)}
                  >
                    <option value="">Saved replies…</option>
                    {replies.map((reply) => (
                      <option key={reply.id} value={reply.id}>
                        {reply.name}
                      </option>
                    ))}
                  </select>
                )}
                <textarea
                  name="text"
                  className="input min-h-16"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  aria-label={`Reply to ${comment.author}`}
                />
                <button
                  type="submit"
                  className="btn btn-ink btn-sm justify-self-start"
                  disabled={sender.state !== "idle"}
                >
                  {sender.state !== "idle" ? "Checking…" : `Reply as ${handle}`}
                </button>
                {sender.data?.error && <p className="text-hot">{sender.data.error}</p>}
              </sender.Form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
