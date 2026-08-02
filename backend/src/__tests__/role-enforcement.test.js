// Proves that a driver's JWT is rejected by every staff-only route.
// Mounts the SAME production router modules used by server.js into a
// minimal test app (no real port bound, no DB writes needed — the role
// middleware rejects before any handler reaches a pool.query call), so
// this exercises the actual authenticateToken/requireRole/adminWare
// middleware chain, not a reimplementation of it.
import '../env.js';
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import hazardRoute from '../routes/hazards.route.js';
import reportsRoute from '../routes/reports.routes.js';
import { adminRouter, normalUserRouter } from '../routes/destination.routes.js';
import { authenticateToken } from '../middleware/auth.js';
import authenticateAdmin from '../middleware/admin.js';

const app = express();
app.use(express.json());
app.use('/api/hazards', hazardRoute);
app.use('/api/reports', reportsRoute);
app.use('/api/normal-user/destinations', authenticateToken, normalUserRouter);
app.use('/api/admin-user/destinations', authenticateToken, authenticateAdmin, adminRouter);

function tokenFor(userType, userId = 1) {
  return jwt.sign({ userId, userType }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const driverToken = tokenFor('driver');

describe('Role enforcement: a driver token is rejected by staff-only routes', () => {
  it('GET /api/reports/safety (admin-only) -> 403', async () => {
    const res = await request(app).get('/api/reports/safety').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/reports/hotspots (data_analyst/admin-only) -> 403', async () => {
    const res = await request(app).get('/api/reports/hotspots').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/reports/trips (admin/data_analyst-only) -> 403', async () => {
    const res = await request(app).get('/api/reports/trips').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/reports/hazard-responses (staff-only) -> 403', async () => {
    const res = await request(app).get('/api/reports/hazard-responses').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  it('PATCH /api/hazards/:id/status (staff-only) -> 403', async () => {
    const res = await request(app)
      .patch('/api/hazards/1/status')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });

  it('GET /api/admin-user/destinations (admin-only) -> 403', async () => {
    const res = await request(app).get('/api/admin-user/destinations').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  it('no token at all -> 401, not 403', async () => {
    const res = await request(app).get('/api/reports/safety');
    expect(res.status).toBe(401);
  });

  it('a driver CAN reach their own driver-only route (POST /api/hazards)', async () => {
    // Sanity check the negative tests above aren't rejecting for the
    // wrong reason (e.g. a broken token) — a driver must still be able
    // to reach routes that ARE meant for them. adminWare/requireRole
    // aren't in the way here, so this should get past auth even though
    // the request body is intentionally incomplete (400, not 401/403).
    const res = await request(app)
      .post('/api/hazards')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
