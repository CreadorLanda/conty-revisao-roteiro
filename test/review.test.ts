import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { Clock } from "../src/clock.ts";
import { ReviewError, ReviewService } from "../src/review.ts";

function mutableClock(initial: string): { clock: Clock; set: (iso: string) => void } {
  let current = new Date(initial);
  return {
    clock: () => current,
    set: (iso: string) => {
      current = new Date(iso);
    },
  };
}

function serviceAt(initial: string) {
  const time = mutableClock(initial);
  let counter = 0;
  const service = new ReviewService({
    clock: time.clock,
    newId: () => `rev_${(counter += 1)}`,
  });
  return { service, time };
}

describe("fluxo de revisão de roteiro", () => {
  it("percorre submissão, pedido de alteração, nova versão e aprovação", () => {
    const { service, time } = serviceAt("2026-03-10T12:00:00.000Z");
    const opened = service.submitScript("primeira versão");
    expect(opened.state).toBe("pending_review");
    expect(opened.versions).toHaveLength(1);

    const requested = service.requestChanges(opened.id, "ajustar o gancho inicial", "2026-03-20");
    expect(requested.state).toBe("changes_requested");
    expect(requested.changeRequests).toHaveLength(1);

    time.set("2026-03-12T12:00:00.000Z");
    const revised = service.submitNewVersion(opened.id, "segunda versão");
    expect(revised.state).toBe("pending_review");
    expect(revised.versions).toHaveLength(2);

    const approved = service.approve(opened.id);
    expect(approved.state).toBe("approved");
    expect(approved.approvedAt).toBe("2026-03-12T12:00:00.000Z");
  });

  it("preserva as versões antigas quando uma nova chega", () => {
    const { service } = serviceAt("2026-03-10T12:00:00.000Z");
    const opened = service.submitScript("v1");
    service.requestChanges(opened.id, "trocar o call to action", "2026-03-20");
    const revised = service.submitNewVersion(opened.id, "v2");
    expect(revised.versions.map((version) => version.content)).toEqual(["v1", "v2"]);
    expect(revised.versions.map((version) => version.number)).toEqual([1, 2]);
  });
});

describe("regras do pedido de alteração", () => {
  let ctx: ReturnType<typeof serviceAt>;
  let reviewId: string;

  beforeEach(() => {
    ctx = serviceAt("2026-03-10T12:00:00.000Z");
    reviewId = ctx.service.submitScript("roteiro").id;
  });

  it("recusa pedido sem motivo", () => {
    expect(() => ctx.service.requestChanges(reviewId, "   ", "2026-03-20")).toThrowError(
      expect.objectContaining({ code: "missing_reason" }),
    );
  });

  it("recusa pedido sem prazo", () => {
    expect(() => ctx.service.requestChanges(reviewId, "motivo", "")).toThrowError(
      expect.objectContaining({ code: "missing_deadline" }),
    );
  });

  it("recusa prazo que não é um dia civil válido", () => {
    expect(() => ctx.service.requestChanges(reviewId, "motivo", "2026-13-40")).toThrowError(
      expect.objectContaining({ code: "invalid_deadline" }),
    );
  });
});

describe("prazo no fuso da marca", () => {
  it("aceita o pedido no último instante do dia do prazo em São Paulo", () => {
    const { service, time } = serviceAt("2026-03-10T12:00:00.000Z");
    const review = service.submitScript("roteiro");
    time.set("2026-03-13T02:59:59.999Z");
    const requested = service.requestChanges(review.id, "motivo", "2026-03-12");
    expect(requested.state).toBe("changes_requested");
  });

  it("recusa o pedido no primeiro instante do dia seguinte em São Paulo", () => {
    const { service, time } = serviceAt("2026-03-10T12:00:00.000Z");
    const review = service.submitScript("roteiro");
    time.set("2026-03-13T03:00:00.000Z");
    expect(() => service.requestChanges(review.id, "motivo", "2026-03-12")).toThrowError(
      expect.objectContaining({ code: "deadline_passed" }),
    );
  });
});

describe("estado terminal de aprovação", () => {
  let ctx: ReturnType<typeof serviceAt>;
  let reviewId: string;

  beforeEach(() => {
    ctx = serviceAt("2026-03-10T12:00:00.000Z");
    reviewId = ctx.service.submitScript("roteiro").id;
    ctx.service.approve(reviewId);
  });

  it("não aceita nova versão depois de aprovado", () => {
    expect(() => ctx.service.submitNewVersion(reviewId, "nova")).toThrowError(
      expect.objectContaining({ code: "already_approved" }),
    );
  });

  it("não aceita novo pedido de alteração depois de aprovado", () => {
    expect(() => ctx.service.requestChanges(reviewId, "motivo", "2026-03-20")).toThrowError(
      expect.objectContaining({ code: "already_approved" }),
    );
  });
});

describe("transições inválidas", () => {
  it("não aprova enquanto aguarda nova versão", () => {
    const { service } = serviceAt("2026-03-10T12:00:00.000Z");
    const review = service.submitScript("roteiro");
    service.requestChanges(review.id, "motivo", "2026-03-20");
    expect(() => service.approve(review.id)).toThrowError(
      expect.objectContaining({ code: "not_pending" }),
    );
  });

  it("falha ao buscar revisão inexistente", () => {
    const { service } = serviceAt("2026-03-10T12:00:00.000Z");
    expect(() => service.find("rev_inexistente")).toThrowError(ReviewError);
  });
});

describe("camada HTTP", () => {
  function httpApp() {
    const { service } = serviceAt("2026-03-10T12:00:00.000Z");
    return createApp(service);
  }

  async function post(app: ReturnType<typeof createApp>, path: string, body?: unknown) {
    const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.request(path, init);
  }

  it("cria, pede alteração e aprova via HTTP", async () => {
    const app = httpApp();
    const created = await post(app, "/reviews", { content: "roteiro" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const requested = await post(app, `/reviews/${id}/change-requests`, {
      reason: "motivo",
      deadline: "2026-03-20",
    });
    expect(requested.status).toBe(201);

    await post(app, `/reviews/${id}/versions`, { content: "v2" });
    const approved = await post(app, `/reviews/${id}/approval`);
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { state: string }).state).toBe("approved");
  });

  it("devolve 409 quando o prazo já passou", async () => {
    const app = httpApp();
    const created = await post(app, "/reviews", { content: "roteiro" });
    const { id } = (await created.json()) as { id: string };
    const requested = await post(app, `/reviews/${id}/change-requests`, {
      reason: "motivo",
      deadline: "2000-01-01",
    });
    expect(requested.status).toBe(409);
    expect(((await requested.json()) as { code: string }).code).toBe("deadline_passed");
  });
});
