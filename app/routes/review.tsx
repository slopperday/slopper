import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/review";
import { api } from "@convex/_generated/api";
import { convex, convexMessage } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { notFound } from "~/.server/http";
import { wordsFor } from "~/.server/social/studio";
import { allowAction, callerAddress } from "~/.server/tokens";
import { NETWORKS, type SocialProvider } from "~/lib/networks";
import { PostPreview, type StudioAccount } from "~/components/Studio";

/**
 * A preview link (`/review/:token`): anyone with the address sees a post as
 * each network will show it, and says whether it's good to go. It expires
 * after 14 days and its owner can revoke it. It shows the post's words and
 * media only: never stats, notes, credentials or who else is on the account.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!(await allowAction(`review:${callerAddress(request)}`, 300, 3_600_000))) {
    throw new Response("Slow down a little.", { status: 429 });
  }
  const review = await convex.query(api.studio.reviewByToken, { token: params.token });
  if (!review) notFound();
  const [post, accounts] = await Promise.all([
    convex.query(api.social.get, { userId: review.userId, postId: review.postId }),
    convex.query(api.accounts.list, { userId: review.userId }),
  ]);
  if (!post) notFound();
  const picked = new Set(post.deliveries.filter((row) => !row.repost).map((row) => row.accountId));
  const previews = accounts
    .filter((account) => picked.has(account._id))
    .map((account) => ({
      account: {
        id: account._id,
        provider: account.provider,
        handle: account.handle,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        brand: null,
      } satisfies StudioAccount,
      text: wordsFor(account.provider, post, { account }),
    }));
  return {
    previews,
    media: post.media
      .filter((item) => item.url && item.kind !== "document")
      .map((item) => ({ kind: item.kind as "image" | "video", url: item.url! })),
    thread: post.thread,
    firstComment: post.firstComment,
    youtubeTitle: post.options.youtube?.title ?? null,
    scheduledAt: post.scheduledAt,
    expiresAt: review.expiresAt,
    feedback: review.feedback,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  if (!(await allowAction(`review-feedback:${callerAddress(request)}`, 20, 3_600_000))) {
    return { error: "Slow down a little.", sent: false };
  }
  const form = await request.formData();
  const verdict = formText(form, "verdict") === "approve" ? "approve" : "changes";
  try {
    await convex.mutation(api.studio.addFeedback, {
      token: params.token,
      name: formText(form, "name"),
      verdict,
      note: formText(form, "note"),
    });
  } catch (error) {
    return { error: convexMessage(error) ?? "That didn't send. Try again.", sent: false };
  }
  return { error: null, sent: true };
}

export const meta: Route.MetaFunction = () => [
  { title: "Post preview · Slopper" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function Review({ loaderData, actionData }: Route.ComponentProps) {
  const { previews, media, thread, firstComment, youtubeTitle, scheduledAt, expiresAt, feedback } = loaderData;
  const sending = useNavigation().state !== "idle";
  return (
    <section className="mx-auto max-w-5xl px-4 pt-10 pb-16">
      <p className="text-sm text-muted">Preview link · expires {new Date(expiresAt).toLocaleDateString()}</p>
      <h1 className="title-1 mt-2">How it will look</h1>
      <p className="lede mt-3 max-w-2xl">
        {scheduledAt ? `Set to go out ${new Date(scheduledAt).toLocaleString()}.` : "Not scheduled yet."} Say if it’s
        good to go, or what to change.
      </p>
      <div className="mt-8 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {previews.map(({ account, text }) => (
          <PostPreview
            key={account.id}
            account={account}
            text={text}
            title={account.provider === "youtube" ? (youtubeTitle ?? undefined) : undefined}
            media={media}
            over={false}
          />
        ))}
      </div>
      {(thread.length > 0 || firstComment) && (
        <div className="panel mt-6">
          {thread.length > 0 && (
            <>
              <h2 className="font-bold">Then, as a thread</h2>
              <ol className="mt-2 grid list-decimal gap-2 pl-5" start={2}>
                {thread.map((part, index) => (
                  <li key={index} className="whitespace-pre-wrap">
                    {part}
                  </li>
                ))}
              </ol>
            </>
          )}
          {firstComment && (
            <p className="mt-3">
              <strong>First comment:</strong> {firstComment}
            </p>
          )}
        </div>
      )}
      <Form method="post" className="panel mt-6 grid max-w-xl gap-3">
        <h2 className="title-3">Your verdict</h2>
        <input name="name" className="input" placeholder="Your name" maxLength={60} aria-label="Your name" />
        <textarea
          name="note"
          className="input min-h-24"
          placeholder="Anything to change? (optional)"
          maxLength={1000}
          aria-label="Note"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="verdict" value="approve" className="btn btn-slop" disabled={sending}>
            Looks good
          </button>
          <button type="submit" name="verdict" value="changes" className="btn btn-ink" disabled={sending}>
            Needs changes
          </button>
        </div>
        {actionData?.sent && (
          <p role="status" className="text-slop-text">
            Thanks. The maker can see what you said.
          </p>
        )}
        {actionData?.error && (
          <p role="alert" className="text-hot">
            {actionData.error}
          </p>
        )}
      </Form>
      {feedback.length > 0 && (
        <ul className="mt-6 grid max-w-xl gap-2 text-sm">
          {feedback.map((item) => (
            <li key={item.at} className="rounded-xl bg-raised p-3">
              <strong>{item.name}</strong> · {item.verdict === "approve" ? "Looks good" : "Needs changes"}
              {item.note && <p className="mt-1 whitespace-pre-wrap">{item.note}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-10 text-sm text-muted">
        Made with the Slopper studio, which posts to{" "}
        {Object.values(NETWORKS)
          .map((network) => network.label)
          .join(", ")}
        .
      </p>
    </section>
  );
}

export type { SocialProvider };
