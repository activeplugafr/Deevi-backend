import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Public()
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 300, windowSeconds: 60, bucket: 'webhook' })
  @ApiOperation({
    summary: 'Receive a provider webhook',
    description:
      'Signature is verified against the raw body before parsing. The event is persisted first, ' +
      'de-duplicated on (provider, event_id), acknowledged with 200 immediately and processed ' +
      'asynchronously with capped retries. Currently routes `payments`. Events that fail verification ' +
      'are still recorded, because a run of bad signatures is worth being able to see.',
  })
  @ApiHeader({
    name: 'x-paystack-signature',
    required: false,
    description: 'HMAC SHA-512 of the raw body. In mock mode the same scheme applies with PAYMENT_WEBHOOK_SECRET.',
  })
  @ApiBody({ description: 'Raw provider event payload', schema: { type: 'object' } })
  @ApiOkResponse({
    schema: {
      example: { received: true, eventId: 'evt_123', duplicate: false, signatureValid: true },
    },
  })
  async receive(
    @Param('provider') provider: string,
    @Body() payload: any,
    @Req() request: any,
    @Headers() headers: Record<string, string>,
  ) {
    const signature =
      headers['x-paystack-signature'] ??
      headers['x-deevi-signature'] ??
      headers['x-webhook-signature'];

    // rawBody is captured by the verify hook in main.ts. Signature checks
    // must run over the exact bytes received, not a re-serialised object.
    const rawBody: string = request.rawBody ?? JSON.stringify(payload ?? {});

    return this.webhooks.ingest(provider, rawBody, signature, headers, payload);
  }
}
