import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";

/** Whether pictures go through the Image CDN here (`app/lib/images.ts`). */
export function useImageCdn(): boolean {
  return useRouteLoaderData<typeof rootLoader>("root")?.imageCdn ?? false;
}
