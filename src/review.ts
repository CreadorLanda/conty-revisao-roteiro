import type { Clock } from "./clock.ts";
import { BRAND_TIME_ZONE, endOfCivilDay, isCivilDay } from "./timezone.ts";

export type ReviewState = "pending_review" | "changes_requested" | "approved";

export type ScriptVersion = {
  number: number;
  content: string;
  submittedAt: string;
};

export type ChangeRequest = {
  reason: string;
  deadline: string;
  requestedAt: string;
};

export type Review = {
  id: string;
  state: ReviewState;
  versions: ScriptVersion[];
  changeRequests: ChangeRequest[];
  createdAt: string;
  approvedAt: string | null;
};

export type ReviewErrorCode =
  | "not_found"
  | "empty_content"
  | "missing_reason"
  | "missing_deadline"
  | "invalid_deadline"
  | "deadline_passed"
  | "not_pending"
  | "already_approved";

export class ReviewError extends Error {
  constructor(readonly code: ReviewErrorCode, message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

function requireContent(content: unknown): string {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) throw new ReviewError("empty_content", "conteúdo do roteiro é obrigatório");
  return text;
}

function snapshot(review: Review): Review {
  return {
    ...review,
    versions: review.versions.map((version) => ({ ...version })),
    changeRequests: review.changeRequests.map((request) => ({ ...request })),
  };
}

export type ReviewServiceOptions = {
  clock: Clock;
  timeZone?: string;
  newId?: () => string;
};

export class ReviewService {
  private readonly reviews = new Map<string, Review>();
  private readonly clock: Clock;
  private readonly timeZone: string;
  private readonly newId: () => string;

  constructor(options: ReviewServiceOptions) {
    this.clock = options.clock;
    this.timeZone = options.timeZone ?? BRAND_TIME_ZONE;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  submitScript(content: unknown): Review {
    const body = requireContent(content);
    const at = this.clock().toISOString();
    const review: Review = {
      id: this.newId(),
      state: "pending_review",
      versions: [{ number: 1, content: body, submittedAt: at }],
      changeRequests: [],
      createdAt: at,
      approvedAt: null,
    };
    this.reviews.set(review.id, review);
    return snapshot(review);
  }

  submitNewVersion(id: string, content: unknown): Review {
    const review = this.require(id);
    if (review.state === "approved") {
      throw new ReviewError("already_approved", "roteiro aprovado não aceita nova versão");
    }
    const body = requireContent(content);
    review.versions.push({
      number: review.versions.length + 1,
      content: body,
      submittedAt: this.clock().toISOString(),
    });
    review.state = "pending_review";
    return snapshot(review);
  }

  requestChanges(id: string, reason: unknown, deadline: unknown): Review {
    const review = this.require(id);
    if (review.state === "approved") {
      throw new ReviewError("already_approved", "roteiro aprovado não aceita pedido de alteração");
    }
    if (review.state !== "pending_review") {
      throw new ReviewError("not_pending", "só é possível pedir alteração enquanto a versão aguarda revisão");
    }
    const cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (!cleanReason) throw new ReviewError("missing_reason", "pedido de alteração exige motivo");
    if (deadline === undefined || deadline === null || deadline === "") {
      throw new ReviewError("missing_deadline", "pedido de alteração exige prazo");
    }
    if (!isCivilDay(deadline)) {
      throw new ReviewError("invalid_deadline", "prazo deve ser um dia no formato AAAA-MM-DD");
    }
    const now = this.clock();
    if (now.getTime() > endOfCivilDay(deadline, this.timeZone).getTime()) {
      throw new ReviewError("deadline_passed", "prazo já passou");
    }
    review.changeRequests.push({
      reason: cleanReason,
      deadline,
      requestedAt: now.toISOString(),
    });
    review.state = "changes_requested";
    return snapshot(review);
  }

  approve(id: string): Review {
    const review = this.require(id);
    if (review.state === "approved") {
      throw new ReviewError("already_approved", "roteiro já está aprovado");
    }
    if (review.state !== "pending_review") {
      throw new ReviewError("not_pending", "só é possível aprovar a versão que aguarda revisão");
    }
    review.state = "approved";
    review.approvedAt = this.clock().toISOString();
    return snapshot(review);
  }

  find(id: string): Review {
    return snapshot(this.require(id));
  }

  private require(id: string): Review {
    const review = this.reviews.get(id);
    if (!review) throw new ReviewError("not_found", "revisão não encontrada");
    return review;
  }
}
