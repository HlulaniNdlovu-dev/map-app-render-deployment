// server.js
import './env.js'; // MUST be the first import — see env.js for why
import express from 'express';
import cors from 'cors';
import pool  from './db/db.js';
import { authenticateToken } from './middleware/auth.js';
import authenticateAdmin from "./middleware/admin.js"
import  createAuthRouter  from './routes/auth.routes.js';
import userRoute from "./routes/user.routes.js"
import hazardRoute from "./routes/hazards.route.js"
import {adminRouter as adminDestinationRoute,normalUserRouter as userDestinationRoute } from "./routes/destination.routes.js"
import analyse from "./routes/analyse.js"
import reportsRoute from "./routes/reports.routes.js"
import aiRoute from "./routes/ai.routes.js"
import geocodeRoute from "./routes/geocode.routes.js"
import notificationsRoute from "./routes/notifications.routes.js"

const app = express();

app.use(cors());
app.use(express.json());

// Authentication Sign-Up Route
app.use('/api/auth',createAuthRouter)
app.use('/api/users',userRoute)
app.use('/api/hazards', hazardRoute)
app.use('/api/normal-user/destinations', authenticateToken, userDestinationRoute)
app.use('/api/admin-user/destinations', authenticateToken, authenticateAdmin, adminDestinationRoute)
app.use("/api/analyse", analyse);
app.use("/api/reports", reportsRoute);
app.use("/api/ai", aiRoute);
app.use("/api/geocode", geocodeRoute);
app.use("/api/notifications", notificationsRoute);

// Root endpoint
app.get('/', (req, res) => {
  console.log('Root endpoint accessed');
  res.json({
    message: 'Welcome to Safe Route Monitor API',
    version: '1.0.2',
  });
});

// Catch-all for unmatched routes — JSON instead of Express's default HTML.
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found.' });
});

// Global error handler. Must be registered last, after every route. Catches
// anything a route handler throws or an awaited promise rejects with
// (Express 5 forwards both automatically, sync or async, no per-route
// try/catch wrapper needed) plus body-parser errors (malformed JSON body).
// Always responds with JSON and never leaks a stack trace to the client —
// before this existed, an uncaught error fell through to Express's default
// handler, which returns a raw HTML page with the full stack trace.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: status === 400 ? 'Malformed request body.' : 'Internal server error.',
  });
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on: ${PORT}`);
});
