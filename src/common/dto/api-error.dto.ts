import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The single error shape returned by every Deevi endpoint. */
export class ApiErrorDto {
  @ApiProperty({ example: 400 }) statusCode: number;
  @ApiProperty({ example: 'VALIDATION_FAILED', description: 'Stable machine-readable error code' })
  code: string;
  @ApiProperty({ example: 'title should not be empty' }) message: string;
  @ApiPropertyOptional({ type: [String], description: 'Field-level validation messages' })
  details?: string[];
  @ApiProperty({ example: '/api/v1/jobs' }) path: string;
  @ApiProperty({ example: '2026-01-01T09:00:00.000Z' }) timestamp: string;
  @ApiPropertyOptional({ description: 'Correlates a client error with server logs' })
  requestId?: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Job published successfully' }) message: string;
}

export class IdResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
}
