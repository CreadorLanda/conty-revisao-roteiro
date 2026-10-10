import { Hono } from "hono";
import { ReviewError, ReviewService } from "./review.ts";

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  empty_content: 400,
  missing_reason: 400,
  missing_deadline: 400,
  invalid_deadline: 400,
  deadline_passed: 409,
  not_pending: 409,
  already_approved: 409,
};

async function readJson(raw: unknown): Promise<Record<string, unknown>> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function createApp(service: ReviewService) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/reviews", async (c) => {
    const body = await readJson(await c.req.json().catch(() => null));
    const review = service.submitScript(body.content);
    return c.json(review, 201);
  });

  app.get("/reviews/:id", (c) => c.json(service.find(c.req.param("id"))));

  app.post("/reviews/:id/versions", async (c) => {
    const body = await readJson(await c.req.json().catch(() => null));
    const review = service.submitNewVersion(c.req.param("id"), body.content);
    return c.json(review, 201);
  });

  app.post("/reviews/:id/change-requests", async (c) => {
    const body = await readJson(await c.req.json().catch(() => null));
    const review = service.requestChanges(c.req.param("id"), body.reason, body.deadline);
    return c.json(review, 201);
  });

  app.post("/reviews/:id/approval", async (c) => {
    const review = service.approve(c.req.param("id"));
    return c.json(review);
  });

  app.onError((err, c) => {
    if (err instanceof ReviewError) {
      return c.json({ error: err.message, code: err.code }, (STATUS_BY_CODE[err.code] ?? 400) as 400);
    }
    return c.json({ error: "erro inesperado" }, 500);
  });

  return app;
}
