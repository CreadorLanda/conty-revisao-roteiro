import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { systemClock } from "./clock.ts";
import { ReviewService } from "./review.ts";

const service = new ReviewService({ clock: systemClock });
const port = Number(process.env.PORT ?? 3003);

serve({ fetch: createApp(service).fetch, port }, (info) => {
  console.log(`revisão de roteiro em http://127.0.0.1:${info.port}`);
});
