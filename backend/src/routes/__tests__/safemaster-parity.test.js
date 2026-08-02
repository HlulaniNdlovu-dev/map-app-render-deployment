import { describe, it, expect } from 'vitest';
import { scoreRoutePath } from '../../lib/safemaster.js';
import fixture from '../__fixtures__/safemaster-vectors.json' with { type: 'json' };

// Guards SafeMaster Rule 3: the backend and frontend ports must compute
// identical riskScore/riskLevel/incidentsOnRoute for the same route +
// hazard input. This file and frontend_v2/src/lib/__tests__/safemaster-parity.test.ts
// run the SAME fixture (safemaster-vectors.json, kept byte-identical across
// both repos) through each port's own scoreRoutePath — if a future change
// to one port's scoring logic isn't mirrored in the other, one of these two
// test files fails.
describe('SafeMaster scoreRoutePath (backend port) matches shared fixture', () => {
  for (const vector of fixture.vectors) {
    it(vector.name, () => {
      const events = vector.hazards.map((h) => ({ id: h.id, latitude: h.lat, longitude: h.lon }));
      const result = scoreRoutePath(vector.coordinates, 'Test Start', 'Test End', {
        events,
        areas: [],
        alerts: [],
      });
      expect(result.riskScore).toBe(vector.expected.riskScore);
      expect(result.riskLevelLabel).toBe(vector.expected.riskLevel);
      expect(result.incidentsOnRoute).toBe(vector.expected.incidentsOnRoute);
    });
  }
});
