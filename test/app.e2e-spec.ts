import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * Smoke-level end-to-end coverage. Requires a reachable Supabase project with
 * the migrations applied; skipped automatically when SUPABASE_URL is absent so
 * the suite stays green on a fresh clone.
 */
const describeIfConfigured = process.env.SUPABASE_URL ? describe : describe.skip;

describeIfConfigured('Deevi API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('reports liveness without authentication', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('rejects unauthenticated access to a protected route', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('serves the public service catalogue', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/catalogue/categories')
      .expect(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('validates the signup payload', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: 'not-an-email', password: 'short', role: 'WIZARD' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });
});
