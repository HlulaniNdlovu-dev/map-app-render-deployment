// server.js
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import pool  from './db/db.js';
import { authenticateToken } from './middleware/auth.js';
import authenticateAdmin from "./middleware/admin.js"
import  createAuthRouter  from './routes/auth.routes.js';
import userRoute from "./routes/user.routes.js"
import hazardRoute from "./routes/hazards.route.js"
import {adminRouter as adminDestinationRoute,normalUserRouter as userDestinationRoute } from "./routes/destination.routes.js"
import analyse from "./routes/analyse.js"

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_routing_key_123';

app.use(cors());
app.use(express.json());

// Authentication Sign-Up Route
app.use('/api/auth',createAuthRouter)
app.use('/api/users',userRoute)
app.use('/api/hazards', hazardRoute)
app.use('/api/normal-user/destinations', userDestinationRoute)
app.use('/api/admin-user/destinations', authenticateAdmin,adminDestinationRoute)
app.use("/api/analyse", analyse);

// Root endpoint
app.get('/', (req, res) => {
  console.log('Root endpoint accessed');
  res.json({
    message: 'Welcome to Safe Route Monitor API',
    version: '1.0.2',
  });
});
/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on: ${PORT}`);
});
