import { handle } from "hono/cloudflare-pages";
import app from "../src/index";
import type { Env } from "../src/types";

const hono = handle(app);

export const onRequest: PagesFunction<Env> = async (context) => {
  // Hono's Pages EventContext type is slightly stricter than workers-types; cast at the boundary.
  const response = await hono(context as Parameters<typeof hono>[0]);
  if (response.status !== 404) {
    return response;
  }
  return context.env.ASSETS.fetch(context.request);
};