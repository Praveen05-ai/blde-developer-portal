import express from 'express';
import {
  login,
  register,
  setup2FA,
  verify2FA,
  getUsers,
  updateUser,
  getAllSites,
  changePassword,
  activateAccount
} from '../controllers/authController.js';
import { auth, requireRole } from '../middleware/auth.js';
import { checkUserLimit } from '../middleware/licenseVerifier.js';

import { loginLimiter, registerLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public routes
router.post('/login', loginLimiter, login);
router.post('/register', registerLimiter, checkUserLimit, register);
router.post('/activate', activateAccount); // Can be restricted to admin if desired in production

// Private authenticated routes
router.post('/2fa/setup', auth, setup2FA);
router.post('/2fa/verify', auth, verify2FA);
router.post('/change-password', auth, changePassword);

// Admin and PI user management routes
router.get('/users', auth, requireRole(['admin', 'pi']), getUsers);
router.put('/users/:id', auth, requireRole(['admin', 'pi']), updateUser);
router.get('/sites', auth, requireRole(['admin', 'pi', 'project_incharge']), getAllSites);

export default router;
