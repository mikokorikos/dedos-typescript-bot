// ============================================================================
// RUTA: src/application/usecases/middleman/SubmitReviewUseCase.ts
// ============================================================================

import type { TextChannel } from 'discord.js';
import type { Logger } from 'pino';

import { type SubmitReviewDTO,SubmitReviewSchema } from '@/application/dto/review.dto';
import type { IReviewRepository } from '@/domain/repositories/IReviewRepository';
import type { ITicketRepository } from '@/domain/repositories/ITicketRepository';
import { Rating } from '@/domain/value-objects/Rating';
import type { EmbedFactory } from '@/presentation/embeds/EmbedFactory';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import {
  DuplicateReviewError,
  TicketNotFoundError,
  UnauthorizedActionError,
  ValidationFailedError,
} from '@/shared/errors/domain.errors';

export class SubmitReviewUseCase {
  public constructor(
    private readonly reviewRepo: IReviewRepository,
    private readonly ticketRepo: ITicketRepository,
    private readonly embeds: EmbedFactory = embedFactory,
    private readonly logger: Logger,
  ) {}

  public async execute(dto: SubmitReviewDTO, reviewsChannel: TextChannel): Promise<void> {
    const payload = SubmitReviewSchema.parse(dto);

    const ticket = await this.ticketRepo.findById(payload.ticketId);
    if (!ticket) {
      throw new TicketNotFoundError(String(payload.ticketId));
    }

    if (!ticket.isClosed()) {
      throw new ValidationFailedError({ ticketId: 'El ticket debe estar cerrado antes de enviar una reseña.' });
    }

    const reviewerId = BigInt(payload.reviewerId);
    const middlemanId = BigInt(payload.middlemanId);

    const isParticipant = await this.ticketRepo.isParticipant(ticket.id, reviewerId);
    if (!isParticipant && !ticket.isOwnedBy(reviewerId)) {
      throw new UnauthorizedActionError('middleman:review');
    }

    const hasReview = await this.reviewRepo.existsForTicketAndReviewer(ticket.id, reviewerId);
    if (hasReview) {
      throw new DuplicateReviewError(String(ticket.id), payload.reviewerId);
    }

    const trimmedComment = payload.comment?.trim() ?? null;

    if (trimmedComment && trimmedComment.length > 500) {
      throw new ValidationFailedError({ comment: 'El comentario no puede superar los 500 caracteres.' });
    }

    const ratingResult = Rating.create(payload.rating);
    if (ratingResult.isErr()) {
      throw ratingResult.unwrapErr();
    }

    const review = await this.reviewRepo.create({
      ticketId: ticket.id,
      reviewerId,
      middlemanId,
      rating: ratingResult.unwrap(),
      comment: trimmedComment,
    });

    const averageRating = await this.reviewRepo.calculateAverageRating(middlemanId);

    await reviewsChannel.send({
      embeds: [
        this.embeds.reviewPublished({
          ticketId: ticket.id,
          middlemanTag: `<@${payload.middlemanId}>`,
          reviewerTag: `<@${payload.reviewerId}>`,
          rating: review.rating.getValue(),
          comment: trimmedComment,
          averageRating,
        }),
      ],
    });

    this.logger.info(
      {
        ticketId: ticket.id,
        reviewerId: payload.reviewerId,
        middlemanId: payload.middlemanId,
        rating: review.rating.getValue(),
      },
      'Reseña registrada exitosamente.',
    );
  }
}
